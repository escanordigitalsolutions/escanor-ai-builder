<?php
/**
 * ESCANOR AI Builder — wp-admin editor (v3A, milestone E1).
 *
 * A chat editor that lives inside wp-admin instead of the SaaS dashboard. The
 * browser talks to WordPress (cookie + wp_rest nonce, manage_options); this
 * class relays the request to the SaaS with the site key via WPAB_Cloud, so the
 * key never reaches the browser and the manage_options check happens here first.
 *
 * This first slice is READ-ONLY chat. Proposal review and one-click deploy move
 * into this same screen in a later milestone.
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
		register_rest_route(
			self::NAMESPACE,
			'/editor/chat',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_chat' ),
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
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
			return new WP_Error(
				'wpab_editor_empty',
				'Message is required.',
				array( 'status' => 400 )
			);
		}

		if ( strlen( $message ) > 6000 ) {
			return new WP_Error(
				'wpab_editor_too_long',
				'Message is too long.',
				array( 'status' => 400 )
			);
		}

		$body = array( 'message' => $message );

		$conversation_id = isset( $params['conversationId'] ) ? trim( (string) $params['conversationId'] ) : '';

		if ( '' !== $conversation_id ) {
			$body['conversationId'] = $conversation_id;
		}

		// Model calls can take a while; give the SaaS room to answer.
		$result = WPAB_Cloud::request( 'agent/chat', $body, 60 );

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
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'cloudPage'   => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'connected'   => WPAB_Cloud::has_key(),
		);
		?>
		<div class="wrap">
			<h1>AI Builder — Editor</h1>
			<p class="description">
				Ask the AI about this site's theme and companion plugin. This first
				version is read-only: it inspects real project files and answers.
				Change proposals and deployments arrive here in a later update.
			</p>

			<div id="wpab-editor-root" class="wpab-editor">
				<div class="wpab-editor__bar">
					<div id="wpab-editor-status" class="wpab-editor__status">Connecting…</div>
					<button type="button" id="wpab-editor-new" class="button wpab-editor__new">New chat</button>
				</div>

				<div id="wpab-editor-thread" class="wpab-editor__thread" aria-live="polite"></div>

				<form id="wpab-editor-form" class="wpab-editor__form" autocomplete="off">
					<textarea
						id="wpab-editor-input"
						class="wpab-editor__input"
						rows="2"
						placeholder="e.g. Where is the header markup rendered in this theme?"
					></textarea>
					<button type="submit" id="wpab-editor-send" class="button button-primary">
						Send
					</button>
				</form>

				<p id="wpab-editor-meta" class="wpab-editor__meta"></p>
			</div>
		</div>

		<style>
			.wpab-editor { max-width: 860px; margin-top: 16px; }
			.wpab-editor__bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
			.wpab-editor__status {
				flex: 1; padding: 10px 12px; border: 1px solid #dcdcde; border-radius: 8px;
				background: #fff; font-size: 13px;
			}
			.wpab-editor__status.is-error { border-color: #d63638; color: #d63638; }
			.wpab-editor__status.is-ok { border-color: #00a32a; }
			.wpab-editor__new { flex: 0 0 auto; }
			.wpab-editor__thread {
				border: 1px solid #dcdcde; border-radius: 8px; background: #fff;
				min-height: 220px; max-height: 52vh; overflow-y: auto; padding: 12px;
			}
			.wpab-editor__empty { color: #8c8f94; font-size: 13px; }
			.wpab-msg { margin: 0 0 14px; display: flex; flex-direction: column; }
			.wpab-msg__role { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8c8f94; margin-bottom: 3px; }
			.wpab-msg__body { font-size: 14px; line-height: 1.55; color: #1d2327; }
			.wpab-msg__body p { margin: 0 0 8px; }
			.wpab-msg__body p:last-child { margin-bottom: 0; }
			.wpab-msg__body ul { margin: 4px 0 8px; padding-left: 20px; }
			.wpab-msg__body li { margin: 2px 0; }
			.wpab-msg__body h4, .wpab-msg__body h5, .wpab-msg__body h6 { margin: 10px 0 4px; font-size: 13px; }
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
		</style>

		<script>
		window.WPAB_EDITOR = <?php echo wp_json_encode( $config ); ?>;
		</script>
		<?php
		self::print_app_script();
	}

	/**
	 * Vanilla JS app — no bundler, no external dependencies. Kept in its own
	 * method so the render markup stays readable.
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
			var conversationId = null;
			var busy = false;

			function setStatus(text, kind) {
				statusEl.textContent = text;
				statusEl.className = 'wpab-editor__status' + (kind ? ' is-' + kind : '');
			}

			function escapeHtml(value) {
				return String(value == null ? '' : value)
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
			}

			// Inline markdown on an ALREADY-escaped string.
			function renderInline(s) {
				s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
				s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
				s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
				s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
					'<a href="$2" target="_blank" rel="noopener">$1</a>');
				return s;
			}

			// Minimal, safe markdown: escape first, then build HTML from markers.
			function renderMarkdown(text) {
				var lines = escapeHtml(text).split('\n');
				var html = '';
				var inCode = false, inList = false, codeBuf = '';
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

			function renderActivity(activity) {
				if (!activity || !activity.length) {
					return '';
				}
				var parts = activity.map(function (item) {
					var label = item.tool === 'read_project_files' ? 'read' : 'listed';
					var scope = item.scope ? escapeHtml(item.scope) : '';
					var paths = (item.paths && item.paths.length)
						? ': ' + item.paths.map(escapeHtml).join(', ')
						: '';
					return '<code>' + label + ' ' + scope + paths + '</code>';
				});
				return '<div class="wpab-msg__activity">Inspected ' + parts.join(' ') + '</div>';
			}

			function addMessage(role, body, activity) {
				var empty = thread.querySelector('.wpab-editor__empty');
				if (empty) { empty.remove(); }

				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--' + role;
				var bodyHtml = role === 'assistant'
					? renderMarkdown(body)
					: escapeHtml(body);
				wrap.innerHTML =
					'<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div>' +
					'<div class="wpab-msg__body">' + bodyHtml + '</div>' +
					(role === 'assistant' ? renderActivity(activity) : '');
				thread.appendChild(wrap);
				thread.scrollTop = thread.scrollHeight;
				return wrap;
			}

			function addTyping() {
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML =
					'<div class="wpab-msg__role">AI</div>' +
					'<div class="wpab-typing">Thinking…</div>';
				thread.appendChild(wrap);
				thread.scrollTop = thread.scrollHeight;
				return wrap;
			}

			function resetThread() {
				conversationId = null;
				metaEl.textContent = '';
				thread.innerHTML = '<p class="wpab-editor__empty">Ask a question to inspect this site’s theme or companion plugin.</p>';
				input.focus();
			}

			function loadStatus() {
				fetch(cfg.restSession, {
					method: 'POST',
					headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
					body: '{}'
				}).then(function (res) {
					return res.json().then(function (data) {
						return { ok: res.ok, data: data };
					});
				}).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						var msg = (out.data && out.data.error) ||
							(out.data && out.data.message) ||
							'Not connected to the AI Builder cloud.';
						setStatus(msg + ' Connect the site key first.', 'error');
						var link = document.createElement('a');
						link.href = cfg.cloudPage;
						link.textContent = ' Open Cloud connection →';
						statusEl.appendChild(link);
						return;
					}
					var d = out.data;
					var project = d.project || {};
					var site = d.site || {};
					setStatus(
						'Connected · Project: ' + (project.name || '—') +
						' · Theme: ' + (site.themeName || '—') +
						' · Plugin: ' + (site.pluginName || 'None'),
						'ok'
					);
				}).catch(function () {
					setStatus('Could not reach WordPress REST API.', 'error');
				});
			}

			function send(message) {
				busy = true;
				sendBtn.disabled = true;
				input.disabled = true;
				metaEl.textContent = '';

				var typing = addTyping();

				var payload = { message: message };
				if (conversationId) { payload.conversationId = conversationId; }

				fetch(cfg.restChat, {
					method: 'POST',
					headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				}).then(function (res) {
					return res.json().then(function (data) {
						return { ok: res.ok, data: data };
					});
				}).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						var err = (out.data && (out.data.error || out.data.message)) || 'Request failed.';
						addMessage('assistant', 'Error: ' + err);
						return;
					}
					var d = out.data;
					if (d.conversation && d.conversation.id) {
						conversationId = d.conversation.id;
					}
					addMessage('assistant', d.answer || 'Analysis completed.', d.activity);
					if (d.usage) {
						metaEl.textContent =
							(d.toolCalls || 0) + ' tool calls · ' +
							(d.usage.totalTokens || 0).toLocaleString() + ' tokens';
					}
				}).catch(function () {
					typing.remove();
					addMessage('assistant', 'Error: network request failed.');
				}).then(function () {
					busy = false;
					sendBtn.disabled = false;
					input.disabled = false;
					input.focus();
				});
			}

			form.addEventListener('submit', function (event) {
				event.preventDefault();
				if (busy) { return; }
				var message = input.value.trim();
				if (!message) { return; }
				addMessage('user', message);
				input.value = '';
				send(message);
			});

			input.addEventListener('keydown', function (event) {
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					form.requestSubmit();
				}
			});

			newBtn.addEventListener('click', function () {
				if (busy) { return; }
				resetThread();
			});

			resetThread();

			if (cfg.connected) {
				loadStatus();
			} else {
				setStatus('This site is not connected to the AI Builder cloud yet.', 'error');
				var link = document.createElement('a');
				link.href = cfg.cloudPage;
				link.textContent = ' Open Cloud connection →';
				statusEl.appendChild(link);
			}
		})();
		</script>
		<?php
	}
}
