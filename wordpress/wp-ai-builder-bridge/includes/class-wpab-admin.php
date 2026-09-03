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
	private const EDITOR_SLUG    = 'wp-ai-builder-editor';
	private const DESIGN_SLUG    = 'wp-ai-builder-design';
	private const BRIDGE_SLUG    = 'wp-ai-builder-bridge';
	private const LOG_SLUG       = 'wp-ai-builder-log';

	/**
	 * The design's pages as JSON for the card, from either shape.
	 *
	 * A design's screens used to be a fixed list of six names the browser could
	 * label from a table it held itself. They are the site's own pages now — the
	 * labels come with them — and an older job result still sends bare strings,
	 * so both are normalised to {slug,label} here rather than in three places in
	 * the JavaScript.
	 */
	public static function page_list_json( $available ) {
		$fallback = array( array( 'slug' => 'home', 'label' => 'Homepage' ) );

		if ( ! is_array( $available ) || ! $available ) {
			return wp_json_encode( $fallback );
		}

		$legacy = array(
			'home'       => 'Homepage',
			'archive'    => 'Blog',
			'post'       => 'Blog post',
			'notfound'   => '404',
			'inner'      => 'Inner page',
			'components' => 'Components',
			'brand'      => 'Brand sheet',
		);

		$out = array();

		foreach ( $available as $entry ) {
			if ( is_array( $entry ) ) {
				$slug  = sanitize_key( isset( $entry['slug'] ) ? $entry['slug'] : '' );
				$label = isset( $entry['label'] ) ? sanitize_text_field( (string) $entry['label'] ) : '';
			} else {
				$slug  = sanitize_key( (string) $entry );
				$label = '';
			}

			if ( '' === $slug ) {
				continue;
			}

			if ( '' === $label ) {
				$label = isset( $legacy[ $slug ] ) ? $legacy[ $slug ] : ucfirst( str_replace( '-', ' ', $slug ) );
			}

			$out[] = array( 'slug' => $slug, 'label' => $label );
		}

		return wp_json_encode( $out ? $out : $fallback );
	}

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
		add_action( 'admin_post_wpab_generate_token', array( __CLASS__, 'handle_generate_token' ) );
		add_action( 'admin_post_wpab_revoke_token', array( __CLASS__, 'handle_revoke_token' ) );
		add_action( 'admin_post_wpab_clear_log', array( __CLASS__, 'handle_clear_log' ) );
		add_filter( 'plugin_action_links_' . WPAB_BASENAME, array( __CLASS__, 'action_links' ) );
	}

	public static function action_links( $links ) {
		$url = admin_url( 'admin.php?page=' . self::BRIDGE_SLUG );

		// "Check for updates" sits here rather than on a Meikero screen because
		// this is where someone already is when they wonder whether they are on
		// the current version.
		if ( class_exists( 'WPAB_Notices' ) && current_user_can( 'update_plugins' ) ) {
			array_unshift(
				$links,
				'<a href="' . esc_url( WPAB_Notices::check_update_url() ) . '">Check for updates</a>'
			);
		}

		array_unshift( $links, '<a href="' . esc_url( $url ) . '">Settings</a>' );

		return $links;
	}

	public static function register_menu(): void {
		// The top level is the AI Editor — the single unified tool (live
		// preview + chat + build + content). Everything else is a support
		// submenu. The submenu parents used by Cloud / Snapshots / Log /
		// Editor (all 'wp-ai-builder') stay intact.
		add_menu_page(
			'Meikero',
			'Meikero',
			'manage_options',
			self::MENU_SLUG,
			array( __CLASS__, 'render_dashboard' ),
			'dashicons-superhero',
			58
		);

		add_submenu_page(
			self::MENU_SLUG,
			'Meikero — Dashboard',
			'Dashboard',
			'manage_options',
			self::MENU_SLUG,
			array( __CLASS__, 'render_dashboard' )
		);

		// Designing a theme comes before editing one, and reads first.
		add_submenu_page(
			self::MENU_SLUG,
			'Meikero — Wizard',
			'Wizard',
			'manage_options',
			self::DESIGN_SLUG,
			array( 'WPAB_Editor', 'render_design_page' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'Meikero — AI Editor',
			'AI Editor',
			'manage_options',
			self::EDITOR_SLUG,
			array( 'WPAB_Editor', 'render_page' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'Meikero — Bridge',
			'Bridge settings',
			'manage_options',
			self::BRIDGE_SLUG,
			array( __CLASS__, 'render_main' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'Meikero — Activity log',
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

	/** First menu section: the usage & prices dashboard. */
	public static function render_dashboard(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$connected = class_exists( 'WPAB_Cloud' ) && WPAB_Cloud::has_key();
		$report    = $connected ? WPAB_Cloud::request( 'agent/usage', array(), 20 ) : null;
		$editor    = esc_url( admin_url( 'admin.php?page=' . self::EDITOR_SLUG ) );

		// The balance rides along on the handshake, so the person working here
		// sees what is left before a generation is refused rather than after.
		$session = $connected ? WPAB_Cloud::session() : null;
		$credits = ( is_array( $session ) && isset( $session['credits'] ) && is_array( $session['credits'] ) )
			? $session['credits']
			: null;
		$account_url = ( is_array( $session ) && ! empty( $session['accountUrl'] ) )
			? (string) $session['accountUrl']
			: 'https://meikero.com/dashboard';

		$stage_labels = array(
			'design' => 'Design (mockup)',
			'plan'   => 'Page plan',
			'build'  => 'File generation',
			'edit'   => 'Edits',
			'chat'   => 'Chat',
			'review' => 'Quality check',
		);

		$fmt = static function ( $n ) {
			$n = (float) $n;
			if ( $n >= 1000000 ) { return round( $n / 1000000, 1 ) . 'M'; }
			if ( $n >= 1000 ) { return round( $n / 1000, 1 ) . 'k'; }
			return (string) (int) $n;
		};
		$money = static function ( $n ) {
			if ( null === $n || '' === $n ) { return '—'; }
			$n = (float) $n;
			return '$' . ( ( $n > 0 && $n < 0.01 ) ? number_format( $n, 4 ) : number_format( $n, 2 ) );
		};
		?>
		<div class="wrap" style="max-width:1080px;">
			<style>
				.wpabd-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:18px 0; }
				.wpabd-card { background:#fff; border:1px solid rgba(20,19,18,.08); border-radius:14px; padding:14px 16px; }
				.wpabd-card .l { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#8a8783; }
				.wpabd-card .v { font-size:22px; font-weight:600; color:#141312; margin-top:4px; }
				.wpabd-panel { background:#fff; border:1px solid rgba(20,19,18,.08); border-radius:14px; padding:16px 18px; margin-bottom:14px; }
				.wpabd-panel h2 { margin:0 0 10px; font-size:13px; }
				.wpabd-table { width:100%; border-collapse:collapse; font-size:12px; }
				.wpabd-table th { text-align:right; font-weight:400; color:#8a8783; padding:4px 8px; }
				.wpabd-table th:first-child, .wpabd-table td:first-child { text-align:left; padding-left:0; }
				.wpabd-table td { text-align:right; padding:6px 8px; border-top:1px solid rgba(20,19,18,.06); color:#3d3b38; }
				.wpabd-btn { display:inline-block; background:#141312; color:#fff !important; border-radius:10px; padding:9px 18px; font-size:13px; font-weight:600; text-decoration:none; }
				.wpabd-btn:hover { background:#000; }
				.wpabd-credits .wpabd-creditrow { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; flex-wrap:wrap; }
				.wpabd-credits .l { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#8a8783; }
				.wpabd-credits .bal { font-size:34px; font-weight:600; line-height:1.1; color:#141312; margin-top:2px; font-variant-numeric:tabular-nums; }
				.wpabd-credits .plan { font-size:16px; font-weight:600; color:#141312; margin-top:2px; }
				.wpabd-credits .hint { margin:6px 0 0; font-size:12px; color:#6f6b64; }
				.wpabd-credits.is-empty { border-color:rgba(190,40,40,.35); background:#fff7f7; }
				.wpabd-credits.is-empty .bal { color:#b42318; }
				.wpabd-bars { display:flex; flex-direction:column; gap:10px; }
				.wpabd-bar { display:grid; grid-template-columns:150px 1fr 64px; gap:12px; align-items:center; }
				.wpabd-bar__l { font-size:13px; color:#141312; }
				.wpabd-bar__t { height:10px; background:rgba(20,19,18,.07); border-radius:5px; overflow:hidden; }
				.wpabd-bar__t span { display:block; height:100%; background:#3d64f2; border-radius:5px; }
				.wpabd-bar__v { font-size:13px; text-align:right; font-variant-numeric:tabular-nums; color:#6f6b64; }
				.wpabd-hint { margin:12px 0 0; font-size:12px; color:#6f6b64; }
				@media (max-width:600px) { .wpabd-bar { grid-template-columns:110px 1fr 52px; } }
			</style>

			<h1 style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
				<span>Meikero — Dashboard</span>
				<a class="wpabd-btn" href="<?php echo $editor; ?>">Open AI Editor →</a>
			</h1>

			<?php if ( $credits ) :
				$balance = (int) ( $credits['balance'] ?? 0 );
				$empty   = $balance <= 0;
				?>
				<div class="wpabd-panel wpabd-credits<?php echo $empty ? ' is-empty' : ''; ?>">
					<div class="wpabd-creditrow">
						<div>
							<div class="l">Credits</div>
							<div class="bal"><?php echo esc_html( number_format_i18n( $balance ) ); ?></div>
							<p class="hint">
								<?php if ( $empty ) : ?>
									Out of credits — the AI Editor is paused until you top up.
								<?php else : ?>
									Spent as the AI works. A full site build is about 43.
								<?php endif; ?>
							</p>
						</div>
						<div style="text-align:right;">
							<div class="l">Plan</div>
							<div class="plan"><?php echo esc_html( (string) ( $credits['planName'] ?? 'Free' ) ); ?></div>
							<a class="wpabd-btn" style="margin-top:8px;" href="<?php echo esc_url( $account_url ); ?>" target="_blank" rel="noopener">
								<?php echo $empty ? 'Top up credits' : 'Manage account'; ?> →
							</a>
						</div>
					</div>
				</div>
			<?php endif; ?>

			<?php if ( ! $connected ) : ?>
				<div class="wpabd-panel"><p>This site is not connected to the Meikero cloud yet. Open <a href="<?php echo esc_url( admin_url( 'admin.php?page=wp-ai-builder-bridge' ) ); ?>">Bridge settings</a> to connect.</p></div>
			<?php elseif ( is_wp_error( $report ) ) : ?>
				<div class="wpabd-panel"><p>Could not load usage: <?php echo esc_html( $report->get_error_message() ); ?></p></div>
			<?php else :
				// Credits only. This panel used to print model names, the rate per
				// million tokens and the dollar cost of every call — to the person
				// being billed in credits, who could read the margin straight off
				// their own dashboard. The endpoint no longer sends any of it.
				$activities = isset( $report['activities'] ) && is_array( $report['activities'] ) ? $report['activities'] : array();
				$spent      = isset( $report['totalCredits'] ) ? (float) $report['totalCredits'] : 0.0;
				$designs_n  = isset( $report['designs'] ) ? (int) $report['designs'] : 0;
				$credits_fmt = static function ( $value ) {
					$value = (float) $value;
					return $value >= 10 ? number_format_i18n( round( $value ) ) : number_format_i18n( $value, 1 );
				};
				$widest = 0.0;
				foreach ( $activities as $a ) {
					$widest = max( $widest, (float) ( $a['credits'] ?? 0 ) );
				}
				?>
				<div class="wpabd-cards">
					<div class="wpabd-card"><div class="l">Credits used here</div><div class="v"><?php echo esc_html( $credits_fmt( $spent ) ); ?></div></div>
					<div class="wpabd-card"><div class="l">Designs generated</div><div class="v"><?php echo esc_html( number_format_i18n( $designs_n ) ); ?></div></div>
					<div class="wpabd-card">
						<div class="l">Last activity</div>
						<div class="v" style="font-size:18px;">
							<?php echo esc_html( ! empty( $report['lastAt'] ) ? mysql2date( 'M j, H:i', (string) $report['lastAt'] ) : '—' ); ?>
						</div>
					</div>
				</div>

				<?php if ( $activities ) : ?>
					<div class="wpabd-panel">
						<h2>Where your credits went</h2>
						<div class="wpabd-bars">
							<?php foreach ( $activities as $a ) :
								$c   = (float) ( $a['credits'] ?? 0 );
								$pct = $widest > 0 ? max( 2, round( ( $c / $widest ) * 100 ) ) : 0;
								?>
								<div class="wpabd-bar">
									<div class="wpabd-bar__l"><?php echo esc_html( (string) ( $a['label'] ?? '' ) ); ?></div>
									<div class="wpabd-bar__t"><span style="width:<?php echo esc_attr( (string) $pct ); ?>%"></span></div>
									<div class="wpabd-bar__v"><?php echo esc_html( $credits_fmt( $c ) ); ?></div>
								</div>
							<?php endforeach; ?>
						</div>
						<p class="wpabd-hint">Credits are spent as the AI works. A full site generation is about 90 — roughly half of that is the design.</p>
					</div>
				<?php endif; ?>
			<?php endif; ?>

			<?php
			// The design archive lived here until 1.43. Designs are the Wizard's
			// business now — generated there, listed there, built from there — so
			// the dashboard stays what a dashboard is: numbers and a door.
			?>
			<div class="wpabd-panel">
				<h2>Designs</h2>
				<p style="margin:0;color:#5c5955;font-size:12.5px;">Your generated designs live in the <a href="<?php echo esc_url( admin_url( 'admin.php?page=wp-ai-builder-design' ) ); ?>">Wizard</a> — browse the library, continue one, or build a theme from it.</p>
			</div>
		</div>
		<?php
	}

	public static function render_main(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$notice    = self::notice();
		$new_token = self::take_token();
		$theme     = WPAB_Scopes::theme();
		?>
		<div class="wrap">
			<h1>Meikero — Bridge</h1>
			<p class="description">
				Bridge <?php echo esc_html( WPAB_VERSION ); ?> connects this site to Meikero.
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
			<h1>Meikero — Activity log</h1>
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
