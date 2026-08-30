<?php
/**
 * The three things a site owner needs telling, and nothing else.
 *
 * An admin notice is expensive: it appears above someone else's work, on a
 * screen they opened for another reason. So there are exactly three, each tied
 * to something that will otherwise fail silently — the connection is missing,
 * the credits will not cover the next generation, or a fix has shipped that
 * this site has not taken.
 *
 * Two rules keep them from becoming noise. Every notice that is merely useful
 * can be dismissed for a day; only the ones that block work outright cannot.
 * And the balance is never fetched on a screen the person did not open for
 * Meikero — the WordPress dashboard must not pay for a network call to show a
 * warning nobody asked for.
 *
 * @package Meikero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Notices {

	private const DISMISS_OPTION = 'wpab_notice_dismissed';
	private const BALANCE_CACHE  = 'wpab_balance_cache';
	private const BALANCE_TTL    = 10 * MINUTE_IN_SECONDS;

	/** Roughly what one full site generation costs. Below this the next one fails. */
	private const LOW_CREDITS = 50;

	private const DISMISS_FOR = DAY_IN_SECONDS;

	public static function init(): void {
		add_action( 'admin_notices', array( __CLASS__, 'render' ) );
		add_action( 'admin_post_wpab_dismiss_notice', array( __CLASS__, 'handle_dismiss' ) );
		add_action( 'admin_post_wpab_check_update', array( __CLASS__, 'handle_check_update' ) );
	}

	/* ------------------------------------------------------------------ */

	/**
	 * Meikero's own screens, where a network call is expected and welcome.
	 *
	 * The prefix is the menu slug, `wp-ai-builder` — not the `wpab` used for
	 * class names and options. Matching the wrong one would silently mean the
	 * balance was never fetched anywhere, and the credit warning never appeared.
	 */
	private static function on_meikero_screen(): bool {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';

		return '' !== $page && 0 === strpos( $page, 'wp-ai-builder' );
	}

	/** Screens where a notice is worth showing at all. */
	private static function on_relevant_screen(): bool {
		if ( self::on_meikero_screen() ) {
			return true;
		}

		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		return $screen && in_array( $screen->id, array( 'dashboard', 'plugins' ), true );
	}

	private static function dismissed(): array {
		$stored = get_option( self::DISMISS_OPTION, array() );

		return is_array( $stored ) ? $stored : array();
	}

	private static function is_dismissed( string $key ): bool {
		$all = self::dismissed();

		return isset( $all[ $key ] ) && (int) $all[ $key ] > time();
	}

	private static function dismiss_link( string $key ): string {
		return wp_nonce_url(
			admin_url( 'admin-post.php?action=wpab_dismiss_notice&notice=' . rawurlencode( $key ) ),
			'wpab_dismiss_' . $key
		);
	}

	public static function handle_dismiss(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You cannot do that.', 'wp-ai-builder-bridge' ) );
		}

		$key = isset( $_GET['notice'] ) ? sanitize_key( wp_unslash( $_GET['notice'] ) ) : '';

		check_admin_referer( 'wpab_dismiss_' . $key );

		if ( '' !== $key ) {
			$all         = self::dismissed();
			$all[ $key ] = time() + self::DISMISS_FOR;
			update_option( self::DISMISS_OPTION, $all, false );
		}

		wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url() );
		exit;
	}

	/**
	 * Force an update check now, rather than waiting out two caches.
	 *
	 * A published fix used to take up to seven hours to become visible: the
	 * manifest is cached by the plugin and WordPress caches its own update
	 * transient on top. Both are cleared here so the Plugins screen tells the
	 * truth the moment someone asks it to.
	 */
	public static function handle_check_update(): void {
		if ( ! current_user_can( 'update_plugins' ) ) {
			wp_die( esc_html__( 'You cannot do that.', 'wp-ai-builder-bridge' ) );
		}

		check_admin_referer( 'wpab_check_update' );

		if ( class_exists( 'WPAB_Updater' ) ) {
			WPAB_Updater::flush();
		}

		delete_site_transient( 'update_plugins' );
		wp_update_plugins();

		wp_safe_redirect( admin_url( 'plugins.php' ) );
		exit;
	}

	/* ------------------------------------------------------------------ */

	/**
	 * The credit balance, cached.
	 *
	 * Fetched only from Meikero's own screens. Elsewhere a stale-but-present
	 * value is used and a missing one simply means no notice — a warning is not
	 * worth a network round trip on a page opened for something else.
	 */
	private static function balance(): ?int {
		$cached = get_transient( self::BALANCE_CACHE );

		if ( is_numeric( $cached ) ) {
			return (int) $cached;
		}

		if ( ! self::on_meikero_screen() || ! class_exists( 'WPAB_Cloud' ) || ! WPAB_Cloud::has_key() ) {
			return null;
		}

		$session = WPAB_Cloud::session();

		if ( is_wp_error( $session ) || ! is_array( $session ) || ! isset( $session['credits']['balance'] ) ) {
			return null;
		}

		$balance = (int) $session['credits']['balance'];

		set_transient( self::BALANCE_CACHE, $balance, self::BALANCE_TTL );

		return $balance;
	}

	/** The balance changed, so the cached one is wrong. */
	public static function forget_balance(): void {
		delete_transient( self::BALANCE_CACHE );
	}

	/* ------------------------------------------------------------------ */

	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) || ! self::on_relevant_screen() ) {
			return;
		}

		$connected = class_exists( 'WPAB_Cloud' ) && WPAB_Cloud::has_key();

		if ( ! $connected ) {
			self::not_connected();
			return;
		}

		self::credits();
		self::update_available();
	}

	private static function not_connected(): void {
		// Not dismissible: nothing in the plugin works until this is done, so
		// hiding it would only postpone the same discovery.
		$settings = esc_url( admin_url( 'admin.php?page=wp-ai-builder-bridge' ) );

		echo '<div class="notice notice-warning"><p><strong>Meikero is not connected.</strong> ';
		echo 'Paste your site key to start generating themes. ';
		echo '<a href="' . esc_url( $settings ) . '">Connect this site</a></p></div>';
	}

	private static function credits(): void {
		$balance = self::balance();

		if ( null === $balance ) {
			return;
		}

		$account = 'https://meikero.com/dashboard/billing';

		if ( $balance <= 0 ) {
			// Also not dismissible: the AI Editor is refusing work right now.
			echo '<div class="notice notice-error"><p><strong>Meikero is out of credits.</strong> ';
			echo 'Generating and editing are paused until you top up. ';
			echo '<a href="' . esc_url( $account ) . '" target="_blank" rel="noopener">Top up credits</a></p></div>';
			return;
		}

		if ( $balance >= self::LOW_CREDITS || self::is_dismissed( 'credits' ) ) {
			return;
		}

		echo '<div class="notice notice-warning"><p><strong>Meikero credits are running low — ';
		echo esc_html( (string) $balance ) . ' left.</strong> ';
		echo 'A full site generation needs about ' . esc_html( (string) self::LOW_CREDITS ) . '. ';
		echo '<a href="' . esc_url( $account ) . '" target="_blank" rel="noopener">Top up</a> · ';
		echo '<a href="' . esc_url( self::dismiss_link( 'credits' ) ) . '">Remind me tomorrow</a></p></div>';
	}

	private static function update_available(): void {
		if ( ! class_exists( 'WPAB_Updater' ) || ! current_user_can( 'update_plugins' ) ) {
			return;
		}

		$latest = WPAB_Updater::newer_version();

		if ( ! $latest || self::is_dismissed( 'update_' . $latest ) ) {
			return;
		}

		$plugins = esc_url( admin_url( 'plugins.php' ) );

		echo '<div class="notice notice-info"><p><strong>Meikero Bridge ' . esc_html( $latest );
		echo ' is available.</strong> You are on ' . esc_html( (string) WPAB_VERSION ) . '. ';
		echo '<a href="' . esc_url( $plugins ) . '">Update on the Plugins screen</a> · ';
		echo '<a href="' . esc_url( self::dismiss_link( 'update_' . $latest ) ) . '">Not now</a></p></div>';
	}

	/** The "check now" control, for wherever a screen wants to offer it. */
	public static function check_update_url(): string {
		return wp_nonce_url(
			admin_url( 'admin-post.php?action=wpab_check_update' ),
			'wpab_check_update'
		);
	}
}
