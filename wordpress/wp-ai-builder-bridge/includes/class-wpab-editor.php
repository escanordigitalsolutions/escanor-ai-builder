<?php
/**
 * AI Editor — wp-admin full-screen editor (clean base).
 *
 * A large live preview of the site on the left, and a side panel with a
 * read-only Chat on the right. Everything talks to the SaaS through WPAB_Cloud
 * (site key); the manage_options check happens in WordPress first.
 *
 * This is the lean base: theme recognition + live preview + chat inspection.
 * Theme generation, the setup wizard, content editing and the code-proposal
 * pipeline were removed to be rebuilt fresh on top of this shell.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Editor {

	private const PAGE_SLUG = 'wp-ai-builder-editor';
	private const NAMESPACE = WPAB_REST_NAMESPACE;

	public static function init(): void {
		// The admin menu (top level + landing submenu) is registered by
		// WPAB_Admin — the AI Editor is the primary tool, so it does not
		// register a separate submenu of its own.
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/* ---------------------------------------------------------------------
	 * REST proxy — browser to WordPress to SaaS
	 * ------------------------------------------------------------------ */

	public static function register_routes(): void {
		$permission = static function () {
			return current_user_can( 'manage_options' );
		};

		// Chat: read-only project inspection + answers (proxied to the SaaS).
		register_rest_route(
			self::NAMESPACE,
			'/editor/chat',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_chat' ),
				'permission_callback' => $permission,
			)
		);

		// Project context: the active theme, its templates/parts/patterns and
		// pages — read by the editor to recognise and preview the site.
		register_rest_route(
			self::NAMESPACE,
			'/editor/context',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_context' ),
				'permission_callback' => $permission,
			)
		);
	}
	private static function json_params( WP_REST_Request $request ): array {
		$params = $request->get_json_params();

		return is_array( $params ) ? $params : array();
	}

	public static function rest_chat( WP_REST_Request $request ) {
		$params  = self::json_params( $request );
		$message = isset( $params['message'] ) ? trim( (string) $params['message'] ) : '';

		if ( '' === $message ) {
			return new WP_Error( 'wpab_editor_empty', 'Message is required.', array( 'status' => 400 ) );
		}
		if ( strlen( $message ) > 6000 ) {
			return new WP_Error( 'wpab_editor_too_long', 'Message is too long.', array( 'status' => 400 ) );
		}

		$body = array( 'message' => $message );

		$conversation_id = isset( $params['conversationId'] ) ? trim( (string) $params['conversationId'] ) : '';
		if ( '' !== $conversation_id ) {
			$body['conversationId'] = $conversation_id;
		}

		$result = WPAB_Cloud::request( 'agent/chat', $body, 60 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}
	private const AI_LOG_OPTION = 'wpab_ai_log';
	private const AI_LOG_MAX    = 25;
	private static function list_dir_files( string $dir ): array {
		$out = array();
		if ( ! is_dir( $dir ) ) {
			return $out;
		}
		$items = scandir( $dir );
		if ( ! is_array( $items ) ) {
			return $out;
		}
		foreach ( $items as $f ) {
			if ( '.' === $f || '..' === $f || 'index.php' === $f ) {
				continue;
			}
			$out[] = $f;
		}
		sort( $out );
		return $out;
	}

	/** Build the project snapshot the Studio chat is grounded in. */
	public static function project_context(): array {
		$slug  = get_stylesheet();
		$theme = wp_get_theme();
		$dir   = get_stylesheet_directory();

		$palette = array();
		$tj      = $dir . '/theme.json';
		if ( file_exists( $tj ) ) {
			$json = json_decode( (string) file_get_contents( $tj ), true );
			if ( isset( $json['settings']['color']['palette'] ) && is_array( $json['settings']['color']['palette'] ) ) {
				foreach ( $json['settings']['color']['palette'] as $p ) {
					$palette[] = array(
						'slug'  => isset( $p['slug'] ) ? (string) $p['slug'] : '',
						'color' => isset( $p['color'] ) ? (string) $p['color'] : '',
					);
				}
			}
		}

		$front = (int) get_option( 'page_on_front' );
		$pages = array();
		$posts = get_posts(
			array(
				'post_type'   => 'page',
				'numberposts' => 50,
				'post_status' => 'publish',
				'orderby'     => 'menu_order title',
				'order'       => 'asc',
			)
		);
		foreach ( $posts as $pg ) {
			$pages[] = array(
				'id'    => (int) $pg->ID,
				'title' => (string) get_the_title( $pg->ID ),
				'slug'  => (string) $pg->post_name,
				'front' => ( (int) $pg->ID === $front ),
				'url'   => (string) get_permalink( $pg->ID ),
			);
		}

		// Theme-only: features (booking, post types, custom blocks) live in the
		// active theme's features/ folder — there is no companion plugin.
		$features = self::list_dir_files( $dir . '/features' );

		$recent = array();
		$log    = get_option( self::AI_LOG_OPTION, array() );
		if ( is_array( $log ) ) {
			foreach ( array_slice( $log, 0, 10 ) as $e ) {
				$recent[] = array(
					'action'      => isset( $e['action'] ) ? (string) $e['action'] : '',
					'ok'          => ! isset( $e['ok'] ) || (bool) $e['ok'],
					'time'        => isset( $e['time'] ) ? (string) $e['time'] : '',
					'duration_ms' => isset( $e['duration_ms'] ) ? (int) $e['duration_ms'] : 0,
				);
			}
		}

		return array(
			'theme'     => array(
				'name'      => (string) $theme->get( 'Name' ),
				'slug'      => $slug,
				'generated' => ( '' !== (string) get_option( 'wpab_generated_theme', '' ) && (string) get_option( 'wpab_generated_theme', '' ) === $slug ),
				'palette'   => $palette,
				'templates' => self::list_dir_files( $dir . '/templates' ),
				'parts'     => self::list_dir_files( $dir . '/parts' ),
				'patterns'  => self::list_dir_files( $dir . '/patterns' ),
			),
			'front'     => array(
				'mode'          => (string) get_option( 'show_on_front' ),
				'page_on_front' => $front,
			),
			'pages'     => $pages,
			'features'  => $features,
			'recent'    => $recent,
			'site'      => array(
				'name'    => (string) get_bloginfo( 'name' ),
				'tagline' => (string) get_bloginfo( 'description' ),
				'url'     => home_url( '/' ),
			),
		);
	}

	public static function rest_context( WP_REST_Request $request ) {
		return new WP_REST_Response( array( 'success' => true, 'context' => self::project_context() ), 200 );
	}


	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$config = array(
			'restSession' => esc_url_raw( rest_url( self::NAMESPACE . '/cloud/session' ) ),
			'restChat'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat' ) ),
			'restContext' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/context' ) ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'cloudPage'   => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'exitUrl'     => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'siteUrl'     => esc_url_raw( home_url( '/' ) ),
			'connected'   => (bool) WPAB_Cloud::has_key(),
		);
		?>
		<div class="wpab-ed" id="wpab-ed">
			<header class="wpab-ed__top">
				<div class="wpab-ed__brand">
					<span class="wpab-ed__dot"></span>
					<span class="wpab-ed__name">AI Editor</span>
					<span id="wpab-ed-theme" class="wpab-ed__theme"></span>
				</div>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=wp-ai-builder' ) ); ?>" class="wpab-ed__exit">Exit</a>
			</header>

			<div class="wpab-ed__body">
				<div class="wpab-ed__preview">
					<div id="wpab-ed-pbar" class="wpab-ed__pbar">Loading preview…</div>
					<iframe id="wpab-ed-frame" class="wpab-ed__frame" title="Site preview"></iframe>
				</div>

				<aside class="wpab-ed__chat">
					<div id="wpab-ed-notice" class="wpab-ed__notice" hidden></div>
					<div id="wpab-ed-thread" class="wpab-ed__thread" aria-live="polite">
						<p class="wpab-ed__empty">Ask anything about this site — its theme, templates, pages or content.</p>
					</div>
					<form id="wpab-ed-form" class="wpab-ed__form" autocomplete="off">
						<textarea id="wpab-ed-input" class="wpab-ed__input" rows="1" placeholder="Ask about this site…"></textarea>
						<div class="wpab-ed__formrow">
							<button type="button" id="wpab-ed-new" class="wpab-ed__new">New chat</button>
							<button type="submit" id="wpab-ed-send" class="wpab-ed__send">Send</button>
						</div>
					</form>
				</aside>
			</div>
		</div>

		<style>
			#wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
			#wpfooter { display: none; }
			.wpab-ed { position: fixed; inset: 0; top: 32px; left: 160px; display: flex; flex-direction: column; background: #0e1013; color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; z-index: 9990; }
			.auto-fold .wpab-ed { left: 36px; }
			.folded .wpab-ed { left: 36px; }
			@media (max-width: 782px) { .wpab-ed { left: 0; top: 46px; } }
			.wpab-ed__top { display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 18px; border-bottom: 1px solid #23262b; background: #14171b; flex: 0 0 auto; }
			.wpab-ed__brand { display: flex; align-items: center; gap: 10px; }
			.wpab-ed__dot { width: 10px; height: 10px; border-radius: 50%; background: #3a5bff; box-shadow: 0 0 0 4px rgba(58,91,255,.18); }
			.wpab-ed__name { font-weight: 600; font-size: 14px; }
			.wpab-ed__theme { font-size: 12px; color: #9aa1ac; }
			.wpab-ed__exit { color: #c9ced4; text-decoration: none; font-size: 13px; border: 1px solid #2c3037; border-radius: 8px; padding: 6px 14px; }
			.wpab-ed__exit:hover { background: #1c1f24; color: #fff; }
			.wpab-ed__body { flex: 1 1 auto; display: flex; min-height: 0; }
			.wpab-ed__preview { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; background: #17191d; }
			.wpab-ed__pbar { height: 30px; display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: #9aa1ac; border-bottom: 1px solid #23262b; }
			.wpab-ed__frame { flex: 1 1 auto; width: 100%; border: 0; background: #fff; }
			.wpab-ed__chat { width: 400px; max-width: 42vw; flex: 0 0 auto; display: flex; flex-direction: column; border-left: 1px solid #23262b; background: #101216; min-height: 0; }
			@media (max-width: 900px) { .wpab-ed__chat { width: 320px; } }
			.wpab-ed__notice { margin: 12px; padding: 11px 13px; border-radius: 10px; background: #2a1d1d; border: 1px solid #4a2b2b; color: #f0c9c9; font-size: 13px; }
			.wpab-ed__notice a { color: #ff9d9d; }
			.wpab-ed__thread { flex: 1 1 auto; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
			.wpab-ed__empty { color: #7c828b; font-size: 13px; line-height: 1.6; margin: 0; }
			.wpab-msg { display: flex; flex-direction: column; gap: 5px; }
			.wpab-msg__role { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7c828b; }
			.wpab-msg__body { font-size: 14px; line-height: 1.6; color: #e7e9ec; word-wrap: break-word; }
			.wpab-msg__body code { background: #1c1f24; padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
			.wpab-msg__body pre { background: #1c1f24; padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
			.wpab-msg__body a { color: #8bb6ff; }
			.wpab-msg--user .wpab-msg__body { color: #f4f5f7; }
			.wpab-typing { color: #9aa1ac; font-size: 13px; }
			.wpab-ed__form { border-top: 1px solid #23262b; padding: 12px; flex: 0 0 auto; background: #14171b; }
			.wpab-ed__input { width: 100%; box-sizing: border-box; resize: none; background: #0e1013; border: 1px solid #2c3037; border-radius: 10px; color: #f4f5f7; font: inherit; font-size: 14px; padding: 10px 12px; max-height: 160px; }
			.wpab-ed__input:focus { outline: none; border-color: #3a5bff; }
			.wpab-ed__formrow { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
			.wpab-ed__new { background: none; border: 0; color: #9aa1ac; font-size: 12px; cursor: pointer; }
			.wpab-ed__new:hover { color: #fff; }
			.wpab-ed__send { appearance: none; border: 0; border-radius: 9px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: #3a5bff; color: #fff; }
			.wpab-ed__send:disabled { opacity: .55; cursor: default; }
		</style>
		<?php
		self::print_app_script( $config );
	}

	private static function print_app_script( array $config ): void {
		?>
		<script>
		window.WPAB_EDITOR = <?php echo wp_json_encode( $config ); ?>;
		(function () {
			var cfg = window.WPAB_EDITOR || {};
			function $(id) { return document.getElementById(id); }

			var thread = $('wpab-ed-thread');
			var input  = $('wpab-ed-input');
			var form   = $('wpab-ed-form');
			var sendBtn = $('wpab-ed-send');
			var conversationId = null;

			function escapeHtml(s) {
				return String(s == null ? '' : s)
					.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
			}
			function renderMarkdown(s) {
				var out = escapeHtml(s);
				out = out.replace(/```([\s\S]*?)```/g, function (m, c) { return '<pre><code>' + c.replace(/^\n/, '') + '</code></pre>'; });
				out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
				out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
				out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
				out = out.replace(/\n/g, '<br>');
				return out;
			}
			function api(method, url, body) {
				return fetch(url, {
					method: method,
					headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' },
					credentials: 'same-origin',
					body: body ? JSON.stringify(body) : undefined
				}).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); });
			}
			function addMessage(role, body) {
				var empty = thread.querySelector('.wpab-ed__empty');
				if (empty) { empty.remove(); }
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--' + role;
				var html = role === 'assistant' ? renderMarkdown(body) : escapeHtml(body);
				wrap.innerHTML = '<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="wpab-msg__body">' + html + '</div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function addTyping() {
				var wrap = document.createElement('div'); wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div><div class="wpab-typing">Thinking…</div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function setBusy(b) { if (sendBtn) { sendBtn.disabled = b; } }

			function sendChat(message) {
				addMessage('user', message);
				setBusy(true);
				var typing = addTyping();
				var body = { message: message };
				if (conversationId) { body.conversationId = conversationId; }
				api('POST', cfg.restChat, body).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						addMessage('assistant', (out.data && (out.data.message || out.data.error)) || 'Something went wrong. Please try again.');
						return;
					}
					if (out.data.conversationId) { conversationId = out.data.conversationId; }
					addMessage('assistant', out.data.answer || out.data.reply || '(no answer)');
				}).catch(function () {
					typing.remove();
					addMessage('assistant', 'Network error. Please try again.');
				}).then(function () { setBusy(false); });
			}

			if (form) {
				form.addEventListener('submit', function (e) {
					e.preventDefault();
					var v = (input.value || '').trim();
					if (!v) { return; }
					input.value = ''; input.style.height = 'auto';
					sendChat(v);
				});
			}
			if (input) {
				input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
				input.addEventListener('keydown', function (e) {
					if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })); }
				});
			}

			var newBtn = $('wpab-ed-new');
			if (newBtn) {
				newBtn.addEventListener('click', function () {
					conversationId = null;
					thread.innerHTML = '<p class="wpab-ed__empty">Ask anything about this site — its theme, templates, pages or content.</p>';
				});
			}

			// Not connected to the cloud yet: show a notice, disable chat.
			if (!cfg.connected) {
				var n = $('wpab-ed-notice');
				if (n) { n.hidden = false; n.innerHTML = 'This site is not connected to the AI Builder cloud yet. <a href="' + cfg.cloudPage + '">Connect it</a> to use the chat.'; }
				setBusy(true);
				if (input) { input.disabled = true; }
			}

			// Live preview of the site.
			var frame = $('wpab-ed-frame'), pbar = $('wpab-ed-pbar');
			if (frame && cfg.siteUrl) {
				frame.addEventListener('load', function () { if (pbar) { pbar.textContent = cfg.siteUrl; } });
				frame.src = cfg.siteUrl;
			}

			// Theme recognition: show the active theme's name in the top bar.
			if (cfg.restContext) {
				fetch(cfg.restContext, { headers: { 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' }, credentials: 'same-origin' })
					.then(function (r) { return r.json(); })
					.then(function (d) {
						var t = d && d.context && d.context.theme;
						var el = $('wpab-ed-theme');
						if (t && el) { el.textContent = '· ' + (t.name || t.slug || ''); }
					})
					.catch(function () {});
			}
		})();
		</script>
		<?php
	}
}
