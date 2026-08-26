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

	private const VISUAL_CSS_OPTION = 'wpab_visual_css';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_page' ), 30 );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		// Print the Visual editor's overrides on the front end, late so they win
		// over the theme regardless of whether the theme loads style.css.
		add_action( 'wp_head', array( __CLASS__, 'print_front_css' ), 999 );
	}

	/**
	 * Output the stored Visual CSS on the front end. This is a site-local
	 * override layer (like core's Additional CSS), managed entirely by the
	 * plugin — so it applies to any theme and is instantly reversible.
	 */
	public static function print_front_css(): void {
		if ( is_admin() ) {
			return;
		}

		$css = (string) get_option( self::VISUAL_CSS_OPTION, '' );

		if ( '' === trim( $css ) ) {
			return;
		}

		// Neutralise any attempt to break out of the style element.
		$css = str_ireplace( '</style', '', $css );

		echo "\n<style id=\"wpab-visual-css\">\n" . $css . "\n</style>\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
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

		register_rest_route(
			self::NAMESPACE,
			'/editor/steps',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_steps' ),
				'permission_callback' => $permission,
			)
		);

		// Native content browser (Phase 1). Served locally from WP core — the
		// panel shows the site's real pages/posts/products/menus/media without a
		// cloud round-trip, so it works even if the SaaS is briefly unreachable.
		register_rest_route(
			self::NAMESPACE,
			'/editor/content/types',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_content_types' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/content/list',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_content_list' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/content/get',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_content_get' ),
				'permission_callback' => $permission,
			)
		);

		// Content editing (Phase 3): draft a change (proxied to the SaaS model)
		// and apply it (proxied to the SaaS writer -> bridge -> wp_update_post).
		register_rest_route(
			self::NAMESPACE,
			'/editor/content/propose',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_content_edit_propose' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/content/apply',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_content_edit_apply' ),
				'permission_callback' => $permission,
			)
		);

		// Visual CSS override layer (stored locally, printed on the front end).
		register_rest_route(
			self::NAMESPACE,
			'/editor/visual-css',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'rest_visual_css_get' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'rest_visual_css_set' ),
					'permission_callback' => $permission,
				),
			)
		);
	}

	public static function rest_steps( WP_REST_Request $request ) {
		$run_id = trim( (string) $request->get_param( 'runId' ) );

		if ( '' === $run_id ) {
			return new WP_REST_Response( array( 'success' => true, 'steps' => array() ), 200 );
		}

		$result = WPAB_Cloud::get( 'agent/steps', array( 'runId' => $run_id ), 12 );

		return is_wp_error( $result ) ? new WP_REST_Response( array( 'success' => true, 'steps' => array() ), 200 ) : new WP_REST_Response( $result, 200 );
	}

	public static function rest_content_types( WP_REST_Request $request ) {
		return new WP_REST_Response( WPAB_Content::types(), 200 );
	}

	public static function rest_content_list( WP_REST_Request $request ) {
		$limit  = (int) $request->get_param( 'limit' );
		$result = WPAB_Content::listing(
			(string) $request->get_param( 'type' ),
			$limit > 0 ? $limit : 30
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_content_get( WP_REST_Request $request ) {
		$result = WPAB_Content::get_item(
			(string) $request->get_param( 'type' ),
			(int) $request->get_param( 'id' )
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_content_edit_propose( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$type        = isset( $params['type'] ) ? trim( (string) $params['type'] ) : '';
		$id          = isset( $params['id'] ) ? (int) $params['id'] : 0;
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';

		if ( '' === $type || $id < 1 || '' === $instruction ) {
			return new WP_Error( 'wpab_editor_bad_edit', 'type, id and instruction are required.', array( 'status' => 400 ) );
		}
		if ( strlen( $instruction ) > 4000 ) {
			return new WP_Error( 'wpab_editor_too_long', 'Instruction is too long.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request(
			'agent/content-propose',
			array(
				'type'        => $type,
				'id'          => $id,
				'instruction' => $instruction,
			),
			55
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_content_edit_apply( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$type   = isset( $params['type'] ) ? trim( (string) $params['type'] ) : '';
		$id     = isset( $params['id'] ) ? (int) $params['id'] : 0;
		$fields = isset( $params['fields'] ) && is_array( $params['fields'] ) ? $params['fields'] : array();

		if ( '' === $type || $id < 1 || empty( $fields ) ) {
			return new WP_Error( 'wpab_editor_bad_edit', 'type, id and fields are required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request(
			'agent/content-apply',
			array(
				'type'   => $type,
				'id'     => $id,
				'fields' => $fields,
			),
			45
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_visual_css_get() {
		return new WP_REST_Response(
			array(
				'success' => true,
				'css'     => (string) get_option( self::VISUAL_CSS_OPTION, '' ),
			),
			200
		);
	}

	public static function rest_visual_css_set( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$css    = isset( $params['css'] ) ? (string) $params['css'] : '';

		if ( strlen( $css ) > 80000 ) {
			return new WP_Error( 'wpab_visual_css_too_long', 'Visual CSS is too large.', array( 'status' => 400 ) );
		}

		$css = str_ireplace( '</style', '', $css );

		update_option( self::VISUAL_CSS_OPTION, $css, true );

		return new WP_REST_Response( array( 'success' => true, 'css' => $css ), 200 );
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
			'restVisualCss' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/visual-css' ) ),
			'restSteps'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/steps' ) ),
			'restContentTypes' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/types' ) ),
			'restContentList'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/list' ) ),
			'restContentGet'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/get' ) ),
			'restContentPropose' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/propose' ) ),
			'restContentApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/apply' ) ),
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
						<button type="button" class="wpab-tab" data-tab="content">Content</button>
						<button type="button" class="wpab-tab" data-tab="visual">Inspect</button>
						<button type="button" class="wpab-tab" data-tab="build">History</button>
						<span class="wpab-studio__spacer"></span>
						<button type="button" id="wpab-collapse" class="wpab-studio__collapse">▾ Collapse</button>
					</div>

					<div class="wpab-studio__content">
						<div id="wpab-pane-chat" class="wpab-pane">
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">Ask a question or describe a change — I’ll propose it inline.</span>
								<button type="button" id="wpab-editor-new" class="button">New chat</button>
							</div>
							<div id="wpab-suggests" class="wpab-suggests"></div>
							<div id="wpab-editor-thread" class="wpab-editor__thread" aria-live="polite"></div>
							<form id="wpab-editor-form" class="wpab-editor__form" autocomplete="off">
								<textarea id="wpab-editor-input" class="wpab-editor__input" rows="2"
									placeholder="Ask anything, or e.g. “Make the header sticky and add a Contact button.”"></textarea>
								<button type="submit" id="wpab-editor-send" class="button button-primary">Send</button>
							</form>
							<p id="wpab-editor-meta" class="wpab-editor__meta"></p>
						</div>

						<div id="wpab-pane-build" class="wpab-pane" hidden>
							<div class="wpab-pane__bar">
									<span class="wpab-pane__hint">Past proposals &amp; deployments. New changes start in Chat.</span>
									<button type="button" id="wpab-build-refresh" class="button">Refresh</button>
								</div>
								<p id="wpab-build-meta" class="wpab-editor__meta"></p>
							<div id="wpab-current"></div>
							<h3 class="wpab-col__title">Recent proposals</h3>
							<div id="wpab-proposals" class="wpab-list"></div>
							<h3 class="wpab-col__title" style="margin-top:16px">Deployments</h3>
							<div id="wpab-deployments" class="wpab-list"></div>
						</div>

						<div id="wpab-pane-content" class="wpab-pane" hidden>
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">Your site’s native content — pages, posts, products, menus &amp; media.</span>
								<button type="button" id="wpab-content-refresh" class="button">Refresh</button>
							</div>
							<div id="wpab-content-types" class="wpab-ctypes"></div>
							<div id="wpab-content-body" class="wpab-content__body">
								<p class="wpab-empty">Loading content…</p>
							</div>
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
								<label class="wpab-v-label">Font weight</label>
								<select id="wpab-v-fw" class="wpab-v-input">
									<option value="">—</option>
									<option value="400">Normal (400)</option>
									<option value="500">Medium (500)</option>
									<option value="600">Semibold (600)</option>
									<option value="700">Bold (700)</option>
								</select>
								<label class="wpab-v-label">Text align</label>
								<select id="wpab-v-ta" class="wpab-v-input">
									<option value="">—</option>
									<option value="left">Left</option>
									<option value="center">Center</option>
									<option value="right">Right</option>
								</select>
								<label class="wpab-v-label">Padding (px)</label>
								<input type="number" id="wpab-v-pad" class="wpab-v-input" min="0" max="200" />
								<label class="wpab-v-label">Border radius (px)</label>
								<input type="number" id="wpab-v-radius" class="wpab-v-input" min="0" max="200" />
								<label class="wpab-v-label">Custom CSS for this element</label>
								<textarea id="wpab-v-css" class="wpab-v-input" rows="3" placeholder="border: 1px solid #ccc; letter-spacing: 1px;"></textarea>
								<div class="wpab-v-actions">
									<button type="button" id="wpab-v-apply" class="button button-primary">Apply changes</button>
									<button type="button" id="wpab-v-reset" class="button">Reset</button>
								</div>
								<div id="wpab-v-result"></div>
								<p class="wpab-v-note">
									Apply saves the CSS as a site override that loads on every page (works on any theme) and is instantly reversible.
									<a href="#" id="wpab-v-clear">Clear all applied CSS</a>
								</p>
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
			.wpab-studio__body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
			.wpab-studio__preview { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px; }
			.wpab-studio__previewbar { font-size: 12px; color: #50575e; margin-bottom: 8px; }
			.wpab-studio__previewbar.is-error { color: #d63638; }
			.wpab-studio__frame { flex: 1; width: 100%; border: 1px solid #dcdcde; border-radius: 10px; background: #fff; }
			.wpab-studio__panel { flex: 0 0 30vh; height: 30vh; background: #fff; border-top: 1px solid #dcdcde; display: flex; flex-direction: column; min-height: 0; transition: flex-basis .15s ease, height .15s ease; }
			.wpab-studio__panel.is-collapsed { flex-basis: 46px; height: 46px; }
			.wpab-studio__panel.is-collapsed .wpab-studio__content { display: none; }
			.wpab-studio__tabs { display: flex; gap: 6px; padding: 10px 12px; align-items: center; }
			.wpab-studio__spacer { flex: 1; }
			.wpab-studio__collapse { background: none; border: 1px solid #dcdcde; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; color: #50575e; }
			.wpab-studio__content { flex: 1; overflow-y: auto; padding: 0 12px 12px; min-height: 0; }
			.wpab-suggests { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
			.wpab-chip { background: #f0f0f1; border: 1px solid #e2e4e7; border-radius: 999px; padding: 4px 11px; font-size: 12px; color: #3c434a; cursor: pointer; }
			.wpab-chip:hover { background: #e8e8ea; }
			.wpab-steps { margin-top: 4px; }
			.wpab-step { font-size: 12px; color: #50575e; padding: 2px 0; }
			.wpab-step::before { content: "→ "; color: #8c8f94; }
			.wpab-tab { background: none; border: 1px solid #dcdcde; border-radius: 999px; padding: 4px 14px; cursor: pointer; font-size: 13px; color: #50575e; }
			.wpab-tab.is-active { background: #1d2327; border-color: #1d2327; color: #fff; }
			.wpab-pane__bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
			.wpab-pane__hint { font-size: 12px; color: #8c8f94; }
			.wpab-editor__thread { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; min-height: 90px; max-height: 22vh; overflow-y: auto; padding: 12px; }
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
			.wpab-prop-mount:empty { display: none; }
			.wpab-prop-mount { margin-top: 8px; }
			.wpab-inline-status { margin-top: 4px; }
			.wpab-ce-field { border: 1px solid #e2e4e7; border-radius: 6px; margin-top: 10px; overflow: hidden; }
			.wpab-ce-fname { background: #f6f7f7; padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #50575e; }
			.wpab-ce-before, .wpab-ce-after { padding: 8px 10px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-family: Menlo, Consolas, monospace; }
			.wpab-ce-before { background: #fbeaea; color: #9a2325; }
			.wpab-ce-after { background: #eaf7ec; color: #14622a; }
			.wpab-ctypes { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
			.wpab-ctype { background: #f0f0f1; border: 1px solid #e2e4e7; border-radius: 999px; padding: 4px 12px; font-size: 12px; color: #3c434a; cursor: pointer; }
			.wpab-ctype:hover { background: #e8e8ea; }
			.wpab-ctype.is-active { background: #1d2327; border-color: #1d2327; color: #fff; }
			.wpab-ctype__count { opacity: .6; margin-left: 5px; }
			.wpab-content__body { min-height: 60px; }
			.wpab-crow { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; padding: 9px 12px; margin-bottom: 7px; cursor: pointer; }
			.wpab-crow:hover { border-color: #1d2327; }
			.wpab-crow__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
			.wpab-crow__title { color: #1d2327; font-weight: 500; word-break: break-word; }
			.wpab-crow__meta { color: #8c8f94; font-size: 12px; margin-top: 2px; }
			.wpab-cstatus { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 1px 7px; border-radius: 999px; border: 1px solid #dcdcde; color: #50575e; white-space: nowrap; }
			.wpab-cstatus--publish { background: #edfaef; color: #007a1c; border-color: #b7e4c0; }
			.wpab-cstatus--draft { background: #f6f7f7; color: #50575e; }
			.wpab-cstatus--pending, .wpab-cstatus--future { background: #fef8ee; color: #8a6100; border-color: #f2d9a8; }
			.wpab-cstatus--private { background: #f0eefc; color: #5a3ec8; border-color: #d6cffa; }
			.wpab-cdetail { border: 1px solid #dcdcde; border-radius: 8px; background: #fff; padding: 12px; margin-bottom: 10px; }
			.wpab-cdetail__title { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
			.wpab-cdetail__row { font-size: 12px; color: #50575e; margin: 2px 0; }
			.wpab-cdetail__row code { background: #f0f0f1; padding: 1px 5px; border-radius: 4px; }
			.wpab-cdetail__content { margin-top: 8px; background: #f6f7f7; border: 1px solid #e2e4e7; border-radius: 6px; padding: 10px; font-family: Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 30vh; overflow-y: auto; }
			.wpab-cdetail__actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
			.wpab-cback { background: none; border: none; color: #2271b1; cursor: pointer; font-size: 12px; padding: 0 0 8px; }
			.wpab-cthumb { max-width: 100%; border-radius: 6px; margin-top: 8px; border: 1px solid #e2e4e7; }
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
			var buildMeta = $('wpab-build-meta');
			var currentEl = $('wpab-current');
			var proposalsEl = $('wpab-proposals');
			var deploymentsEl = $('wpab-deployments');
			var conversationId = null;
			var busy = false;
			var buildLoaded = false;
			var contentLoaded = false;
			var contentActiveType = null;

			function setStatus(text, kind) {
				statusEl.textContent = text;
				statusEl.className = 'wpab-studio__status' + (kind ? ' is-' + kind : '');
			}
			function escapeHtml(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
			function nowIso() { return new Date().toISOString(); }
			function setBusy(state) {
				busy = state;
				sendBtn.disabled = state; input.disabled = state;
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
					$('wpab-pane-content').hidden = (name !== 'content');
					$('wpab-pane-visual').hidden = (name !== 'visual');
					if (name === 'build' && !buildLoaded) { buildLoaded = true; loadBuild(); }
					if (name === 'content' && !contentLoaded) { contentLoaded = true; loadContentTypes(); }
				});
			}

			/* ---- Chat ---- */
			function renderActivity(activity) {
				activity = (activity || []).filter(function (item) { return item.tool !== 'request_build'; });
				if (!activity.length) { return ''; }
				var parts = activity.map(function (item) {
					var label = (item.tool === 'read_project_files' || item.tool === 'get_content') ? 'read' : (item.tool === 'list_content_types' ? 'content types' : 'listed');
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
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div><div class="wpab-typing">Working…</div><div class="wpab-steps"></div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function resetThread() {
				conversationId = null; metaEl.textContent = '';
				thread.innerHTML = '<p class="wpab-editor__empty">Ask a question to inspect this site’s theme or companion plugin.</p>';
			}
			function sendChat(message) {
				var pendingBuild = null;
					var pendingContentEdit = null;
					setBusy(true); metaEl.textContent = '';
				var runId = genRunId();
				var typing = addTyping();
				var stepsBox = typing.querySelector('.wpab-steps');
				var polling = true;
				function pollSteps() {
					if (!polling) { return; }
					api('GET', cfg.restSteps + '?runId=' + encodeURIComponent(runId)).then(function (o) {
						if (!polling) { return; }
						var st = (o.data && o.data.steps) || [];
						if (st.length && stepsBox) { stepsBox.innerHTML = st.map(function (s) { return '<div class="wpab-step">' + escapeHtml(s.label) + '</div>'; }).join(''); }
						if (polling) { setTimeout(pollSteps, 1300); }
					}).catch(function () { if (polling) { setTimeout(pollSteps, 1500); } });
				}
				setTimeout(pollSteps, 700);
				var payload = { message: message, runId: runId };
				if (conversationId) { payload.conversationId = conversationId; }
				api('POST', cfg.restChat, payload).then(function (out) {
					polling = false; typing.remove();
					if (!out.ok || !out.data || out.data.success === false) { addMessage('assistant', 'Error: ' + ((out.data && (out.data.error || out.data.message)) || 'Request failed.')); return; }
					var d = out.data;
					if (d.conversation && d.conversation.id) { conversationId = d.conversation.id; }
					addMessage('assistant', d.answer || 'Analysis completed.', d.activity);
						if (d.buildRequest && d.buildRequest.instruction) { pendingBuild = d.buildRequest.instruction; }
						if (d.contentEditRequest && d.contentEditRequest.id) { pendingContentEdit = d.contentEditRequest; }
					if (d.usage) { metaEl.textContent = (d.toolCalls || 0) + ' tool calls · ' + (d.usage.totalTokens || 0).toLocaleString() + ' tokens'; }
				}).catch(function () { polling = false; typing.remove(); addMessage('assistant', 'Error: network request failed.'); })
				.then(function () { setBusy(false); input.focus(); if (pendingBuild) { startInlineProposal(pendingBuild); } else if (pendingContentEdit) { startInlineContentEdit(pendingContentEdit); } });
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
			function renderProposal(p, mount) {
					var filesHtml = (p.files || []).map(function (f) {
						return '<div class="wpab-file"><div class="wpab-file__head"><span class="wpab-file__op">' + escapeHtml(f.operation || 'modify') + '</span><span class="wpab-file__path">' + escapeHtml((f.scope || '') + '/' + (f.path || '')) + '</span></div>' + renderDiff(f.diff) + '</div>';
					}).join('');
					mount.innerHTML = '<div class="wpab-prop"><div class="wpab-prop__head">' + riskPill(p.risk) + '<h3 class="wpab-prop__title">' + escapeHtml(p.title || 'Proposed change') + '</h3></div><p class="wpab-prop__summary">' + escapeHtml(p.summary || '') + '</p>' + filesHtml + '<div class="wpab-prop__actions"><button type="button" class="button button-primary wpab-apply-btn">Deploy</button><button type="button" class="button wpab-close-btn">Dismiss</button></div><div class="wpab-deploy-slot"></div></div>';
					var card = mount.querySelector('.wpab-prop');
					card.querySelector('.wpab-apply-btn').addEventListener('click', function () { deploy(p.id, card); });
					card.querySelector('.wpab-close-btn').addEventListener('click', function () { if (!busy) { mount.innerHTML = ''; } });
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
						el.addEventListener('click', function () { renderProposal(p, currentEl); currentEl.scrollIntoView({ block: 'nearest' }); });
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
				function runProposal(instruction, mount, statusFn) {
					setBusy(true);
					if (statusFn) { statusFn('Inspecting the project and drafting the change… this can take up to a minute.'); }
					var since = nowIso();
					function done() { setBusy(false); loadBuild(); input.focus(); }
					function fail(msg) { if (statusFn) { statusFn(''); } mount.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(msg) + '</div>'; }
					api('POST', cfg.restPropose, { prompt: instruction }).then(function (out) {
						if (out.ok && out.data && out.data.proposal) { if (statusFn) { statusFn(''); } renderProposal(out.data.proposal, mount); done(); return; }
						if (out.data && out.data.success === false && out.data.error && !out.data.started) { fail(out.data.error); done(); return; }
						pollProposal(since, 0, mount, statusFn, done, fail);
					}).catch(function () { pollProposal(since, 0, mount, statusFn, done, fail); });
				}
				function pollProposal(since, attempt, mount, statusFn, done, fail) {
					if (attempt > 40) { fail('Generation is taking longer than expected. Check the History tab in a moment, or try again.'); done(); return; }
					setTimeout(function () {
						api('GET', cfg.restProposals + '?limit=3&since=' + encodeURIComponent(since)).then(function (out) {
							var list = (out.data && out.data.proposals) || [];
							if (list.length) { if (statusFn) { statusFn(''); } renderProposal(list[0], mount); done(); }
							else { pollProposal(since, attempt + 1, mount, statusFn, done, fail); }
						}).catch(function () { pollProposal(since, attempt + 1, mount, statusFn, done, fail); });
					}, 4000);
				}
				function startInlineProposal(instruction) {
					var wrap = document.createElement('div'); wrap.className = 'wpab-msg wpab-msg--assistant';
					wrap.innerHTML = '<div class="wpab-msg__role">Proposal</div><div class="wpab-inline-status wpab-typing">Drafting the change…</div><div class="wpab-prop-mount"></div>';
					thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
					var st = wrap.querySelector('.wpab-inline-status');
					var mount = wrap.querySelector('.wpab-prop-mount');
					runProposal(instruction, mount, function (t) { if (st) { st.textContent = t; st.style.display = t ? '' : 'none'; } thread.scrollTop = thread.scrollHeight; });
				}
								/* ---- Content edit (Phase 3) ---- */
				function ceTrunc(t, nn) { t = String(t == null ? '' : t); return t.length > nn ? t.slice(0, nn) + '…' : t; }
				function renderContentEditCard(proposal, mount) {
					var changesHtml = (proposal.changes || []).map(function (c) {
						return '<div class="wpab-ce-field"><div class="wpab-ce-fname">' + escapeHtml(c.field) + '</div>' +
							(String(c.before) !== '' ? '<div class="wpab-ce-before">' + escapeHtml(ceTrunc(c.before, 1500)) + '</div>' : '') +
							'<div class="wpab-ce-after">' + escapeHtml(ceTrunc(c.after, 1500)) + '</div></div>';
					}).join('');
					mount.innerHTML = '<div class="wpab-prop"><div class="wpab-prop__head"><span class="wpab-pill wpab-pill--low">content</span><h3 class="wpab-prop__title">' + escapeHtml(proposal.summary || 'Content update') + '</h3></div>' +
						'<p class="wpab-prop__summary">' + escapeHtml((proposal.type || '') + ' #' + proposal.id) + '</p>' + changesHtml +
						'<div class="wpab-prop__actions"><button type="button" class="button button-primary wpab-ce-apply">Apply</button><button type="button" class="button wpab-ce-close">Dismiss</button></div><div class="wpab-deploy-slot"></div></div>';
					var card = mount.querySelector('.wpab-prop');
					card.querySelector('.wpab-ce-apply').addEventListener('click', function () { applyContentEdit(proposal, proposal.fields, card, false); });
					card.querySelector('.wpab-ce-close').addEventListener('click', function () { if (!busy) { mount.innerHTML = ''; } });
				}
				function applyContentEdit(proposal, fields, card, isUndo) {
					if (busy) { return; }
					setBusy(true);
					var slot = card.querySelector('.wpab-deploy-slot');
					if (slot) { slot.innerHTML = '<div class="wpab-deploy">' + (isUndo ? 'Undoing…' : 'Applying & saving a revision…') + '</div>'; }
					api('POST', cfg.restContentApply, { type: proposal.type, id: proposal.id, fields: fields }).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) { var err = (out.data && (out.data.error || out.data.message)) || 'Update failed.'; if (slot) { slot.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(err) + '</div>'; } return; }
						var r = out.data.result || {};
						var rev = r.revision_id ? ' · revision ' + escapeHtml(String(r.revision_id)) : '';
						var view = r.url ? ' · <a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">View</a>' : '';
						if (slot) {
							slot.innerHTML = '<div class="wpab-deploy wpab-deploy--ok">' + (isUndo ? 'Reverted ✓' : 'Applied ✓') + rev + view + '</div>';
							if (!isUndo && proposal.before) {
								var undoBtn = document.createElement('button'); undoBtn.type = 'button'; undoBtn.className = 'button'; undoBtn.textContent = 'Undo'; undoBtn.style.marginTop = '8px';
								undoBtn.addEventListener('click', function () { applyContentEdit(proposal, proposal.before, card, true); });
								slot.appendChild(undoBtn);
							}
						}
						var ab = card.querySelector('.wpab-ce-apply'); if (ab) { ab.disabled = true; ab.textContent = isUndo ? 'Reverted' : 'Applied'; }
						reloadPreview();
					}).catch(function () { if (slot) { slot.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>'; } })
					.then(function () { setBusy(false); });
				}
				function startInlineContentEdit(req) {
					var wrap = document.createElement('div'); wrap.className = 'wpab-msg wpab-msg--assistant';
					wrap.innerHTML = '<div class="wpab-msg__role">Content edit</div><div class="wpab-inline-status wpab-typing">Drafting the content change…</div><div class="wpab-prop-mount"></div>';
					thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
					var st = wrap.querySelector('.wpab-inline-status');
					var mount = wrap.querySelector('.wpab-prop-mount');
					setBusy(true);
					api('POST', cfg.restContentPropose, { type: req.type, id: req.id, instruction: req.instruction }).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) { if (st) { st.textContent = ''; } mount.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml((out.data && (out.data.error || out.data.message)) || 'Could not draft the change.') + '</div>'; return; }
						if (!out.data.proposal) { if (st) { st.textContent = ''; } mount.innerHTML = '<div class="wpab-deploy">' + escapeHtml(out.data.message || 'No change was needed.') + '</div>'; return; }
						if (st) { st.textContent = ''; st.style.display = 'none'; }
						renderContentEditCard(out.data.proposal, mount);
					}).catch(function () { if (st) { st.textContent = ''; } mount.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed. If the change was large it may still be processing — try again.</div>'; })
					.then(function () { setBusy(false); input.focus(); thread.scrollTop = thread.scrollHeight; });
				}
				function deploy(proposalId, card) {
					if (busy) { return; }
					setBusy(true);
					var slot = card.querySelector('.wpab-deploy-slot');
					if (slot) { slot.innerHTML = '<div class="wpab-deploy">Applying with snapshot…</div>'; }
					api('POST', cfg.restApply, { proposalId: proposalId }).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) { var err = (out.data && (out.data.error || out.data.message)) || 'Deploy failed.'; if (slot) { slot.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(err) + '</div>'; } return; }
						var d = out.data.deployment || {};
						var snap = d.snapshotId ? ' · snapshot ' + escapeHtml(String(d.snapshotId)) : '';
						if (slot) { slot.innerHTML = '<div class="wpab-deploy wpab-deploy--ok">Deployed ✓ · ' + (d.filesCount || 0) + ' file(s)' + snap + '.</div>'; }
						var b = card.querySelector('.wpab-apply-btn'); if (b) { b.disabled = true; b.textContent = 'Deployed'; }
						reloadPreview();
					}).catch(function () { if (slot) { slot.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>'; } })
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
				/* ---- Content browser (native WP components, read-only) ---- */
				var ctypesEl = $('wpab-content-types');
				var cbodyEl = $('wpab-content-body');
				function cStatusClass(s) { return 'wpab-cstatus wpab-cstatus--' + escapeHtml(String(s || '')); }
				function loadContentTypes() {
					ctypesEl.innerHTML = '';
					cbodyEl.innerHTML = '<p class="wpab-empty">Loading content…</p>';
					api('GET', cfg.restContentTypes).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) { cbodyEl.innerHTML = '<p class="wpab-empty">Could not load content.</p>'; return; }
						var types = (out.data.types || []).filter(function (t) { return t.count > 0 || t.key === 'page' || t.key === 'post'; });
						if (!types.length) { cbodyEl.innerHTML = '<p class="wpab-empty">No content found.</p>'; return; }
						ctypesEl.innerHTML = '';
						types.forEach(function (t) {
							var b = document.createElement('button'); b.type = 'button'; b.className = 'wpab-ctype'; b.setAttribute('data-type', t.key);
							b.innerHTML = escapeHtml(t.label) + '<span class="wpab-ctype__count">' + (t.count || 0) + '</span>';
							b.addEventListener('click', function () { selectContentType(t.key); });
							ctypesEl.appendChild(b);
						});
						selectContentType(types[0].key);
					}).catch(function () { cbodyEl.innerHTML = '<p class="wpab-empty">Could not reach WordPress.</p>'; });
				}
				function selectContentType(type) {
					contentActiveType = type;
					var btns = ctypesEl.querySelectorAll('.wpab-ctype');
					for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle('is-active', btns[i].getAttribute('data-type') === type); }
					cbodyEl.innerHTML = '<p class="wpab-empty">Loading…</p>';
					api('GET', cfg.restContentList + '?type=' + encodeURIComponent(type) + '&limit=40').then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) { cbodyEl.innerHTML = '<p class="wpab-empty">Could not load items.</p>'; return; }
						renderContentList(type, out.data.items || []);
					}).catch(function () { cbodyEl.innerHTML = '<p class="wpab-empty">Could not reach WordPress.</p>'; });
				}
				function renderContentList(type, items) {
					if (!items.length) { cbodyEl.innerHTML = '<p class="wpab-empty">Nothing here yet.</p>'; return; }
					cbodyEl.innerHTML = '';
					items.forEach(function (it) {
						var el = document.createElement('div'); el.className = 'wpab-crow';
						var right = '';
						if (type === 'menu') { right = '<span class="wpab-cstatus">' + (it.count || 0) + ' items</span>'; }
						else if (type === 'media') { right = '<span class="wpab-cstatus">' + escapeHtml((it.mime || '').split('/').pop()) + '</span>'; }
						else { right = '<span class="' + cStatusClass(it.status) + '">' + escapeHtml(it.status || '') + '</span>'; }
						var meta = '';
						if (type === 'media') { meta = escapeHtml(it.url || ''); }
						else if (type === 'menu') { meta = 'Navigation menu'; }
						else { meta = '#' + it.id + (it.sku ? ' · SKU ' + escapeHtml(it.sku) : '') + (it.price ? ' · ' + escapeHtml(it.price) : ''); }
						el.innerHTML = '<div class="wpab-crow__top"><span class="wpab-crow__title">' + escapeHtml(it.title || '(no title)') + '</span>' + right + '</div><div class="wpab-crow__meta">' + meta + '</div>';
						el.addEventListener('click', function () { openContentItem(type, it.id); });
						cbodyEl.appendChild(el);
					});
				}
				function openContentItem(type, id) {
					cbodyEl.innerHTML = '<p class="wpab-empty">Loading…</p>';
					api('GET', cfg.restContentGet + '?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id)).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false || !out.data.item) { cbodyEl.innerHTML = '<p class="wpab-empty">Could not open item.</p>'; return; }
						renderContentDetail(type, out.data.item);
					}).catch(function () { cbodyEl.innerHTML = '<p class="wpab-empty">Could not reach WordPress.</p>'; });
				}
				function renderContentDetail(type, item) {
					var rows = '';
					function row(label, val) { if (val === '' || val == null) { return ''; } return '<div class="wpab-cdetail__row">' + escapeHtml(label) + ': <code>' + escapeHtml(String(val)) + '</code></div>'; }
					var body = '';
					if (type === 'menu') {
						rows += row('Items', (item.items || []).length);
						body = (item.items || []).map(function (mi) { return '• ' + (mi.title || '') + '  →  ' + (mi.url || ''); }).join('\n');
					} else if (type === 'media') {
						rows += row('Type', item.mime) + row('Dimensions', (item.width && item.height) ? item.width + '×' + item.height : '') + row('Alt', item.alt) + row('URL', item.url);
						if ((item.mime || '').indexOf('image/') === 0) { body = ''; }
					} else {
						rows += row('Status', item.status) + row('Type', item.type) + row('Slug', item.slug) + row('Template', item.template) + row('URL', item.url) + row('Modified', item.modified);
						if (item.product) { rows += row('SKU', item.product.sku) + row('Price', item.product.price) + row('Stock', item.product.stock_status); }
						body = item.content || '';
						if (item.truncated) { body += '\n\n… (truncated, ' + item.content_chars + ' chars total)'; }
					}
					var thumb = (type === 'media' && (item.mime || '').indexOf('image/') === 0 && item.url) ? '<img class="wpab-cthumb" src="' + escapeHtml(item.url) + '" alt="" />' : '';
					var contentBlock = body ? '<div class="wpab-cdetail__content">' + escapeHtml(body) + '</div>' : '';
					cbodyEl.innerHTML =
						'<button type="button" class="wpab-cback" id="wpab-cback">‹ Back to list</button>' +
						'<div class="wpab-cdetail"><h3 class="wpab-cdetail__title">' + escapeHtml(item.title || '(no title)') + '</h3>' + rows + thumb + contentBlock +
						'<div class="wpab-cdetail__actions">' +
						(item.url ? '<a class="button" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">View</a>' : '') +
						(item.edit_url ? '<a class="button" href="' + escapeHtml(item.edit_url) + '" target="_blank" rel="noopener">Edit in WP</a>' : '') +
						((type !== 'menu' && type !== 'media') ? '<button type="button" class="button button-primary" id="wpab-cedit">Edit with AI</button>' : '') +
						'<button type="button" class="button" id="wpab-cask">Ask AI about this</button>' +
						'</div></div>';
					var back = $('wpab-cback'); if (back) { back.addEventListener('click', function () { selectContentType(contentActiveType); }); }
					var edit = $('wpab-cedit'); if (edit) { edit.addEventListener('click', function () {
						var q = 'Edit the ' + type + ' "' + (item.title || '') + '" (id ' + item.id + '): ';
						for (var i = 0; i < tabs.length; i++) { tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-tab') === 'chat'); }
						$('wpab-pane-chat').hidden = false; $('wpab-pane-build').hidden = true; $('wpab-pane-content').hidden = true; $('wpab-pane-visual').hidden = true;
						input.value = q; input.focus();
					}); }
					var ask = $('wpab-cask'); if (ask) { ask.addEventListener('click', function () {
						var label = (type === 'menu' ? 'menu' : (type === 'media' ? 'media item' : type));
						var q = 'Tell me about the ' + label + ' "' + (item.title || '') + '"' + (item.id ? ' (id ' + item.id + ')' : '') + ' and suggest improvements.';
						for (var i = 0; i < tabs.length; i++) { tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-tab') === 'chat'); }
						$('wpab-pane-chat').hidden = false; $('wpab-pane-build').hidden = true; $('wpab-pane-content').hidden = true; $('wpab-pane-visual').hidden = true;
						input.value = q; input.focus();
					}); }
				}
				(function () { var rb = $('wpab-content-refresh'); if (rb) { rb.addEventListener('click', function () { loadContentTypes(); }); } })();
				(function () { var rb = $('wpab-build-refresh'); if (rb) { rb.addEventListener('click', function () { loadBuild(); }); } })();

			/* ---- Inspect (visual CSS) ---- */
			var vFrame = $('wpab-visual-frame');
			var vSelectorEl = $('wpab-visual-selector');
			var vPanel = $('wpab-visual-panel');
			var vHint = $('wpab-visual-hint');
			var vStatusEl = $('wpab-visual-status');
			var vRules = {};
			var vCurrentSel = null;
				var vBaseCss = '';

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
				var r = vRules[vCurrentSel] || {};
					$('wpab-v-fw').value = r['font-weight'] || '';
					$('wpab-v-ta').value = r['text-align'] || '';
					$('wpab-v-pad').value = r['padding'] ? parseInt(r['padding'], 10) : '';
					$('wpab-v-radius').value = r['border-radius'] ? parseInt(r['border-radius'], 10) : '';
					$('wpab-v-css').value = r.__raw || '';
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
				api('POST', cfg.restVisualCss, { css: (vBaseCss ? vBaseCss.trim() + '\n' : '') + css }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { var err = (out.data && (out.data.error || out.data.message)) || 'Apply failed.'; if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml(err) + '</div>'; } return; }
					var d = out.data.deployment || {};
					var snap = d.snapshotId ? ' · snapshot ' + escapeHtml(String(d.snapshotId)) : '';
					vBaseCss = (out.data && typeof out.data.css === 'string') ? out.data.css : vBaseCss;
						if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--ok">Applied ✓ · reloading preview…</div>'; }
					vRules = {}; vCurrentSel = null; vPanel.hidden = true; if (vHint) { vHint.hidden = false; }
					setTimeout(reloadPreview, 800);
					buildLoaded = false;
				}).catch(function () { if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed.</div>'; } })
				.then(function () { setBusy(false); });
			}
			function clearVisual() {
					if (busy) { return; }
					if (!window.confirm('Clear all applied visual CSS on this site?')) { return; }
					setBusy(true);
					api('POST', cfg.restVisualCss, { css: '' }).then(function () {
						vBaseCss = ''; vRules = {}; vCurrentSel = null; vApplyPreview(); vPanel.hidden = true; if (vHint) { vHint.hidden = false; }
						var re = $('wpab-v-result'); if (re) { re.innerHTML = '<div class="wpab-deploy">Cleared. Reloading…</div>'; }
						setTimeout(reloadPreview, 400);
					}).catch(function () {}).then(function () { setBusy(false); });
				}
				function initVisual() {
				$('wpab-v-color').addEventListener('input', function () { vSetProp('color', this.value); });
				$('wpab-v-bg').addEventListener('input', function () { vSetProp('background-color', this.value); });
				$('wpab-v-fs').addEventListener('input', function () { vSetProp('font-size', this.value ? this.value + 'px' : ''); });
				$('wpab-v-css').addEventListener('input', function () { if (!vCurrentSel) { return; } vRules[vCurrentSel] = vRules[vCurrentSel] || {}; vRules[vCurrentSel].__raw = this.value; vApplyPreview(); });
				vSelectorEl.addEventListener('change', function () { var v = this.value.trim(); if (v) { vCurrentSel = v; } });
				$('wpab-v-reset').addEventListener('click', function () { vRules = {}; vCurrentSel = null; vApplyPreview(); vPanel.hidden = true; if (vHint) { vHint.hidden = false; } var doc = vDoc(); if (doc) { var s = doc.querySelector('.wpab-sel'); if (s) { s.classList.remove('wpab-sel'); } } });
				$('wpab-v-apply').addEventListener('click', applyVisual);
					$('wpab-v-fw').addEventListener('change', function () { vSetProp('font-weight', this.value); });
					$('wpab-v-ta').addEventListener('change', function () { vSetProp('text-align', this.value); });
					$('wpab-v-pad').addEventListener('input', function () { vSetProp('padding', this.value !== '' ? this.value + 'px' : ''); });
					$('wpab-v-radius').addEventListener('input', function () { vSetProp('border-radius', this.value !== '' ? this.value + 'px' : ''); });
					var clearLink = $('wpab-v-clear'); if (clearLink) { clearLink.addEventListener('click', function (e) { e.preventDefault(); clearVisual(); }); }
					api('GET', cfg.restVisualCss).then(function (out) { if (out.data && typeof out.data.css === 'string') { vBaseCss = out.data.css; } });
				vFrame.addEventListener('load', vBind);
				vStatusEl.textContent = 'Loading preview…';
				vFrame.src = cfg.siteUrl;
			}

			/* ---- Init ---- */
			resetThread();
			initVisual();
			function genRunId() { return 'r' + Date.now() + '_' + Math.floor(Math.random() * 1e6); }
				(function () { var box = $('wpab-suggests'); if (!box) { return; } ['Give me a quick overview of this theme', 'What pages and products do I have?', 'Suggest 3 quick visual improvements', 'Where can I change the primary color?'].forEach(function (s) { var c = document.createElement('button'); c.type = 'button'; c.className = 'wpab-chip'; c.textContent = s; c.addEventListener('click', function () { input.value = s; input.focus(); }); box.appendChild(c); }); })();
				(function () { var collapseBtn = $('wpab-collapse'); var studioPanel = document.querySelector('.wpab-studio__panel'); if (collapseBtn && studioPanel) { collapseBtn.addEventListener('click', function () { var c = studioPanel.classList.toggle('is-collapsed'); collapseBtn.textContent = c ? '▴ Expand' : '▾ Collapse'; }); } })();
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
