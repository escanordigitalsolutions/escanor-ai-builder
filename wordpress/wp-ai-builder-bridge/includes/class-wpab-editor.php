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
 *             deterministically (no AI) as a site-local override, instantly
 *             reversible via "Clear all applied CSS".
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Editor {

	private const PAGE_SLUG = 'wp-ai-builder-editor';
	private const NAMESPACE = WPAB_REST_NAMESPACE;

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

		// Analysis: /analyze is computed locally (instant, no AI); /recommend is
		// proxied to the SaaS model which reads the same audit.
		register_rest_route(
			self::NAMESPACE,
			'/editor/analyze',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_analyze' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/recommend',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_recommend' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/editor/understand',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_understand' ),
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

	public static function rest_analyze( WP_REST_Request $request ) {
		return new WP_REST_Response( WPAB_Analysis::audit(), 200 );
	}

	public static function rest_recommend( WP_REST_Request $request ) {
		$result = WPAB_Cloud::request( 'agent/recommend', array(), 55 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_understand( WP_REST_Request $request ) {
		$result = WPAB_Cloud::request( 'agent/understand', array(), 55 );

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
			'restVisualCss' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/visual-css' ) ),
			'restSteps'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/steps' ) ),
			'restContentTypes' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/types' ) ),
			'restContentList'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/list' ) ),
			'restContentGet'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/get' ) ),
			'restContentPropose' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/propose' ) ),
			'restContentApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/apply' ) ),
			'restAnalyze'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/analyze' ) ),
			'restRecommend' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/recommend' ) ),
			'restUnderstand' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/understand' ) ),
			'nonce'         => wp_create_nonce( 'wp_rest' ),
			'cloudPage'     => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'snapPage'      => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-snapshots' ) ),
			'exitUrl'       => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'siteUrl'       => esc_url_raw( home_url( '/' ) ),
			'connected'     => WPAB_Cloud::has_key(),
		);
		?>
		<div class="wpab-studio" id="wpab-studio">
			<div class="wpab-studio__preview">
				<div id="wpab-visual-status" class="wpab-studio__previewbar">Loading preview…</div>
				<div class="wpab-studio__stage" id="wpab-stage">
					<iframe id="wpab-visual-frame" class="wpab-studio__frame" title="Site preview"></iframe>
				</div>
			</div>

			<div id="wpab-overlay" class="wpab-overlay" hidden>
				<div class="wpab-overlay__box">
					<div class="wpab-spinner"></div>
					<div id="wpab-overlay-label" class="wpab-overlay__label">Working…</div>
				</div>
			</div>

			<div id="wpab-dock" class="wpab-dock">
				<div id="wpab-progress" class="wpab-dock__progress" hidden></div>

				<div id="wpab-sheet" class="wpab-sheet" hidden>
					<div class="wpab-sheet__head">
						<span id="wpab-sheet-title" class="wpab-sheet__title">Chat</span>
						<button type="button" id="wpab-sheet-close" class="wpab-iconbtn" title="Collapse">▾</button>
					</div>
					<div class="wpab-sheet__body">
						<div id="wpab-pane-chat" class="wpab-pane">
							<div id="wpab-suggests" class="wpab-suggests"></div>
							<div id="wpab-editor-thread" class="wpab-editor__thread" aria-live="polite"></div>
							<div class="wpab-pane__foot">
								<p id="wpab-editor-meta" class="wpab-editor__meta"></p>
								<button type="button" id="wpab-editor-new" class="wpab-textbtn">New chat</button>
							</div>
						</div>

						<div id="wpab-pane-build" class="wpab-pane" hidden>
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">Past proposals &amp; deployments. New changes start in Chat.</span>
								<button type="button" id="wpab-build-refresh" class="wpab-textbtn">Refresh</button>
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
								<button type="button" id="wpab-content-refresh" class="wpab-textbtn">Refresh</button>
							</div>
							<div id="wpab-content-types" class="wpab-ctypes"></div>
							<div id="wpab-content-body" class="wpab-content__body">
								<p class="wpab-empty">Loading content…</p>
							</div>
						</div>

						<div id="wpab-pane-seo" class="wpab-pane" hidden>
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">SEO signals across your published pages.</span>
								<button type="button" id="wpab-seo-refresh" class="wpab-textbtn">Refresh</button>
							</div>
							<div id="wpab-seo-body"><p class="wpab-empty">Loading…</p></div>
						</div>

						<div id="wpab-pane-insights" class="wpab-pane" hidden>
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">What is on your site right now.</span>
								<button type="button" id="wpab-insights-refresh" class="wpab-textbtn">Refresh</button>
							</div>
							<div class="wpab-understand">
								<div class="wpab-understand__head">
									<span class="wpab-understand__title">AI read of this site</span>
									<button type="button" id="wpab-understand-run" class="wpab-btn">Scan site</button>
								</div>
								<div id="wpab-understand-body" class="wpab-understand__body"><p class="wpab-empty">Click &ldquo;Scan site&rdquo; for an AI biography &mdash; what this site is, who it is for, the problem it solves, its objective, standpoint and economic outlook.</p></div>
							</div>
							<div id="wpab-insights-body"><p class="wpab-empty">Loading…</p></div>
						</div>

						<div id="wpab-pane-recs" class="wpab-pane" hidden>
							<div class="wpab-pane__bar">
								<span class="wpab-pane__hint">AI recommendations from your site data.</span>
								<button type="button" id="wpab-recs-run" class="wpab-textbtn">Generate</button>
							</div>
							<div id="wpab-recs-body"><p class="wpab-empty">Click Generate to analyze your site and get prioritized recommendations.</p></div>
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

				<div id="wpab-confirm" class="wpab-confirm" hidden></div>

				<div class="wpab-bar">
					<div class="wpab-dd" id="wpab-tool-dd">
						<button type="button" class="wpab-dd__btn" id="wpab-tool-btn"><span id="wpab-tool-label">Chat</span><span class="wpab-dd__caret">▾</span></button>
						<div class="wpab-dd__menu" id="wpab-tool-menu" hidden>
							<button type="button" class="wpab-dd__item" data-tool="chat">Chat</button>
							<button type="button" class="wpab-dd__item" data-tool="content">Content</button>
							<button type="button" class="wpab-dd__item" data-tool="visual">Inspect</button>
							<button type="button" class="wpab-dd__item" data-tool="build">History</button>
						</div>
					</div>
					<div class="wpab-anlz__group">
						<button type="button" class="wpab-anlz" data-view="seo" title="SEO audit"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.6" y2="16.6"></line></svg><span class="wpab-anlz__label">SEO</span></button>
						<button type="button" class="wpab-anlz" data-view="insights" title="Insights"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="21" x2="5" y2="11"></line><line x1="12" y1="21" x2="12" y2="4"></line><line x1="19" y1="21" x2="19" y2="14"></line></svg><span class="wpab-anlz__label">Insights</span></button>
						<button type="button" class="wpab-anlz" data-view="recs" title="AI recommendations"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 21h4"></path><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.2 1 2.5h6c0-1.3.3-1.8 1-2.5A6 6 0 0 0 12 3z"></path></svg><span class="wpab-anlz__label">Recs</span></button>
					</div>
					<button type="button" id="wpab-context" class="wpab-bar__context" hidden></button>
					<form id="wpab-editor-form" class="wpab-bar__form" autocomplete="off">
						<textarea id="wpab-editor-input" class="wpab-bar__input" rows="1" placeholder="Ask anything, or describe a change…"></textarea>
						<button type="submit" id="wpab-editor-send" class="wpab-bar__send">Send</button>
					</form>
					<div class="wpab-viewport" id="wpab-viewport">
						<button type="button" class="wpab-vp is-active" data-vp="desktop">Desktop</button>
						<button type="button" class="wpab-vp" data-vp="tablet">Tablet</button>
						<button type="button" class="wpab-vp" data-vp="mobile">Mobile</button>
					</div>
					<span id="wpab-editor-status" class="wpab-studio__dockstatus"></span>
					<a class="wpab-bar__exit" href="<?php echo esc_url( $config['exitUrl'] ); ?>">Exit ✕</a>
				</div>
			</div>
		</div>

		<style>
#wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
			.wpab-studio { position: fixed; inset: 0; z-index: 100000; background: #eceef1; font-size: 14px; color: #1d2327; }
			.wpab-studio__preview { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 10px 10px 92px; box-sizing: border-box; }
			.wpab-studio__previewbar { font-size: 12px; color: #6a7178; margin: 0 0 8px; flex: 0 0 auto; }
			.wpab-studio__previewbar.is-error { color: #d63638; }
			.wpab-studio__stage { flex: 1; width: 100%; max-width: 100%; margin: 0 auto; min-height: 0; transition: max-width .28s ease; }
			.wpab-studio__frame { width: 100%; height: 100%; border: 1px solid #d3d7dc; border-radius: 12px; background: #fff; transition: opacity .22s ease; box-shadow: 0 6px 24px rgba(0,0,0,.06); }

			.wpab-overlay { position: absolute; inset: 0; z-index: 100050; display: flex; align-items: center; justify-content: center; background: rgba(20,22,25,.30); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
			.wpab-overlay[hidden] { display: none; }
			.wpab-overlay__box { display: flex; flex-direction: column; align-items: center; gap: 12px; color: #fff; }
			.wpab-overlay__label { font-size: 13px; }
			.wpab-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(255,255,255,.25); border-top-color: #fff; animation: wpab-spin .8s linear infinite; }
			@keyframes wpab-spin { to { transform: rotate(360deg); } }

			.wpab-dock { position: absolute; left: 50%; transform: translateX(-50%); bottom: 14px; width: calc(100% - 28px); max-width: 1080px; z-index: 100100; background: #1f2226; border: 1px solid #34393f; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.35); color: #e7e9ec; display: flex; flex-direction: column; overflow: hidden; }
			.wpab-dock__progress { height: 2px; background: linear-gradient(90deg, transparent, #6ea8fe, transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: wpab-prog 1.1s ease-in-out infinite; }
			.wpab-dock__progress[hidden] { display: none; }
			@keyframes wpab-prog { 0% { background-position: -40% 0; } 100% { background-position: 140% 0; } }

			.wpab-sheet { display: flex; flex-direction: column; max-height: 66vh; border-bottom: 1px solid #2b2f34; overflow: hidden; }
			.wpab-sheet[hidden] { display: none; }
			.wpab-sheet__head { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; border-bottom: 1px solid #2b2f34; }
			.wpab-sheet__title { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #9aa0a6; }
			.wpab-sheet__body { padding: 12px 14px; overflow-y: auto; min-height: 0; }

			.wpab-bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
			.wpab-bar__context { max-width: 26%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #2a2e33; border: 1px solid #3a3f45; color: #c9ced4; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
			.wpab-bar__context[hidden] { display: none; }
			.wpab-bar__form { flex: 1; display: flex; gap: 8px; align-items: center; min-width: 0; }
			.wpab-bar__input { flex: 1; resize: none; background: #2a2e33; border: 1px solid #3a3f45; color: #f0f2f4; border-radius: 10px; padding: 9px 12px; font-size: 14px; line-height: 1.4; max-height: 120px; min-width: 0; }
			.wpab-bar__input::placeholder { color: #7c828a; }
			.wpab-bar__input:focus { outline: none; border-color: #5b6069; background: #30353b; }
			.wpab-bar__send { background: #fff; color: #1d2327; border: 0; border-radius: 10px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
			.wpab-bar__send:hover { background: #e9ebee; }
			.wpab-bar__send:disabled { opacity: .5; cursor: default; }
			.wpab-bar__exit { color: #c9ced4; text-decoration: none; border: 1px solid #3a3f45; border-radius: 8px; padding: 6px 12px; font-size: 12px; background: #2a2e33; white-space: nowrap; }
			.wpab-bar__exit:hover { background: #3a2b2d; border-color: #6b3b3d; color: #ffb3b3; }

			.wpab-dd { position: relative; }
			.wpab-dd__btn { display: inline-flex; align-items: center; gap: 6px; background: #2a2e33; border: 1px solid #3a3f45; color: #e7e9ec; border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
			.wpab-dd__btn:hover { background: #31363c; }
			.wpab-dd__caret { color: #9aa0a6; font-size: 10px; }
			.wpab-dd__menu { position: absolute; bottom: calc(100% + 8px); left: 0; background: #24282d; border: 1px solid #3a3f45; border-radius: 10px; padding: 6px; min-width: 160px; box-shadow: 0 10px 30px rgba(0,0,0,.4); z-index: 5; }
			.wpab-dd__menu[hidden] { display: none; }
			.wpab-dd__item { display: block; width: 100%; text-align: left; background: none; border: 0; color: #d5d9de; padding: 8px 10px; font-size: 13px; border-radius: 7px; cursor: pointer; }
			.wpab-dd__item:hover { background: #31363c; color: #fff; }

			.wpab-viewport { display: inline-flex; background: #2a2e33; border: 1px solid #3a3f45; border-radius: 8px; padding: 2px; }
			.wpab-vp { background: none; border: 0; color: #9aa0a6; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
			.wpab-vp.is-active { background: #3a3f45; color: #fff; }

			.wpab-studio__dockstatus { font-size: 12px; color: #9aa0a6; max-width: 22%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.wpab-studio__dockstatus:empty { display: none; }
			.wpab-studio__dockstatus.is-ok { display: none; }
			.wpab-studio__dockstatus.is-error { color: #ff8f8f; }

			.wpab-confirm { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #2b2f34; background: #24282d; font-size: 13px; color: #d5d9de; }
			.wpab-confirm[hidden] { display: none; }
			.wpab-confirm.is-error { color: #ffb3b3; }
			.wpab-confirm span { flex: 1; }

			.wpab-btn, .wpab-textbtn { background: #2a2e33; border: 1px solid #3a3f45; color: #d5d9de; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
			.wpab-btn:hover, .wpab-textbtn:hover { background: #31363c; color: #fff; }
			.wpab-btn--danger { background: #3a2b2d; border-color: #6b3b3d; color: #ffb3b3; }
			.wpab-textbtn { padding: 4px 10px; }
			.wpab-iconbtn { background: none; border: 0; color: #9aa0a6; font-size: 14px; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
			.wpab-iconbtn:hover { background: #31363c; color: #fff; }

			.wpab-dock .button { background: #2a2e33 !important; border: 1px solid #3a3f45 !important; color: #d5d9de !important; border-radius: 8px !important; box-shadow: none !important; text-shadow: none !important; height: auto !important; line-height: 1.6 !important; padding: 5px 12px !important; font-size: 12px !important; }
			.wpab-dock .button:hover { background: #31363c !important; color: #fff !important; border-color: #4a4f56 !important; }
			.wpab-dock .button-primary { background: #fff !important; border-color: #fff !important; color: #1d2327 !important; font-weight: 600 !important; }
			.wpab-dock .button-primary:hover { background: #e9ebee !important; color: #1d2327 !important; }
			.wpab-dock .button:disabled { opacity: .5 !important; }

			.wpab-pane__bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
			.wpab-pane__hint { font-size: 12px; color: #8b9198; }
			.wpab-pane__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; gap: 8px; }
			.wpab-suggests { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
			.wpab-chip { background: #2a2e33; border: 1px solid #3a3f45; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #c9ced4; cursor: pointer; }
			.wpab-chip:hover { background: #31363c; color: #fff; }
			.wpab-steps { margin-top: 4px; }
			.wpab-step { font-size: 12px; color: #9aa0a6; padding: 2px 0; }
			.wpab-step::before { content: "→ "; color: #6a7178; }
			.wpab-editor__thread { border: 1px solid #2f343a; border-radius: 10px; background: #24282d; min-height: 100px; max-height: 44vh; overflow-y: auto; padding: 12px; }
			.wpab-editor__empty, .wpab-empty { color: #8b9198; font-size: 13px; }
			.wpab-msg { margin: 0 0 14px; display: flex; flex-direction: column; }
			.wpab-msg__role { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8b9198; margin-bottom: 3px; }
			.wpab-msg__body { font-size: 14px; line-height: 1.55; color: #e7e9ec; }
			.wpab-msg__body p { margin: 0 0 8px; } .wpab-msg__body p:last-child { margin-bottom: 0; }
			.wpab-msg__body ul { margin: 4px 0 8px; padding-left: 20px; } .wpab-msg__body li { margin: 2px 0; }
			.wpab-msg__body h4 { margin: 10px 0 4px; font-size: 13px; }
			.wpab-msg__body code { background: #31363c; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
			.wpab-msg__body pre { background: #1b1e22; border: 1px solid #33383e; border-radius: 6px; padding: 10px; overflow-x: auto; margin: 6px 0 10px; }
			.wpab-msg__body pre code { background: none; padding: 0; }
			.wpab-msg__body a { color: #8bb6ff; }
			.wpab-msg--user .wpab-msg__body { font-weight: 500; white-space: pre-wrap; color: #fff; }
			.wpab-msg__activity { margin-top: 6px; font-size: 12px; color: #8b9198; }
			.wpab-msg__activity code { background: #31363c; padding: 1px 5px; border-radius: 4px; }
			.wpab-editor__meta { color: #8b9198; font-size: 12px; min-height: 16px; }
			.wpab-typing { color: #9aa0a6; font-size: 13px; }
			.wpab-prop { border: 1px solid #33383e; border-radius: 10px; background: #24282d; padding: 12px; margin-top: 10px; }
			.wpab-prop__head { display: flex; align-items: center; gap: 10px; }
			.wpab-prop__title { font-size: 14px; font-weight: 600; margin: 0; color: #e7e9ec; }
			.wpab-prop__summary { color: #b7bcc2; font-size: 13px; margin: 6px 0 10px; }
			.wpab-pill { font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid; }
			.wpab-pill--low { background: rgba(46,160,67,.15); color: #7ee2a8; border-color: rgba(46,160,67,.4); }
			.wpab-pill--medium { background: rgba(210,153,34,.15); color: #f0c674; border-color: rgba(210,153,34,.4); }
			.wpab-pill--high { background: rgba(207,66,66,.15); color: #ff9b9b; border-color: rgba(207,66,66,.4); }
			.wpab-file { border: 1px solid #33383e; border-radius: 6px; margin-top: 10px; overflow: hidden; }
			.wpab-file__head { background: #1b1e22; padding: 7px 10px; font-size: 12px; color: #9aa0a6; display: flex; gap: 8px; align-items: center; }
			.wpab-file__op { text-transform: uppercase; font-size: 10px; letter-spacing: .05em; padding: 1px 6px; border-radius: 4px; background: #33383e; color: #c9ced4; }
			.wpab-file__path { font-family: Menlo, Consolas, monospace; color: #e7e9ec; word-break: break-all; }
			.wpab-diff { margin: 0; padding: 8px 0; overflow-x: auto; font-family: Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; background: #1b1e22; max-height: 260px; }
			.wpab-diff__line { padding: 0 10px; white-space: pre-wrap; word-break: break-word; }
			.wpab-diff__line--add { background: rgba(46,160,67,.16); color: #86e0a6; }
			.wpab-diff__line--del { background: rgba(207,66,66,.16); color: #ff9b9b; }
			.wpab-diff__line--ctx { color: #9aa0a6; }
			.wpab-prop__actions, .wpab-v-actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
			.wpab-deploy { margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
			.wpab-deploy--ok { background: rgba(46,160,67,.15); border: 1px solid rgba(46,160,67,.4); color: #86e0a6; }
			.wpab-deploy--err { background: rgba(207,66,66,.15); border: 1px solid rgba(207,66,66,.4); color: #ff9b9b; }
			.wpab-deploy a { color: #8bb6ff; }
			.wpab-col__title { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #8b9198; margin: 16px 0 8px; }
			.wpab-list { display: flex; flex-direction: column; gap: 8px; }
			.wpab-item { border: 1px solid #33383e; border-radius: 8px; background: #24282d; padding: 10px 12px; font-size: 13px; }
			.wpab-item__row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
			.wpab-item__title { color: #e7e9ec; font-weight: 500; }
			.wpab-item__meta { color: #8b9198; font-size: 12px; margin-top: 2px; }
			.wpab-status { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid; }
			.wpab-status--applied { background: rgba(46,160,67,.15); color: #86e0a6; border-color: rgba(46,160,67,.4); }
			.wpab-status--failed { background: rgba(207,66,66,.15); color: #ff9b9b; border-color: rgba(207,66,66,.4); }
			.wpab-status--rolled_back { background: #2a2e33; color: #9aa0a6; border-color: #3a3f45; }
			.wpab-status--applying { background: rgba(210,153,34,.15); color: #f0c674; border-color: rgba(210,153,34,.4); }
			.wpab-v-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8b9198; margin: 10px 0 4px; }
			.wpab-v-label:first-child { margin-top: 0; }
			.wpab-v-input { width: 100%; box-sizing: border-box; font-size: 13px; background: #2a2e33; border: 1px solid #3a3f45; color: #e7e9ec; border-radius: 8px; padding: 7px 9px; }
			.wpab-v-color { width: 100%; height: 32px; padding: 0; border: 1px solid #3a3f45; border-radius: 6px; background: #2a2e33; }
			.wpab-v-note { font-size: 11px; color: #8b9198; margin-top: 10px; }
			.wpab-v-note a { color: #8bb6ff; }
			.wpab-prop-mount:empty { display: none; }
			.wpab-prop-mount { margin-top: 8px; }
			.wpab-inline-status { margin-top: 4px; }
			.wpab-ce-field { border: 1px solid #33383e; border-radius: 6px; margin-top: 10px; overflow: hidden; }
			.wpab-ce-fname { background: #1b1e22; padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #9aa0a6; }
			.wpab-ce-before, .wpab-ce-after { padding: 8px 10px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-family: Menlo, Consolas, monospace; }
			.wpab-ce-before { background: rgba(207,66,66,.14); color: #ff9b9b; }
			.wpab-ce-after { background: rgba(46,160,67,.14); color: #86e0a6; }
			.wpab-ctypes { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
			.wpab-ctype { background: #2a2e33; border: 1px solid #3a3f45; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #c9ced4; cursor: pointer; }
			.wpab-ctype:hover { background: #31363c; color: #fff; }
			.wpab-ctype.is-active { background: #fff; border-color: #fff; color: #1d2327; }
			.wpab-ctype__count { opacity: .55; margin-left: 5px; }
			.wpab-content__body { min-height: 60px; }
			.wpab-crow { border: 1px solid #33383e; border-radius: 8px; background: #24282d; padding: 9px 12px; margin-bottom: 7px; cursor: pointer; }
			.wpab-crow:hover { border-color: #5b6069; }
			.wpab-crow__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
			.wpab-crow__title { color: #e7e9ec; font-weight: 500; word-break: break-word; }
			.wpab-crow__meta { color: #8b9198; font-size: 12px; margin-top: 2px; }
			.wpab-cstatus { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 1px 7px; border-radius: 999px; border: 1px solid #3a3f45; color: #9aa0a6; white-space: nowrap; }
			.wpab-cstatus--publish { background: rgba(46,160,67,.15); color: #86e0a6; border-color: rgba(46,160,67,.4); }
			.wpab-cstatus--draft { background: #2a2e33; color: #9aa0a6; }
			.wpab-cstatus--pending, .wpab-cstatus--future { background: rgba(210,153,34,.15); color: #f0c674; border-color: rgba(210,153,34,.4); }
			.wpab-cstatus--private { background: rgba(124,92,240,.15); color: #b7a6ff; border-color: rgba(124,92,240,.4); }
			.wpab-cdetail { border: 1px solid #33383e; border-radius: 8px; background: #24282d; padding: 12px; margin-bottom: 10px; }
			.wpab-cdetail__title { font-size: 14px; font-weight: 600; margin: 0 0 4px; color: #e7e9ec; }
			.wpab-cdetail__row { font-size: 12px; color: #9aa0a6; margin: 2px 0; }
			.wpab-cdetail__row code { background: #31363c; padding: 1px 5px; border-radius: 4px; color: #d5d9de; }
			.wpab-cdetail__content { margin-top: 8px; background: #1b1e22; border: 1px solid #33383e; border-radius: 6px; padding: 10px; font-family: Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 30vh; overflow-y: auto; color: #c9ced4; }
			.wpab-cdetail__actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
			.wpab-cback { background: none; border: none; color: #8bb6ff; cursor: pointer; font-size: 12px; padding: 0 0 8px; }
			.wpab-cthumb { max-width: 100%; border-radius: 6px; margin-top: 8px; border: 1px solid #33383e; }
			@media (max-width: 720px) { .wpab-viewport { display: none; } .wpab-studio__dockstatus { display: none; } .wpab-bar__context { max-width: 20%; } }
			.wpab-anlz__group { display: inline-flex; gap: 6px; }
			.wpab-anlz { display: inline-flex; align-items: center; gap: 5px; background: #2a2e33; border: 1px solid #3a3f45; color: #c9ced4; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
			.wpab-anlz:hover { background: #31363c; color: #fff; }
			.wpab-anlz svg { display: block; }
			.wpab-checks { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
			.wpab-check { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 8px; border-radius: 8px; background: #24282d; border: 1px solid #33383e; }
			.wpab-check__i { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: 0 0 auto; }
			.wpab-check.is-ok .wpab-check__i { background: rgba(46,160,67,.2); color: #86e0a6; }
			.wpab-check.is-bad .wpab-check__i { background: rgba(207,66,66,.2); color: #ff9b9b; }
			.wpab-check__l { color: #e7e9ec; }
			.wpab-check__m { color: #9aa0a6; font-size: 12px; margin-left: auto; text-align: right; }
			.wpab-issues { display: flex; flex-wrap: wrap; gap: 6px; }
			.wpab-issue { background: rgba(210,153,34,.14); border: 1px solid rgba(210,153,34,.4); color: #f0c674; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
			.wpab-issue--sm { background: #2a2e33; border-color: #3a3f45; color: #c9ced4; font-size: 11px; padding: 2px 8px; }
			.wpab-stats { display: flex; flex-wrap: wrap; gap: 8px; }
			.wpab-stat { flex: 1; min-width: 78px; background: #24282d; border: 1px solid #33383e; border-radius: 10px; padding: 10px 12px; text-align: center; }
			.wpab-stat__n { font-size: 20px; font-weight: 700; color: #fff; }
			.wpab-stat__l { font-size: 11px; color: #9aa0a6; text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }
			.wpab-bar { margin-bottom: 10px; }
			.wpab-bar__top { display: flex; justify-content: space-between; font-size: 13px; color: #e7e9ec; margin-bottom: 4px; }
			.wpab-bar__n { color: #9aa0a6; }
			.wpab-bar__track { height: 8px; background: #2a2e33; border-radius: 999px; overflow: hidden; }
			.wpab-bar__track span { display: block; height: 100%; background: #6ea8fe; border-radius: 999px; }
			.wpab-bar__sub { font-size: 11px; color: #8b9198; margin-top: 3px; }
			.wpab-rec { border: 1px solid #33383e; border-radius: 10px; background: #24282d; padding: 10px 12px; margin-bottom: 8px; }
			.wpab-rec__top { display: flex; align-items: center; gap: 8px; }
			.wpab-rec__title { font-weight: 600; color: #e7e9ec; flex: 1; }
			.wpab-rec__area { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #9aa0a6; background: #2a2e33; border: 1px solid #3a3f45; border-radius: 6px; padding: 1px 7px; }
			.wpab-rec__detail { color: #b7bcc2; font-size: 13px; margin-top: 6px; }
			.wpab-pri { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 2px 8px; border-radius: 999px; border: 1px solid; }
			.wpab-pri--high { background: rgba(207,66,66,.15); color: #ff9b9b; border-color: rgba(207,66,66,.4); }
			.wpab-pri--medium { background: rgba(210,153,34,.15); color: #f0c674; border-color: rgba(210,153,34,.4); }
			.wpab-pri--low { background: rgba(46,160,67,.15); color: #86e0a6; border-color: rgba(46,160,67,.4); }
			.wpab-recs-summary { color: #b7bcc2; font-size: 13px; margin: 0 0 12px; }
			.wpab-anlz-foot { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
			@media (max-width: 900px) { .wpab-anlz__label { display: none; } }
			.wpab-understand { border: 1px solid #33383e; border-radius: 10px; background: #24282d; padding: 12px; margin-bottom: 14px; }
			.wpab-understand__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
			.wpab-understand__title { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #9aa0a6; }
			.wpab-bio { color: #e7e9ec; font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
			.wpab-ufs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
			.wpab-uf { background: #1f2226; border: 1px solid #33383e; border-radius: 8px; padding: 8px 10px; }
			.wpab-uf__l { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #8b9198; margin-bottom: 3px; }
			.wpab-uf__v { font-size: 13px; color: #d5d9de; line-height: 1.45; }
			.wpab-ucols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
			.wpab-uchips { display: flex; flex-wrap: wrap; gap: 6px; }
			.wpab-uchip { font-size: 12px; padding: 3px 9px; border-radius: 8px; border: 1px solid; }
			.wpab-uchip.is-good { background: rgba(46,160,67,.14); color: #86e0a6; border-color: rgba(46,160,67,.4); }
			.wpab-uchip.is-warn { background: rgba(210,153,34,.14); color: #f0c674; border-color: rgba(210,153,34,.4); }
			@media (max-width: 640px) { .wpab-ufs, .wpab-ucols { grid-template-columns: 1fr; } }
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
				if (!statusEl) { return; }
					statusEl.className = 'wpab-studio__dockstatus' + (kind ? ' is-' + kind : '');
			}
			function escapeHtml(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
			function nowIso() { return new Date().toISOString(); }
			function showOverlay(on) { var ov = $('wpab-overlay'); if (ov) { ov.hidden = !on; } }
			function setBusy(state, light) {
				busy = state;
				if (sendBtn) { sendBtn.disabled = state; }
				if (input) { input.disabled = state; }
				var prog = $('wpab-progress'); if (prog) { prog.hidden = !state; }
				showOverlay(state && !light);
			}
			function wpConfirm(message, onYes) {
				var host = $('wpab-confirm'); if (!host) { onYes(); return; }
				host.className = 'wpab-confirm';
				host.innerHTML = '<span></span><button type="button" class="wpab-btn wpab-btn--danger" id="wpab-confirm-yes">Yes</button><button type="button" class="wpab-btn" id="wpab-confirm-no">Cancel</button>';
				host.querySelector('span').textContent = message;
				host.hidden = false;
				$('wpab-confirm-yes').addEventListener('click', function () { host.hidden = true; host.innerHTML = ''; onYes(); });
				$('wpab-confirm-no').addEventListener('click', function () { host.hidden = true; host.innerHTML = ''; });
			}
			function wpToast(message, kind) {
				var host = $('wpab-confirm'); if (!host) { return; }
				host.className = 'wpab-confirm' + (kind ? ' is-' + kind : '');
				host.innerHTML = '<span></span>';
				host.querySelector('span').textContent = message;
				host.hidden = false;
				setTimeout(function () { host.hidden = true; host.innerHTML = ''; host.className = 'wpab-confirm'; }, 3600);
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

			/* ---- Tools (dropdown-driven) + sheet ---- */
			var TOOL_LABELS = { chat: 'Chat', content: 'Content', visual: 'Inspect', build: 'History', seo: 'SEO', insights: 'Insights', recs: 'Recommendations' };
			var currentTool = 'chat';
			function openSheet() { var sh = $('wpab-sheet'), dk = $('wpab-dock'); if (sh) { sh.hidden = false; } if (dk) { dk.classList.add('is-open'); } }
			function closeSheet() { var sh = $('wpab-sheet'), dk = $('wpab-dock'); if (sh) { sh.hidden = true; } if (dk) { dk.classList.remove('is-open'); } }
			var ALL_PANES = ['chat', 'build', 'content', 'visual', 'seo', 'insights', 'recs'];
			function showPane(name) {
				for (var pi = 0; pi < ALL_PANES.length; pi++) { var pel = $('wpab-pane-' + ALL_PANES[pi]); if (pel) { pel.hidden = (ALL_PANES[pi] !== name); } }
			}
			function updateContext() {
				var c = $('wpab-context'); if (!c) { return; }
				if (currentTool === 'visual' && typeof vCurrentSel !== 'undefined' && vCurrentSel) { c.textContent = '\u2196 ' + vCurrentSel; c.hidden = false; }
				else { c.textContent = ''; c.hidden = true; }
			}
			function openTool(name, keepClosed) {
				currentTool = name;
				showPane(name);
				var tt = $('wpab-sheet-title'); if (tt) { tt.textContent = TOOL_LABELS[name] || 'Chat'; }
				var tl = $('wpab-tool-label'); if (tl) { tl.textContent = TOOL_LABELS[name] || name; }
				if (name === 'build' && !buildLoaded) { buildLoaded = true; loadBuild(); }
				if (name === 'content' && !contentLoaded) { contentLoaded = true; loadContentTypes(); }
				updateContext();
				if (!keepClosed) { openSheet(); }
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
					setBusy(true, true); metaEl.textContent = '';
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
			form.addEventListener('submit', function (e) { e.preventDefault(); if (busy) { return; } var m = input.value.trim(); if (!m) { return; } openTool('chat'); addMessage('user', m); input.value = ''; sendChat(m); });
			input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
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
				function startInlineProposal(instruction) { openSheet();
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
				function startInlineContentEdit(req) { openSheet();
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
						openTool('chat');
						input.value = q; input.focus();
					}); }
					var ask = $('wpab-cask'); if (ask) { ask.addEventListener('click', function () {
						var label = (type === 'menu' ? 'menu' : (type === 'media' ? 'media item' : type));
						var q = 'Tell me about the ' + label + ' "' + (item.title || '') + '"' + (item.id ? ' (id ' + item.id + ')' : '') + ' and suggest improvements.';
						openTool('chat');
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

			function reloadPreview() { try { vFrame.style.opacity = '0.35'; var done = function () { vFrame.style.opacity = '1'; vFrame.removeEventListener('load', done); }; vFrame.addEventListener('load', done); vFrame.src = cfg.siteUrl; } catch (e) { try { vFrame.style.opacity = '1'; } catch (e2) {} } }
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
				vSelectorEl.value = vCurrentSel; updateContext();
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
				if (resultEl) { resultEl.innerHTML = '<div class="wpab-deploy">Applying…</div>'; }
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

			/* ---- Analysis: SEO / Insights / Recommendations ---- */
			var auditData = null, auditLoading = false, recsData = null;
			var SPIN = '<p class="wpab-empty">Loading…</p>';
			var ISSUE_LABELS = { missing_meta: 'Missing meta description', short_title: 'Title too short', long_title: 'Title too long', thin_content: 'Thin content (<300 words)', images_no_alt: 'Images missing alt', multi_h1: 'Multiple H1s' };
			function loadAudit(cb) {
				if (auditData) { cb(auditData); return; }
				if (auditLoading) { return; }
				auditLoading = true;
				api('GET', cfg.restAnalyze).then(function (out) {
					auditLoading = false;
					if (out.ok && out.data && out.data.success !== false) { auditData = out.data; cb(auditData); } else { cb(null); }
				}).catch(function () { auditLoading = false; cb(null); });
			}
			function chk(ok, label, failmsg) {
				return '<div class="wpab-check ' + (ok ? 'is-ok' : 'is-bad') + '"><span class="wpab-check__i">' + (ok ? '\u2713' : '!') + '</span><span class="wpab-check__l">' + escapeHtml(label) + '</span>' + (ok ? '' : '<span class="wpab-check__m">' + escapeHtml(failmsg) + '</span>') + '</div>';
			}
			function renderSeo(audit) {
				var body = $('wpab-seo-body'); if (!body) { return; }
				if (!audit || !audit.seo) { body.innerHTML = '<p class="wpab-empty">Could not run the audit.</p>'; return; }
				var s = audit.site || {}, seo = audit.seo || {};
				var checks = '<div class="wpab-checks">' +
					chk(!s.permalink_plain, 'Pretty permalinks', 'Using plain ?p= URLs — switch to a post-name permalink structure.') +
					chk(!!s.https, 'HTTPS', 'The site is not served over HTTPS.') +
					chk(!!s.search_indexable, 'Search engines allowed', 'WordPress is set to discourage search engines.') +
					chk(!s.tagline_default && !s.tagline_empty, 'Tagline set', s.tagline_default ? 'Still the default tagline.' : 'Tagline is empty.') +
					chk(!!seo.seo_plugin, 'SEO plugin', 'No SEO plugin detected (Yoast / Rank Math / AIOSEO).') +
					'</div>';
				var issues = seo.issues || {}, chips = '';
				Object.keys(issues).forEach(function (k) { if (issues[k] > 0) { chips += '<span class="wpab-issue">' + escapeHtml(ISSUE_LABELS[k] || k) + ' \u00b7 ' + issues[k] + '</span>'; } });
				var issuesHtml = chips ? '<h3 class="wpab-col__title">Issues found (' + (seo.checked || 0) + ' pages checked)</h3><div class="wpab-issues">' + chips + '</div>' : '<p class="wpab-empty" style="margin-top:10px">No SEO issues in the ' + (seo.checked || 0) + ' pages checked.</p>';
				var itemsHtml = '';
				(seo.items || []).forEach(function (it) {
					var fl = (it.flags || []).map(function (f) { return '<span class="wpab-issue wpab-issue--sm">' + escapeHtml(ISSUE_LABELS[f] || f) + '</span>'; }).join('');
					itemsHtml += '<div class="wpab-crow"><div class="wpab-crow__top"><span class="wpab-crow__title">' + escapeHtml(it.title || '(no title)') + '</span><span class="wpab-cstatus">' + escapeHtml(it.type) + '</span></div><div class="wpab-crow__meta">' + fl + '</div></div>';
				});
				if (itemsHtml) { itemsHtml = '<h3 class="wpab-col__title">Pages to improve</h3>' + itemsHtml; }
				body.innerHTML = checks + issuesHtml + itemsHtml + '<div class="wpab-anlz-foot"><button type="button" class="wpab-btn" id="wpab-seo-torecs">Get AI recommendations \u2192</button></div>';
				var b = $('wpab-seo-torecs'); if (b) { b.addEventListener('click', function () { openTool('recs'); }); }
			}
			function statTile(label, n) { return '<div class="wpab-stat"><div class="wpab-stat__n">' + (n || 0) + '</div><div class="wpab-stat__l">' + escapeHtml(label) + '</div></div>'; }
			function renderInsights(audit) {
				var body = $('wpab-insights-body'); if (!body) { return; }
				if (!audit || !audit.inventory) { body.innerHTML = '<p class="wpab-empty">Could not load insights.</p>'; return; }
				var inv = audit.inventory;
				var max = 1; (inv.types || []).forEach(function (t) { if (t.total > max) { max = t.total; } });
				var bars = (inv.types || []).map(function (t) {
					var pct = Math.round((t.total / max) * 100);
					return '<div class="wpab-bar"><div class="wpab-bar__top"><span>' + escapeHtml(t.label) + '</span><span class="wpab-bar__n">' + t.total + '</span></div><div class="wpab-bar__track"><span style="width:' + pct + '%"></span></div><div class="wpab-bar__sub">' + t.published + ' published \u00b7 ' + t.draft + ' draft</div></div>';
				}).join('');
				var stats = '<div class="wpab-stats">' + statTile('Media', inv.media) + statTile('Menus', inv.menus) + (inv.products ? statTile('In stock', inv.products.instock) + statTile('Out of stock', inv.products.outofstock) : '') + '</div>';
				var recent = (inv.recent || []).map(function (r) { return '<div class="wpab-crow"><div class="wpab-crow__top"><span class="wpab-crow__title">' + escapeHtml(r.title || '(no title)') + '</span><span class="wpab-cstatus wpab-cstatus--' + escapeHtml(r.status) + '">' + escapeHtml(r.status) + '</span></div><div class="wpab-crow__meta">' + escapeHtml(r.type) + '</div></div>'; }).join('');
				body.innerHTML = stats + '<h3 class="wpab-col__title">Content by type</h3>' + bars + (recent ? '<h3 class="wpab-col__title">Recently updated</h3>' + recent : '');
			}
			function renderRecs(data) {
				var body = $('wpab-recs-body'); if (!body) { return; }
				var recs = data.recommendations || [];
				if (!recs.length) { body.innerHTML = '<p class="wpab-empty">' + escapeHtml(data.summary || 'The site looks good — no recommendations.') + '</p>'; return; }
				var order = { high: 0, medium: 1, low: 2 };
				recs.sort(function (a, b) { return (order[a.priority] == null ? 3 : order[a.priority]) - (order[b.priority] == null ? 3 : order[b.priority]); });
				var cards = recs.map(function (r) {
					return '<div class="wpab-rec"><div class="wpab-rec__top"><span class="wpab-pri wpab-pri--' + escapeHtml(r.priority || 'low') + '">' + escapeHtml(r.priority || 'low') + '</span><span class="wpab-rec__title">' + escapeHtml(r.title || '') + '</span><span class="wpab-rec__area">' + escapeHtml(r.area || '') + '</span></div><div class="wpab-rec__detail">' + escapeHtml(r.detail || '') + '</div></div>';
				}).join('');
				body.innerHTML = '<p class="wpab-recs-summary">' + escapeHtml(data.summary || '') + '</p>' + cards + '<div class="wpab-anlz-foot"><button type="button" class="wpab-btn" id="wpab-recs-copy">Copy as report</button><button type="button" class="wpab-btn" id="wpab-recs-regen">Regenerate</button></div>';
				var cp = $('wpab-recs-copy'); if (cp) { cp.addEventListener('click', function () { copyRecs(data); }); }
				var rg = $('wpab-recs-regen'); if (rg) { rg.addEventListener('click', function () { runRecs(); }); }
			}
			function copyRecs(data) {
				var nl = String.fromCharCode(10);
				var lines = ['Site recommendations', '', (data.summary || '')];
				(data.recommendations || []).forEach(function (r) { lines.push('- [' + (r.priority || '') + '] ' + (r.title || '') + ' - ' + (r.detail || '')); });
				try { navigator.clipboard.writeText(lines.join(nl)); wpToast('Report copied to clipboard.'); } catch (e) { wpToast('Copy is not available here.', 'error'); }
			}
			function runRecs() {
				var body = $('wpab-recs-body'); if (body) { body.innerHTML = '<p class="wpab-typing">Analyzing your site and drafting recommendations…</p>'; }
				setBusy(true);
				api('POST', cfg.restRecommend, {}).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { if (body) { body.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml((out.data && (out.data.error || out.data.message)) || 'Could not generate recommendations.') + '</div>'; } return; }
					recsData = out.data; renderRecs(out.data);
				}).catch(function () { if (body) { body.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed. If your site is large it may take a moment — try again.</div>'; } })
				.then(function () { setBusy(false); });
			}
			function renderUnderstanding(u) {
				var body = $('wpab-understand-body'); if (!body || !u) { return; }
				function field(label, val) { return val ? '<div class="wpab-uf"><div class="wpab-uf__l">' + escapeHtml(label) + '</div><div class="wpab-uf__v">' + escapeHtml(val) + '</div></div>' : ''; }
				function chips(arr, cls) { return (arr || []).map(function (x) { return '<span class="wpab-uchip ' + cls + '">' + escapeHtml(x) + '</span>'; }).join(''); }
				var html = '<p class="wpab-bio">' + escapeHtml(u.biography || '') + '</p>';
				html += '<div class="wpab-ufs">' + field('Identity', u.identity) + field('Audience', u.audience) + field('Objective', u.objective) + field('Problem it solves', u.problem_solved) + field('Standpoint', u.positioning) + field('Economic outlook', u.economic_outlook) + '</div>';
				if ((u.strengths && u.strengths.length) || (u.risks && u.risks.length)) {
					html += '<div class="wpab-ucols">';
					if (u.strengths && u.strengths.length) { html += '<div><div class="wpab-col__title">Strengths</div><div class="wpab-uchips">' + chips(u.strengths, 'is-good') + '</div></div>'; }
					if (u.risks && u.risks.length) { html += '<div><div class="wpab-col__title">Risks</div><div class="wpab-uchips">' + chips(u.risks, 'is-warn') + '</div></div>'; }
					html += '</div>';
				}
				html += '<div class="wpab-anlz-foot"><button type="button" class="wpab-btn" id="wpab-understand-regen">Rescan</button></div>';
				body.innerHTML = html;
				var rg = $('wpab-understand-regen'); if (rg) { rg.addEventListener('click', function () { runUnderstand(); }); }
			}
			function runUnderstand() {
				var body = $('wpab-understand-body'); if (body) { body.innerHTML = '<p class="wpab-typing">Scanning your site and forming an understanding…</p>'; }
				setBusy(true);
				api('POST', cfg.restUnderstand, {}).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { if (body) { body.innerHTML = '<div class="wpab-deploy wpab-deploy--err">' + escapeHtml((out.data && (out.data.error || out.data.message)) || 'Could not scan the site.') + '</div>'; } return; }
					renderUnderstanding(out.data.understanding || {});
				}).catch(function () { if (body) { body.innerHTML = '<div class="wpab-deploy wpab-deploy--err">Network request failed. Try again.</div>'; } })
				.then(function () { setBusy(false); });
			}
			function seoLoad() { var b = $('wpab-seo-body'); if (b) { b.innerHTML = SPIN; } loadAudit(renderSeo); }
			function insightsLoad() { var b = $('wpab-insights-body'); if (b) { b.innerHTML = SPIN; } loadAudit(renderInsights); }
			(function () {
				var g = document.querySelectorAll('.wpab-anlz');
				for (var i = 0; i < g.length; i++) { g[i].addEventListener('click', function () {
					var v = this.getAttribute('data-view');
					openTool(v);
					if (v === 'seo') { seoLoad(); } else if (v === 'insights') { insightsLoad(); }
				}); }
				var sr = $('wpab-seo-refresh'); if (sr) { sr.addEventListener('click', function () { auditData = null; seoLoad(); }); }
				var ir = $('wpab-insights-refresh'); if (ir) { ir.addEventListener('click', function () { auditData = null; insightsLoad(); }); }
				var rr = $('wpab-recs-run'); if (rr) { rr.addEventListener('click', function () { runRecs(); }); }
				var ub = $('wpab-understand-run'); if (ub) { ub.addEventListener('click', function () { runUnderstand(); }); }
			})();

			/* ---- Init ---- */
			resetThread();
			initVisual();
			function genRunId() { return 'r' + Date.now() + '_' + Math.floor(Math.random() * 1e6); }
				(function () { var box = $('wpab-suggests'); if (!box) { return; } ['Give me a quick overview of this theme', 'What pages and products do I have?', 'Suggest 3 quick visual improvements', 'Where can I change the primary color?'].forEach(function (s) { var c = document.createElement('button'); c.type = 'button'; c.className = 'wpab-chip'; c.textContent = s; c.addEventListener('click', function () { input.value = s; input.focus(); }); box.appendChild(c); }); })();
				(function () { var cb = $('wpab-sheet-close'); if (cb) { cb.addEventListener('click', function () { closeSheet(); }); } })();
				(function () {
					var btn = $('wpab-tool-btn'), menu = $('wpab-tool-menu');
					if (btn && menu) {
						btn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
						document.addEventListener('click', function () { menu.hidden = true; });
						var items = menu.querySelectorAll('.wpab-dd__item');
						for (var i = 0; i < items.length; i++) { items[i].addEventListener('click', function () { menu.hidden = true; openTool(this.getAttribute('data-tool')); }); }
					}
				})();
				(function () {
					var vp = $('wpab-viewport'); if (!vp) { return; }
					var stage = $('wpab-stage');
					var widths = { desktop: '100%', tablet: '834px', mobile: '390px' };
					var btns = vp.querySelectorAll('.wpab-vp');
					for (var i = 0; i < btns.length; i++) { btns[i].addEventListener('click', function () {
						var m = this.getAttribute('data-vp');
						for (var j = 0; j < btns.length; j++) { btns[j].classList.toggle('is-active', btns[j] === this); }
						if (stage) { stage.style.maxWidth = widths[m] || '100%'; }
					}); }
				})();
				(function () { var ctx = $('wpab-context'); if (ctx) { ctx.addEventListener('click', function () { ctx.hidden = true; ctx.textContent = ''; }); } })();
				(function () { var ta = $('wpab-editor-input'); if (ta) { ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }); } })();
				function loadStatus() {
				api('POST', cfg.restSession, {}).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						var msg = (out.data && (out.data.error || out.data.message)) || 'Not connected to the AI Builder cloud.';
						setStatus(msg + ' Open Cloud connection to connect the site key.', 'error');
						return;
					}
					var d = out.data, project = d.project || {}, site = d.site || {};
					setStatus('', 'ok');
				}).catch(function () { setStatus('Could not reach WordPress REST API.', 'error'); });
			}
			if (cfg.connected) { loadStatus(); }
			else { setStatus('This site is not connected to the AI Builder cloud yet. Open Cloud connection.', 'error'); }
		})();
		</script>
		<?php
	}
}
