<?php
/**
 * ESCANOR AI Builder — wp-admin editor (v3A).
 *
 * A chat + build editor that lives inside wp-admin instead of the SaaS
 * dashboard. The browser talks to WordPress (cookie + wp_rest nonce,
 * manage_options); this class relays each request to the SaaS with the site key
 * via WPAB_Cloud, so the key never reaches the browser and the manage_options
 * check happens here first.
 *
 *   Chat   (E1): read-only project inspection + answers.
 *   Build  (E2): describe a change -> AI proposal with a diff -> one-click Apply
 *                (preflight + snapshot + auto-rollback happen on the SaaS/Bridge).
 *
 * Depends on WPAB_Cloud (the reverse-direction client) already being loaded.
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

		register_rest_route(
			self::NAMESPACE,
			'/editor/chat',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_chat' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/propose',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_propose' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/apply',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_apply' ),
				'permission_callback' => $permission,
			)
		);
	}

	public static function rest_chat( WP_REST_Request $request ) {
		$params = $request->get_json_params();

		if ( ! is_array( $params ) ) {
			$params = array();
		}

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

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	public static function rest_propose( WP_REST_Request $request ) {
		$params = $request->get_json_params();

		if ( ! is_array( $params ) ) {
			$params = array();
		}

		$prompt = isset( $params['prompt'] ) ? trim( (string) $params['prompt'] ) : '';

		if ( '' === $prompt ) {
			return new WP_Error( 'wpab_editor_empty', 'Describe the change first.', array( 'status' => 400 ) );
		}

		if ( strlen( $prompt ) > 6000 ) {
			return new WP_Error( 'wpab_editor_too_long', 'Change request is too long.', array( 'status' => 400 ) );
		}

		// Proposal generation inspects files and drafts code — allow more time.
		$result = WPAB_Cloud::request( 'agent/proposals', array( 'prompt' => $prompt ), 120 );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	public static function rest_apply( WP_REST_Request $request ) {
		$params = $request->get_json_params();

		if ( ! is_array( $params ) ) {
			$params = array();
		}

		$proposal_id = isset( $params['proposalId'] ) ? trim( (string) $params['proposalId'] ) : '';

		if ( '' === $proposal_id ) {
			return new WP_Error( 'wpab_editor_no_proposal', 'proposalId is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/apply', array( 'proposalId' => $proposal_id ), 90 );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	/* ---------------------------------------------------------------------
	 * Admin page
	 * ------------------------------------------------------------------ */

	public static function register_page(): void {
		add_submenu_page(
			'wp-ai-builder',
			'AI Builder — Editor',
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
			'restSession' => esc_url_raw( rest_url( self::NAMESPACE . '/cloud/session' ) ),
			'restChat'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat' ) ),
			'restPropose' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/propose' ) ),
			'restApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/apply' ) ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'cloudPage'   => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'snapPage'    => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-snapshots' ) ),
			'connected'   => WPAB_Cloud::has_key(),
		);
		?>
		<div class="wrap">
			<h1>AI Builder — Editor</h1>
			<p class="description">
				Chat with the AI about this site's theme and companion plugin, or
				describe a change and review a diff before applying it. Every apply is
				snapshotted and rolls back automatically if the site breaks.
			</p>

			<div id="wpab-editor-root" class="wpab-editor">
				<div class="wpab-editor__bar">
					<div id="wpab-editor-status" class="wpab-editor__status">Connecting…</div>
					<button type="button" id="wpab-editor-new" class="button wpab-editor__new">New chat</button>
				</div>

				<div class="wpab-editor__tabs">
					<button type="button" class="wpab-tab is-active" data-tab="chat">Chat</button>
					<button type="button" class="wpab-tab" data-tab="build">Build</button>
				</div>

				<div id="wpab-pane-chat" class="wpab-pane">
					<div id="wpab-editor-thread" class="wpab-editor__thread" aria-live="polite"></div>

					<form id="wpab-editor-form" class="wpab-editor__form" autocomplete="off">
						<textarea id="wpab-editor-input" class="wpab-editor__input" rows="2"
							placeholder="e.g. Where is the header markup rendered in this theme?"></textarea>
						<button type="submit" id="wpab-editor-send" class="button button-primary">Send</button>
					</form>

					<p id="wpab-editor-meta" class="wpab-editor__meta"></p>
				</div>

				<div id="wpab-pane-build" class="wpab-pane" hidden>
					<form id="wpab-build-form" class="wpab-editor__form" autocomplete="off">
						<textarea id="wpab-build-input" class="wpab-editor__input" rows="3"
							placeholder="Describe a change, e.g. Add a newsletter signup section to the footer."></textarea>
						<button type="submit" id="wpab-build-send" class="button button-primary">Propose change</button>
					</form>
					<p id="wpab-build-meta" class="wpab-editor__meta"></p>
					<div id="wpab-build-result" class="wpab-build-result"></div>
				</div>
			</div>
		</div>

		<style>
			.wpab-editor { max-width: 900px; margin-top: 16px; }
			.wpab-editor__bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
			.wpab-editor__status { flex: 1; padding: 10px 12px; border: 1px solid #dcdcde; border-radius: 8px; background: #fff; font-size: 13px; }
			.wpab-editor__status.is-error { border-color: #d63638; color: #d63638; }
			.wpab-editor__status.is-ok { border-color: #00a32a; }
			.wpab-editor__new { flex: 0 0 auto; }
			.wpab-editor__tabs { display: flex; gap: 6px; margin-bottom: 10px; }
			.wpab-tab { background: none; border: 1px solid #dcdcde; border-radius: 999px; padding: 4px 14px; cursor: pointer; font-size: 13px; color: #50575e; }
			.wpab-tab.is-active { background: #1d2327; border-color: #1d2327; color: #fff; }
			.wpab-editor__thread { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; min-height: 220px; max-height: 52vh; overflow-y: auto; padding: 12px; }
			.wpab-editor__empty { color: #8c8f94; font-size: 13px; }
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
			/* Build */
			.wpab-build-result { margin-top: 8px; }
			.wpab-prop { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; padding: 14px; }
			.wpab-prop__head { display: flex; align-items: center; gap: 10px; }
			.wpab-prop__title { font-size: 15px; font-weight: 600; margin: 0; color: #1d2327; }
			.wpab-prop__summary { color: #50575e; font-size: 13px; margin: 6px 0 10px; }
			.wpab-pill { font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid; }
			.wpab-pill--low { background: #edfaef; color: #007a1c; border-color: #b7e4c0; }
			.wpab-pill--medium { background: #fef8ee; color: #8a6100; border-color: #f2d9a8; }
			.wpab-pill--high { background: #fcf0f1; color: #b32d2e; border-color: #f0b9ba; }
			.wpab-file { border: 1px solid #e2e4e7; border-radius: 6px; margin-top: 10px; overflow: hidden; }
			.wpab-file__head { background: #f6f7f7; padding: 7px 10px; font-size: 12px; color: #50575e; display: flex; gap: 8px; align-items: center; }
			.wpab-file__op { text-transform: uppercase; font-size: 10px; letter-spacing: .05em; padding: 1px 6px; border-radius: 4px; background: #e2e4e7; color: #3c434a; }
			.wpab-file__path { font-family: Menlo, Consolas, monospace; color: #1d2327; }
			.wpab-diff { margin: 0; padding: 8px 0; overflow-x: auto; font-family: Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; background: #fff; }
			.wpab-diff__line { padding: 0 10px; white-space: pre-wrap; word-break: break-word; }
			.wpab-diff__line--add { background: #eaf7ec; color: #14622a; }
			.wpab-diff__line--del { background: #fbeaea; color: #9a2325; }
			.wpab-diff__line--ctx { color: #50575e; }
			.wpab-prop__actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
			.wpab-deploy { margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
			.wpab-deploy--ok { background: #edfaef; border: 1px solid #b7e4c0; color: #007a1c; }
			.wpab-deploy--err { background: #fcf0f1; border: 1px solid #f0b9ba; color: #b32d2e; }
		</style>

		<script>
		window.WPAB_EDITOR = <?php echo wp_json_encode( $config ); ?>;
		</script>
		<?php
		self::print_app_script();
	}

	/**
	 * Vanilla JS app — no bundler, no external dependencies.
	 */
	private static function print_app_script(): void {
		?>
		<script>
		(function () {
			var cfg = window.WPAB_EDITOR || {};
			var thread = document.getElementById('wpab-editor-thread');
			var form = document.getElementById('wpab-editor-form');
			var input = document.getElementById('wpab-editor-input');
			var sendBtn = document.getElementById('wpab-editor-send');
			var newBtn = document.getElementById('wpab-editor-new');
			var statusEl = document.getElementById('wpab-editor-status');
			var metaEl = document.getElementById('wpab-editor-meta');
			var buildForm = document.getElementById('wpab-build-form');
			var buildInput = document.getElementById('wpab-build-input');
			var buildBtn = document.getElementById('wpab-build-send');
			var buildMeta = document.getElementById('wpab-build-meta');
			var buildResult = document.getElementById('wpab-build-result');
			var conversationId = null;
			var busy = false;

			function setStatus(text, kind) {
				statusEl.textContent = text;
				statusEl.className = 'wpab-editor__status' + (kind ? ' is-' + kind : '');
			}

			function escapeHtml(value) {
				return String(value == null ? '' : value)
					.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

			/* ---- Tabs ---- */
			var tabs = document.querySelectorAll('.wpab-tab');
			for (var t = 0; t < tabs.length; t++) {
				tabs[t].addEventListener('click', function () {
					if (busy) { return; }
					var name = this.getAttribute('data-tab');
					for (var j = 0; j < tabs.length; j++) {
						tabs[j].classList.toggle('is-active', tabs[j] === this);
					}
					document.getElementById('wpab-pane-chat').hidden = (name !== 'chat');
					document.getElementById('wpab-pane-build').hidden = (name !== 'build');
				}.bind(tabs[t]));
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
				wrap.innerHTML = '<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div>' +
					'<div class="wpab-msg__body">' + bodyHtml + '</div>' +
					(role === 'assistant' ? renderActivity(activity) : '');
				thread.appendChild(wrap);
				thread.scrollTop = thread.scrollHeight;
				return wrap;
			}

			function addTyping(where) {
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div><div class="wpab-typing">Thinking…</div>';
				where.appendChild(wrap);
				where.scrollTop = where.scrollHeight;
				return wrap;
			}

			function resetThread() {
				conversationId = null;
				metaEl.textContent = '';
				thread.innerHTML = '<p class="wpab-editor__empty">Ask a question to inspect this site’s theme or companion plugin.</p>';
			}

			function api(url, payload) {
				return fetch(url, {
					method: 'POST',
					headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
					body: JSON.stringify(payload || {})
				}).then(function (res) {
					return res.json().then(function (data) { return { ok: res.ok, data: data }; });
				});
			}

			function setBusy(state) {
				busy = state;
				sendBtn.disabled = state; input.disabled = state;
				buildBtn.disabled = state; buildInput.disabled = state;
			}

			function loadStatus() {
				api(cfg.restSession, {}).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						var msg = (out.data && (out.data.error || out.data.message)) || 'Not connected to the AI Builder cloud.';
						setStatus(msg + ' Connect the site key first.', 'error');
						var link = document.createElement('a');
						link.href = cfg.cloudPage; link.textContent = ' Open Cloud connection →';
						statusEl.appendChild(link);
						return;
					}
					var d = out.data, project = d.project || {}, site = d.site || {};
					setStatus('Connected · Project: ' + (project.name || '—') + ' · Theme: ' + (site.themeName || '—') + ' · Plugin: ' + (site.pluginName || 'None'), 'ok');
				}).catch(function () { setStatus('Could not reach WordPress REST API.', 'error'); });
			}

			function sendChat(message) {
				setBusy(true); metaEl.textContent = '';
				var typing = addTyping(thread);
				var payload = { message: message };
				if (conversationId) { payload.conversationId = conversationId; }
				api(cfg.restChat, payload).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						addMessage('assistant', 'Error: ' + ((out.data && (out.data.error || out.data.message)) || 'Request failed.'));
						return;
					}
					var d = out.data;
					if (d.conversation && d.conversation.id) { conversationId = d.conversation.id; }
					addMessage('assistant', d.answer || 'Analysis completed.', d.activity);
					if (d.usage) { metaEl.textContent = (d.toolCalls || 0) + ' tool calls · ' + (d.usage.totalTokens || 0).toLocaleString() + ' tokens'; }
				}).catch(function () { typing.remove(); addMessage('assistant', 'Error: network request failed.'); })
				.then(function () { setBusy(false); input.focus(); });
			}

			form.addEventListener('submit', function (e) {
				e.preventDefault();
				if (busy) { return; }
				var message = input.value.trim();
				if (!message) { return; }
				addMessage('user', message); input.value = ''; sendChat(message);
			});
			input.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
			});
			newBtn.addEventListener('click', function () { if (!busy) { resetThread(); input.focus(); } });

			/* ---- Build (propose / diff / apply) ---- */
			function riskPill(risk) {
				var r = (risk === 'high' || risk === 'medium') ? risk : 'low';
				return '<span class="wpab-pill wpab-pill--' + r + '">' + r + ' risk</span>';
			}

			function renderDiff(diff) {
				if (!diff || !diff.length) { return '<pre class="wpab-diff"><div class="wpab-diff__line wpab-diff__line--ctx">(no diff)</div></pre>'; }
				var out = '';
				for (var i = 0; i < diff.length; i++) {
					var part = diff[i] || {};
					var cls = part.type === 'added' ? 'add' : (part.type === 'removed' ? 'del' : 'ctx');
					var prefix = part.type === 'added' ? '+' : (part.type === 'removed' ? '-' : ' ');
					var lines = String(part.value == null ? '' : part.value).replace(/\n$/, '').split('\n');
					for (var k = 0; k < lines.length; k++) {
						out += '<div class="wpab-diff__line wpab-diff__line--' + cls + '">' + escapeHtml(prefix + lines[k]) + '</div>';
					}
				}
				return '<pre class="wpab-diff">' + out + '</pre>';
			}

			function renderProposal(p) {
				var filesHtml = (p.files || []).map(function (f) {
					return '<div class="wpab-file">' +
						'<div class="wpab-file__head"><span class="wpab-file__op">' + escapeHtml(f.operation || 'modify') + '</span>' +
						'<span class="wpab-file__path">' + escapeHtml((f.scope || '') + '/' + (f.path || '')) + '</span></div>' +
						renderDiff(f.diff) + '</div>';
				}).join('');

				buildResult.innerHTML =
					'<div class="wpab-prop">' +
						'<div class="wpab-prop__head">' + riskPill(p.risk) + '<h3 class="wpab-prop__title">' + escapeHtml(p.title || 'Proposed change') + '</h3></div>' +
						'<p class="wpab-prop__summary">' + escapeHtml(p.summary || '') + '</p>' +
						filesHtml +
						'<div class="wpab-prop__actions">' +
							'<button type="button" class="button button-primary" id="wpab-apply-btn">Apply change</button>' +
							'<button type="button" class="button" id="wpab-discard-btn">Discard</button>' +
						'</div>' +
						'<div id="wpab-deploy" ></div>' +
					'</div>';

				document.getElementById('wpab-apply-btn').addEventListener('click', function () { applyProposal(p.id); });
				document.getElementById('wpab-discard-btn').addEventListener('click', function () { if (!busy) { buildResult.innerHTML = ''; buildMeta.textContent = ''; } });
			}

			function propose(promptText) {
				setBusy(true);
				buildResult.innerHTML = '';
				buildMeta.textContent = 'Inspecting the project and drafting a change… this can take a moment.';
				api(cfg.restPropose, { prompt: promptText }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						buildMeta.textContent = '';
						buildResult.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml((out.data && (out.data.error || out.data.message)) || 'Could not create a proposal.') + '</div>';
						return;
					}
					var p = out.data.proposal || {};
					var u = p.usage || {};
					buildMeta.textContent = (p.toolCalls || 0) + ' tool calls · ' + ((u.totalTokens || 0)).toLocaleString() + ' tokens';
					renderProposal(p);
				}).catch(function () {
					buildMeta.textContent = '';
					buildResult.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>';
				}).then(function () { setBusy(false); });
			}

			function applyProposal(proposalId) {
				if (busy) { return; }
				setBusy(true);
				var deploy = document.getElementById('wpab-deploy');
				if (deploy) { deploy.innerHTML = '<div class="wpab-deploy">Applying with snapshot…</div>'; }
				api(cfg.restApply, { proposalId: proposalId }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						var err = (out.data && (out.data.error || out.data.message)) || 'Apply failed.';
						if (deploy) { deploy.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(err) + '</div>'; }
						return;
					}
					var d = out.data.deployment || {};
					var snap = d.snapshotId ? ' · snapshot ' + escapeHtml(String(d.snapshotId)) : '';
					if (deploy) {
						deploy.innerHTML = '<div class="wpab-deploy wpab-deploy--ok">Deployed ✓ · ' + (d.filesCount || 0) + ' file(s)' + snap +
							'. Roll back anytime from <a href="' + cfg.snapPage + '">Snapshots</a>.</div>';
					}
					var applyBtn = document.getElementById('wpab-apply-btn');
					if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Applied'; }
				}).catch(function () {
					if (deploy) { deploy.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>'; }
				}).then(function () { setBusy(false); });
			}

			buildForm.addEventListener('submit', function (e) {
				e.preventDefault();
				if (busy) { return; }
				var p = buildInput.value.trim();
				if (!p) { return; }
				propose(p);
			});

			/* ---- Init ---- */
			resetThread();
			if (cfg.connected) {
				loadStatus();
			} else {
				setStatus('This site is not connected to the AI Builder cloud yet.', 'error');
				var link = document.createElement('a');
				link.href = cfg.cloudPage; link.textContent = ' Open Cloud connection →';
				statusEl.appendChild(link);
			}
		})();
		</script>
		<?php
	}
}
