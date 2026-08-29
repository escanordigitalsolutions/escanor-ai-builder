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
	private const BRIDGE_SLUG    = 'wp-ai-builder-bridge';
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
			</style>

			<h1 style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
				<span>Meikero — Dashboard</span>
				<a class="wpabd-btn" href="<?php echo $editor; ?>">Open AI Editor →</a>
			</h1>

			<?php if ( ! $connected ) : ?>
				<div class="wpabd-panel"><p>This site is not connected to the Meikero cloud yet. Open <a href="<?php echo esc_url( admin_url( 'admin.php?page=wp-ai-builder-bridge' ) ); ?>">Bridge settings</a> to connect.</p></div>
			<?php elseif ( is_wp_error( $report ) ) : ?>
				<div class="wpabd-panel"><p>Could not load usage: <?php echo esc_html( $report->get_error_message() ); ?></p></div>
			<?php else :
				$totals = isset( $report['totals'] ) && is_array( $report['totals'] ) ? $report['totals'] : array();
				?>
				<div class="wpabd-cards">
					<div class="wpabd-card"><div class="l">Calls</div><div class="v"><?php echo esc_html( $fmt( $totals['calls'] ?? 0 ) ); ?></div></div>
					<div class="wpabd-card"><div class="l">Input tokens</div><div class="v"><?php echo esc_html( $fmt( $totals['inputTokens'] ?? 0 ) ); ?></div></div>
					<div class="wpabd-card"><div class="l">Output tokens</div><div class="v"><?php echo esc_html( $fmt( $totals['outputTokens'] ?? 0 ) ); ?></div></div>
					<div class="wpabd-card"><div class="l"><?php echo empty( $totals['costComplete'] ) ? 'Cost (partial)' : 'Cost'; ?></div><div class="v"><?php echo esc_html( $money( $totals['costUsd'] ?? null ) ); ?></div></div>
				</div>

				<div class="wpabd-panel">
					<h2>By model — rates are USD per 1M tokens</h2>
					<table class="wpabd-table">
						<tr><th>Model</th><th>Calls</th><th>In</th><th>Out</th><th>$/1M in</th><th>$/1M out</th><th>Cost</th></tr>
						<?php foreach ( (array) ( $report['byModel'] ?? array() ) as $m ) : ?>
							<tr>
								<td><?php echo esc_html( $m['model'] ?? '' ); ?></td>
								<td><?php echo esc_html( $fmt( $m['calls'] ?? 0 ) ); ?></td>
								<td><?php echo esc_html( $fmt( $m['inputTokens'] ?? 0 ) ); ?></td>
								<td><?php echo esc_html( $fmt( $m['outputTokens'] ?? 0 ) ); ?></td>
								<td><?php echo isset( $m['rateIn'] ) && null !== $m['rateIn'] ? '$' . esc_html( $m['rateIn'] ) : '—'; ?></td>
								<td><?php echo isset( $m['rateOut'] ) && null !== $m['rateOut'] ? '$' . esc_html( $m['rateOut'] ) : '—'; ?></td>
								<td><strong><?php echo esc_html( $money( $m['costUsd'] ?? null ) ); ?></strong></td>
							</tr>
						<?php endforeach; ?>
					</table>
				</div>

				<div class="wpabd-panel">
					<h2>By stage</h2>
					<table class="wpabd-table">
						<tr><th>Stage</th><th>Calls</th><th>In</th><th>Out</th><th>Cost</th></tr>
						<?php foreach ( (array) ( $report['byStage'] ?? array() ) as $st ) :
							$slug = (string) ( $st['stage'] ?? '' );
							?>
							<tr>
								<td><?php echo esc_html( $stage_labels[ $slug ] ?? $slug ); ?></td>
								<td><?php echo esc_html( $fmt( $st['calls'] ?? 0 ) ); ?></td>
								<td><?php echo esc_html( $fmt( $st['inputTokens'] ?? 0 ) ); ?></td>
								<td><?php echo esc_html( $fmt( $st['outputTokens'] ?? 0 ) ); ?></td>
								<td><strong><?php echo esc_html( $money( $st['costUsd'] ?? null ) ); ?></strong></td>
							</tr>
						<?php endforeach; ?>
					</table>
				</div>
			<?php endif; ?>

			<?php
			// ---- Design archive: every generated homepage design, newest first.
			$designs = $connected ? WPAB_Cloud::request( 'agent/designs', array(), 20 ) : null;
			$rows    = ( ! is_wp_error( $designs ) && isset( $designs['designs'] ) && is_array( $designs['designs'] ) ) ? $designs['designs'] : array();
			$dnonce  = wp_create_nonce( 'wp_rest' );
			$dhtml   = esc_url_raw( rest_url( WPAB_REST_NAMESPACE . '/editor/design/html' ) );
			$slabels = array( 'used' => 'Used', 'rejected' => 'Rejected', 'pending' => 'Not used' );
			?>
			<div class="wpabd-panel">
				<h2>Design archive</h2>
				<?php if ( $connected && is_wp_error( $designs ) ) : ?>
					<p><?php echo esc_html( $designs->get_error_message() ); ?></p>
				<?php elseif ( empty( $rows ) ) : ?>
					<p style="color:#8a8783;font-size:12px;">No archived designs yet — every homepage design generated in the AI Editor lands here, including rejected directions.</p>
				<?php else : ?>
					<style>
						.wpabd-designs { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px; margin-top:4px; }
						.wpabd-dcard { background:#fff; border:1px solid rgba(20,19,18,.1); border-radius:14px; overflow:hidden; cursor:pointer; transition:border-color .15s, box-shadow .15s; }
						.wpabd-dcard:hover { border-color:#141312; box-shadow:0 4px 18px rgba(20,19,18,.1); }
						.wpabd-dcard.is-open { border-color:#141312; box-shadow:0 0 0 2px #141312; }
						.wpabd-dshell { background:#e9e7e4; padding:8px 8px 0; }
						.wpabd-dbar { display:flex; gap:4px; padding:0 2px 6px; }
						.wpabd-dbar i { width:7px; height:7px; border-radius:50%; background:#cfccc7; }
						.wpabd-dthumb { position:relative; height:160px; overflow:hidden; background:#fff; border-radius:6px 6px 0 0; }
						.wpabd-dthumb iframe { width:1280px; height:1024px; border:0; transform-origin:0 0; pointer-events:none; background:#fff; display:block; }
						.wpabd-dthumb .wpabd-dload { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; color:#8a8783; background:#faf9f7; }
						.wpabd-dmeta { padding:10px 12px; }
						.wpabd-dmeta .t { font-size:12px; font-weight:600; color:#141312; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
						.wpabd-dmeta .s { font-size:11px; color:#8a8783; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
						.wpabd-dtag { display:inline-block; font-size:10px; font-weight:600; border-radius:6px; padding:1px 6px; margin-right:5px; background:#f0efec; color:#5c5955; }
						.wpabd-dtag.used { background:#141312; color:#fff; }
					</style>
					<div style="text-align:right;margin-bottom:10px;"><button type="button" class="button" id="wpabd-dlall">Download all HTML</button></div>
					<div class="wpabd-designs" id="wpabd-designs">
						<?php foreach ( $rows as $d ) :
							$brief = isset( $d['brief'] ) && is_array( $d['brief'] ) ? $d['brief'] : array();
							$title = ! empty( $brief['name'] ) ? $brief['name'] : ( ! empty( $brief['prompt'] ) ? mb_substr( (string) $brief['prompt'], 0, 60 ) : 'Untitled design' );
							$stat  = isset( $d['status'] ) ? (string) $d['status'] : 'pending';
							$when  = isset( $d['created_at'] ) ? mysql2date( 'M j, H:i', (string) $d['created_at'] ) : '';
							?>
							<div class="wpabd-dcard" data-design="<?php echo esc_attr( (string) ( $d['id'] ?? '' ) ); ?>" data-title="<?php echo esc_attr( $title ); ?>" title="Open full preview">
								<div class="wpabd-dshell">
									<div class="wpabd-dbar"><i></i><i></i><i></i></div>
									<div class="wpabd-dthumb">
										<div class="wpabd-dload">Loading…</div>
										<iframe sandbox="allow-scripts" scrolling="no" tabindex="-1" aria-hidden="true"></iframe>
									</div>
								</div>
								<div class="wpabd-dmeta">
									<div class="t"><?php echo esc_html( $title ); ?></div>
									<div class="s"><span class="wpabd-dtag <?php echo esc_attr( $stat ); ?>"><?php echo esc_html( $slabels[ $stat ] ?? $stat ); ?></span><?php echo esc_html( trim( ( $d['model'] ?? '' ) . ( $when ? ' · ' . $when : '' ) ) ); ?></div>
									<button type="button" class="button button-small wpabd-dl" data-design="<?php echo esc_attr( (string) ( $d['id'] ?? '' ) ); ?>" style="margin-top:8px;">Download HTML</button>
								</div>
							</div>
						<?php endforeach; ?>
					</div>
					<div id="wpabd-prevwrap" style="display:none;margin-top:14px;">
						<iframe id="wpabd-prevframe" sandbox="allow-scripts" style="width:100%;height:680px;border:1px solid rgba(20,19,18,.1);border-radius:12px;background:#fff;"></iframe>
					</div>
					<script>
					(function () {
						var URL_HTML = <?php echo wp_json_encode( $dhtml ); ?>;
						var NONCE = <?php echo wp_json_encode( $dnonce ); ?>;
						var cache = {};
						var open = null;

						function fetchHtml(id) {
							if (cache[id]) { return Promise.resolve(cache[id]); }
							return fetch(URL_HTML, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
								credentials: 'same-origin',
								body: JSON.stringify({ designId: id })
							}).then(function (r) { return r.json(); }).then(function (j) {
								if (!j || !j.html) { throw new Error((j && (j.error || j.message)) || 'Could not load the design.'); }
								cache[id] = j.html;
								return j.html;
							});
						}

						function fitThumb(card) {
							var thumb = card.querySelector('.wpabd-dthumb');
							var frame = thumb && thumb.querySelector('iframe');
							if (!thumb || !frame) { return; }
							var w = thumb.clientWidth || 230;
							var scale = w / 1280;
							frame.style.transform = 'scale(' + scale + ')';
							thumb.style.height = Math.round(1024 * scale) + 'px';
						}

						function slugify(t) {
						return String(t || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'design';
					}
					function saveHtml(id, title) {
						return fetchHtml(id).then(function (html) {
							var blob = new Blob([html], { type: 'text/html' });
							var a = document.createElement('a');
							a.href = URL.createObjectURL(blob);
							a.download = slugify(title) + '-' + String(id).slice(0, 6) + '.html';
							document.body.appendChild(a);
							a.click();
							setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
						});
					}

					var cards = Array.prototype.slice.call(document.querySelectorAll('.wpabd-dcard'));
						var queue = cards.slice();
						function next() {
							var card = queue.shift();
							if (!card) { return; }
							var id = card.getAttribute('data-design');
							var thumb = card.querySelector('.wpabd-dthumb');
							var frame = thumb.querySelector('iframe');
							var load = thumb.querySelector('.wpabd-dload');
							fitThumb(card);
							fetchHtml(id).then(function (html) {
								frame.srcdoc = html;
								if (load) { load.style.display = 'none'; }
							}).catch(function () {
								if (load) { load.textContent = 'Preview unavailable'; }
							}).then(next);
						}
						next(); next(); next();

						var resizeTimer = null;
						window.addEventListener('resize', function () {
							clearTimeout(resizeTimer);
							resizeTimer = setTimeout(function () { for (var i = 0; i < cards.length; i++) { fitThumb(cards[i]); } }, 150);
						});

						document.addEventListener('click', function (e) {
							var dl = e.target && e.target.closest ? e.target.closest('.wpabd-dl') : null;
							if (dl) {
								e.stopPropagation();
								var did = dl.getAttribute('data-design');
								var dcard = dl.closest('.wpabd-dcard');
								dl.disabled = true;
								dl.textContent = 'Downloading…';
								saveHtml(did, dcard ? dcard.getAttribute('data-title') : 'design').then(function () {
									dl.disabled = false; dl.textContent = 'Download HTML';
								}).catch(function () {
									dl.disabled = false; dl.textContent = 'Failed — retry';
								});
								return;
							}
							if (e.target && e.target.id === 'wpabd-dlall') {
								var all = e.target;
								all.disabled = true;
								var i = 0;
								(function step() {
									if (i >= cards.length) { all.disabled = false; all.textContent = 'Download all HTML'; return; }
									var c = cards[i]; i++;
									all.textContent = 'Downloading ' + i + '/' + cards.length + '…';
									saveHtml(c.getAttribute('data-design'), c.getAttribute('data-title')).catch(function () {}).then(function () { setTimeout(step, 600); });
								})();
								return;
							}
							var card = e.target && e.target.closest ? e.target.closest('.wpabd-dcard') : null;
							if (!card) { return; }
							var id = card.getAttribute('data-design');
							var wrap = document.getElementById('wpabd-prevwrap');
							var frame = document.getElementById('wpabd-prevframe');
							if (!id || !wrap || !frame) { return; }
							for (var i = 0; i < cards.length; i++) { cards[i].classList.remove('is-open'); }
							if (open === id) { wrap.style.display = 'none'; open = null; return; }
							card.classList.add('is-open');
							fetchHtml(id).then(function (html) {
								frame.srcdoc = html;
								wrap.style.display = 'block';
								open = id;
								wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
							}).catch(function (err) {
								card.classList.remove('is-open');
								alert(err && err.message ? err.message : 'Could not load the design.');
							});
						});
					})();
					</script>
				<?php endif; ?>
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
