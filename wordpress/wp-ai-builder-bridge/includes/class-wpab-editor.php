<?php
/**
 * ESCANOR AI Builder — wp-admin "Studio" editor (v3A).
 *
 * A full-screen editor (Base44-style): a large live preview of the site on the
 * left, and a side panel with Chat, Build & deploy, and Inspect (visual CSS)
 * on the right. Everything talks to the SaaS through WPAB_Cloud (site key);
 * the manage_options check happens in WordPress first.
 *
 *   Chat    — read-only project inspection + answers.
 *   Build   — describe a change -> AI proposal + diff -> Deploy -> Rollback.
 *   Inspect — click an element in the preview, tweak its CSS live, Apply
 *             deterministically (no AI) with snapshot + rollback.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Editor {

	private const PAGE_SLUG = 'wp-ai-builder-editor';
	private const NAMESPACE = 'wp-ai-builder/v1';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_page' ), 30 );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/* ---------------------------------------------------------------------
	 * REST proxy — browser to WordPress to SaaS
	 * ------------------------------------------------------------------ */

	public static function register_routes(): void {
		$permission = static function () {
			return current_user_can( 'manage_options' );
		};

		$post = array(
			'chat'      => 'rest_chat',
			'propose'   => 'rest_propose',
			'apply'     => 'rest_apply',
			'rollback'  => 'rest_rollback',
			'css-apply' => 'rest_css_apply',
		);

		foreach ( $post as $route => $cb ) {
			register_rest_route(
				self::NAMESPACE,
				'/editor/' . $route,
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, $cb ),
					'permission_callback' => $permission,
				)
			);
		}

		register_rest_route(
			self::NAMESPACE,
			'/editor/proposals',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_proposals' ),
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

	public static function rest_propose( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$prompt = isset( $params['prompt'] ) ? trim( (string) $params['prompt'] ) : '';

		if ( '' === $prompt ) {
			return new WP_Error( 'wpab_editor_empty', 'Describe the change first.', array( 'status' => 400 ) );
		}
		if ( strlen( $prompt ) > 6000 ) {
			return new WP_Error( 'wpab_editor_too_long', 'Change request is too long.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/proposals', array( 'prompt' => $prompt ), 55 );

		if ( is_wp_error( $result ) ) {
			if ( 'wpab_cloud_error' === $result->get_error_code() ) {
				return $result;
			}
			return new WP_REST_Response( array( 'success' => true, 'started' => true ), 200 );
		}

		return new WP_REST_Response( $result, 200 );
	}

	public static function rest_proposals( WP_REST_Request $request ) {
		$query = array();

		$since = (string) $request->get_param( 'since' );
		if ( '' !== $since ) {
			$query['since'] = $since;
		}

		$limit = (int) $request->get_param( 'limit' );
		if ( $limit > 0 ) {
			$query['limit'] = $limit;
		}

		$result = WPAB_Cloud::get( 'agent/proposals', $query, 20 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_apply( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$proposal_id = isset( $params['proposalId'] ) ? trim( (string) $params['proposalId'] ) : '';

		if ( '' === $proposal_id ) {
			return new WP_Error( 'wpab_editor_no_proposal', 'proposalId is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/apply', array( 'proposalId' => $proposal_id ), 90 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_rollback( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$run_id = isset( $params['runId'] ) ? trim( (string) $params['runId'] ) : '';

		if ( '' === $run_id ) {
			return new WP_Error( 'wpab_editor_no_run', 'runId is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/rollback', array( 'runId' => $run_id ), 60 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_css_apply( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$css    = isset( $params['css'] ) ? (string) $params['css'] : '';

		if ( '' === trim( $css ) ) {
			return new WP_Error( 'wpab_editor_no_css', 'No CSS to apply.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/css-apply', array( 'css' => $css ), 90 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/* ---------------------------------------------------------------------
	 * Studio page (full screen)
	 * ------------------------------------------------------------------ */

	public static function register_page(): void {
		add_submenu_page(
			'wp-ai-builder',
			'AI Builder — Studio',
			'AI Editor',
			'manage_options',
			self::PAGE_SLUG,
			array( __CLASS__, 'render_page' )
		);
	}

	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$config = array(
			'restSession'   => esc_url_raw( rest_url( self::NAMESPACE . '/cloud/session' ) ),
			'restChat'      => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat' ) ),
			'restPropose'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/propose' ) ),
			'restProposals' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/proposals' ) ),
			'restApply'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/apply' ) ),
			'restRollback'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/rollback' ) ),
			'restCssApply'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/css-apply' ) ),
			'nonce'         => wp_create_nonce( 'wp_rest' ),
			'cloudPage'     => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'snapPage'      => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-snapshots' ) ),
			'exitUrl'       => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'siteUrl'       => esc_url_raw( home_url( '/' ) ),
			'connected'     => WPAB_Cloud::has_key(),
		);
		?>
		<div class="wpab-studio" id="wpab-studio">
			<div class="wpab-studio__top">
				<span class="wpab-studio__brand">AI Studio</span>
				<span id="wpab-editor-status" class="wpab-studio__status">Connecting…</span>
				<a class="wpab-studio__exit" href="<?php echo esc_url( $config['exitUrl'] ); ?>">Exit ✕</a>
			</div>

			<div class="wpab-studio__body">
				<div class="wpab-studio__preview">
					<div id="wpab-visual-status" class="wpab-studio__previewbar">Loading preview…</div>
					<iframe id="wpab-visual-frame" class="wpab-studio__frame" title="Site preview"></iframe>
				</div>

				<div class="wpab-studio__panel">
					<div class="wpab-studio__tabs">
						<button type="button" class="wpab-tab is-active" data-tab="chat">Chat</button>
						<button type="button" class="wpab-tab" data-tab="build">Build</button>
						<button type="button" class="wpab-tab" data-tab="visual">Inspect</button>
					</div>

					<div class="wpab-studio__content">
						<div id="wpab-pane-chat" class="wpab-pane">
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">Ask about the theme or plugin.</span>
								<button type="button" id="wpab-editor-new" class="button">New chat</button>
							</div>
							<div id="wpab-editor-thread" class="wpab-editor__thread" aria-live="polite"></div>
							<form id="wpab-editor-form" class="wpab-editor__form" autocomplete="off">
								<textarea id="wpab-editor-input" class="wpab-editor__input" rows="2"
									placeholder="e.g. Where is the header rendered?"></textarea>
								<button type="submit" id="wpab-editor-send" class="button button-primary">Send</button>
							</form>
							<p id="wpab-editor-meta" class="wpab-editor__meta"></p>
						</div>

						<div id="wpab-pane-build" class="wpab-pane" hidden>
							<form id="wpab-build-form" class="wpab-editor__form" autocomplete="off">
								<textarea id="wpab-build-input" class="wpab-editor__input" rows="3"
									placeholder="Describe a change, e.g. Add a newsletter section to the footer."></textarea>
								<button type="submit" id="wpab-build-send" class="button button-primary">Propose</button>
							</form>
							<p id="wpab-build-meta" class="wpab-editor__meta"></p>
							<div id="wpab-current"></div>
							<h3 class="wpab-col__title">Recent proposals</h3>
							<div id="wpab-proposals" class="wpab-list"></div>
							<h3 class="wpab-col__title" style="margin-top:16px">Deployments</h3>
							<div id="wpab-deployments" class="wpab-list"></div>
						</div>

						<div id="wpab-pane-visual" class="wpab-pane" hidden>
							<p id="wpab-visual-hint" class="wpab-empty">Click any element in the preview to target it.</p>
							<div id="wpab-visual-panel" class="wpab-visual__panel" hidden>
								<label class="wpab-v-label">Selector</label>
								<input type="text" id="wpab-visual-selector" class="wpab-v-input" />
								<label class="wpab-v-label">Text color</label>
								<input type="color" id="wpab-v-color" class="wpab-v-color" />
								<label class="wpab-v-label">Background</label>
								<input type="color" id="wpab-v-bg" class="wpab-v-color" />
								<label class="wpab-v-label">Font size (px)</label>
								<input type="number" id="wpab-v-fs" class="wpab-v-input" min="8" max="140" />
								<label class="wpab-v-label">Custom CSS for this element</label>
								<textarea id="wpab-v-css" class="wpab-v-input" rows="3" placeholder="margin: 20px; border-radius: 8px;"></textarea>
								<div class="wpab-v-actions">
									<button type="button" id="wpab-v-apply" class="button button-primary">Apply changes</button>
									<button type="button" id="wpab-v-reset" class="button">Reset</button>
								</div>
								<div id="wpab-v-result"></div>
								<p class="wpab-v-note">Apply writes to the theme stylesheet in a managed block, with a rollback snapshot.</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<style>
			#wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
			.wpab-studio { position: fixed; inset: 0; z-index: 100000; background: #f5f6f7; display: flex; flex-direction: column; font-size: 14px; color: #1d2327; }
			.wpab-studio__top { height: 52px; flex: 0 0 auto; background: #1d2327; color: #fff; display: flex; align-items: center; gap: 14px; padding: 0 16px; }
			.wpab-studio__brand { font-weight: 600; }
			.wpab-studio__status { flex: 1; font-size: 12px; color: #c3c4c7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.wpab-studio__status.is-ok { color: #68de7c; }
			.wpab-studio__status.is-error { color: #ff9a9a; }
			.wpab-studio__exit { color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.3); border-radius: 6px; padding: 5px 12px; font-size: 13px; }
			.wpab-studio__exit:hover { background: rgba(255,255,255,.1); color: #fff; }
			.wpab-studio__body { flex: 1; display: flex; min-height: 0; }
			.wpab-studio__preview { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 12px; }
			.wpab-studio__previewbar { font-size: 12px; color: #50575e; margin-bottom: 8px; }
			.wpab-studio__previewbar.is-error { color: #d63638; }
			.wpab-studio__frame { flex: 1; width: 100%; border: 1px solid #dcdcde; border-radius: 10px; background: #fff; }
			.wpab-studio__panel { width: 400px; flex: 0 0 400px; background: #fff; border-left: 1px solid #dcdcde; display: flex; flex-direction: column; min-height: 0; }
			.wpab-studio__tabs { display: flex; gap: 6px; padding: 12px 12px 0; }
			.wpab-studio__content { flex: 1; overflow-y: auto; padding: 12px; min-height: 0; }
			@media (max-width: 900px) { .wpab-studio__body { flex-direction: column; } .wpab-studio__panel { width: auto; flex: 1 1 45%; border-left: none; border-top: 1px solid #dcdcde; } }
			.wpab-tab { background: none; border: 1px solid #dcdcde; border-radius: 999px; padding: 4px 14px; cursor: pointer; font-size: 13px; color: #50575e; }
			.wpab-tab.is-active { background: #1d2327; border-color: #1d2327; color: #fff; }
			.wpab-pane__bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
			.wpab-pane__hint { font-size: 12px; color: #8c8f94; }
			.wpab-editor__thread { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; min-height: 180px; max-height: 46vh; overflow-y: auto; padding: 12px; }
			.wpab-editor__empty, .wpab-empty { color: #8c8f94; font-size: 13px; }
			.wpab-msg { margin: 0 0 14px; display: flex; flex-direction: column; }
			.wpab-msg__role { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8c8f94; margin-bottom: 3px; }
			.wpab-msg__body { font-size: 14px; line-height: 1.55; color: #1d2327; }
			.wpab-msg__body p { margin: 0 0 8px; } .wpab-msg__body p:last-child { margin-bottom: 0; }
			.wpab-msg__body ul { margin: 4px 0 8px; padding-left: 20px; } .wpab-msg__body li { margin: 2px 0; }
			.wpab-msg__body h4 { margin: 10px 0 4px; font-size: 13px; }
			.wpab-msg__body code { background: #f0f0f1; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
			.wpab-msg__body pre { background: #f6f7f7; border: 1px solid #e2e4e7; border-radius: 6px; padding: 10px; overflow-x: auto; margin: 6px 0 10px; }
			.wpab-msg__body pre code { background: none; padding: 0; }
			.wpab-msg__body a { color: #2271b1; }
			.wpab-msg--user .wpab-msg__body { font-weight: 500; white-space: pre-wrap; }
			.wpab-msg__activity { margin-top: 6px; font-size: 12px; color: #646970; }
			.wpab-msg__activity code { background: #f0f0f1; padding: 1px 5px; border-radius: 4px; }
			.wpab-editor__form { display: flex; gap: 8px; margin-top: 12px; align-items: flex-start; }
			.wpab-editor__input { flex: 1; font-size: 14px; }
			.wpab-editor__meta { color: #8c8f94; font-size: 12px; margin-top: 8px; min-height: 16px; }
			.wpab-typing { color: #8c8f94; font-size: 13px; }
			.wpab-prop { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; padding: 12px; margin-top: 10px; }
			.wpab-prop__head { display: flex; align-items: center; gap: 10px; }
			.wpab-prop__title { font-size: 14px; font-weight: 600; margin: 0; }
			.wpab-prop__summary { color: #50575e; font-size: 13px; margin: 6px 0 10px; }
			.wpab-pill { font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid; }
			.wpab-pill--low { background: #edfaef; color: #007a1c; border-color: #b7e4c0; }
			.wpab-pill--medium { background: #fef8ee; color: #8a6100; border-color: #f2d9a8; }
			.wpab-pill--high { background: #fcf0f1; color: #b32d2e; border-color: #f0b9ba; }
			.wpab-file { border: 1px solid #e2e4e7; border-radius: 6px; margin-top: 10px; overflow: hidden; }
			.wpab-file__head { background: #f6f7f7; padding: 7px 10px; font-size: 12px; color: #50575e; display: flex; gap: 8px; align-items: center; }
			.wpab-file__op { text-transform: uppercase; font-size: 10px; letter-spacing: .05em; padding: 1px 6px; border-radius: 4px; background: #e2e4e7; color: #3c434a; }
			.wpab-file__path { font-family: Menlo, Consolas, monospace; color: #1d2327; word-break: break-all; }
			.wpab-diff { margin: 0; padding: 8px 0; overflow-x: auto; font-family: Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; background: #fff; max-height: 260px; }
			.wpab-diff__line { padding: 0 10px; white-space: pre-wrap; word-break: break-word; }
			.wpab-diff__line--add { background: #eaf7ec; color: #14622a; }
			.wpab-diff__line--del { background: #fbeaea; color: #9a2325; }
			.wpab-diff__line--ctx { color: #50575e; }
			.wpab-prop__actions, .wpab-v-actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
			.wpab-deploy { margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
			.wpab-deploy--ok { background: #edfaef; border: 1px solid #b7e4c0; color: #007a1c; }
			.wpab-deploy--err { background: #fcf0f1; border: 1px solid #f0b9ba; color: #b32d2e; }
			.wpab-col__title { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #8c8f94; margin: 16px 0 8px; }
			.wpab-list { display: flex; flex-direction: column; gap: 8px; }
			.wpab-item { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; padding: 10px 12px; font-size: 13px; }
			.wpab-item__row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
			.wpab-item__title { color: #1d2327; font-weight: 500; }
			.wpab-item__meta { color: #8c8f94; font-size: 12px; margin-top: 2px; }
			.wpab-status { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid; }
			.wpab-status--applied { background: #edfaef; color: #007a1c; border-color: #b7e4c0; }
			.wpab-status--failed { background: #fcf0f1; color: #b32d2e; border-color: #f0b9ba; }
			.wpab-status--rolled_back { background: #f0f0f1; color: #50575e; border-color: #dcdcde; }
			.wpab-status--applying { background: #fef8ee; color: #8a6100; border-color: #f2d9a8; }
			.wpab-v-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8c8f94; margin: 10px 0 4px; }
			.wpab-v-label:first-child { margin-top: 0; }
			.wpab-v-input { width: 100%; box-sizing: border-box; font-size: 13px; }
			.wpab-v-color { width: 100%; height: 32px; padding: 0; border: 1px solid #dcdcde; border-radius: 6px; background: #fff; }
			.wpab-v-note { font-size: 11px; color: #8c8f94; margin-top: 10px; }
		</style>

		<script>
		window.WPAB_EDITOR = <?php echo wp_json_encode( $config ); ?>;
		</script>
		<?php
		self::print_app_script();
	}

	private static function print_app_script(): void {
		?>
		<script>
		(function () {
			var cfg = window.WPAB_EDITOR || {};
			var $ = function (id) { return document.getElementById(id); };
			var thread = $('wpab-editor-thread');
			var form = $('wpab-editor-form');
			var input = $('wpab-editor-input');
			var sendBtn = $('wpab-editor-send');
			var newBtn = $('wpab-editor-new');
			var statusEl = $('wpab-editor-status');
			var metaEl = $('wpab-editor-meta');
			var buildForm = $('wpab-build-form');
			var buildInput = $('wpab-build-input');
			var buildBtn = $('wpab-build-send');
			var buildMeta = $('wpab-build-meta');
			var currentEl = $('wpab-current');
			var proposalsEl = $('wpab-proposals');
			var deploymentsEl = $('wpab-deployments');
			var conversationId = null;
			var busy = false;
			var buildLoaded = false;

			function setStatus(text, kind) {
				statusEl.textContent = text;
				statusEl.className = 'wpab-studio__status' + (kind ? ' is-' + kind : '');
			}
			function escapeHtml(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
			function nowIso() { return new Date().toISOString(); }
			function setBusy(state) {
				busy = state;
				sendBtn.disabled = state; input.disabled = state;
				buildBtn.disabled = state; buildInput.disabled = state;
			}
			function api(method, url, payload) {
				var opts = { method: method, headers: { 'X-WP-Nonce': cfg.nonce } };
				if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(payload || {}); }
				return fetch(url, opts).then(function (res) {
					return res.json().then(function (data) { return { ok: res.ok, data: data }; }, function () { return { ok: res.ok, data: null }; });
				});
			}
			function renderInline(s) {
				s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
				s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
				s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
				s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
				return s;
			}
			function renderMarkdown(text) {
				var lines = escapeHtml(text).split('\n');
				var html = '', inCode = false, inList = false, codeBuf = '';
				function closeList() { if (inList) { html += '</ul>'; inList = false; } }
				for (var i = 0; i < lines.length; i++) {
					var line = lines[i];
					if (/^```/.test(line.trim())) {
						if (!inCode) { inCode = true; codeBuf = ''; closeList(); }
						else { inCode = false; html += '<pre><code>' + codeBuf + '</code></pre>'; }
						continue;
					}
					if (inCode) { codeBuf += (codeBuf ? '\n' : '') + line; continue; }
					var h = line.match(/^(#{1,4})\s+(.*)$/);
					if (h) { closeList(); html += '<h4>' + renderInline(h[2]) + '</h4>'; continue; }
					var li = line.match(/^\s*[-*]\s+(.*)$/);
					if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + renderInline(li[1]) + '</li>'; continue; }
					if (line.trim() === '') { closeList(); continue; }
					closeList();
					html += '<p>' + renderInline(line) + '</p>';
				}
				if (inCode) { html += '<pre><code>' + codeBuf + '</code></pre>'; }
				closeList();
				return html;
			}

			/* ---- Tabs (right panel only; preview stays visible) ---- */
			var tabs = document.querySelectorAll('.wpab-tab');
			for (var t = 0; t < tabs.length; t++) {
				tabs[t].addEventListener('click', function () {
					var name = this.getAttribute('data-tab');
					for (var j = 0; j < tabs.length; j++) { tabs[j].classList.toggle('is-active', tabs[j] === this); }
					$('wpab-pane-chat').hidden = (name !== 'chat');
					$('wpab-pane-build').hidden = (name !== 'build');
					$('wpab-pane-visual').hidden = (name !== 'visual');
					if (name === 'build' && !buildLoaded) { buildLoaded = true; loadBuild(); }
				});
			}

			/* ---- Chat ---- */
			function renderActivity(activity) {
				if (!activity || !activity.length) { return ''; }
				var parts = activity.map(function (item) {
					var label = item.tool === 'read_project_files' ? 'read' : 'listed';
					var scope = item.scope ? escapeHtml(item.scope) : '';
					var paths = (item.paths && item.paths.length) ? ': ' + item.paths.map(escapeHtml).join(', ') : '';
					return '<code>' + label + ' ' + scope + paths + '</code>';
				});
				return '<div class="wpab-msg__activity">Inspected ' + parts.join(' ') + '</div>';
			}
			function addMessage(role, body, activity) {
				var empty = thread.querySelector('.wpab-editor__empty');
				if (empty) { empty.remove(); }
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--' + role;
				var bodyHtml = role === 'assistant' ? renderMarkdown(body) : escapeHtml(body);
				wrap.innerHTML = '<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="wpab-msg__body">' + bodyHtml + '</div>' + (role === 'assistant' ? renderActivity(activity) : '');
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function addTyping() {
				var wrap = document.createElement('div'); wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div><div class="wpab-typing">Thinking…</div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function resetThread() {
				conversationId = null; metaEl.textContent = '';
				thread.innerHTML = '<p class="wpab-editor__empty">Ask a question to inspect this site’s theme or companion plugin.</p>';
			}
			function sendChat(message) {
				setBusy(true); metaEl.textContent = '';
				var typing = addTyping();
				var payload = { message: message };
				if (conversationId) { payload.conversationId = conversationId; }
				api('POST', cfg.restChat, payload).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) { addMessage('assistant', 'Error: ' + ((out.data && (out.data.error || out.data.message)) || 'Request failed.')); return; }
					var d = out.data;
					if (d.conversation && d.conversation.id) { conversationId = d.conversation.id; }
					addMessage('assistant', d.answer || 'Analysis completed.', d.activity);
					if (d.usage) { metaEl.textContent = (d.toolCalls || 0) + ' tool calls · ' + (d.usage.totalTokens || 0).toLocaleString() + ' tokens'; }
				}).catch(function () { typing.remove(); addMessage('assistant', 'Error: network request failed.'); })
				.then(function () { setBusy(false); input.focus(); });
			}
			form.addEventListener('submit', function (e) { e.preventDefault(); if (busy) { return; } var m = input.value.trim(); if (!m) { return; } addMessage('user', m); input.value = ''; sendChat(m); });
			input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
			newBtn.addEventListener('click', function () { if (!busy) { resetThread(); input.focus(); } });

			/* ---- Build ---- */
			function riskPill(risk) { var r = (risk === 'high' || risk === 'medium') ? risk : 'low'; return '<span class="wpab-pill wpab-pill--' + r + '">' + r + ' risk</span>'; }
			function renderDiff(diff) {
				if (!diff || !diff.length) { return '<pre class="wpab-diff"><div class="wpab-diff__line wpab-diff__line--ctx">(no diff)</div></pre>'; }
				var out = '';
				for (var i = 0; i < diff.length; i++) {
					var part = diff[i] || {};
					var cls = part.type === 'added' ? 'add' : (part.type === 'removed' ? 'del' : 'ctx');
					var prefix = part.type === 'added' ? '+' : (part.type === 'removed' ? '-' : ' ');
					var lines = String(part.value == null ? '' : part.value).replace(/\n$/, '').split('\n');
					for (var k = 0; k < lines.length; k++) { out += '<div class="wpab-diff__line wpab-diff__line--' + cls + '">' + escapeHtml(prefix + lines[k]) + '</div>'; }
				}
				return '<pre class="wpab-diff">' + out + '</pre>';
			}
			function renderProposal(p) {
				var filesHtml = (p.files || []).map(function (f) {
					return '<div class="wpab-file"><div class="wpab-file__head"><span class="wpab-file__op">' + escapeHtml(f.operation || 'modify') + '</span><span class="wpab-file__path">' + escapeHtml((f.scope || '') + '/' + (f.path || '')) + '</span></div>' + renderDiff(f.diff) + '</div>';
				}).join('');
				currentEl.innerHTML = '<div class="wpab-prop"><div class="wpab-prop__head">' + riskPill(p.risk) + '<h3 class="wpab-prop__title">' + escapeHtml(p.title || 'Proposed change') + '</h3></div><p class="wpab-prop__summary">' + escapeHtml(p.summary || '') + '</p>' + filesHtml + '<div class="wpab-prop__actions"><button type="button" class="button button-primary" id="wpab-apply-btn">Deploy</button><button type="button" class="button" id="wpab-close-btn">Close</button></div><div id="wpab-deploy"></div></div>';
				$('wpab-apply-btn').addEventListener('click', function () { deploy(p.id); });
				$('wpab-close-btn').addEventListener('click', function () { if (!busy) { currentEl.innerHTML = ''; } });
			}
			function loadBuild() {
				api('GET', cfg.restProposals + '?limit=6').then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { return; }
					renderProposalsList(out.data.proposals || []);
					renderDeploymentsList(out.data.deployments || []);
				});
			}
			function renderProposalsList(list) {
				if (!list.length) { proposalsEl.innerHTML = '<p class="wpab-empty">No proposals yet.</p>'; return; }
				proposalsEl.innerHTML = '';
				list.forEach(function (p) {
					var el = document.createElement('div'); el.className = 'wpab-item'; el.style.cursor = 'pointer';
					el.innerHTML = '<div class="wpab-item__row"><span class="wpab-item__title">' + escapeHtml(p.title || 'Proposal') + '</span>' + riskPill(p.risk) + '</div><div class="wpab-item__meta">' + (p.files ? p.files.length : 0) + ' file(s) · ' + escapeHtml(p.status || 'draft') + '</div>';
					el.addEventListener('click', function () { renderProposal(p); });
					proposalsEl.appendChild(el);
				});
			}
			function renderDeploymentsList(list) {
				if (!list.length) { deploymentsEl.innerHTML = '<p class="wpab-empty">No deployments yet.</p>'; return; }
				deploymentsEl.innerHTML = '';
				list.forEach(function (d) {
					var el = document.createElement('div'); el.className = 'wpab-item';
					var canRoll = (d.status === 'applied' && d.snapshotId);
					var btn = canRoll ? '<button type="button" class="button" data-run="' + escapeHtml(d.id) + '">Rollback</button>' : '';
					el.innerHTML = '<div class="wpab-item__row"><span class="wpab-item__title">' + escapeHtml(d.proposalTitle || 'Deployment') + '</span><span class="wpab-status wpab-status--' + escapeHtml(d.status || '') + '">' + escapeHtml(d.status || '') + '</span></div><div class="wpab-item__row"><span class="wpab-item__meta">' + (d.filesCount || 0) + ' file(s)' + (d.snapshotId ? ' · ' + escapeHtml(d.snapshotId) : '') + '</span>' + btn + '</div>';
					if (canRoll) { el.querySelector('button').addEventListener('click', function () { rollback(d.id); }); }
					deploymentsEl.appendChild(el);
				});
			}
			function propose(promptText) {
				setBusy(true); currentEl.innerHTML = '';
				buildMeta.textContent = 'Inspecting the project and drafting a change… this can take up to a minute.';
				var since = nowIso();
				api('POST', cfg.restPropose, { prompt: promptText }).then(function (out) {
					if (out.ok && out.data && out.data.proposal) { buildMeta.textContent = ''; renderProposal(out.data.proposal); loadBuild(); setBusy(false); return; }
					if (out.data && out.data.success === false && out.data.error && !out.data.started) { buildMeta.textContent = ''; currentEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(out.data.error) + '</div>'; setBusy(false); return; }
					pollForProposal(since, 0);
				}).catch(function () { pollForProposal(since, 0); });
			}
			function pollForProposal(since, attempt) {
				if (attempt > 40) { buildMeta.textContent = ''; currentEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Generation is taking longer than expected. Check "Recent proposals" in a moment, or try again.</div>'; loadBuild(); setBusy(false); return; }
				setTimeout(function () {
					api('GET', cfg.restProposals + '?limit=3&since=' + encodeURIComponent(since)).then(function (out) {
						var list = (out.data && out.data.proposals) || [];
						if (list.length) { buildMeta.textContent = ''; renderProposal(list[0]); loadBuild(); setBusy(false); }
						else { pollForProposal(since, attempt + 1); }
					}).catch(function () { pollForProposal(since, attempt + 1); });
				}, 4000);
			}
			function deploy(proposalId) {
				if (busy) { return; }
				setBusy(true);
				var deployEl = $('wpab-deploy');
				if (deployEl) { deployEl.innerHTML = '<div class="wpab-deploy">Applying with snapshot…</div>'; }
				api('POST', cfg.restApply, { proposalId: proposalId }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { var err = (out.data && (out.data.error || out.data.message)) || 'Deploy failed.'; if (deployEl) { deployEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(err) + '</div>'; } return; }
					var d = out.data.deployment || {};
					var snap = d.snapshotId ? ' · snapshot ' + escapeHtml(String(d.snapshotId)) : '';
					if (deployEl) { deployEl.innerHTML = '<div class="wpab-deploy wpab-deploy--ok">Deployed ✓ · ' + (d.filesCount || 0) + ' file(s)' + snap + '.</div>'; }
					var b = $('wpab-apply-btn'); if (b) { b.disabled = true; b.textContent = 'Deployed'; }
					reloadPreview();
				}).catch(function () { if (deployEl) { deployEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>'; } })
				.then(function () { setBusy(false); loadBuild(); });
			}
			function rollback(runId) {
				if (busy) { return; }
				if (!window.confirm('Roll back this deployment? The snapshot will be restored.')) { return; }
				setBusy(true);
				api('POST', cfg.restRollback, { runId: runId }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { window.alert((out.data && (out.data.error || out.data.message)) || 'Rollback failed.'); }
					else { reloadPreview(); }
				}).catch(function () { window.alert('Network request failed.'); })
				.then(function () { setBusy(false); loadBuild(); });
			}
			buildForm.addEventListener('submit', function (e) { e.preventDefault(); if (busy) { return; } var p = buildInput.value.trim(); if (!p) { return; } propose(p); });

			/* ---- Inspect (visual CSS) ---- */
			var vFrame = $('wpab-visual-frame');
			var vSelectorEl = $('wpab-visual-selector');
			var vPanel = $('wpab-visual-panel');
			var vHint = $('wpab-visual-hint');
			var vStatusEl = $('wpab-visual-status');
			var vRules = {};
			var vCurrentSel = null;

			function reloadPreview() { try { vFrame.src = cfg.siteUrl; } catch (e) {} }
			function vDoc() { try { return vFrame.contentDocument || (vFrame.contentWindow && vFrame.contentWindow.document); } catch (e) { return null; } }
			function rgbToHex(rgb) {
				if (!rgb) { return '#000000'; }
				var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
				if (!m) { return '#000000'; }
				function h(n) { n = parseInt(n, 10); var s = n.toString(16); return s.length < 2 ? '0' + s : s; }
				return '#' + h(m[1]) + h(m[2]) + h(m[3]);
			}
			function vBuildSelector(el) {
				if (!el || el.nodeType !== 1) { return ''; }
				if (el.id) { return '#' + el.id; }
				var parts = [], node = el, depth = 0;
				while (node && node.nodeType === 1 && node.tagName && node.tagName.toLowerCase() !== 'html' && depth < 5) {
					if (node.id) { parts.unshift('#' + node.id); break; }
					var tag = node.tagName.toLowerCase();
					var cls = [];
					if (node.className && typeof node.className === 'string') { cls = node.className.trim().split(/\s+/).filter(function (c) { return c && c.indexOf('wpab-') !== 0; }).slice(0, 2); }
					var sel = tag + (cls.length ? '.' + cls.join('.') : '');
					var parent = node.parentNode;
					if (parent && parent.children) {
						var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
						if (same.length > 1) { sel += ':nth-of-type(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')'; }
					}
					parts.unshift(sel);
					node = node.parentNode; depth++;
				}
				return parts.join(' > ');
			}
			function vBuildCss() {
				var css = '';
				Object.keys(vRules).forEach(function (sel) {
					var props = vRules[sel] || {}, body = '';
					Object.keys(props).forEach(function (p) { if (p === '__raw') { return; } if (props[p] !== '' && props[p] != null) { body += p + ':' + props[p] + ' !important;'; } });
					if (props.__raw) { body += props.__raw; }
					if (body) { css += sel + '{' + body + '}\n'; }
				});
				return css;
			}
			function vApplyPreview() {
				var doc = vDoc(); if (!doc) { return; }
				var style = doc.getElementById('wpab-visual-preview');
				if (!style) { style = doc.createElement('style'); style.id = 'wpab-visual-preview'; doc.head.appendChild(style); }
				style.textContent = vBuildCss();
			}
			function vSetProp(prop, value) { if (!vCurrentSel) { return; } vRules[vCurrentSel] = vRules[vCurrentSel] || {}; vRules[vCurrentSel][prop] = value; vApplyPreview(); }
			function vSelect(el) {
				var doc = vDoc(); if (!doc) { return; }
				var prev = doc.querySelector('.wpab-sel'); if (prev) { prev.classList.remove('wpab-sel'); }
				if (el.classList) { el.classList.add('wpab-sel'); }
				vCurrentSel = vBuildSelector(el);
				vSelectorEl.value = vCurrentSel;
				try { var cs = vFrame.contentWindow.getComputedStyle(el); $('wpab-v-color').value = rgbToHex(cs.color); $('wpab-v-bg').value = rgbToHex(cs.backgroundColor); $('wpab-v-fs').value = parseInt(cs.fontSize, 10) || ''; } catch (e) {}
				$('wpab-v-css').value = (vRules[vCurrentSel] && vRules[vCurrentSel].__raw) || '';
				if (vHint) { vHint.hidden = true; }
				vPanel.hidden = false;
			}
			function vBind() {
				var doc = vDoc();
				if (!doc) { vStatusEl.textContent = 'Preview cannot access the site (it may block being framed). Element targeting is unavailable.'; vStatusEl.className = 'wpab-studio__previewbar is-error'; return; }
				var hl = doc.getElementById('wpab-visual-hl');
				if (!hl) { hl = doc.createElement('style'); hl.id = 'wpab-visual-hl'; hl.textContent = '.wpab-hl{outline:2px dashed #2271b1 !important;outline-offset:-2px}.wpab-sel{outline:2px solid #2271b1 !important;outline-offset:-2px}'; doc.head.appendChild(hl); }
				vStatusEl.textContent = 'Click any element in the preview to target it.';
				vStatusEl.className = 'wpab-studio__previewbar';
				vApplyPreview();
				doc.addEventListener('mouseover', function (e) { if (e.target && e.target.classList) { e.target.classList.add('wpab-hl'); } }, true);
				doc.addEventListener('mouseout', function (e) { if (e.target && e.target.classList) { e.target.classList.remove('wpab-hl'); } }, true);
				doc.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); vSelect(e.target); }, true);
			}
			function applyVisual() {
				if (busy) { return; }
				var css = vBuildCss().trim();
				var resultEl = $('wpab-v-result');
				if (!css) { if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Nothing to apply yet — pick an element and change a style.</div>'; } return; }
				setBusy(true);
				if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy">Applying with snapshot…</div>'; }
				api('POST', cfg.restCssApply, { css: css }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { var err = (out.data && (out.data.error || out.data.message)) || 'Apply failed.'; if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(err) + '</div>'; } return; }
					var d = out.data.deployment || {};
					var snap = d.snapshotId ? ' · snapshot ' + escapeHtml(String(d.snapshotId)) : '';
					if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--ok">Applied ✓' + snap + '. Reloading preview…</div>'; }
					vRules = {}; vCurrentSel = null; vPanel.hidden = true; if (vHint) { vHint.hidden = false; }
					setTimeout(reloadPreview, 800);
					buildLoaded = false;
				}).catch(function () { if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>'; } })
				.then(function () { setBusy(false); });
			}
			function initVisual() {
				$('wpab-v-color').addEventListener('input', function () { vSetProp('color', this.value); });
				$('wpab-v-bg').addEventListener('input', function () { vSetProp('background-color', this.value); });
				$('wpab-v-fs').addEventListener('input', function () { vSetProp('font-size', this.value ? this.value + 'px' : ''); });
				$('wpab-v-css').addEventListener('input', function () { if (!vCurrentSel) { return; } vRules[vCurrentSel] = vRules[vCurrentSel] || {}; vRules[vCurrentSel].__raw = this.value; vApplyPreview(); });
				vSelectorEl.addEventListener('change', function () { var v = this.value.trim(); if (v) { vCurrentSel = v; } });
				$('wpab-v-reset').addEventListener('click', function () { vRules = {}; vCurrentSel = null; vApplyPreview(); vPanel.hidden = true; if (vHint) { vHint.hidden = false; } var doc = vDoc(); if (doc) { var s = doc.querySelector('.wpab-sel'); if (s) { s.classList.remove('wpab-sel'); } } });
				$('wpab-v-apply').addEventListener('click', applyVisual);
				vFrame.addEventListener('load', vBind);
				vStatusEl.textContent = 'Loading preview…';
				vFrame.src = cfg.siteUrl;
			}

			/* ---- Init ---- */
			resetThread();
			initVisual();
			function loadStatus() {
				api('POST', cfg.restSession, {}).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						var msg = (out.data && (out.data.error || out.data.message)) || 'Not connected to the AI Builder cloud.';
						setStatus(msg + ' Open Cloud connection to connect the site key.', 'error');
						return;
					}
					var d = out.data, project = d.project || {}, site = d.site || {};
					setStatus('Connected · ' + (project.name || '—') + ' · Theme: ' + (site.themeName || '—') + ' · Plugin: ' + (site.pluginName || 'None'), 'ok');
				}).catch(function () { setStatus('Could not reach WordPress REST API.', 'error'); });
			}
			if (cfg.connected) { loadStatus(); }
			else { setStatus('This site is not connected to the AI Builder cloud yet. Open Cloud connection.', 'error'); }
		})();
		</script>
		<?php
	}
}
