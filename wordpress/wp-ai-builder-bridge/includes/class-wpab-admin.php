<?php
/**
 * wp-admin screens.
 *
 * Three pages under one menu:
 *
 *   AI Builder            the bridge token, the project scopes, write policy
 *   Snapshots             every deployment this site has taken, with rollback
 *   Activity log          what the bridge did and when
 *
 * WPAB_Cloud adds a fourth ("Cloud connection") for the reverse direction.
 *
 * Every form posts to admin-post.php with a nonce and is gated on
 * manage_options in the handler, not merely by hiding the menu.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Admin {

	private const MENU_SLUG      = 'wp-ai-builder';
	private const BRIDGE_SLUG    = 'wp-ai-builder-bridge';
	private const SNAPSHOTS_SLUG = 'wp-ai-builder-snapshots';
	private const LOG_SLUG       = 'wp-ai-builder-log';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
		add_action( 'admin_post_wpab_generate_token', array( __CLASS__, 'handle_generate_token' ) );
		add_action( 'admin_post_wpab_revoke_token', array( __CLASS__, 'handle_revoke_token' ) );
		add_action( 'admin_post_wpab_clear_log', array( __CLASS__, 'handle_clear_log' ) );
		add_filter( 'plugin_action_links_' . WPAB_BASENAME, array( __CLASS__, 'action_links' ) );
	}

	public static function action_links( $links ) {
		$url = admin_url( 'admin.php?page=' . self::BRIDGE_SLUG );

		array_unshift( $links, '<a href="' . esc_url( $url ) . '">Settings</a>' );

		return $links;
	}

	public static function register_menu(): void {
		// The top level is the AI Editor — the single unified tool (live
		// preview + chat + build + content). Everything else is a support
		// submenu. The submenu parents used by Cloud / Snapshots / Log /
		// Editor (all 'wp-ai-builder') stay intact.
		add_menu_page(
			'ESCANOR AI Builder',
			'ESCANOR',
			'manage_options',
			self::MENU_SLUG,
			array( 'WPAB_Editor', 'render_page' ),
			'dashicons-superhero',
			58
		);

		add_submenu_page(
			self::MENU_SLUG,
			'ESCANOR — AI Editor',
			'AI Editor',
			'manage_options',
			self::MENU_SLUG,
			array( 'WPAB_Editor', 'render_page' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'AI Builder — Bridge',
			'Bridge settings',
			'manage_options',
			self::BRIDGE_SLUG,
			array( __CLASS__, 'render_main' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'AI Builder — Activity log',
			'Activity log',
			'manage_options',
			self::LOG_SLUG,
			array( __CLASS__, 'render_log' )
		);
	}

	/* ---------------------------------------------------------------------
	 * Handlers
	 * ------------------------------------------------------------------ */

	private static function guard( string $nonce_action ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You are not allowed to do this.', '', array( 'response' => 403 ) );
		}

		check_admin_referer( $nonce_action );
	}

	private static function back( string $page, string $notice, array $extra = array() ): void {
		wp_safe_redirect(
			add_query_arg(
				array_merge(
					array(
						'page'        => $page,
						'wpab_notice' => $notice,
					),
					$extra
				),
				admin_url( 'admin.php' )
			)
		);

		exit;
	}

	/**
	 * The plaintext token exists for exactly one page render, held in a short
	 * transient scoped to the administrator who pressed the button.
	 */
	private static function stash_token( string $token ): void {
		set_transient( 'wpab_new_token_' . get_current_user_id(), $token, 300 );
	}

	private static function take_token(): string {
		$key   = 'wpab_new_token_' . get_current_user_id();
		$token = (string) get_transient( $key );

		if ( '' !== $token ) {
			delete_transient( $key );
		}

		return $token;
	}

	public static function handle_generate_token(): void {
		self::guard( 'wpab_generate_token' );

		$existing = WPAB_Auth::has_token();
		$token    = WPAB_Auth::generate_token();

		self::stash_token( $token );

		WPAB_Log::add( $existing ? 'token_regenerated' : 'token_generated' );

		self::back( self::BRIDGE_SLUG, $existing ? 'token_regenerated' : 'token_generated' );
	}

	public static function handle_revoke_token(): void {
		self::guard( 'wpab_revoke_token' );

		WPAB_Auth::revoke_token();
		WPAB_Log::add( 'token_revoked' );

		self::back( self::BRIDGE_SLUG, 'token_revoked' );
	}

	public static function handle_clear_log(): void {
		self::guard( 'wpab_clear_log' );

		WPAB_Log::clear();

		self::back( self::LOG_SLUG, 'log_cleared' );
	}

	/* ---------------------------------------------------------------------
	 * Shared rendering helpers
	 * ------------------------------------------------------------------ */

	private static function notice(): string {
		return isset( $_GET['wpab_notice'] ) ? sanitize_key( wp_unslash( $_GET['wpab_notice'] ) ) : '';
	}

	private static function detail(): string {
		return isset( $_GET['wpab_detail'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['wpab_detail'] ) ) ) : '';
	}

	private static function pill( bool $on, string $on_label = 'Yes', string $off_label = 'No' ): string {
		$color = $on ? '#00a32a' : '#8c8f94';

		return '<span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:11px;color:#fff;background:' . $color . '">'
			. esc_html( $on ? $on_label : $off_label )
			. '</span>';
	}

	private static function local_time( string $iso ): string {
		if ( '' === $iso ) {
			return '—';
		}

		$timestamp = strtotime( $iso );

		if ( ! $timestamp ) {
			return '—';
		}

		return wp_date( 'Y-m-d H:i', $timestamp );
	}

	/* ---------------------------------------------------------------------
	 * Main page
	 * ------------------------------------------------------------------ */

	public static function render_main(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$notice    = self::notice();
		$new_token = self::take_token();
		$theme     = WPAB_Scopes::theme();
		?>
		<div class="wrap">
			<h1>AI Builder — Bridge</h1>
			<p class="description">
				Bridge <?php echo esc_html( WPAB_VERSION ); ?> connects this site to the AI Builder.
				The builder reads the active theme and the site's content so the AI Editor can
				inspect and answer questions about this site.
			</p>

			<?php if ( 'token_revoked' === $notice ) : ?>
				<div class="notice notice-success is-dismissible"><p>Bridge token revoked. The builder can no longer reach this site.</p></div>
			<?php elseif ( 'token_regenerated' === $notice ) : ?>
				<div class="notice notice-warning is-dismissible"><p>A new bridge token was generated. The previous token stopped working immediately — paste the new one into the builder.</p></div>
			<?php endif; ?>

			<?php if ( '' !== $new_token ) : ?>
				<div class="notice notice-success">
					<p><strong>Copy this bridge token now. It is shown once and never again.</strong></p>
					<p>
						<input
							type="text"
							readonly
							onfocus="this.select()"
							value="<?php echo esc_attr( $new_token ); ?>"
							style="width:100%;max-width:640px;font-family:monospace;padding:6px"
						/>
					</p>
					<p class="description">Paste it into the builder dashboard under your project's WordPress connection.</p>
				</div>
			<?php endif; ?>

			<h2>Connection</h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Bridge token</th>
					<td>
						<?php if ( WPAB_Auth::has_token() ) : ?>
							<?php echo self::pill( true, 'Active' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
							<code><?php echo esc_html( WPAB_Auth::token_hint() ); ?></code>
							<p class="description">
								Created <?php echo esc_html( self::local_time( WPAB_Auth::created_at() ) ); ?> ·
								Last used <?php echo esc_html( self::local_time( WPAB_Auth::last_used_at() ) ); ?>
							</p>
						<?php else : ?>
							<?php echo self::pill( false, '', 'Not generated' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
							<p class="description">The bridge refuses every request until a token exists.</p>
						<?php endif; ?>

						<p>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
								<?php wp_nonce_field( 'wpab_generate_token' ); ?>
								<input type="hidden" name="action" value="wpab_generate_token" />
								<?php
								submit_button(
									WPAB_Auth::has_token() ? 'Regenerate token' : 'Generate token',
									'primary',
									'submit',
									false,
									WPAB_Auth::has_token()
										? array( 'onclick' => "return confirm('Regenerating invalidates the current token immediately. Continue?')" )
										: array()
								);
								?>
							</form>

							<?php if ( WPAB_Auth::has_token() ) : ?>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;margin-left:8px">
									<?php wp_nonce_field( 'wpab_revoke_token' ); ?>
									<input type="hidden" name="action" value="wpab_revoke_token" />
									<?php submit_button( 'Revoke', 'delete', 'submit', false, array( 'onclick' => "return confirm('Revoke the bridge token? The builder will lose access to this site.')" ) ); ?>
								</form>
							<?php endif; ?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Site URL</th>
					<td><code><?php echo esc_html( home_url( '/' ) ); ?></code></td>
				</tr>
				<tr>
					<th scope="row">Bridge endpoint</th>
					<td><code><?php echo esc_html( rest_url( WPAB_REST_NAMESPACE ) ); ?></code></td>
				</tr>
				<tr>
					<th scope="row">Active theme</th>
					<td>
						<?php if ( ! empty( $theme['available'] ) ) : ?>
							<strong><?php echo esc_html( (string) $theme['label'] ); ?></strong>
							<code><?php echo esc_html( (string) $theme['slug'] ); ?></code>
						<?php else : ?>
							<em><?php echo esc_html( isset( $theme['reason'] ) ? $theme['reason'] : 'Unavailable.' ); ?></em>
						<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th scope="row">Access</th>
					<td><?php echo self::pill( true, 'Read-only' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
						<p class="description">The bridge reads the theme and content so the AI Editor can inspect this site. It does not modify files.</p>
					</td>
				</tr>
			</table>
		</div>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * Activity log page
	 * ------------------------------------------------------------------ */

	public static function render_log(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$entries = WPAB_Log::all();
		?>
		<div class="wrap">
			<h1>AI Builder — Activity log</h1>
			<p class="description">The last <?php echo esc_html( (string) count( $entries ) ); ?> bridge events on this site. File contents and secrets are never logged.</p>

			<?php if ( 'log_cleared' === self::notice() ) : ?>
				<div class="notice notice-success is-dismissible"><p>Activity log cleared.</p></div>
			<?php endif; ?>

			<table class="widefat striped">
				<thead>
					<tr>
						<th style="width:170px">When</th>
						<th style="width:180px">Event</th>
						<th style="width:140px">Actor</th>
						<th>Detail</th>
					</tr>
				</thead>
				<tbody>
					<?php if ( empty( $entries ) ) : ?>
						<tr><td colspan="4"><em>Nothing logged yet.</em></td></tr>
					<?php endif; ?>

					<?php foreach ( $entries as $entry ) : ?>
						<tr>
							<td><?php echo esc_html( self::local_time( (string) $entry['time'] ) ); ?></td>
							<td><code><?php echo esc_html( (string) $entry['event'] ); ?></code></td>
							<td><?php echo esc_html( (string) $entry['actor'] ); ?></td>
							<td>
								<?php
								$context = isset( $entry['context'] ) && is_array( $entry['context'] ) ? $entry['context'] : array();

								foreach ( $context as $key => $value ) {
									$printable = is_array( $value ) ? implode( ', ', $value ) : (string) $value;

									echo '<div><span class="description">' . esc_html( (string) $key ) . ':</span> ' . esc_html( $printable ) . '</div>';
								}
								?>
							</td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:16px">
				<?php wp_nonce_field( 'wpab_clear_log' ); ?>
				<input type="hidden" name="action" value="wpab_clear_log" />
				<?php submit_button( 'Clear log', 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}
}
