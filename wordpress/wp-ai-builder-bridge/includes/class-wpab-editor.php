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
		add_action( 'add_meta_boxes', array( __CLASS__, 'register_meta_boxes' ) );
		// The admin menu (top level + landing submenu) is registered by
		// WPAB_Admin — the AI Editor is the primary tool, so it does not
		// register a separate submenu of its own.
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );

		// Meikero-managed pages still open normally in the block editor — SEO
		// plugins, the featured image and other page settings live there and
		// must stay reachable. This just adds a fast way to jump to the AI
		// Editor with the same page preloaded, alongside the normal Edit link.
		add_filter( 'page_row_actions', array( __CLASS__, 'filter_page_row_actions' ), 10, 2 );
	}

	/** True while a Meikero-generated theme is the active theme. */
	private static function is_generated_theme_active(): bool {
		$generated = (string) get_option( WPAB_Theme_Writer::GENERATED_OPTION, '' );
		return '' !== $generated && $generated === get_stylesheet();
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
		register_rest_route(
			self::NAMESPACE,
			'/editor/edit-start',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_edit_start' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/edit-apply',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_edit_apply' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/text-apply',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_text_apply' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/edit-plan',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_edit_plan' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/page-content',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_page_content' ),
				'permission_callback' => $permission,
			)
		);
		// The theme map, and one file from it. Both read the local filesystem
		// directly: the editor is already inside wp-admin, so asking the SaaS
		// for something sitting on this disk would be slow, chargeable and
		// dependent on a connection the site may not have.
		register_rest_route(
			self::NAMESPACE,
			'/editor/theme-structure',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_theme_structure' ),
				'permission_callback' => $permission,
			)
		);
		// The change history: what was edited, what it looked like before, and
		// putting any of it back. All local — none of this involves the SaaS.
		register_rest_route(
			self::NAMESPACE,
			'/editor/history',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_history' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/history-file',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_history_file' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/restore',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_restore' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/theme-file',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_theme_file' ),
				'permission_callback' => $permission,
			)
		);
		// Chat as a background job, for hosts whose proxy ends a request before
		// a considered answer is ready.
		register_rest_route(
			self::NAMESPACE,
			'/editor/chat/start',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_chat_start' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/chat/history',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_chat_history' ),
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

		// Theme generation. plan (blueprint) + file (one file at a time, proxied
		// to the SaaS), then create-theme writes the whole set via the
		// create-only WPAB_Theme_Writer.
		register_rest_route(
			self::NAMESPACE,
			'/editor/build/plan',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_build_plan' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/build/file',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_build_file' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/build/files',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_build_files' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/build/files-start',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_build_files_start' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/build/job',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_build_job' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design/html',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_design_html' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design/edit',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_design_edit' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design/pages',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_design_pages' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design/pack',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_design_pack' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design/status',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_design_status' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design/mockup-start',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_mockup_start' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/edit-theme',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_edit_theme' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/undo-edit',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_undo_edit' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/review-theme',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_review_theme' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/design-plan',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_design_plan' ),
				'permission_callback' => $permission,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/editor/create-theme',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_create_theme' ),
				'permission_callback' => $permission,
			)
		);
	}

	/** Phase B: ask the SaaS for a theme blueprint from the wizard brief. */
	public static function rest_build_plan( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 300 ); }
		$params = self::json_params( $request );
		$brief  = isset( $params['brief'] ) && is_array( $params['brief'] ) ? $params['brief'] : array();

		if ( empty( $brief ) ) {
			return new WP_Error( 'wpab_plan_empty', 'A brief is required.', array( 'status' => 400 ) );
		}

		$plan_payload = array( 'brief' => $brief );
		if ( isset( $params['mockupSections'] ) && is_array( $params['mockupSections'] ) ) {
			$plan_payload['mockupSections'] = array_slice( array_values( array_map( 'sanitize_key', $params['mockupSections'] ) ), 0, 10 );
		}

		// The site map the art director decided, carried from the design the
		// person approved. Without it the blueprint plans a second, different
		// set of pages and every link in the approved header goes nowhere.
		if ( isset( $params['sitePages'] ) && is_array( $params['sitePages'] ) ) {
			$clean = array();
			foreach ( $params['sitePages'] as $page ) {
				if ( ! is_array( $page ) ) {
					continue;
				}
				$slug = sanitize_key( isset( $page['slug'] ) ? $page['slug'] : '' );
				if ( '' === $slug ) {
					continue;
				}
				$clean[] = array(
					'slug'    => $slug,
					'title'   => sanitize_text_field( isset( $page['title'] ) ? $page['title'] : $slug ),
					'purpose' => sanitize_text_field( isset( $page['purpose'] ) ? $page['purpose'] : '' ),
				);
				if ( count( $clean ) >= 7 ) {
					break;
				}
			}
			if ( $clean ) {
				$plan_payload['sitePages'] = $clean;
			}
		}

		$result = WPAB_Cloud::request( 'agent/build-plan', $plan_payload, 90 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Phase C: ask the SaaS to generate one theme file from the blueprint. */
	public static function rest_build_file( WP_REST_Request $request ) {
		$params    = self::json_params( $request );
		$blueprint = isset( $params['blueprint'] ) && is_array( $params['blueprint'] ) ? $params['blueprint'] : array();
		$path      = isset( $params['path'] ) ? trim( (string) $params['path'] ) : '';

		if ( empty( $blueprint ) || '' === $path ) {
			return new WP_Error( 'wpab_file_bad', 'A blueprint and a path are required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request(
			'agent/build-file',
			array(
				'blueprint' => $blueprint,
				'path'      => $path,
			),
			90
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Generate a BATCH of theme files in one SaaS call (fewer wizard steps). */
	public static function rest_build_files( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 300 ); }
		$params    = self::json_params( $request );
		$blueprint = isset( $params['blueprint'] ) && is_array( $params['blueprint'] ) ? $params['blueprint'] : array();
		$paths     = array();

		if ( isset( $params['paths'] ) && is_array( $params['paths'] ) ) {
			foreach ( $params['paths'] as $p ) {
				$p = trim( (string) $p );
				if ( '' !== $p ) {
					$paths[] = $p;
				}
			}
		}

		if ( empty( $blueprint ) || empty( $paths ) ) {
			return new WP_Error( 'wpab_files_bad', 'A blueprint and paths are required.', array( 'status' => 400 ) );
		}

		$files_payload = array(
			'blueprint' => $blueprint,
			'paths'     => $paths,
		);
		if ( isset( $params['mockup'] ) && is_array( $params['mockup'] ) ) {
			$files_payload['mockup'] = $params['mockup'];
		}

		$result = WPAB_Cloud::request( 'agent/build-files', $files_payload, 180 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * Async batch generation: START a build-files job on the SaaS. Returns a
	 * jobId immediately; the browser polls rest_build_job. Every request in the
	 * chain stays short, so no host/proxy timeout can kill a long generation.
	 */
	public static function rest_build_files_start( WP_REST_Request $request ) {
		$params    = self::json_params( $request );
		$blueprint = isset( $params['blueprint'] ) && is_array( $params['blueprint'] ) ? $params['blueprint'] : array();
		$paths     = array();

		if ( isset( $params['paths'] ) && is_array( $params['paths'] ) ) {
			foreach ( $params['paths'] as $p ) {
				$p = trim( (string) $p );
				if ( '' !== $p ) {
					$paths[] = $p;
				}
			}
		}

		if ( empty( $blueprint ) || empty( $paths ) ) {
			return new WP_Error( 'wpab_files_bad', 'A blueprint and paths are required.', array( 'status' => 400 ) );
		}

		$files_payload = array(
			'blueprint' => $blueprint,
			'paths'     => $paths,
		);
		if ( isset( $params['mockup'] ) && is_array( $params['mockup'] ) ) {
			$files_payload['mockup'] = $params['mockup'];
		}

		$result = WPAB_Cloud::request( 'agent/build-files-start', $files_payload, 30 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Async batch generation: poll one SaaS job for its status/result. */
	public static function rest_build_job( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$job_id = isset( $params['jobId'] ) ? trim( (string) $params['jobId'] ) : '';

		if ( '' === $job_id ) {
			return new WP_Error( 'wpab_job_bad', 'A jobId is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/job-status', array( 'jobId' => $job_id ), 20 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Design-first: START the homepage mockup job on the SaaS. */
	public static function rest_mockup_start( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 300 ); }
		$params = self::json_params( $request );
		$brief  = isset( $params['brief'] ) && is_array( $params['brief'] ) ? $params['brief'] : array();

		if ( empty( $brief ) ) {
			return new WP_Error( 'wpab_mock_bad', 'A brief is required.', array( 'status' => 400 ) );
		}

		$payload = array( 'brief' => $brief );
		if ( isset( $params['variation'] ) && is_string( $params['variation'] ) ) {
			$payload['variation'] = substr( $params['variation'], 0, 500 );
		}
		if ( isset( $params['designStyle'] ) && is_string( $params['designStyle'] ) ) {
			$payload['designStyle'] = preg_replace( '/[^a-z]/', '', strtolower( $params['designStyle'] ) );
		}

		$result = WPAB_Cloud::request( 'agent/design-mockup-start', $payload, 30 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Design archive: fetch one design's HTML for the wp-admin preview. */
	/**
	 * Which archived screen was asked for.
	 *
	 * This has been a list written in advance twice, and both times the list
	 * fell behind what a design actually held: first two names when there were
	 * six, and then six names when a design started holding the site's own
	 * pages. Both times every unlisted screen quietly asked for the homepage and
	 * got it — the tab changed, the preview did not. So the test is now the
	 * SHAPE of a slug rather than a set of names, which cannot fall behind. The
	 * SaaS applies the same rule at its end, and owns the question of whether
	 * this particular design has that page.
	 */
	private static function design_page( $value ): string {
		$raw = is_string( $value ) ? strtolower( trim( $value ) ) : '';

		return preg_match( '/^[a-z0-9][a-z0-9-]{0,39}$/', $raw ) ? $raw : 'home';
	}

	public static function rest_design_html( WP_REST_Request $request ) {
		$params    = self::json_params( $request );
		$design_id = isset( $params['designId'] ) ? trim( (string) $params['designId'] ) : '';

		if ( '' === $design_id ) {
			return new WP_Error( 'wpab_dhtml_bad', 'A designId is required.', array( 'status' => 400 ) );
		}

		$which = self::design_page( isset( $params['which'] ) ? $params['which'] : '' );

		$result = WPAB_Cloud::request(
			'agent/design-html',
			array(
				'designId' => $design_id,
				'which'    => $which,
			),
			20
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Design archive: mark a design used/rejected on the SaaS. Best-effort. */
	/**
	 * Everything needed to build a theme from a design already generated.
	 *
	 * Designing is the expensive half of a run, and every design is archived —
	 * so rebuilding from one is the cheapest theme this product can make.
	 */
	public static function rest_design_pack( WP_REST_Request $request ) {
		$params    = self::json_params( $request );
		$design_id = isset( $params['designId'] ) ? trim( (string) $params['designId'] ) : '';

		if ( '' === $design_id ) {
			return new WP_Error( 'wpab_dpack_bad', 'A designId is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/design-pack', array( 'designId' => $design_id ), 30 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function rest_design_status( WP_REST_Request $request ) {
		$params    = self::json_params( $request );
		$design_id = isset( $params['designId'] ) ? trim( (string) $params['designId'] ) : '';
		$status    = isset( $params['status'] ) ? (string) $params['status'] : '';

		if ( '' === $design_id || ! in_array( $status, array( 'used', 'rejected' ), true ) ) {
			return new WP_Error( 'wpab_dstatus_bad', 'A designId and a valid status are required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request(
			'agent/design-status',
			array(
				'designId' => $design_id,
				'status'   => $status,
			),
			15
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Phase F: edit the active generated theme from a plain-language instruction. */
	public static function rest_edit_theme( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 300 ); }
		$params      = self::json_params( $request );
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';

		if ( '' === $instruction ) {
			return new WP_Error( 'wpab_edit_empty', 'An instruction is required.', array( 'status' => 400 ) );
		}
		if ( strlen( $instruction ) > 2000 ) {
			$instruction = substr( $instruction, 0, 2000 );
		}

		$edit_payload = array( 'instruction' => $instruction );
		if ( isset( $params['plan'] ) && is_array( $params['plan'] ) ) {
			$edit_payload['plan'] = array_slice( $params['plan'], 0, 8 );
		}
		if ( isset( $params['selected'] ) && is_string( $params['selected'] ) ) {
			$edit_payload['selected'] = substr( $params['selected'], 0, 600 );
		}
		$edit_payload = WPAB_Files::attach_snapshot( $edit_payload );

		$result = WPAB_Cloud::request( 'agent/edit-theme', $edit_payload, 180 );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$files = ( isset( $result['files'] ) && is_array( $result['files'] ) ) ? $result['files'] : array();

		if ( empty( $files ) ) {
			$msg = isset( $result['error'] ) ? (string) $result['error'] : 'The editor returned no changes.';
			return new WP_Error( 'wpab_edit_empty_files', $msg, array( 'status' => 502 ) );
		}

		$applied = WPAB_Theme_Writer::update(
			$files,
			isset( $result['summary'] ) ? (string) $result['summary'] : ''
		);

		if ( is_wp_error( $applied ) ) {
			return $applied;
		}

		self::after_theme_write();

		$changed = array();
		foreach ( $files as $f ) {
			if ( is_array( $f ) && isset( $f['path'] ) && '' !== trim( (string) $f['path'] ) ) {
				$changed[] = (string) $f['path'];
			}
		}

		return new WP_REST_Response(
			array(
				'success'        => true,
				'summary'        => isset( $result['summary'] ) ? (string) $result['summary'] : 'Updated the theme.',
				'updated'        => isset( $applied['updated'] ) ? (int) $applied['updated'] : count( $files ),
				'files'          => $changed,
				'inspected'      => ( isset( $result['inspected'] ) && is_array( $result['inspected'] ) ) ? array_map( 'strval', $result['inspected'] ) : array(),
				'usage'          => isset( $result['usage'] ) && is_array( $result['usage'] ) ? $result['usage'] : null,
				'undo_available' => true,
			),
			200
		);
	}

	/** Phase F: undo the most recent theme edit (one level). */
	public static function rest_undo_edit( WP_REST_Request $request ) {
		$result = WPAB_Theme_Writer::undo();

		if ( ! is_wp_error( $result ) ) {
			self::after_theme_write();
		}

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * Post-generation QA: ask the SaaS to review the just-built active theme for
	 * critical defects and apply any fixes. Non-fatal by design — the theme is
	 * already created and working, so a failed or empty review never errors.
	 */
	public static function rest_review_theme( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 300 ); }
		$params  = self::json_params( $request );
		$focus   = isset( $params['focus'] ) ? trim( (string) $params['focus'] ) : '';
		$payload = array();
		if ( '' !== $focus ) {
			$payload['focus'] = substr( $focus, 0, 500 );
		}

		$payload = WPAB_Files::attach_snapshot( $payload );

		$result = WPAB_Cloud::request( 'agent/review-theme', $payload, 180 );

		if ( is_wp_error( $result ) ) {
			return new WP_REST_Response(
				array( 'success' => true, 'applied' => false, 'updated' => 0, 'summary' => 'Review skipped.' ),
				200
			);
		}

		$files   = ( isset( $result['files'] ) && is_array( $result['files'] ) ) ? $result['files'] : array();
		$summary = isset( $result['summary'] ) ? (string) $result['summary'] : 'Reviewed the theme.';

		$usage = isset( $result['usage'] ) && is_array( $result['usage'] ) ? $result['usage'] : null;

		if ( empty( $files ) ) {
			return new WP_REST_Response(
				array( 'success' => true, 'applied' => false, 'updated' => 0, 'summary' => $summary, 'usage' => $usage ),
				200
			);
		}

		$applied = WPAB_Theme_Writer::update( $files, '' !== $summary ? $summary : 'Design pass' );

		if ( is_wp_error( $applied ) ) {
			// Keep the already-working theme rather than failing generation.
			return new WP_REST_Response(
				array( 'success' => true, 'applied' => false, 'updated' => 0, 'summary' => $summary, 'usage' => $usage ),
				200
			);
		}

		self::after_theme_write();

		return new WP_REST_Response(
			array(
				'success' => true,
				'applied' => true,
				'updated' => isset( $applied['updated'] ) ? (int) $applied['updated'] : count( $files ),
				'summary' => $summary,
				'usage'   => $usage,
			),
			200
		);
	}

	/**
	 * Staged design revision — the critique step. Proxies to the SaaS, which
	 * returns a small punch-list of design elevations; the JS applies each one
	 * via the edit-theme path so every call stays small and timeout-safe.
	 */
	public static function rest_design_plan( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 300 ); }
		$params  = self::json_params( $request );
		$payload = array();
		if ( isset( $params['concept'] ) && is_array( $params['concept'] ) ) {
			$payload['concept'] = $params['concept'];
		} elseif ( isset( $params['blueprint'] ) && is_array( $params['blueprint'] ) ) {
			$payload['blueprint'] = $params['blueprint'];
		}

		$payload = WPAB_Files::attach_snapshot( $payload );

		$result = WPAB_Cloud::request( 'agent/design-plan', $payload, 120 );

		if ( is_wp_error( $result ) ) {
			// Non-fatal: skip the design pass rather than failing generation.
			return new WP_REST_Response( array( 'success' => true, 'targets' => array() ), 200 );
		}

		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * A require/include of a theme file that is not part of the generated set
	 * fatals on every page load (WordPress then deactivates the theme). Scan
	 * every PHP file for get_template_directory()/get_theme_file_path requires
	 * and reject the OFFENDING file when the target is missing — the wizard's
	 * repair flow then regenerates that one file.
	 *
	 * @param array $files [ [ 'path' => ..., 'contents' => ... ], ... ].
	 * @return true|WP_Error
	 */
	private static function find_missing_requires( array $files ) {
		$have = array();
		foreach ( $files as $f ) {
			$have[ ltrim( (string) $f['path'], '/' ) ] = true;
		}

		foreach ( $files as $f ) {
			$path = (string) $f['path'];
			if ( substr( $path, -4 ) !== '.php' ) {
				continue;
			}
			if ( ! preg_match_all(
				'/(?:require|include)(?:_once)?\s*\(?\s*(?:get_template_directory\(\)\s*\.\s*|get_theme_file_path\(\s*)[\'"]\/?([^\'"]+)[\'"]/',
				(string) $f['contents'],
				$m
			) ) {
				continue;
			}
			foreach ( $m[1] as $target ) {
				$target = ltrim( $target, '/' );
				if ( ! isset( $have[ $target ] ) ) {
					return new WP_Error(
						'wpab_missing_require',
						'PHP error in ' . $path . ': it requires ' . $target . ', which does not exist in the theme. Remove the require or generate that file.',
						array( 'status' => 422 )
					);
				}
			}
		}

		return true;
	}

	public static function rest_create_theme( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$brand  = isset( $params['brand'] ) ? trim( (string) $params['brand'] ) : '';

		if ( '' === $brand ) {
			$brand = (string) get_bloginfo( 'name' );
		}
		if ( '' === trim( $brand ) ) {
			$brand = 'My Site';
		}
		if ( mb_strlen( $brand ) > 80 ) {
			$brand = mb_substr( $brand, 0, 80 );
		}

		// If the caller supplied generated files, use them; otherwise fall back
		// to the built-in starter theme. The writer re-validates everything
		// regardless of where the files came from.
		$files = array();

		if ( isset( $params['files'] ) && is_array( $params['files'] ) ) {
			foreach ( $params['files'] as $f ) {
				if ( is_array( $f ) && isset( $f['path'] ) ) {
					$files[] = array(
						'path'     => (string) $f['path'],
						'contents' => isset( $f['contents'] ) ? (string) $f['contents'] : '',
					);
				}
			}
		}

		if ( empty( $files ) ) {
			$files = self::starter_classic_theme( $brand );
		}

		$meta = array();
		if ( isset( $params['description'] ) ) {
			$meta['description'] = (string) $params['description'];
		}

		$missing_req = self::find_missing_requires( $files );
		if ( is_wp_error( $missing_req ) ) {
			return $missing_req;
		}

		$result = WPAB_Theme_Writer::create( $brand, $files, $meta );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// Phase E: with the theme written and active, materialise the site —
		// create the pages (each picks up its page-{slug}.php template via the
		// WordPress template hierarchy), set the front page and build the menu.
		$blueprint = isset( $params['blueprint'] ) && is_array( $params['blueprint'] ) ? $params['blueprint'] : array();
		$content   = isset( $params['content'] ) && is_array( $params['content'] ) ? $params['content'] : array();

		if ( ! empty( $blueprint ) ) {
			try {
				$result['finalize'] = self::finalize_generated_site( $blueprint, $content );
			} catch ( \Throwable $e ) {
				$result['finalize'] = array( 'ok' => false, 'error' => $e->getMessage() );
			}
		}

		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * Create the WordPress pages a blueprint describes, wire the front page and
	 * build the primary menu. Idempotent by slug: a page that already exists is
	 * reused, the menu is rebuilt each time. Templates are picked up
	 * automatically by the page-{slug}.php hierarchy — no per-page meta needed.
	 */
	private static function finalize_generated_site( array $blueprint, array $content = array() ): array {
		$pages      = isset( $blueprint['pages'] ) && is_array( $blueprint['pages'] ) ? $blueprint['pages'] : array();
		$front_slug = isset( $blueprint['frontPage'] ) ? sanitize_title( (string) $blueprint['frontPage'] ) : '';
		$menu_items = isset( $blueprint['menu'] ) && is_array( $blueprint['menu'] ) ? $blueprint['menu'] : array();

		$created  = array(); // slug => page id
		$front_id = 0;

		foreach ( $pages as $p ) {
			if ( ! is_array( $p ) ) {
				continue;
			}

			$slug  = isset( $p['slug'] ) ? sanitize_title( (string) $p['slug'] ) : '';
			$title = isset( $p['title'] ) ? sanitize_text_field( (string) $p['title'] ) : '';

			if ( '' === $slug || '' === $title ) {
				continue;
			}

			// Real page copy from the SaaS content stage — stored as post_content
			// so SEO plugins, search, RSS and the WP editor all see it, and the
			// templates render it through the_content().
			$body = '';
			if ( isset( $content[ $slug ] ) && is_string( $content[ $slug ] ) ) {
				$body = wp_kses_post( (string) $content[ $slug ] );
				// Store real Gutenberg blocks, not raw HTML — otherwise the block
				// editor shows one opaque HTML blob with no editable links or
				// buttons. Same converter the front page mirror uses.
				if ( '' !== $body ) {
					$blocked = self::html_to_blocks( $body );
					if ( '' !== $blocked ) {
						$body = $blocked;
					}
				}
			}

			$existing = get_page_by_path( $slug );

			if ( $existing instanceof WP_Post ) {
				$created[ $slug ] = (int) $existing->ID;
				// A reused page only gains content when it has none — never
				// overwrite something the user has written.
				if ( '' !== $body && '' === trim( (string) $existing->post_content ) ) {
					wp_update_post(
						array(
							'ID'           => (int) $existing->ID,
							'post_content' => $body,
						)
					);
					// The content just written is Meikero's, so this page is now
					// managed by the AI Editor, not the block editor.
					update_post_meta( (int) $existing->ID, '_wpab_generated_page', 1 );
				}
			} else {
				$id = wp_insert_post(
					array(
						'post_type'    => 'page',
						'post_status'  => 'publish',
						'post_title'   => $title,
						'post_name'    => $slug,
						'post_content' => $body,
					),
					true
				);

				if ( is_wp_error( $id ) ) {
					continue;
				}

				$created[ $slug ] = (int) $id;
				update_post_meta( $id, '_wpab_generated_page', 1 );
			}

			if ( $slug === $front_slug ) {
				$front_id = $created[ $slug ];
			}
		}

		// Static front page (front-page.php still wins for rendering, but this
		// makes the front a real page rather than the blog index).
		if ( $front_id > 0 ) {
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $front_id );
			update_post_meta( $front_id, '_wpab_generated_page', 1 );
		}

		// Build the primary menu from the blueprint order.
		$menu_built = false;

		if ( ! empty( $menu_items ) && function_exists( 'wp_create_nav_menu' ) ) {
			$menu_name = 'Primary';
			$menu_obj  = wp_get_nav_menu_object( $menu_name );
			$menu_id   = $menu_obj ? (int) $menu_obj->term_id : (int) wp_create_nav_menu( $menu_name );

			if ( $menu_id && ! is_wp_error( $menu_id ) ) {
				// Clear existing items so regeneration does not stack duplicates.
				$existing_items = wp_get_nav_menu_items( $menu_id );
				if ( is_array( $existing_items ) ) {
					foreach ( $existing_items as $item ) {
						wp_delete_post( (int) $item->ID, true );
					}
				}

				foreach ( $menu_items as $mi ) {
					if ( ! is_array( $mi ) ) {
						continue;
					}

					$mslug  = isset( $mi['slug'] ) ? sanitize_title( (string) $mi['slug'] ) : '';
					$mtitle = isset( $mi['title'] ) ? sanitize_text_field( (string) $mi['title'] ) : '';

					if ( isset( $created[ $mslug ] ) ) {
						wp_update_nav_menu_item(
							$menu_id,
							0,
							array(
								'menu-item-title'     => '' !== $mtitle ? $mtitle : get_the_title( $created[ $mslug ] ),
								'menu-item-object'    => 'page',
								'menu-item-object-id' => $created[ $mslug ],
								'menu-item-type'      => 'post_type',
								'menu-item-status'    => 'publish',
							)
						);
					}
				}

				$locations = get_theme_mod( 'nav_menu_locations' );
				if ( ! is_array( $locations ) ) {
					$locations = array();
				}
				$locations['primary'] = $menu_id;
				set_theme_mod( 'nav_menu_locations', $locations );

				$menu_built = true;
			}
		}

		// Freshly generated theme: (re)build the front page's Gutenberg shadow
		// copy from the actual written section files — block markup, links and
		// images included — and (re)arm the sync hash.
		$front_synced = false;
		try {
			$fs           = self::after_theme_write( true );
			$front_synced = ! empty( $fs['synced'] );
		} catch ( \Throwable $e ) {} // phpcs:ignore

		return array(
			'ok'            => true,
			'pages_created' => count( $created ),
			'front_page'    => $front_id > 0,
			'front_synced'  => $front_synced,
			'menu_built'    => $menu_built,
		);
	}

	/**
	 * A minimal but real classic PHP theme, used to prove the create-only write
	 * path end to end. Every file here is later replaced by AI-generated code.
	 */
	private static function starter_classic_theme( string $brand ): array {
		$prefix = preg_replace( '/[^a-z0-9_]/', '', strtolower( str_replace( array( ' ', '-' ), '_', $brand ) ) );
		if ( '' === $prefix || is_numeric( $prefix[0] ) ) {
			$prefix = 't_' . $prefix;
		}

		$css = ":root{--container:1140px;--fg:#1a1d21;--muted:#6b7280;--accent:#3a5bff;--bg:#ffffff}"
			. "*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);line-height:1.6}"
			. ".container{max-width:var(--container);margin:0 auto;padding:0 24px}"
			. ".site-header{border-bottom:1px solid #eceef1}.site-header .container{display:flex;align-items:center;justify-content:space-between;padding-top:18px;padding-bottom:18px}"
			. ".site-title{font-weight:700;font-size:20px;text-decoration:none;color:var(--fg)}"
			. ".site-nav ul{display:flex;gap:22px;list-style:none;margin:0;padding:0}.site-nav a{text-decoration:none;color:var(--fg)}"
			. ".hero{padding:88px 0;text-align:center}.hero h1{font-size:44px;margin:0 0 12px}.hero p{color:var(--muted);font-size:19px;margin:0 0 24px}"
			. ".btn{display:inline-block;background:var(--accent);color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:600}"
			. "section{padding:56px 0}.site-footer{border-top:1px solid #eceef1;color:var(--muted);text-align:center}";

		$header = "<?php\n/**\n * Header template.\n */\n?>\n"
			. "<!DOCTYPE html>\n<html <?php language_attributes(); ?>>\n<head>\n"
			. "<meta charset=\"<?php bloginfo( 'charset' ); ?>\">\n"
			. "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
			. "<?php wp_head(); ?>\n</head>\n\n"
			. "<body <?php body_class(); ?>>\n<?php wp_body_open(); ?>\n"
			. "<header class=\"site-header\">\n\t<div class=\"container\">\n"
			. "\t\t<?php if ( has_custom_logo() ) { the_custom_logo(); } else { ?>\n"
			. "\t\t\t<a class=\"site-title\" href=\"<?php echo esc_url( home_url( '/' ) ); ?>\"><?php bloginfo( 'name' ); ?></a>\n"
			. "\t\t<?php } ?>\n"
			. "\t\t<nav class=\"site-nav\"><?php wp_nav_menu( array( 'theme_location' => 'primary', 'container' => false, 'fallback_cb' => false ) ); ?></nav>\n"
			. "\t</div>\n</header>\n\n<main class=\"site-main\">\n";

		$footer = "</main>\n\n<footer class=\"site-footer\">\n\t<div class=\"container\">\n"
			. "\t\t<p>&copy; <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?></p>\n"
			. "\t</div>\n</footer>\n<?php wp_footer(); ?>\n</body>\n</html>\n";

		$functions = "<?php\n/**\n * Theme functions for {$brand}.\n */\nif ( ! defined( 'ABSPATH' ) ) { exit; }\n\n"
			. "if ( ! function_exists( '{$prefix}_setup' ) ) {\n"
			. "\tfunction {$prefix}_setup() {\n"
			. "\t\tadd_theme_support( 'title-tag' );\n"
			. "\t\tadd_theme_support( 'post-thumbnails' );\n"
			. "\t\tadd_theme_support( 'custom-logo' );\n"
			. "\t\tadd_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );\n"
			. "\t\tregister_nav_menus( array( 'primary' => 'Primary Menu' ) );\n"
			. "\t}\n}\nadd_action( 'after_setup_theme', '{$prefix}_setup' );\n\n"
			. "function {$prefix}_assets() {\n"
			. "\twp_enqueue_style( '{$prefix}-style', get_stylesheet_uri(), array(), '1.0.0' );\n"
			. "\twp_enqueue_style( '{$prefix}-main', get_template_directory_uri() . '/assets/css/main.css', array(), '1.0.0' );\n"
			. "\twp_enqueue_script( '{$prefix}-main', get_template_directory_uri() . '/assets/js/main.js', array(), '1.0.0', true );\n"
			. "}\nadd_action( 'wp_enqueue_scripts', '{$prefix}_assets' );\n";

		$front = "<?php get_header(); ?>\n\n"
			. "<section class=\"hero\">\n\t<div class=\"container\">\n"
			. "\t\t<h1><?php bloginfo( 'name' ); ?></h1>\n"
			. "\t\t<p><?php bloginfo( 'description' ); ?></p>\n"
			. "\t\t<a class=\"btn\" href=\"#\">Get started</a>\n"
			. "\t</div>\n</section>\n\n"
			. "<section class=\"intro\">\n\t<div class=\"container\">\n"
			. "\t\t<?php if ( have_posts() ) { while ( have_posts() ) { the_post(); the_content(); } } ?>\n"
			. "\t</div>\n</section>\n\n<?php get_footer(); ?>\n";

		$page = "<?php get_header(); ?>\n\n<section class=\"page\">\n\t<div class=\"container\">\n"
			. "\t\t<?php while ( have_posts() ) { the_post(); ?>\n"
			. "\t\t\t<h1><?php the_title(); ?></h1>\n"
			. "\t\t\t<div class=\"entry\"><?php the_content(); ?></div>\n"
			. "\t\t<?php } ?>\n\t</div>\n</section>\n\n<?php get_footer(); ?>\n";

		$single = "<?php get_header(); ?>\n\n<section class=\"single\">\n\t<div class=\"container\">\n"
			. "\t\t<?php while ( have_posts() ) { the_post(); ?>\n"
			. "\t\t\t<h1><?php the_title(); ?></h1>\n"
			. "\t\t\t<div class=\"entry\"><?php the_content(); ?></div>\n"
			. "\t\t<?php } ?>\n\t</div>\n</section>\n\n<?php get_footer(); ?>\n";

		$index = "<?php get_header(); ?>\n\n<section class=\"archive\">\n\t<div class=\"container\">\n"
			. "\t\t<?php if ( have_posts() ) { while ( have_posts() ) { the_post(); ?>\n"
			. "\t\t\t<article>\n\t\t\t\t<h2><a href=\"<?php the_permalink(); ?>\"><?php the_title(); ?></a></h2>\n"
			. "\t\t\t\t<?php the_excerpt(); ?>\n\t\t\t</article>\n"
			. "\t\t<?php } } else { echo '<p>Nothing here yet.</p>'; } ?>\n"
			. "\t</div>\n</section>\n\n<?php get_footer(); ?>\n";

		return array(
			array( 'path' => 'style.css', 'contents' => $css ),
			array( 'path' => 'functions.php', 'contents' => $functions ),
			array( 'path' => 'index.php', 'contents' => $index ),
			array( 'path' => 'header.php', 'contents' => $header ),
			array( 'path' => 'footer.php', 'contents' => $footer ),
			array( 'path' => 'front-page.php', 'contents' => $front ),
			array( 'path' => 'page.php', 'contents' => $page ),
			array( 'path' => 'single.php', 'contents' => $single ),
			array( 'path' => 'assets/css/main.css', 'contents' => "/* Extra styles for {$brand}. */\n" ),
			array( 'path' => 'assets/js/main.js', 'contents' => "/* Theme scripts for {$brand}. */\n" ),
		);
	}
	private static function json_params( WP_REST_Request $request ): array {
		$params = $request->get_json_params();

		return is_array( $params ) ? $params : array();
	}

	/** Async edit: start the edit job on the SaaS (result is fetched via the job poll). */
	public static function rest_edit_start( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';
		if ( '' === $instruction ) {
			return new WP_Error( 'wpab_edit_empty', 'An instruction is required.', array( 'status' => 400 ) );
		}
		if ( strlen( $instruction ) > 2000 ) {
			$instruction = substr( $instruction, 0, 2000 );
		}
		$payload = array(
			'instruction' => $instruction,
			'theme'       => (string) wp_get_theme()->get( 'Name' ),
		);
		if ( isset( $params['plan'] ) && is_array( $params['plan'] ) ) {
			$payload['plan'] = array_slice( $params['plan'], 0, 8 );
		}
		if ( isset( $params['selected'] ) && is_string( $params['selected'] ) ) {
			$payload['selected'] = substr( $params['selected'], 0, 600 );
		}
		$payload = WPAB_Files::attach_snapshot( $payload );

		$result = WPAB_Cloud::request( 'agent/edit-start', $payload, 30 );
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Async edit: apply the finished job's files locally (validated, with Undo). */
	public static function rest_edit_apply( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$files  = ( isset( $params['files'] ) && is_array( $params['files'] ) ) ? $params['files'] : array();
		if ( empty( $files ) ) {
			return new WP_Error( 'wpab_apply_empty', 'No files to apply.', array( 'status' => 400 ) );
		}
		$summary = isset( $params['summary'] ) ? (string) $params['summary'] : '';
		$applied = WPAB_Theme_Writer::update( $files, $summary );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}
		self::after_theme_write();
		$changed = array();
		foreach ( $files as $f ) {
			if ( is_array( $f ) && isset( $f['path'] ) && '' !== trim( (string) $f['path'] ) ) {
				$changed[] = (string) $f['path'];
			}
		}
		return new WP_REST_Response(
			array(
				'success'        => true,
				'summary'        => isset( $params['summary'] ) ? (string) $params['summary'] : 'Updated the theme.',
				'updated'        => isset( $applied['updated'] ) ? (int) $applied['updated'] : count( $files ),
				'files'          => $changed,
				'inspected'      => ( isset( $params['inspected'] ) && is_array( $params['inspected'] ) ) ? array_map( 'strval', $params['inspected'] ) : array(),
				'undo_available' => true,
			),
			200
		);
	}

	/**
	 * Inline text edit: deterministic find & replace in one theme file — no AI.
	 *
	 * The editor sends the file it resolved from the click (a section part,
	 * header.php or footer.php), the text as it was and the text as the user
	 * typed it. The old text must appear EXACTLY ONCE across the candidate
	 * files; then it is swapped via WPAB_Theme_Writer::update (validated, with
	 * Undo). 0 matches usually means the text is dynamic site content;
	 * more than 1 means the change is ambiguous — both are reported back so
	 * the editor can fall back to the right path.
	 */
	public static function rest_text_apply( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$file   = isset( $params['file'] ) ? trim( (string) $params['file'] ) : '';
		$old    = isset( $params['oldText'] ) ? trim( (string) $params['oldText'] ) : '';
		$new    = isset( $params['newText'] ) ? trim( (string) $params['newText'] ) : '';

		if ( '' === $old || '' === $new ) {
			return new WP_Error( 'wpab_text_empty', 'Both the old and the new text are required.', array( 'status' => 400 ) );
		}
		if ( strlen( $old ) > 2000 || strlen( $new ) > 2000 ) {
			return new WP_Error( 'wpab_text_long', 'The text is too long for an inline edit.', array( 'status' => 400 ) );
		}

		$active    = get_stylesheet();
		$generated = (string) get_option( WPAB_Theme_Writer::GENERATED_OPTION, '' );
		if ( '' === $generated || $generated !== $active ) {
			return new WP_Error( 'wpab_text_not_generated', 'Text editing is only available for a theme generated here.', array( 'status' => 409 ) );
		}

		$dir = trailingslashit( wp_normalize_path( get_stylesheet_directory() ) );

		// Candidate files: the one the editor resolved from the click first,
		// then the other top-level templates and section parts as a fallback.
		$candidates = array();
		if ( '' !== $file ) {
			$rel = WPAB_Theme_Writer::clean_relative_path( $file );
			if ( ! is_wp_error( $rel ) && 'php' === WPAB_Theme_Writer::extension( $rel ) ) {
				$candidates[] = $rel;
			}
		}
		$found = array_merge(
			glob( $dir . '*.php' ) ?: array(),
			glob( $dir . 'template-parts/*.php' ) ?: array()
		);
		foreach ( $found as $abs ) {
			$rel = ltrim( substr( wp_normalize_path( $abs ), strlen( $dir ) ), '/' );
			if ( '' !== $rel && ! in_array( $rel, $candidates, true ) ) {
				$candidates[] = $rel;
			}
		}

		// The clicked text is plain DOM text; in the file it may be stored raw
		// or HTML-escaped — try both spellings.
		$needles = array_values( array_unique( array( $old, esc_html( $old ) ) ) );

		$hit_file   = '';
		$hit_needle = '';
		$total      = 0;
		foreach ( $candidates as $rel ) {
			$abs = $dir . $rel;
			if ( ! is_file( $abs ) ) {
				continue;
			}
			$real = realpath( $abs );
			if ( false === $real || 0 !== strpos( wp_normalize_path( $real ), $dir ) ) {
				continue;
			}
			$contents = (string) file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			foreach ( $needles as $needle ) {
				$n = substr_count( $contents, $needle );
				if ( $n > 0 ) {
					$total += $n;
					if ( '' === $hit_file ) {
						$hit_file   = $rel;
						$hit_needle = $needle;
					}
					break; // Never double-count the raw and escaped spellings in one file.
				}
			}
			if ( $total > 1 ) {
				break;
			}
		}

		if ( 0 === $total ) {
			return new WP_REST_Response( array( 'success' => false, 'reason' => 'not_found' ), 200 );
		}
		if ( $total > 1 ) {
			return new WP_REST_Response( array( 'success' => false, 'reason' => 'ambiguous', 'file' => $hit_file ), 200 );
		}

		$abs      = $dir . $hit_file;
		$contents = (string) file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$pos      = strpos( $contents, $hit_needle );
		if ( false === $pos ) {
			return new WP_REST_Response( array( 'success' => false, 'reason' => 'not_found' ), 200 );
		}

		$updated = substr_replace( $contents, esc_html( $new ), $pos, strlen( $hit_needle ) );
		$applied = WPAB_Theme_Writer::update( array( array( 'path' => $hit_file, 'contents' => $updated ) ), 'Text edited on the page' );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}

		$synced = self::after_theme_write();

		return new WP_REST_Response(
			array(
				'success'        => true,
				'file'           => $hit_file,
				'summary'        => 'Text updated',
				'content_synced' => ! empty( $synced['synced'] ),
				'undo_available' => true,
			),
			200
		);
	}

	/* ---------------------------------------------------------------------
	 * Gutenberg shadow copy — the front page's post_content mirrors what the
	 * designed homepage actually renders, so SEO tools, search, RSS and other
	 * editors (Gutenberg, Elementor if this plugin is ever disabled) always
	 * see the real content. Deterministic, no AI.
	 * ------------------------------------------------------------------ */

	/**
	 * Rebuild the front page's post_content from the generated theme's section
	 * files as native Gutenberg block markup (headings, paragraphs, lists,
	 * links, images). Manual edits are respected: once the stored sync-hash no
	 * longer matches the page, syncing pauses until the next full generation
	 * (which passes $force).
	 */
	/**
	 * Everything that must happen after theme files change: refresh the front
	 * page's Gutenberg mirror and purge page caches so the change is actually
	 * visible (LiteSpeed & co. otherwise keep serving the old HTML).
	 */
	private static function after_theme_write( bool $force_sync = false ): array {
		$sync = array( 'synced' => false );
		try {
			$sync = self::sync_front_content( $force_sync );
		} catch ( \Throwable $e ) {} // phpcs:ignore
		try {
			self::backfill_managed_pages();
		} catch ( \Throwable $e ) {} // phpcs:ignore
		self::purge_caches();
		return $sync;
	}

	/**
	 * Tag the front page and every page with a matching page-<slug>.php
	 * template as Meikero-managed (_wpab_generated_page), so the manual-edit
	 * guard and the Pages list "Edit in Meikero" link cover them too. Cheap
	 * and idempotent — safe to call on every write, and it also catches up
	 * sites generated before this existed, without a separate migration.
	 */
	private static function backfill_managed_pages(): void {
		if ( ! self::is_generated_theme_active() ) {
			return;
		}
		$front_id = (int) get_option( 'page_on_front', 0 );
		if ( $front_id > 0 && ! get_post_meta( $front_id, '_wpab_generated_page', true ) ) {
			update_post_meta( $front_id, '_wpab_generated_page', 1 );
		}
		$dir   = trailingslashit( wp_normalize_path( get_stylesheet_directory() ) );
		$files = glob( $dir . 'page-*.php' );
		if ( ! is_array( $files ) ) {
			return;
		}
		foreach ( $files as $file ) {
			$slug = preg_replace( '/^page-|\.php$/', '', basename( $file ) );
			if ( '' === $slug ) {
				continue;
			}
			$page = get_page_by_path( $slug );
			if ( $page instanceof WP_Post && ! get_post_meta( $page->ID, '_wpab_generated_page', true ) ) {
				update_post_meta( $page->ID, '_wpab_generated_page', 1 );
			}
		}
	}

	/** Best-effort purge of the common page caches after a theme/content write. */
	private static function purge_caches(): void {
		try {
			do_action( 'litespeed_purge_all' );
			if ( function_exists( 'w3tc_flush_all' ) ) { w3tc_flush_all(); }
			if ( function_exists( 'wp_cache_clear_cache' ) ) { wp_cache_clear_cache(); }
			if ( function_exists( 'rocket_clean_domain' ) ) { rocket_clean_domain(); }
			wp_cache_flush();
		} catch ( \Throwable $e ) {} // phpcs:ignore
	}

	public static function sync_front_content( bool $force = false ): array {
		if ( ! self::is_generated_theme_active() ) {
			return array( 'synced' => false, 'reason' => 'not-generated' );
		}
		$front_id = (int) get_option( 'page_on_front', 0 );
		if ( $front_id <= 0 ) {
			return array( 'synced' => false, 'reason' => 'no-front' );
		}
		$dir = trailingslashit( wp_normalize_path( get_stylesheet_directory() ) );
		$fp  = $dir . 'front-page.php';
		if ( ! is_file( $fp ) ) {
			return array( 'synced' => false, 'reason' => 'no-template' );
		}
		$src = (string) file_get_contents( $fp ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( ! preg_match_all( '/get_template_part\(\s*[\'"]template-parts\/section[\'"]\s*,\s*[\'"]([a-z0-9-]+)[\'"]/', $src, $mm ) || empty( $mm[1] ) ) {
			return array( 'synced' => false, 'reason' => 'no-sections' );
		}

		$post = get_post( $front_id );
		if ( ! $post ) {
			return array( 'synced' => false, 'reason' => 'no-page' );
		}
		// The front page is a MIRROR of the designed homepage — the design is
		// the source of truth, so the mirror always follows it. (Manual edits
		// to this one page get replaced on the next AI edit; the editor's
		// Meikero panel says so.)

		$blocks = array();
		$total  = 0;
		foreach ( array_unique( $mm[1] ) as $slug ) {
			$file = $dir . 'template-parts/section-' . $slug . '.php';
			if ( ! is_file( $file ) ) {
				continue;
			}
			$html = (string) file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			$html = (string) preg_replace( '/<\?php.*?(\?>|$)/s', ' ', $html );
			$b    = self::html_to_blocks( $html );
			if ( '' !== $b ) {
				$blocks[] = $b;
				$total   += strlen( $b );
				if ( $total > 40000 ) {
					break;
				}
			}
		}
		$content = trim( implode( "\n\n", $blocks ) );
		if ( strlen( $content ) < 40 ) {
			return array( 'synced' => false, 'reason' => 'too-little' );
		}

		wp_update_post(
			array(
				'ID'           => $front_id,
				'post_content' => wp_slash( $content ),
			)
		);
		$saved = get_post( $front_id );
		update_post_meta( $front_id, '_wpab_synced_hash', md5( (string) ( $saved ? $saved->post_content : $content ) ) );
		return array( 'synced' => true );
	}

	/** Turn a section's static markup into Gutenberg block markup. */
	private static function html_to_blocks( string $html ): string {
		if ( '' === trim( $html ) || ! class_exists( 'DOMDocument' ) ) {
			return '';
		}
		$doc = new DOMDocument();
		libxml_use_internal_errors( true );
		$loaded = $doc->loadHTML( '<?xml encoding="utf-8"?><body>' . $html . '</body>', LIBXML_NOERROR | LIBXML_NOWARNING );
		libxml_clear_errors();
		if ( ! $loaded ) {
			return '';
		}
		$xp    = new DOMXPath( $doc );
		$nodes = $xp->query( '//h1|//h2|//h3|//p|//ul|//ol|//img' );
		if ( ! $nodes || ! $nodes->length ) {
			return '';
		}
		$inline = array(
			'a'      => array( 'href' => true, 'target' => true, 'rel' => true ),
			'strong' => array(),
			'em'     => array(),
			'b'      => array(),
			'i'      => array(),
			'br'     => array(),
		);
		$done      = array();
		$seen_text = array();
		$out       = array();
		foreach ( $nodes as $node ) {
			// Skip anything already captured through a parent (e.g. li inside ul).
			$anc    = $node->parentNode; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
			$inside = false;
			while ( $anc ) {
				if ( isset( $done[ spl_object_id( $anc ) ] ) ) {
					$inside = true;
					break;
				}
				$anc = $anc->parentNode; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
			}
			if ( $inside ) {
				continue;
			}
			$tag = strtolower( (string) $node->nodeName ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
			if ( 'img' === $tag ) {
				$src = $node instanceof DOMElement ? (string) $node->getAttribute( 'src' ) : '';
				$alt = $node instanceof DOMElement ? (string) $node->getAttribute( 'alt' ) : '';
				if ( ! preg_match( '#^https?://#', $src ) ) {
					continue;
				}
				$out[] = "<!-- wp:image -->\n<figure class=\"wp-block-image\"><img src=\"" . esc_url( $src ) . '" alt="' . esc_attr( $alt ) . "\"/></figure>\n<!-- /wp:image -->";
				$done[ spl_object_id( $node ) ] = true;
				continue;
			}
			if ( 'ul' === $tag || 'ol' === $tag ) {
				$items = array();
				$lis   = $xp->query( './/li', $node );
				if ( $lis ) {
					foreach ( $lis as $li ) {
						$t = self::inline_html( $doc, $li, $inline );
						if ( '' !== trim( wp_strip_all_tags( $t ) ) ) {
							$items[] = '<li>' . $t . '</li>';
						}
						if ( count( $items ) >= 12 ) {
							break;
						}
					}
				}
				if ( $items ) {
					$lt    = 'ol' === $tag ? 'ol' : 'ul';
					$battr = 'ol' === $tag ? ' {"ordered":true}' : '';
					$out[] = "<!-- wp:list{$battr} -->\n<{$lt} class=\"wp-block-list\">" . implode( '', $items ) . "</{$lt}>\n<!-- /wp:list -->";
					$done[ spl_object_id( $node ) ] = true;
				}
				continue;
			}
			if ( 'p' === $tag ) {
				$solo_link = self::paragraph_is_solo_link( $node );
				if ( $solo_link instanceof DOMElement ) {
					$href = $solo_link->getAttribute( 'href' );
					$text = trim( wp_strip_all_tags( self::inline_html( $doc, $solo_link, array( 'strong' => array(), 'em' => array(), 'b' => array(), 'i' => array() ) ) ) );
					if ( '' !== $href && '' !== $text && ! isset( $seen_text[ $text ] ) ) {
						$seen_text[ $text ] = true;
						$out[]              = "<!-- wp:buttons -->\n<div class=\"wp-block-buttons\"><!-- wp:button -->\n<div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"" . esc_url( $href ) . '">' . esc_html( $text ) . "</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->";
						$done[ spl_object_id( $node ) ] = true;
						continue;
					}
				}
			}
			$t     = self::inline_html( $doc, $node, $inline );
			$plain = trim( wp_strip_all_tags( $t ) );
			if ( '' === $plain || strlen( $plain ) < 2 || strlen( $plain ) > 1200 || isset( $seen_text[ $plain ] ) ) {
				continue;
			}
			$seen_text[ $plain ] = true;
			if ( 'p' === $tag ) {
				$out[] = "<!-- wp:paragraph -->\n<p>" . $t . "</p>\n<!-- /wp:paragraph -->";
			} else {
				$lvl   = 'h3' === $tag ? 3 : 2;
				$battr = 3 === $lvl ? ' {"level":3}' : '';
				$out[] = "<!-- wp:heading{$battr} -->\n<h{$lvl} class=\"wp-block-heading\">" . $t . "</h{$lvl}>\n<!-- /wp:heading -->";
			}
			$done[ spl_object_id( $node ) ] = true;
		}
		return implode( "\n\n", $out );
	}

	/** Inner HTML of a node reduced to safe inline markup (links kept). */
	private static function inline_html( DOMDocument $doc, $node, array $allowed ): string {
		$html = '';
		foreach ( $node->childNodes as $child ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
			$html .= $doc->saveHTML( $child );
		}
		$html = (string) preg_replace( '/\s+/', ' ', (string) $html );
		return trim( wp_kses( $html, $allowed ) );
	}

	/**
	 * If a <p> contains nothing but a single <a> (no other text or elements),
	 * return that anchor so it can become a real wp:buttons block instead of
	 * an inert link buried in a paragraph. Returns null otherwise.
	 */
	private static function paragraph_is_solo_link( $node ): ?DOMElement {
		$link = null;
		foreach ( $node->childNodes as $child ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
			if ( XML_TEXT_NODE === $child->nodeType ) {
				if ( '' !== trim( (string) $child->textContent ) ) {
					return null;
				}
				continue;
			}
			if ( XML_ELEMENT_NODE !== $child->nodeType ) {
				continue;
			}
			if ( 'a' !== strtolower( (string) $child->nodeName ) || null !== $link ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
				return null;
			}
			$link = $child;
		}
		return $link instanceof DOMElement ? $link : null;
	}

	/** "Made with Meikero" panel in the page editor. */
	public static function register_meta_boxes(): void {
		if ( ! self::is_generated_theme_active() ) {
			return;
		}
		add_meta_box( 'wpab-made-with', 'Meikero', array( __CLASS__, 'render_meta_box' ), 'page', 'side', 'high' );
	}

	/**
	 * "Made with Meikero" panel in the page editor's side column. The block
	 * editor itself stays fully open — SEO plugin panels, the featured
	 * image, the permalink and every other page setting live there and must
	 * stay reachable. This is a nudge toward the AI Editor for content/design
	 * changes, not a lock.
	 */
	public static function render_meta_box( $post ): void {
		$is_front = (int) get_option( 'page_on_front', 0 ) === (int) $post->ID;
		$url      = admin_url( 'admin.php?page=' . self::PAGE_SLUG . '&edit_page=' . (int) $post->ID );
		echo '<div style="display:flex;flex-direction:column;gap:8px;">';
		echo '<p style="margin:0;color:#50575e;">' . esc_html(
			$is_front
				? 'This page mirrors the designed homepage — every Meikero AI edit refreshes it automatically, so hand edits to the content here are replaced on the next AI edit. SEO, the featured image and other settings below are safe to edit directly.'
				: 'Made with Meikero. For content or design changes, the AI Editor keeps this page consistent with the rest of the site. SEO, the featured image and other settings below can be edited directly here as usual.'
		) . '</p>';
		echo '<a class="button button-primary" style="text-align:center;background:#141312;border-color:#141312;" href="' . esc_url( $url ) . '">Open AI Editor</a>';
		echo '</div>';
	}

	/** Pages list: add a quick "Edit in Meikero" link next to the normal Edit action for managed pages — Edit still opens the block editor as usual. */
	public static function filter_page_row_actions( array $actions, WP_Post $post ): array {
		if ( ! self::is_generated_theme_active() ) {
			return $actions;
		}
		if ( ! get_post_meta( $post->ID, '_wpab_generated_page', true ) ) {
			self::backfill_managed_pages();
		}
		if ( ! get_post_meta( $post->ID, '_wpab_generated_page', true ) ) {
			return $actions;
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return $actions;
		}
		$url                    = admin_url( 'admin.php?page=' . self::PAGE_SLUG . '&edit_page=' . (int) $post->ID );
		$actions['wpab-meikero'] = '<a href="' . esc_url( $url ) . '">Edit in Meikero</a>';
		return $actions;
	}

	/** Edit planning: the cheap model turns an instruction into a numbered plan. */
	public static function rest_edit_plan( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';
		if ( '' === $instruction ) {
			return new WP_Error( 'wpab_plan_empty', 'An instruction is required.', array( 'status' => 400 ) );
		}
		$plan_payload = array(
			'instruction' => $instruction,
			'theme'       => (string) wp_get_theme()->get( 'Name' ),
		);
		if ( isset( $params['selected'] ) && is_string( $params['selected'] ) ) {
			$plan_payload['selected'] = substr( $params['selected'], 0, 600 );
		}
		$plan_payload = WPAB_Files::attach_snapshot( $plan_payload );

		$result = WPAB_Cloud::request( 'agent/edit-plan', $plan_payload, 90 );
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Page content: the cheap model writes real copy for the inner pages. */
	public static function rest_page_content( WP_REST_Request $request ) {
		$params  = self::json_params( $request );
		$payload = array();
		if ( isset( $params['blueprint'] ) && is_array( $params['blueprint'] ) ) {
			$payload['blueprint'] = $params['blueprint'];
		}
		if ( isset( $params['brief'] ) && is_array( $params['brief'] ) ) {
			$payload['brief'] = $params['brief'];
		}
		$result = WPAB_Cloud::request( 'agent/page-content', $payload, 90 );
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * POST /editor/design/edit — adjust an approved design before building.
	 *
	 * Long timeout, because this reads the whole mockup and writes anchored
	 * edits against it; short of that it is an ordinary proxy.
	 */
	public static function rest_design_edit( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$design_id   = isset( $params['designId'] ) ? trim( (string) $params['designId'] ) : '';
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';

		if ( '' === $design_id || '' === $instruction ) {
			return new WP_Error( 'wpab_dedit_bad', 'A design and an instruction are required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request(
			'agent/design-edit',
			array(
				'designId'    => $design_id,
				'instruction' => substr( $instruction, 0, 2000 ),
			),
			240
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * Draw the rest of the site, once the homepage has been approved.
	 *
	 * Starts a job rather than waiting: eight pages take minutes, and a host
	 * that cuts long requests would otherwise lose a generation that had
	 * already succeeded on the SaaS side.
	 */
	public static function rest_design_pages( WP_REST_Request $request ) {
		if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 120 ); }
		$params    = self::json_params( $request );
		$design_id = isset( $params['designId'] ) ? trim( (string) $params['designId'] ) : '';

		if ( '' === $design_id ) {
			return new WP_Error( 'wpab_dpages_bad', 'A design is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/design-pages-start', array( 'designId' => $design_id ), 60 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * GET /editor/theme-structure — the active theme, grouped by file role.
	 *
	 * Local and free. The same array the plugin ships to the SaaS with every
	 * request, so the tree the user browses and the map the AI reasons over
	 * cannot disagree.
	 */
	public static function rest_theme_structure(): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'success'   => true,
				'structure' => WPAB_Files::structure( 'theme' ),
			),
			200
		);
	}

	/** GET /editor/history — the recorded edits, newest first, without contents. */
	public static function rest_history(): WP_REST_Response {
		return new WP_REST_Response(
			array( 'success' => true, 'entries' => WPAB_Theme_Writer::history() ),
			200
		);
	}

	/** POST /editor/history-file — one file before and after a recorded edit. */
	public static function rest_history_file( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$id     = isset( $params['id'] ) ? (string) $params['id'] : '';
		$path   = isset( $params['path'] ) ? (string) $params['path'] : '';

		if ( '' === $id || '' === $path ) {
			return new WP_Error( 'wpab_history_bad', 'A change id and a file path are required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Theme_Writer::history_file( $id, $path );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** POST /editor/restore — put the theme back to before one recorded edit. */
	public static function rest_restore( WP_REST_Request $request ) {
		$params = self::json_params( $request );
		$id     = isset( $params['id'] ) ? (string) $params['id'] : '';

		if ( '' === $id ) {
			return new WP_Error( 'wpab_history_bad', 'A change id is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Theme_Writer::restore( $id );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		self::after_theme_write();

		return new WP_REST_Response( $result, 200 );
	}

	/** POST /editor/theme-file — one theme file, read from this disk. */
	public static function rest_theme_file( WP_REST_Request $request ) {
		$params = $request->get_json_params();
		$path   = isset( $params['path'] ) ? (string) $params['path'] : '';

		if ( '' === trim( $path ) ) {
			return new WP_Error( 'wpab_missing_path', 'A file path is required.', array( 'status' => 400 ) );
		}

		// WPAB_Files::read() resolves through WPAB_Scopes, which is what keeps
		// a crafted path from escaping the theme directory.
		$file = WPAB_Files::read( 'theme', $path );

		if ( is_wp_error( $file ) ) {
			return $file;
		}

		return new WP_REST_Response( $file, 200 );
	}

	/** Chat archive: list conversations, or fetch one conversation's messages. */
	public static function rest_chat_history( WP_REST_Request $request ) {
		$params  = self::json_params( $request );
		$payload = array();
		if ( isset( $params['conversationId'] ) && is_string( $params['conversationId'] ) ) {
			$payload['conversationId'] = substr( $params['conversationId'], 0, 80 );
		}
		$result = WPAB_Cloud::request( 'agent/chat-history', $payload, 30 );
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * Everything a chat turn sends to the SaaS.
	 *
	 * Shared by the inline and the job path so the two cannot send different
	 * things — which, given one carries the whole theme and the site's content,
	 * would be a difference nobody would notice until an answer was wrong.
	 *
	 * @return array|WP_Error
	 */
	private static function chat_payload( WP_REST_Request $request ) {
		$params  = self::json_params( $request );
		$message = isset( $params['message'] ) ? trim( (string) $params['message'] ) : '';

		if ( '' === $message ) {
			return new WP_Error( 'wpab_editor_empty', 'Message is required.', array( 'status' => 400 ) );
		}
		if ( strlen( $message ) > 6000 ) {
			return new WP_Error( 'wpab_editor_too_long', 'Message is too long.', array( 'status' => 400 ) );
		}

		$body = array( 'message' => $message );

		// Live theme identity — the SaaS keeps a snapshot from connection time
		// which goes stale as soon as a new theme is generated; the site itself
		// is the authority.
		$body['theme']     = (string) wp_get_theme()->get( 'Name' );
		$body['themeSlug'] = (string) get_stylesheet();

		// Optional attached image: a data URL the editor already downscaled.
		if ( isset( $params['image'] ) && is_string( $params['image'] ) ) {
			$img = $params['image'];
			// 1.5 MB of base64, not 3: the request now also carries the theme
			// and the site's content, and Vercel rejects a body over 4.5 MB.
			// The editor downscales before sending, so this is still a
			// generous screenshot.
			if ( strlen( $img ) <= 1500000 && 0 === strpos( $img, 'data:image/' ) ) {
				$body['image'] = $img;
			}
		}

		$conversation_id = isset( $params['conversationId'] ) ? trim( (string) $params['conversationId'] ) : '';
		if ( '' !== $conversation_id ) {
			$body['conversationId'] = $conversation_id;
		}

		// The chat reads the theme AND the site's content from what we send,
		// not by being called back.
		$body = WPAB_Files::attach_snapshot( $body );
		$body = WPAB_Content::attach_snapshot( $body );

		return $body;
	}

	public static function rest_chat( WP_REST_Request $request ) {
		$body = self::chat_payload( $request );

		if ( is_wp_error( $body ) ) {
			return $body;
		}

		// 180, not 60: the route is allowed 300 seconds and a question that needs
		// real inspection takes more than a minute. At 60 WordPress hung up while
		// Vercel was still working, so the user saw a network error and the answer
		// they had already paid for was thrown away.
		$result = WPAB_Cloud::request( 'agent/chat', $body, 180 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/**
	 * POST /editor/chat/start — the same turn, started as a job.
	 *
	 * Returns a job id in a second or two; the editor polls for the answer.
	 * Nothing stays open long enough for a hosting proxy to cut it, which is
	 * the one failure raising the timeout cannot fix.
	 */
	public static function rest_chat_start( WP_REST_Request $request ) {
		$body = self::chat_payload( $request );

		if ( is_wp_error( $body ) ) {
			return $body;
		}

		$body['async'] = true;

		$result = WPAB_Cloud::request( 'agent/chat', $body, 30 );

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

	/** Build the project snapshot the chat is grounded in (theme recognition). */
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


	/**
	 * The design flow on its own page.
	 *
	 * Generating a theme and editing one are different jobs done at different
	 * times, and putting the first inside the second meant the AI Editor opened
	 * onto a wizard covering a chat that could not be used yet. They share this
	 * renderer because they share the wizard itself; what differs is that the
	 * design page has no chat behind it and cannot be dismissed into one.
	 */
	public static function render_design_page(): void {
		self::render_page( 'design' );
	}

	public static function render_page( string $mode = 'editor' ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$is_design = ( 'design' === $mode );

		// Deep link from the Pages list / manual-edit guard: preload the
		// preview on the specific page someone was trying to open, instead of
		// always landing on the homepage.
		$initial_url  = '';
		$edit_page_id = isset( $_GET['edit_page'] ) ? absint( $_GET['edit_page'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( $edit_page_id > 0 ) {
			$permalink = get_permalink( $edit_page_id );
			if ( is_string( $permalink ) && '' !== $permalink ) {
				$initial_url = $permalink;
			}
		}

		$config = array(
			'restSession'     => esc_url_raw( rest_url( self::NAMESPACE . '/cloud/session' ) ),
			'restChat'        => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat' ) ),
			'restChatHistory' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat/history' ) ),
			'restChatStart'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat/start' ) ),
			'restStructure'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/theme-structure' ) ),
			'restThemeFile'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/theme-file' ) ),
			'restHistory'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/history' ) ),
			'restHistoryFile' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/history-file' ) ),
			'restRestore'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/restore' ) ),
			'restEditPlan'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-plan' ) ),
			'restEditStart'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-start' ) ),
			'restEditApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-apply' ) ),
			'restTextApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/text-apply' ) ),
			'restPageContent' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/page-content' ) ),
			'restContext'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/context' ) ),
			'restCreateTheme' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/create-theme' ) ),
			'restBuildPlan'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/plan' ) ),
			'restBuildFile'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/file' ) ),
			'restBuildFiles'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/files' ) ),
			'restBuildFilesStart' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/files-start' ) ),
			'restBuildJob'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/job' ) ),
			'mode'            => $is_design ? 'design' : 'editor',
			'dashboardUrl'    => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'editorUrl'       => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-editor' ) ),
			'designUrl'       => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-design' ) ),
			'restMockupStart' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/mockup-start' ) ),
			'restDesignStatus' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/status' ) ),
			'restDesignHtml'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/html' ) ),
			'restDesignPack'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/pack' ) ),
			'restDesignEdit'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/edit' ) ),
			'restDesignPages' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/pages' ) ),
			'restEditTheme'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-theme' ) ),
			'restUndoEdit'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/undo-edit' ) ),
			'restReviewTheme' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/review-theme' ) ),
			'restDesignPlan'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design-plan' ) ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'cloudPage'   => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'exitUrl'     => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'siteUrl'     => esc_url_raw( home_url( '/' ) ),
			'initialUrl'  => '' !== $initial_url ? esc_url_raw( $initial_url ) : '',
			'connected'   => (bool) WPAB_Cloud::has_key(),
		);
		?>
		<div class="wpab-ed<?php echo $is_design ? ' wpab-ed--design' : ''; ?>" id="wpab-ed">
			<div class="wpab-ed__float">
				<a href="<?php echo esc_url( admin_url() ); ?>" class="wpab-ed__wpbtn" title="Back to wp-admin">
					<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M6 8.6l2.8 7.6 2.1-5.5 2.1 5.5L15.8 8.6" fill="none"/></svg>
				</a>
				<button type="button" id="wpab-ed-openpreview" class="wpab-ed__wpbtn" title="Open this page in a new tab">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M20 14v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V6a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>
				</button>
				<span class="wpab-ed__themetag" title="Active theme"><?php echo esc_html( wp_get_theme()->get( 'Name' ) ); ?></span>
				<a id="wpab-ed-credits" class="wpab-ed__credits" href="https://meikero.com/dashboard" target="_blank" rel="noopener" title="Credits remaining" hidden></a>
			</div>

			<div id="wpab-ed-wizard" class="wpab-ed__wizard" hidden>
				<div class="wpab-ed__wcard">
					<div class="wpab-ed__whead">
						<h2 class="wpab-ed__wtitle">Generate a custom theme</h2>
					</div>

					<div id="wpab-ed-wform">
						<p class="wpab-ed__whint">Describe the website you want — what it's for, the vibe, colours, the pages you need and any must-haves. The more detail you give, the better the result.</p>
						<label class="wpab-ed__wlabel" for="wpab-ed-prompt">Describe your website</label>
						<textarea id="wpab-ed-prompt" class="wpab-ed__winput wpab-ed__wprompt" rows="8" placeholder="e.g. A modern site for Aurora Studio, a boutique design agency for tech startups. Clean and minimal with lots of whitespace and a deep-indigo accent. Pages: Home, Work, Services, About, Contact. Include a hero, a logo strip, a case-study grid, testimonials and a bold call to action. Confident, professional voice."></textarea>
						<label class="wpab-ed__wlabel" for="wpab-ed-name">Site / theme name <span class="wpab-ed__wopt">— optional, AI names it if left blank</span></label>
						<input type="text" id="wpab-ed-name" class="wpab-ed__winput" placeholder="e.g. Aurora Studio" />
						<label class="wpab-ed__wlabel">Design style</label>
						<div class="wpab-ed__wstyles" id="wpab-ed-wstyles">
							<button type="button" class="wpab-ed__wstyle is-on" data-style="concept"><b>Concept</b><span>Surprising — brand becomes the layout</span></button>
							<button type="button" class="wpab-ed__wstyle" data-style="minimal"><b>Minimal</b><span>Editorial luxury, whitespace, calm</span></button>
							<button type="button" class="wpab-ed__wstyle" data-style="bold"><b>Bold</b><span>Loud, experimental, art-led</span></button>
							<button type="button" class="wpab-ed__wstyle" data-style="business"><b>Business</b><span>Clean, credible, conversion-first</span></button>
						</div>
					</div>

					<div id="wpab-ed-wprogress" class="wpab-ed__wprogress" hidden>
						<ol class="wpab-ed__steps" id="wpab-ed-steps">
							<li class="wpab-ed__step" data-phase="design"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Designing the homepage</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="plan"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Planning the pages</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="build"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Building the theme</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="write"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Writing files</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="check"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Final quality check</span><span class="wpab-ed__stepmeta"></span></li>
						</ol>
						<div class="wpab-ed__wbar"><span id="wpab-ed-wbarfill" class="wpab-ed__wbarfill"></span></div>
						<div id="wpab-ed-wstep" class="wpab-ed__wstep"></div>
					</div>

					<div id="wpab-ed-mockwrap" class="wpab-ed__mockwrap" hidden>
						<div id="wpab-ed-mockways" class="wpab-ed__mocktabs" hidden></div>
						<div class="wpab-ed__mockstage">
							<nav id="wpab-ed-mocktabs" class="wpab-ed__mockrail" aria-label="Pages in this design" hidden></nav>
							<iframe id="wpab-ed-mockframe" class="wpab-ed__mockframe" title="Design preview" sandbox="allow-scripts"></iframe>
						</div>
						<div id="wpab-ed-mockmeta" class="wpab-ed__mockmeta" hidden></div>
						<div class="wpab-ed__mockedit" id="wpab-ed-mockedit" hidden>
							<input type="text" id="wpab-ed-mockeditinput" class="wpab-ed__mockeditinput" placeholder="Change something first — e.g. make the hero smaller, or turn the method section into a list" />
							<button type="button" id="wpab-ed-mockeditgo" class="wpab-ed__wbtn wpab-ed__wbtn--ghost">Change it</button>
						</div>
						<div id="wpab-ed-mockeditnote" class="wpab-ed__mockeditnote"></div>

						<div class="wpab-ed__mockactions">
							<button type="button" id="wpab-ed-mockgo" class="wpab-ed__wbtn">Design the rest of the site</button>
							<button type="button" id="wpab-ed-mockuse" class="wpab-ed__wbtn" hidden>Build the theme</button>
							<button type="button" id="wpab-ed-mockbrief" class="wpab-ed__wbtn wpab-ed__wbtn--ghost">Edit the brief</button>
							<button type="button" id="wpab-ed-mockredo" class="wpab-ed__wbtn wpab-ed__wbtn--ghost">Try another direction</button>
						</div>
					</div>

					<div id="wpab-ed-wresult" class="wpab-ed__wresult"></div>

					<div class="wpab-ed__wactions">
						<button type="button" id="wpab-ed-wcancel" class="wpab-ed__wbtn wpab-ed__wbtn--ghost">Cancel</button>
						<button type="button" id="wpab-ed-wgo" class="wpab-ed__wbtn">Generate theme</button>
					</div>
				</div>
			</div>

			<div class="wpab-ed__preview">
				<div class="wpab-ed__framewrap is-desktop" id="wpab-ed-framewrap">
					<iframe id="wpab-ed-frame" class="wpab-ed__frame" title="Site preview"></iframe>
					<div id="wpab-ed-frameload" class="wpab-ed__frameload" hidden>
						<span class="wpab-ed__spin"></span>
						<span id="wpab-ed-frameload-txt" class="wpab-ed__frameloadtxt">Working…</span>
					</div>
				</div>
			</div>

			<button type="button" class="wpab-ed__chatback" id="wpab-ed-chatback" tabindex="-1" aria-label="Close the full-screen chat"></button>
			<aside class="wpab-ed__chat" id="wpab-ed-chatpanel">
				<div id="wpab-ed-notice" class="wpab-ed__notice" hidden></div>
				<div id="wpab-ed-thread" class="wpab-ed__thread" aria-live="polite">
					<div class="wpab-ed__empty">
						<p>Ask anything about this site — or tell me what to change.</p>
					</div>
				</div>
				<div id="wpab-ed-memory" class="wpab-ed__memory" hidden aria-label="What this conversation has established"></div>
				<form id="wpab-ed-form" class="wpab-ed__form" autocomplete="off">
					<div id="wpab-ed-selrow" class="wpab-ed__selrow" hidden>
						<span class="wpab-ed__seltag"><span class="tgt" id="wpab-ed-seltgt"></span><span class="sec" id="wpab-ed-selsec"></span><button type="button" class="x" id="wpab-ed-selclear" title="Remove selection">&times;</button></span>
					</div>
					<div id="wpab-ed-imgrow" class="wpab-ed__selrow" hidden>
						<span class="wpab-ed__seltag"><img id="wpab-ed-imgthumb" class="wpab-ed__imgthumb" alt="" /><span class="sec">image</span><button type="button" class="x" id="wpab-ed-imgclear" title="Remove image">&times;</button></span>
					</div>
					<textarea id="wpab-ed-input" class="wpab-ed__input" rows="1" placeholder="Ask about this site…"></textarea>
					<div class="wpab-ed__formrow">
						<span class="wpab-ed__formtools">
							<button type="button" id="wpab-ed-newtheme" class="wpab-ed__newtheme wpab-ed__newtheme--dock">✨ New theme</button>
							<button type="button" id="wpab-ed-new" class="wpab-ed__new">New chat</button>
							<button type="button" id="wpab-ed-history" class="wpab-ed__new" title="Chat history">History</button>
							<button type="button" id="wpab-ed-expand" class="wpab-ed__expand" aria-expanded="false" title="Expand the chat to full screen">⤢</button>
							<button type="button" id="wpab-ed-inspect" class="wpab-ed__dev wpab-ed__inspect" title="Select an element on the page to edit" aria-pressed="false">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.5 18 2.2-7.3L21 12.5z"/><path d="M4 4l8.5 8.5"/></svg>
							</button>
							<button type="button" id="wpab-ed-textmode" class="wpab-ed__dev wpab-ed__inspect" title="Click text on the page to edit it in place" aria-pressed="false">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>
							</button>
							<button type="button" id="wpab-ed-changes" class="wpab-ed__dev" title="What changed, and how to put it back">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>
							</button>
							<button type="button" id="wpab-ed-structure" class="wpab-ed__dev" title="Show the theme's files and what each one does">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h6l1.5 2H20v11.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M8 12h8"/><path d="M8 15.5h5"/></svg>
							</button>
							<button type="button" id="wpab-ed-attach" class="wpab-ed__dev" title="Attach an image or screenshot">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 15.5l-4.5-4.5L7 20.5"/></svg>
							</button>
							<input type="file" id="wpab-ed-attachfile" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
						</span>
						<div class="wpab-ed__devbar" id="wpab-ed-devbar" role="group" aria-label="Preview size">
							<button type="button" class="wpab-ed__dev is-active" data-dev="desktop" title="Desktop" aria-label="Desktop">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
							</button>
							<button type="button" class="wpab-ed__dev" data-dev="laptop" title="Laptop" aria-label="Laptop">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>
							</button>
							<button type="button" class="wpab-ed__dev" data-dev="tablet" title="Tablet" aria-label="Tablet">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/></svg>
							</button>
							<button type="button" class="wpab-ed__dev" data-dev="mobile" title="Mobile" aria-label="Mobile">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2.5" width="8" height="19" rx="2"/><path d="M11.2 18.5h1.6"/></svg>
							</button>
						</div>
						<button type="submit" id="wpab-ed-send" class="wpab-ed__send">Send</button>
					</div>
					<div id="wpab-ed-histmenu" class="wpab-ed__histmenu" hidden></div>
				</form>
			</aside>
		</div>

		<style>
			#wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
			#wpfooter, #wpadminbar, #adminmenumain, #adminmenuwrap, #adminmenuback { display: none !important; }
			html.wp-toolbar { padding-top: 0 !important; }
			#wpcontent { margin-left: 0 !important; }
			.wpab-ed { position: fixed; inset: 0; z-index: 99990; background: var(--ed-bg); color: var(--ed-text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
				--ed-bg: #f6f5f3; --ed-surface: #ffffff; --ed-surface-2: #faf9f7; --ed-border: #e8e5df; --ed-border-strong: #d9d5cc;
				--ed-text: #1b1a18; --ed-muted: #6f6b64; --ed-faint: #9b968d; --ed-accent: #141312; --ed-accent-2: #454340; --ed-accent-soft: rgba(20,19,18,.08);
				/* The conversation's own colour. Deliberately NOT --ed-accent: the
				   editor sits on top of somebody else's design, so its buttons,
				   links and focus rings stay near-black and out of the way. Only
				   the messages and the send button are Meikero blue. */
				--ed-blue: #3d64f2; --ed-blue-2: #2f52d8; --ed-blue-ink: #ffffff; --ed-bubble: #f2f0ec;
				--ed-radius: 14px; --ed-shadow: 0 1px 2px rgba(20,18,16,.05), 0 10px 30px rgba(20,18,16,.09); --ed-shadow-lg: 0 24px 70px rgba(20,18,16,.20); }
			.wpab-ed__float { position: absolute; top: 12px; left: 14px; right: auto; z-index: 20; display: flex; align-items: center; gap: 8px; }
			.wpab-ed__wpbtn { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; color: var(--ed-muted); border: 1px solid var(--ed-border); border-radius: 10px; background: rgba(255,255,255,.85); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: var(--ed-shadow); cursor: pointer; text-decoration: none; transition: all .15s ease; }
			.wpab-ed__wpbtn:hover { background: #141312; border-color: #141312; color: #fff; }
			.wpab-ed__credits { font-size: 11px; font-weight: 600; color: var(--ed-muted); background: rgba(255,255,255,.7); border: 1px solid var(--ed-border); border-radius: 999px; padding: 5px 11px; text-decoration: none; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); white-space: nowrap; }
			.wpab-ed__credits:hover { color: #141312; }
			.wpab-ed__credits.is-empty { color: #b42318; border-color: rgba(180,35,24,.35); background: rgba(255,247,247,.9); }
			.wpab-ed__themetag { font-size: 11px; font-weight: 600; color: var(--ed-muted); background: rgba(255,255,255,.7); border: 1px solid var(--ed-border); border-radius: 999px; padding: 5px 11px; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.wpab-ed__newtheme { background: var(--ed-accent); color: #fff; border: 0; border-radius: 9px; padding: 8px 15px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(20,19,18,.22); }
			.wpab-ed__newtheme:hover { background: #000; }
			.wpab-ed__newtheme--dock { padding: 6px 12px; font-size: 12px; box-shadow: none; white-space: nowrap; }
			/* The design page is the wizard. Everything the editor puts behind it —
		   the preview, the chat, the dock — belongs to a theme that does not exist
		   yet, so it is not rendered as a backdrop for one. */
		.wpab-ed--design > *:not(.wpab-ed__wizard) { display: none !important; }
		.wpab-ed--design .wpab-ed__wizard { background: #f6f5f2; -webkit-backdrop-filter: none; backdrop-filter: none; }
		.wpab-ed__wizard { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: radial-gradient(1200px 620px at 50% -12%, rgba(99,102,241,.14), transparent 60%), rgba(28,26,22,.32); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); padding: 24px; }
			.wpab-ed__wizard[hidden] { display: none !important; }
			.wpab-ed__wcard { position: relative; width: 100%; max-width: 500px; max-height: 88vh; overflow-y: auto; background: rgba(255,255,255,.86); border: 1px solid rgba(20,18,16,.08); border-radius: 20px; padding: 28px; box-shadow: var(--ed-shadow-lg); -webkit-backdrop-filter: blur(22px) saturate(1.3); backdrop-filter: blur(22px) saturate(1.3); animation: wpab-ed-cardin .45s cubic-bezier(.2,.75,.25,1); }
			.wpab-ed__wcard::before { content: ""; position: absolute; inset: 0; border-radius: 20px; padding: 1px; background: linear-gradient(135deg, rgba(20,19,18,.28), rgba(20,19,18,.08) 42%, transparent 72%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
			@keyframes wpab-ed-cardin { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
			.wpab-ed__winput + .wpab-ed__wlabel { margin-top: 14px; }
			.wpab-ed__wlabel { margin-top: 14px; }
			.wpab-ed__wlabel:first-of-type { margin-top: 0; }
			textarea.wpab-ed__winput { resize: vertical; font-family: inherit; }
			.wpab-ed__wrow { display: flex; gap: 12px; }
			.wpab-ed__wcol { flex: 1 1 0; }
			.wpab-ed__wcolor { width: 100%; height: 42px; background: var(--ed-surface-2); border: 1px solid var(--ed-border); border-radius: 10px; padding: 4px; cursor: pointer; }
			.wpab-ed__wprogress { margin-top: 6px; }
			.wpab-ed__steps { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
			.wpab-ed__step { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 10px; font-size: 13.5px; color: var(--ed-faint); transition: background .3s ease, color .3s ease; }
			.wpab-ed__step.is-active { background: var(--ed-accent-soft); color: var(--ed-text); }
			.wpab-ed__step.is-done { color: var(--ed-muted); }
			.wpab-ed__stepicon { position: relative; flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--ed-border-strong); box-sizing: border-box; transition: border-color .3s ease, background .3s ease; }
			.wpab-ed__step.is-active .wpab-ed__stepicon { border-color: rgba(20,19,18,.2); border-top-color: var(--ed-accent); border-right-color: var(--ed-accent); animation: wpab-ed-spin .7s linear infinite; }
			.wpab-ed__step.is-done .wpab-ed__stepicon { border-color: var(--ed-accent); background: var(--ed-accent); animation: none; }
			.wpab-ed__step.is-done .wpab-ed__stepicon::after { content: ""; position: absolute; left: 6px; top: 2px; width: 4px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
			.wpab-ed__steptext { flex: 1 1 auto; }
			.wpab-ed__stepmeta { flex: 0 0 auto; font-size: 11.5px; color: var(--ed-faint); font-variant-numeric: tabular-nums; }
			.wpab-ed__step.is-active .wpab-ed__stepmeta { color: var(--ed-accent); }
			@keyframes wpab-ed-spin { to { transform: rotate(360deg); } }
			.wpab-ed__wbar { height: 6px; background: rgba(20,18,16,.07); border-radius: 999px; overflow: hidden; }
			.wpab-ed__wbarfill { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--ed-accent), var(--ed-accent-2)); box-shadow: 0 0 12px rgba(99,102,241,.4); transition: width .5s cubic-bezier(.2,.75,.25,1); }
			.wpab-ed__wstep { margin-top: 8px; font-size: 12px; color: var(--ed-muted); }
			.wpab-ed__whead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 12px; }
			.wpab-ed__wdots { display: flex; gap: 6px; }
			.wpab-ed__wdots span { width: 8px; height: 8px; border-radius: 50%; background: var(--ed-border-strong); }
			.wpab-ed__wdots span.is-on { background: var(--ed-accent); }
			.wpab-ed__wdots span.is-done { background: var(--ed-accent-2); }
			.wpab-ed__chips { display: flex; flex-wrap: wrap; gap: 8px; }
			.wpab-ed__chip { background: var(--ed-surface-2); border: 1px solid var(--ed-border); color: var(--ed-muted); border-radius: 999px; padding: 8px 15px; font-size: 13px; cursor: pointer; }
			.wpab-ed__chip.is-on { background: var(--ed-accent); border-color: var(--ed-accent); color: #fff; }
			.wpab-ed__checks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin-bottom: 4px; }
			.wpab-ed__checks label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ed-text); cursor: pointer; }
			.wpab-ed__wcheck { display: flex; align-items: center; gap: 9px; margin-top: 16px; font-size: 13px; color: var(--ed-text); cursor: pointer; }
			.wpab-ed__review { font-size: 13px; color: var(--ed-muted); line-height: 1.7; background: var(--ed-surface-2); border: 1px solid var(--ed-border); border-radius: 10px; padding: 14px 16px; }
			.wpab-ed__review b { color: var(--ed-text); font-weight: 600; }
			.wpab-ed__wnav { display: flex; gap: 10px; }
			.wpab-ed__wtitle { margin: 0 0 6px; font-size: 20px; font-weight: 650; letter-spacing: -.01em; color: var(--ed-text); }
			.wpab-ed__whint { margin: 0 0 18px; font-size: 13px; color: var(--ed-muted); line-height: 1.55; }
			.wpab-ed__wlabel { display: block; font-size: 12px; color: var(--ed-muted); margin-bottom: 6px; }
			.wpab-ed__wstyles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }
			.wpab-ed__wstyle { text-align: left; background: rgba(255,255,255,.7); border: 1px solid rgba(20,18,16,.12); border-radius: 12px; padding: 10px 12px; cursor: pointer; transition: border-color .15s, background .15s; font: inherit; }
			.wpab-ed__wstyle b { display: block; font-size: 13px; color: #141312; }
			.wpab-ed__wstyle span { display: block; font-size: 11px; color: var(--ed-muted); margin-top: 2px; line-height: 1.35; }
			.wpab-ed__wstyle:hover { border-color: #141312; }
			.wpab-ed__wstyle.is-on { background: #141312; border-color: #141312; }
			.wpab-ed__wstyle.is-on b { color: #fff; }
			.wpab-ed__wstyle.is-on span { color: rgba(255,255,255,.65); }
			.wpab-ed__winput { width: 100%; box-sizing: border-box; background: var(--ed-surface); border: 1px solid var(--ed-border-strong); border-radius: 10px; color: var(--ed-text); font-size: 14px; padding: 11px 13px; }
			.wpab-ed__winput::placeholder { color: var(--ed-faint); }
			.wpab-ed__winput:focus { outline: none; border-color: var(--ed-accent); box-shadow: 0 0 0 3px var(--ed-accent-soft); }
			.wpab-ed__wprompt { resize: vertical; min-height: 150px; line-height: 1.55; }
			.wpab-ed__wopt { color: var(--ed-faint); font-weight: 400; }
			.wpab-ed__wresult { font-size: 13px; margin-top: 12px; min-height: 18px; color: var(--ed-muted); }
			.wpab-ed__wresult.is-err { color: #b42318; }
			.wpab-ed__wresult.is-ok { color: #067647; }
			.wpab-ed__wactions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
			.wpab-ed__wbtn { appearance: none; border: 0; border-radius: 10px; padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--ed-accent); color: #fff; box-shadow: 0 6px 18px rgba(99,102,241,.28); }
			.wpab-ed__wbtn:hover:not(:disabled) { background: #000; }
			.wpab-ed__wbtn:disabled { opacity: .55; cursor: default; }
			.wpab-ed__wbtn--ghost { background: transparent; border: 1px solid var(--ed-border-strong); color: var(--ed-muted); box-shadow: none; }
			.wpab-ed__wbtn--ghost:hover:not(:disabled) { background: var(--ed-surface-2); color: var(--ed-text); }
			.wpab-ed__preview { position: absolute; inset: 0; background: #f1f0ee; }
			.wpab-ed__frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
			.wpab-ed__chat { position: absolute; left: 25%; width: 50%; bottom: 14px; z-index: 15; display: flex; flex-direction: column; justify-content: flex-end; max-height: 70vh; background: transparent; border: 0; box-shadow: none; overflow: visible; pointer-events: none; transition: left .4s cubic-bezier(.2,.75,.25,1), width .4s cubic-bezier(.2,.75,.25,1), height .4s cubic-bezier(.2,.75,.25,1); }
			.wpab-ed__chat > * { pointer-events: auto; }
			.wpab-ed__chat.is-large { left: 7%; width: 86%; height: 87vh; max-height: 87vh; background: rgba(255,255,255,.94); border: 1px solid var(--ed-border); border-radius: var(--ed-radius); box-shadow: var(--ed-shadow-lg); -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3); overflow: hidden; justify-content: flex-start; }
			@media (max-width: 1100px) { .wpab-ed__chat { left: 6%; width: 88%; } }
			.wpab-ed__expand { background: none; border: 0; color: var(--ed-muted); font-size: 15px; cursor: pointer; line-height: 1; padding: 2px 7px; border-radius: 6px; }
			.wpab-ed__expand:hover { background: var(--ed-surface-2); color: var(--ed-text); }
			.wpab-ed__notice { margin: 12px; padding: 11px 13px; border-radius: 10px; background: #fdecec; border: 1px solid #f5c2c2; color: #b42318; font-size: 13px; }
			.wpab-ed__notice a { color: #b42318; }
			.wpab-ed__thread { flex: 0 1 auto; overflow-y: auto; max-height: 132px; padding: 20px 2px 12px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: none; border: 1px solid transparent; background: transparent; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 34px); mask-image: linear-gradient(to bottom, transparent 0, #000 34px); transition: max-height .3s cubic-bezier(.2,.75,.25,1), background .22s ease, padding .22s ease, box-shadow .22s ease; transition-delay: .26s; }
			.wpab-ed__thread::-webkit-scrollbar { display: none; }
			.wpab-ed__chat.is-large .wpab-ed__thread { flex: 1 1 auto; overflow-y: auto; max-height: none; justify-content: flex-start; padding: 14px; -webkit-mask-image: none; mask-image: none; scrollbar-width: thin; }
			.wpab-ed__chat.is-large .wpab-ed__thread::-webkit-scrollbar { display: block; width: 8px; }
			.wpab-ed__empty { display: none; }
			.wpab-ed__chat.is-large .wpab-ed__empty { display: block; color: var(--ed-faint); font-size: 13px; line-height: 1.6; margin: 0; }
			.wpab-msg { display: flex; flex-direction: column; gap: 2px; animation: wpabmsgin .85s cubic-bezier(.16,.7,.2,1); transition: opacity 1.4s ease, transform 1.4s ease; }
			@keyframes wpabmsgin { from { opacity: 0; transform: translateY(22px) scale(.985); filter: blur(2px); } to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); } }
			.wpab-msg__role { display: none; }
			.wpab-msg__body { font-size: 13.5px; line-height: 1.55; color: #33312d; word-wrap: break-word; max-width: 82%; padding: 9px 14px; border-radius: 16px; background: var(--ed-bubble); border: 1px solid rgba(20,18,16,.09); box-shadow: 0 10px 30px -14px rgba(20,19,18,.3); align-self: flex-start; border-bottom-left-radius: 5px; }
			.wpab-ed__chat.is-large .wpab-msg__body { background: var(--ed-bubble); border-color: rgba(20,18,16,.08); box-shadow: none; }
			.wpab-msg--user { align-items: flex-end; }
			.wpab-msg--user .wpab-msg__body { background: var(--ed-blue); border-color: var(--ed-blue); color: var(--ed-blue-ink); align-self: flex-end; border-bottom-left-radius: 16px; border-bottom-right-radius: 5px; }
			.wpab-ed__chat.is-large .wpab-msg--user .wpab-msg__body { background: var(--ed-blue); }
			.wpab-msg--user .wpab-msg__body a { color: #d8e1ff; }
			.wpab-msg--user .wpab-msg__body code { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.28); color: #fff; }
			.wpab-msg--assistant .wpab-typing { align-self: flex-start; background: var(--ed-bubble); border: 1px solid rgba(20,18,16,.09); border-radius: 16px; border-bottom-left-radius: 5px; padding: 9px 14px; font-size: 13px; box-shadow: 0 10px 30px -14px rgba(20,19,18,.3); }
			.wpab-msg__body code { background: var(--ed-surface-2); border: 1px solid var(--ed-border); padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
			.wpab-msg__body pre { background: var(--ed-surface-2); border: 1px solid var(--ed-border); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
			.wpab-msg__body a { color: var(--ed-accent); }
			.wpab-typing { color: var(--ed-muted); font-size: 13px; }
			.wpab-ed__form { position: relative; border: 1px solid var(--ed-border); border-radius: 16px; padding: 12px; flex: 0 0 auto; background: rgba(255,255,255,.82); box-shadow: var(--ed-shadow-lg); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
			.wpab-ed__chat.is-large .wpab-ed__form { border: 0; border-top: 1px solid var(--ed-border); border-radius: 0; box-shadow: none; background: rgba(250,249,247,.7); }
			.wpab-ed__input { width: 100%; box-sizing: border-box; resize: none; background: var(--ed-surface); border: 1px solid var(--ed-border-strong); border-radius: 10px; color: var(--ed-text); font: inherit; font-size: 14px; padding: 10px 12px; max-height: 160px; }
			.wpab-ed__input::placeholder { color: var(--ed-faint); }
			.wpab-ed__input:focus { outline: none; border-color: var(--ed-accent); box-shadow: 0 0 0 3px var(--ed-accent-soft); }
			.wpab-ed__formrow { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
			.wpab-ed__new { background: none; border: 0; color: var(--ed-muted); font-size: 12px; cursor: pointer; }
			.wpab-ed__new:hover { color: var(--ed-text); }
			.wpab-ed__send { appearance: none; border: 0; border-radius: 9px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--ed-blue); color: var(--ed-blue-ink); }
			.wpab-ed__send:hover:not(:disabled) { background: var(--ed-blue-2); }
			.wpab-ed__send:disabled { opacity: .55; cursor: default; }
			.wpab-ed__undo { margin-top: 8px; appearance: none; border: 1px solid var(--ed-border-strong); border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--ed-surface); color: var(--ed-text); }
			.wpab-ed__undo:hover:not(:disabled) { border-color: var(--ed-accent); color: var(--ed-accent); }
			.wpab-ed__undo:disabled { opacity: .55; cursor: default; }
			.wpab-ed__editdone { font-weight: 600; color: var(--ed-text); }
			.wpab-ed__editnote { margin-top: 7px; padding: 7px 10px; border-radius: 8px; background: #fdf3e7; border: 1px solid #f0dcc0; color: #8a5a1c; font-size: 12.5px; line-height: 1.5; }
			.wpab-ed__selrow[hidden] { display: none !important; }
			.wpab-ed__selrow { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; animation: wpabmsgin .5s ease; }
			.wpab-ed__seltag { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; background: rgba(20,19,18,.06); border: 1px solid rgba(20,19,18,.12); border-radius: 9px; padding: 5px 10px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #141312; }
			.wpab-ed__seltag .tgt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
			.wpab-ed__seltag .sec { color: var(--ed-faint); font-family: inherit; }
			.wpab-ed__seltag .x { border: 0; background: none; cursor: pointer; color: var(--ed-muted); font-size: 13px; line-height: 1; padding: 0 2px; }
			.wpab-ed__seltag .x:hover { color: #141312; }
			.wpab-ed__imgthumb { width: 26px; height: 26px; object-fit: cover; border-radius: 6px; display: block; }
			/* Markdown blocks. The AI writes lists and tables; before 1.28 the
			   chat showed a table as a wall of pipes. */
			.wpab-msg__body p { margin: 0 0 8px; }
			.wpab-msg__body p:last-child { margin-bottom: 0; }
			.wpab-msg__body h3, .wpab-msg__body h4, .wpab-msg__body h5, .wpab-msg__body h6 { font-size: 12.5px; font-weight: 600; letter-spacing: .02em; margin: 12px 0 5px; }
			.wpab-msg__body > :first-child { margin-top: 0; }
			.wpab-msg__body hr { border: 0; border-top: 1px solid rgba(20,18,16,.12); margin: 11px 0; }
			.wpab-md__list { margin: 6px 0 9px; padding-left: 19px; }
			.wpab-md__list li { margin-bottom: 3px; }
			.wpab-md__list li:last-child { margin-bottom: 0; }
			.wpab-md__tablewrap { overflow-x: auto; margin: 9px 0; border: 1px solid rgba(20,18,16,.13); border-radius: 9px; background: #fff; }
			.wpab-md__table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
			.wpab-md__table th, .wpab-md__table td { padding: 7px 11px; border-bottom: 1px solid rgba(20,18,16,.07); vertical-align: top; }
			.wpab-md__table thead th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--ed-muted); background: rgba(20,18,16,.035); white-space: nowrap; }
			.wpab-md__table tbody tr:last-child td { border-bottom: 0; }
			.wpab-md__table td { font-variant-numeric: tabular-nums; }
			/* A message carrying a table, a code block or the theme tree is not
			   prose and should not be squeezed into a prose measure. */
			.wpab-msg--wide .wpab-msg__body { max-width: 100%; width: 100%; }
			.wpab-ed__chat.has-wide:not(.is-large) { left: 14%; width: 72%; }
			@media (max-width: 1100px) { .wpab-ed__chat.has-wide:not(.is-large) { left: 6%; width: 88%; } }
			/* Hovering the dock reveals the whole thread. Collapsed it is a
			   glance over the page; hovered it is something to read, so it needs
			   a surface of its own to be legible over any design underneath. */
			.wpab-ed__chat:not(.is-large):hover .wpab-ed__thread,
			.wpab-ed__chat:not(.is-large):focus-within .wpab-ed__thread {
				max-height: 58vh; -webkit-mask-image: none; mask-image: none;
				background: rgba(255,255,255,.93); -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3);
				border-color: var(--ed-border); border-radius: var(--ed-radius); box-shadow: var(--ed-shadow-lg);
				padding: 14px 14px 12px; margin-bottom: 8px; scrollbar-width: thin;
				transition-delay: .12s;
			}
			.wpab-ed__chat:not(.is-large):hover .wpab-ed__thread::-webkit-scrollbar,
			.wpab-ed__chat:not(.is-large):focus-within .wpab-ed__thread::-webkit-scrollbar { display: block; width: 8px; }
			/* Full screen: one gesture in, three ways out. */
			.wpab-ed__chatback { position: absolute; inset: 0; z-index: 14; background: rgba(20,19,18,.3); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); opacity: 0; pointer-events: none; transition: opacity .32s ease; border: 0; padding: 0; cursor: default; }
			.wpab-ed__chatback.is-on { opacity: 1; pointer-events: auto; }
			.wpab-ed__chat.is-large .wpab-ed__thread > * { max-width: 980px; width: 100%; margin-left: auto; margin-right: auto; }
			/* Conversation memory: what the chat is carrying, visible rather than
			   implied. It clears when a new chat starts, because that is what
			   starting a new chat means. */
			.wpab-ed__mockedit { display: flex; gap: 8px; align-items: center; margin: 10px 0 0; }
			.wpab-ed__mockeditinput { flex: 1 1 auto; min-width: 0; padding: 9px 12px; font: inherit; font-size: 13px; border: 1px solid var(--ed-border); border-radius: 9px; background: #fff; color: var(--ed-text); }
			.wpab-ed__mockeditinput:focus { outline: 2px solid var(--ed-blue); outline-offset: 1px; }
			.wpab-ed__mockeditnote { margin: 7px 2px 0; font-size: 12.5px; line-height: 1.5; color: var(--ed-muted); min-height: 1em; }
			.wpab-ed__steps { margin-top: 8px; font-size: 11.5px; color: var(--ed-faint); }
			.wpab-ed__steps summary { cursor: pointer; letter-spacing: .04em; text-transform: uppercase; font-size: 10.5px; }
			.wpab-ed__steps ol { margin: 6px 0 0; padding-left: 18px; }
			.wpab-ed__steps li { margin-bottom: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-word; }
			.wpab-ed__memory { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 0 2px 7px; }
			.wpab-ed__memlead { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; color: var(--ed-faint); margin-right: 2px; }
			.wpab-ed__memchip { font-size: 11.5px; line-height: 1.3; padding: 3px 9px; border-radius: 999px; background: rgba(61,100,242,.09); border: 1px solid rgba(61,100,242,.22); color: #2f52d8; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.wpab-ed__chat.is-large .wpab-ed__memchip { max-width: 420px; }
			/* Changes: one recorded edit, its files and the lines that moved. */
			.wpab-change__top { display: flex; align-items: baseline; gap: 9px; padding: 9px 12px 5px; }
			.wpab-change__when { flex: 0 0 auto; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ed-faint); }
			.wpab-change__summary { font-size: 12.5px; color: var(--ed-text); }
			.wpab-change__restore { margin: 4px 12px 12px; }
			.wpab-tree__flag--new { color: #17795a; background: #e2f2ec; }
			.wpab-diff { margin: 0; border-top: 1px solid rgba(20,18,16,.07); background: #fbfaf8; }
			.wpab-diff__head { padding: 6px 12px; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ed-faint); }
			.wpab-diff__same { padding: 8px 12px; font-size: 12px; color: var(--ed-faint); }
			.wpab-diff__body { margin: 0; padding: 0 0 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.6; overflow-x: auto; white-space: pre; }
			.wpab-diff__line { display: block; padding: 0 12px; }
			.wpab-diff__line--out { background: #fbeae5; color: #8c3a24; }
			.wpab-diff__line--in { background: #e4f3ec; color: #146a4c; }
			/* Theme map: the file tree shown inside a chat message. */
			.wpab-tree { border: 1px solid rgba(20,19,18,.12); border-radius: 12px; background: #fff; overflow: hidden; margin-top: 2px; }
			.wpab-tree__head { display: flex; align-items: baseline; gap: 8px; padding: 9px 12px; border-bottom: 1px solid rgba(20,19,18,.08); background: rgba(250,249,247,.8); }
			.wpab-tree__name { font-weight: 600; font-size: 13px; }
			.wpab-tree__meta { font-size: 11.5px; color: var(--ed-faint); }
			.wpab-tree__group { border-bottom: 1px solid rgba(20,19,18,.06); }
			.wpab-tree__group:last-child { border-bottom: 0; }
			.wpab-tree__label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ed-faint); padding: 8px 12px 4px; }
			.wpab-tree__file { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 5px 12px 6px; cursor: pointer; font: inherit; }
			.wpab-tree__file:hover { background: rgba(20,19,18,.035); }
			.wpab-tree__file[aria-expanded="true"] { background: rgba(20,19,18,.05); }
			.wpab-tree__row { display: flex; align-items: baseline; gap: 8px; }
			.wpab-tree__path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #141312; }
			.wpab-tree__size { margin-left: auto; font-size: 11px; color: var(--ed-faint); flex: 0 0 auto; }
			.wpab-tree__flag { flex: 0 0 auto; order: 2; margin-left: 8px; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: #a8442b; background: #f8e9e4; border-radius: 3px; padding: 2px 6px; }
			.wpab-tree__row .wpab-tree__size { order: 3; margin-left: 8px; }
			.wpab-tree__role { font-size: 11.5px; color: var(--ed-faint); line-height: 1.45; margin-top: 1px; }
			.wpab-tree__src { margin: 0; padding: 10px 12px; background: #141312; color: #f2f0ec; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.55; max-height: 320px; overflow: auto; white-space: pre; }
			.wpab-tree__note { padding: 9px 12px; font-size: 12px; color: var(--ed-faint); }
			.wpab-ed__msgimg { max-width: 190px; max-height: 150px; border-radius: 12px; display: block; margin-bottom: 6px; align-self: flex-end; border: 1px solid rgba(20,19,18,.12); box-shadow: var(--ed-shadow); }
			.wpab-msg .wpab-ed__seltag { margin-bottom: 6px; background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.3); color: #fff; align-self: flex-end; }
			.wpab-msg .wpab-ed__seltag .sec { color: rgba(255,255,255,.65); }
			.wpab-ed__plansteps { margin: 8px 0 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.6; color: var(--ed-muted); }
			.wpab-ed__plansteps li { margin-bottom: 3px; }
			.wpab-ed__chips2 { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
			.wpab-ed__chipslead { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--ed-faint); margin-right: 2px; }
			.wpab-ed__filechip { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; background: var(--ed-accent-soft); border: 1px solid rgba(20,19,18,.14); color: var(--ed-accent); font-size: 11.5px; font-weight: 600; }			.wpab-ed__filechip--soft { opacity: .6; }
			.wpab-ed__editdone + .wpab-ed__chips2 + .wpab-ed__undo, .wpab-ed__chips2 + .wpab-ed__undo { margin-top: 10px; }
		.wpab-ed__preview { display: flex; flex-direction: column; }
		.wpab-ed__devbar { display: flex; justify-content: center; gap: 2px; padding: 0; background: transparent; }
		.wpab-ed__formtools { display: flex; align-items: center; gap: 10px; }
		.wpab-ed__histmenu[hidden] { display: none !important; }
		.wpab-ed__histmenu { position: absolute; bottom: calc(100% + 8px); left: 0; right: 0; max-height: 300px; overflow-y: auto; background: rgba(255,255,255,.94); border: 1px solid var(--ed-border); border-radius: 14px; box-shadow: var(--ed-shadow-lg); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); padding: 8px; z-index: 30; }
		.wpab-ed__histitem { display: flex; justify-content: space-between; gap: 10px; width: 100%; text-align: left; background: none; border: 0; border-radius: 9px; padding: 9px 11px; font-size: 13px; color: var(--ed-text); cursor: pointer; }
		.wpab-ed__histitem:hover { background: rgba(20,19,18,.05); }
		.wpab-ed__histitem .d { color: var(--ed-faint); font-size: 11.5px; white-space: nowrap; }
		.wpab-ed__dev { appearance: none; border: 1px solid transparent; background: transparent; color: var(--ed-muted); border-radius: 9px; width: 32px; height: 30px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s ease; }
		.wpab-ed__dev:hover { color: #141312; }
		.wpab-ed__dev.is-active { background: #141312; color: #fff; }
		.wpab-ed__inspect.is-on { background: #141312; color: #fff; box-shadow: 0 0 0 3px rgba(20,19,18,.15); }
		.wpab-ed__framewrap { flex: 1; display: flex; justify-content: center; overflow: auto; background: #f1f0ee; min-height: 0; position: relative; padding: 10px 12px; }
		.wpab-ed__frameload[hidden] { display: none !important; }
		.wpab-ed__frameload { position: absolute; inset: 10px 12px; z-index: 12; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(241,240,238,.66); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); border-radius: 8px; }
		.wpab-ed__spin { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(20,19,18,.15); border-top-color: #141312; animation: wpabspin .8s linear infinite; }
		@keyframes wpabspin { to { transform: rotate(360deg); } }
		.wpab-ed__frameloadtxt { font-size: 12.5px; color: #5c5955; font-weight: 500; }
		.wpab-ed__framewrap .wpab-ed__frame { width: 100%; height: 100%; border: 1px solid rgba(20,19,18,.07); border-radius: 8px; background: #fff; display: block; transition: width .25s ease; box-shadow: 0 1px 3px rgba(20,18,16,.05); }
		.wpab-ed__framewrap.is-laptop .wpab-ed__frame { width: 1280px; max-width: 100%; }
		.wpab-ed__framewrap.is-tablet .wpab-ed__frame { width: 834px; max-width: 100%; }
		.wpab-ed__framewrap.is-mobile .wpab-ed__frame { width: 390px; max-width: 100%; }
		.wpab-ed__wbtn { background: #141312 !important; box-shadow: none !important; border-radius: 10px; }
		.wpab-ed__wbtn:hover { background: #000 !important; }
		.wpab-ed__wbtn--ghost { background: transparent !important; color: #4b4945 !important; border: 1px solid rgba(20,19,18,.22) !important; }
		.wpab-ed__wbtn--ghost:hover { background: rgba(20,19,18,.05) !important; color: #141312 !important; }
		.wpab-ed__wizard.is-design .wpab-ed__wcard { max-width: min(1400px, 96vw); width: 100%; }
		.wpab-ed__mockmeta { margin-top: 10px; font-size: 12.5px; line-height: 1.55; color: var(--ed-muted); background: rgba(20,19,18,.04); border: 1px solid rgba(20,19,18,.07); border-radius: 12px; padding: 10px 14px; }
		.wpab-ed__mockmeta b { color: #141312; }
		.wpab-ed__wizard.is-design .wpab-ed__mockframe { height: 68vh; }
		.wpab-ed__mockwrap { margin-top: 14px; }
		.wpab-ed__mocktabs { display: flex; gap: 4px; margin-bottom: 8px; }
		.wpab-ed__mocktabs[hidden] { display: none !important; }
		.wpab-ed__mocktab { appearance: none; border: 1px solid rgba(20,19,18,.16); background: transparent; color: #5c5955; border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all .15s ease; }
		.wpab-ed__mocktab:hover { color: #141312; }
		.wpab-ed__mocktab.is-on { background: #141312; border-color: #141312; color: #fff; }
		.wpab-ed__mockframe { width: 100%; height: 440px; border: 1px solid rgba(20,18,16,0.1); border-radius: 12px; background: #fff; display: block; }
		/* The pages of the site down the left, the page itself on the right — so
		   the preview reads as a site with a shape rather than a strip of tabs. */
		.wpab-ed__mockstage { display: grid; grid-template-columns: 196px minmax(0, 1fr); gap: 12px; align-items: start; }
		.wpab-ed__mockrail { display: flex; flex-direction: column; gap: 2px; padding: 6px; border: 1px solid rgba(20,18,16,0.1); border-radius: 12px; background: rgba(20,19,18,.02); max-height: 68vh; overflow-y: auto; }
		.wpab-ed__mockrail[hidden] { display: none !important; }
		.wpab-ed__mockrail .wpab-ed__mocktab { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; border: 0; border-radius: 8px; padding: 7px 10px; background: transparent; }
		.wpab-ed__mockrail .wpab-ed__mocktab:hover { background: rgba(20,19,18,.06); color: #141312; }
		.wpab-ed__mockrail .wpab-ed__mocktab.is-on { background: #141312; color: #fff; }
		.wpab-ed__mocktabname { font-size: 13px; font-weight: 600; line-height: 1.3; }
		.wpab-ed__mocktabfile { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; opacity: .55; line-height: 1.3; }
		.wpab-ed__mocktab:focus-visible { outline: 2px solid #2f6fe4; outline-offset: 1px; }
		@media (max-width: 900px) {
			.wpab-ed__mockstage { grid-template-columns: 1fr; }
			.wpab-ed__mockrail { flex-direction: row; flex-wrap: wrap; max-height: none; }
			.wpab-ed__mockrail .wpab-ed__mocktab { width: auto; }
			.wpab-ed__mocktabfile { display: none; }
		}
		.wpab-ed__mockactions { display: flex; gap: 8px; margin-top: 10px; }
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
			/* ---- Markdown ---------------------------------------------------
			   Escape first, then build blocks: nothing below can produce an
			   element the text did not ask for, because by the time these rules
			   run every < and & is already an entity. Fenced code is pulled out
			   before anything else and put back at the end, so a table drawn
			   inside a code block stays a code block.

			   Lists, headings and tables are here because the AI writes them and
			   the chat used to show a table as a wall of pipes. ---- */
			function inlineMd(s) {
				return s
					.replace(/`([^`]+)`/g, '<code>$1</code>')
					.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
					// The content may not start or end with a space, or "2 * 3 * 4"
					// becomes italics. Written without a lookbehind on purpose: a
					// regex older Safari cannot parse would take the whole editor
					// script down with it, not just the emphasis.
					.replace(/(^|[\s(])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
					.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
			}
			function isTableRow(line) { return /^\s*\|.*\|\s*$/.test(line); }
			function isTableRule(line) { return /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(line); }
			function tableCells(line) {
				return line.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
			}
			function columnAligns(rule) {
				return tableCells(rule).map(function (c) {
					if (/^:.*:$/.test(c)) { return 'center'; }
					if (/:$/.test(c)) { return 'right'; }
					return 'left';
				});
			}
			// U+E000/U+E001 are private-use characters: escapeHtml cannot produce
			// one and no answer contains one, so they are safe placeholder
			// markers. Built from their code points rather than written
			// literally — a literal invisible character in a source file is the
			// kind of thing an editor or a copy-paste quietly eats.
			var MD_OPEN = String.fromCharCode(57344);
			var MD_CLOSE = String.fromCharCode(57345);
			var MD_FENCE_ONLY = new RegExp('^' + MD_OPEN + '(\\d+)' + MD_CLOSE + '$');
			var MD_FENCE_REF = new RegExp(MD_OPEN + '(\\d+)' + MD_CLOSE, 'g');
			function renderMarkdown(s) {
				var text = escapeHtml(s);

				// Fenced code is lifted out before any other rule sees it, so a
				// table or a list drawn inside a code block stays code. The
				// placeholder uses private-use characters: escapeHtml cannot
				// produce them and no answer contains them.
				var fences = [];
				text = text.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, function (m, code) {
					fences.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
					return MD_OPEN + (fences.length - 1) + MD_CLOSE;
				});

				var lines = text.split('\n');
				var out = [];
				var para = [];
				var i = 0;

				function flushParagraph() {
					if (!para.length) { return; }
					out.push('<p>' + inlineMd(para.join('<br>')) + '</p>');
					para.length = 0;
				}

				while (i < lines.length) {
					var line = lines[i];

					if (MD_FENCE_ONLY.test(line.trim())) {
						flushParagraph();
						out.push(line.trim());
						i++;
						continue;
					}

					if (!line.trim()) { flushParagraph(); i++; continue; }

					var heading = line.match(/^(#{1,4})\s+(.*)$/);
					if (heading) {
						flushParagraph();
						var level = Math.min(heading[1].length + 2, 6);
						out.push('<h' + level + '>' + inlineMd(heading[2].trim()) + '</h' + level + '>');
						i++;
						continue;
					}

					if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
						flushParagraph();
						out.push('<hr>');
						i++;
						continue;
					}

					// A table is a row followed by a |---|---| rule. Without the
					// rule it is just a sentence containing pipes.
					if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
						flushParagraph();
						var align = columnAligns(lines[i + 1]);
						var head = tableCells(line).map(function (c, n) {
							return '<th style="text-align:' + (align[n] || 'left') + '">' + inlineMd(c) + '</th>';
						}).join('');
						var rows = [];
						i += 2;
						while (i < lines.length && isTableRow(lines[i])) {
							rows.push('<tr>' + tableCells(lines[i]).map(function (c, n) {
								return '<td style="text-align:' + (align[n] || 'left') + '">' + inlineMd(c) + '</td>';
							}).join('') + '</tr>');
							i++;
						}
						out.push('<div class="wpab-md__tablewrap"><table class="wpab-md__table"><thead><tr>'
							+ head + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>');
						continue;
					}

					var bullet = line.match(/^\s*[-*+]\s+(.*)$/);
					var numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
					if (bullet || numbered) {
						flushParagraph();
						var ordered = !!numbered;
						var pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
						var items = [];
						while (i < lines.length) {
							var item = lines[i].match(pattern);
							if (!item) { break; }
							items.push('<li>' + inlineMd(item[1].trim()) + '</li>');
							i++;
						}
						var tag = ordered ? 'ol' : 'ul';
						out.push('<' + tag + ' class="wpab-md__list">' + items.join('') + '</' + tag + '>');
						continue;
					}

					para.push(line);
					i++;
				}

				flushParagraph();

				return out.join('').replace(MD_FENCE_REF, function (m, n) {
					return fences[Number(n)] || '';
				});
			}
			function api(method, url, body) {
				return fetch(url, {
					method: method,
					headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' },
					credentials: 'same-origin',
					body: body ? JSON.stringify(body) : undefined
				}).then(function (r) {
					return r.text().then(function (t) {
						var j = null;
						try { j = t ? JSON.parse(t) : null; } catch (pe) { j = null; }
						return { ok: r.ok, status: r.status, data: j };
					});
				});
			}
			function addMessage(role, body, sel, img) {
				var empty = thread.querySelector('.wpab-ed__empty');
				if (empty) { empty.remove(); }
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--' + role;
				var html = role === 'assistant' ? renderMarkdown(body) : escapeHtml(body);
				// innerHTML first, decorations prepended after \u2014 appending the chip
				// before this assignment used to wipe it.
				wrap.innerHTML = '<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="wpab-msg__body">' + html + '</div>';
				if (img) {
					var pic = document.createElement('img');
					pic.className = 'wpab-ed__msgimg';
					pic.src = img; pic.alt = '';
					wrap.insertBefore(pic, wrap.firstChild);
				}
				if (sel) {
					var chip = document.createElement('span');
					chip.className = 'wpab-ed__seltag';
					chip.innerHTML = '<span class="tgt"></span><span class="sec"></span>';
					chip.firstChild.textContent = '\u2316 ' + sel.short;
					chip.lastChild.textContent = sel.sec ? '\u00b7 ' + sel.sec : '';
					wrap.insertBefore(chip, wrap.firstChild);
				}
				markWide(wrap);
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
				return wrap;
			}
			/* ---- Theme map -------------------------------------------------
			   The same grouped structure the AI is given, rendered as a tree the
			   user can browse. Two ways in: the folder button (instant, local,
			   free) and any chat answer where the AI called theme_structure, so
			   asking "what's in my theme?" shows the map instead of a paragraph
			   describing it. Clicking a file reads it from this site's own disk;
			   nothing here goes to the SaaS. ---- */
			function humanBytes(n) {
				n = Number(n) || 0;
				if (n < 1024) { return n + ' B'; }
				if (n < 1024 * 1024) { return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; }
				return (n / 1048576).toFixed(1) + ' MB';
			}
			function buildTree(st) {
				var card = document.createElement('div');
				card.className = 'wpab-tree';

				var head = document.createElement('div');
				head.className = 'wpab-tree__head';
				var name = document.createElement('span');
				name.className = 'wpab-tree__name';
				name.textContent = st.theme || 'Active theme';
				var meta = document.createElement('span');
				meta.className = 'wpab-tree__meta';
				meta.textContent = (st.count || 0) + ' files \u00b7 ' + humanBytes(st.bytes);
				head.appendChild(name); head.appendChild(meta);
				card.appendChild(head);

				var groups = Array.isArray(st.groups) ? st.groups : [];
				if (!groups.length) {
					var note = document.createElement('div');
					note.className = 'wpab-tree__note';
					note.textContent = 'No readable theme files were found.';
					card.appendChild(note);
					return card;
				}

				groups.forEach(function (g) {
					var sec = document.createElement('div');
					sec.className = 'wpab-tree__group';
					var label = document.createElement('div');
					label.className = 'wpab-tree__label';
					label.textContent = g.label || g.key || 'Files';
					sec.appendChild(label);

					(g.files || []).forEach(function (f) {
						var btn = document.createElement('button');
						btn.type = 'button';
						btn.className = 'wpab-tree__file';
						btn.setAttribute('aria-expanded', 'false');

						var row = document.createElement('div');
						row.className = 'wpab-tree__row';
						var path = document.createElement('span');
						path.className = 'wpab-tree__path';
						path.textContent = f.path;
						var size = document.createElement('span');
						size.className = 'wpab-tree__size';
						size.textContent = humanBytes(f.bytes);
						row.appendChild(path); row.appendChild(size);
						btn.appendChild(row);

						if (f.drifted) {
							// Somebody changed this file outside Meikero. Worth
							// saying before the AI is asked to rewrite it.
							var flag = document.createElement('span');
							flag.className = 'wpab-tree__flag';
							flag.textContent = 'edited outside Meikero';
							row.appendChild(flag);
						}

						if (f.role) {
							var role = document.createElement('div');
							role.className = 'wpab-tree__role';
							role.textContent = f.role;
							btn.appendChild(role);
						}

						var src = null;
						btn.addEventListener('click', function () {
							if (src) {
								var open = src.hidden;
								src.hidden = !open;
								btn.setAttribute('aria-expanded', open ? 'true' : 'false');
								return;
							}
							src = document.createElement('pre');
							src.className = 'wpab-tree__src';
							src.textContent = 'Reading\u2026';
							btn.parentNode.insertBefore(src, btn.nextSibling);
							btn.setAttribute('aria-expanded', 'true');
							api('POST', cfg.restThemeFile, { path: f.path }).then(function (out) {
								if (!out.ok || !out.data || typeof out.data.content !== 'string') {
									src.textContent = (out.data && (out.data.message || out.data.error)) || 'That file could not be read.';
									return;
								}
								src.textContent = out.data.content;
							}).catch(function () { src.textContent = 'Could not read that file.'; });
						});

						sec.appendChild(btn);
					});

					card.appendChild(sec);
				});

				return card;
			}
			function addStructure(st) {
				if (!st || !Array.isArray(st.groups)) { return null; }
				var empty = thread.querySelector('.wpab-ed__empty');
				if (empty) { empty.remove(); }
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div>';
				var body = document.createElement('div');
				body.className = 'wpab-msg__body';
				body.appendChild(buildTree(st));
				wrap.appendChild(body);
				markWide(wrap);
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
				return wrap;
			}
			/* ---- Changes ------------------------------------------------------
			   What the AI changed, what you changed, and how to put any of it
			   back. Everything here reads this site's own disk — no request
			   leaves WordPress, so it works whether or not Meikero can be
			   reached. ---- */
			function whenText(iso) {
				var t = Date.parse(iso || '');
				if (!t) { return ''; }
				var mins = Math.round((Date.now() - t) / 60000);
				if (mins < 1) { return 'just now'; }
				if (mins < 60) { return mins + ' min ago'; }
				var hours = Math.round(mins / 60);
				if (hours < 24) { return hours + (hours === 1 ? ' hour ago' : ' hours ago'); }
				return new Date(t).toLocaleDateString();
			}
			/* A line diff that trims what both sides share and shows the middle.
			   Not Myers: for the targeted edits this tool makes, the changed
			   region is one contiguous block, and pretending otherwise would be
			   more code for a worse answer. */
			function lineDiff(before, after) {
				var a = String(before == null ? '' : before).split('\n');
				var b = String(after == null ? '' : after).split('\n');
				var start = 0;
				while (start < a.length && start < b.length && a[start] === b[start]) { start++; }
				var endA = a.length, endB = b.length;
				while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
				return { start: start, removed: a.slice(start, endA), added: b.slice(start, endB) };
			}
			function diffBlock(before, after) {
				var wrap = document.createElement('div');
				wrap.className = 'wpab-diff';
				var d = lineDiff(before, after);
				if (!d.removed.length && !d.added.length) {
					var same = document.createElement('div');
					same.className = 'wpab-diff__same';
					same.textContent = 'This file is unchanged since that edit.';
					wrap.appendChild(same);
					return wrap;
				}
				var head = document.createElement('div');
				head.className = 'wpab-diff__head';
				head.textContent = 'line ' + (d.start + 1)
					+ ' · ' + d.removed.length + ' removed, ' + d.added.length + ' added';
				wrap.appendChild(head);
				var pre = document.createElement('pre');
				pre.className = 'wpab-diff__body';
				d.removed.forEach(function (line) {
					var row = document.createElement('span');
					row.className = 'wpab-diff__line wpab-diff__line--out';
					row.textContent = '- ' + line + '\n';
					pre.appendChild(row);
				});
				d.added.forEach(function (line) {
					var row = document.createElement('span');
					row.className = 'wpab-diff__line wpab-diff__line--in';
					row.textContent = '+ ' + line + '\n';
					pre.appendChild(row);
				});
				wrap.appendChild(pre);
				return wrap;
			}
			function buildChanges(entries) {
				var card = document.createElement('div');
				card.className = 'wpab-tree';

				var head = document.createElement('div');
				head.className = 'wpab-tree__head';
				var name = document.createElement('span');
				name.className = 'wpab-tree__name';
				name.textContent = 'Changes';
				var meta = document.createElement('span');
				meta.className = 'wpab-tree__meta';
				meta.textContent = entries.length ? entries.length + ' recorded' : '';
				head.appendChild(name); head.appendChild(meta);
				card.appendChild(head);

				if (!entries.length) {
					var none = document.createElement('div');
					none.className = 'wpab-tree__note';
					none.textContent = 'Nothing has been changed in this theme yet.';
					card.appendChild(none);
					return card;
				}

				entries.forEach(function (entry) {
					var sec = document.createElement('div');
					sec.className = 'wpab-tree__group';

					var top = document.createElement('div');
					top.className = 'wpab-change__top';
					var when = document.createElement('span');
					when.className = 'wpab-change__when';
					when.textContent = whenText(entry.at);
					var sum = document.createElement('span');
					sum.className = 'wpab-change__summary';
					sum.textContent = entry.summary || 'Theme edit';
					top.appendChild(when); top.appendChild(sum);
					sec.appendChild(top);

					(entry.files || []).forEach(function (f) {
						var btn = document.createElement('button');
						btn.type = 'button';
						btn.className = 'wpab-tree__file';
						btn.setAttribute('aria-expanded', 'false');
						var row = document.createElement('div');
						row.className = 'wpab-tree__row';
						var path = document.createElement('span');
						path.className = 'wpab-tree__path';
						path.textContent = f.path;
						row.appendChild(path);
						if (f.created) {
							var tag = document.createElement('span');
							tag.className = 'wpab-tree__flag wpab-tree__flag--new';
							tag.textContent = 'new file';
							row.appendChild(tag);
						}
						btn.appendChild(row);

						var panel = null;
						btn.addEventListener('click', function () {
							if (panel) {
								panel.hidden = !panel.hidden;
								btn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
								return;
							}
							panel = document.createElement('div');
							panel.className = 'wpab-diff';
							panel.textContent = 'Reading…';
							btn.parentNode.insertBefore(panel, btn.nextSibling);
							btn.setAttribute('aria-expanded', 'true');
							api('POST', cfg.restHistoryFile, { id: entry.id, path: f.path }).then(function (out) {
								if (!out.ok || !out.data) {
									panel.textContent = (out.data && (out.data.message || out.data.error)) || 'That change could not be read.';
									return;
								}
								var block = diffBlock(out.data.before, out.data.after);
								panel.replaceWith(block);
								panel = block;
							}).catch(function () { panel.textContent = 'That change could not be read.'; });
						});

						sec.appendChild(btn);
					});

					var restore = document.createElement('button');
					restore.type = 'button';
					restore.className = 'wpab-ed__undo wpab-change__restore';
					restore.textContent = 'Restore what this changed';
					restore.addEventListener('click', function () {
						restore.disabled = true;
						restore.textContent = 'Restoring…';
						api('POST', cfg.restRestore, { id: entry.id }).then(function (out) {
							if (!out.ok || !out.data || out.data.success === false) {
								restore.disabled = false;
								restore.textContent = (out.data && (out.data.message || out.data.error)) || 'Could not restore';
								return;
							}
							restore.textContent = 'Restored';
							// Putting something back is itself a change, so the
							// list is stale the moment it succeeds.
							loadChanges();
							reloadPreview();
						}).catch(function () {
							restore.disabled = false;
							restore.textContent = 'Could not restore';
						});
					});
					sec.appendChild(restore);

					card.appendChild(sec);
				});

				return card;
			}
			function loadChanges() {
				if (!cfg.restHistory) { return; }
				api('GET', cfg.restHistory, null).then(function (out) {
					if (!out.ok || !out.data || !Array.isArray(out.data.entries)) {
						addMessage('assistant', 'Could not read the change history.');
						return;
					}
					var empty = thread.querySelector('.wpab-ed__empty');
					if (empty) { empty.remove(); }
					var wrap = document.createElement('div');
					wrap.className = 'wpab-msg wpab-msg--assistant';
					wrap.innerHTML = '<div class="wpab-msg__role">AI</div>';
					var body = document.createElement('div');
					body.className = 'wpab-msg__body';
					body.appendChild(buildChanges(out.data.entries));
					wrap.appendChild(body);
					markWide(wrap);
					thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
				}).catch(function () {
					addMessage('assistant', 'Could not read the change history.');
				});
			}
			var changesBtn = $('wpab-ed-changes');
			if (changesBtn) {
				changesBtn.addEventListener('click', function () {
					changesBtn.disabled = true;
					loadChanges();
					window.setTimeout(function () { changesBtn.disabled = false; }, 400);
				});
			}

			var structureBtn = $('wpab-ed-structure');
			if (structureBtn) {
				structureBtn.addEventListener('click', function () {
					if (!cfg.restStructure) { return; }
					structureBtn.disabled = true;
					api('GET', cfg.restStructure, null).then(function (out) {
						if (!out.ok || !out.data || !out.data.structure) {
							addMessage('assistant', 'Could not read the theme structure.');
							return;
						}
						addStructure(out.data.structure);
					}).catch(function () {
						addMessage('assistant', 'Could not read the theme structure.');
					}).then(function () { structureBtn.disabled = false; });
				});
			}

			/* ---- Wide answers ------------------------------------------------
			   A table, a code block or the theme tree is not prose and should not
			   be folded into a prose measure. When one appears the bubble drops
			   its 82% cap and the dock widens; paragraphs keep their measure,
			   because a paragraph at full width is harder to read, not easier. */
			function markWide(wrap) {
				if (!wrap || !wrap.querySelector('.wpab-md__tablewrap, pre, .wpab-tree')) { return; }
				wrap.classList.add('wpab-msg--wide');
				if (chatPanel) { chatPanel.classList.add('has-wide'); }
			}
			function clearWide() {
				if (chatPanel) { chatPanel.classList.remove('has-wide'); }
			}

			/* ---- Full screen -------------------------------------------------
			   One gesture in, three ways out: the toggle, the backdrop and Esc.
			   The choice is remembered, because someone who works full screen
			   works full screen. */
			var chatBack = $('wpab-ed-chatback');
			var CHAT_LARGE_KEY = 'wpabEditorChatLarge';
			function setChatLarge(large) {
				if (!chatPanel) { return; }
				chatPanel.classList.toggle('is-large', large);
				if (chatBack) { chatBack.classList.toggle('is-on', large); }
				var btn = $('wpab-ed-expand');
				if (btn) {
					btn.textContent = large ? '⤡' : '⤢';
					btn.setAttribute('aria-expanded', large ? 'true' : 'false');
					btn.title = large ? 'Shrink the chat back to the dock' : 'Expand the chat to full screen';
				}
				try { window.localStorage.setItem(CHAT_LARGE_KEY, large ? '1' : '0'); } catch (e) { /* private mode */ }
				thread.scrollTop = thread.scrollHeight;
			}

			/* ---- What the AI actually did ------------------------------------
			   The answer says what it concluded; this says what it looked at to get
			   there. Without it a wrong answer is impossible to argue with, because
			   you cannot tell whether it read the file or guessed. Folded away by
			   default — it is evidence, not conversation. */
			var TOOL_LABEL = {
				theme_structure: 'mapped the theme',
				list_project_files: 'listed the theme files',
				read_project_files: 'read',
				list_content_types: 'looked at your content types',
				list_content: 'listed',
				get_content: 'opened',
				edit_theme: 'queued a theme edit'
			};
			function addActivity(wrap, activity) {
				if (!wrap || !Array.isArray(activity) || !activity.length) { return; }
				var body = wrap.querySelector('.wpab-msg__body');
				if (!body) { return; }
				var steps = [];
				activity.forEach(function (a) {
					if (!a || !a.tool) { return; }
					var label = TOOL_LABEL[a.tool] || a.tool;
					if (a.paths && a.paths.length) { label += ' ' + a.paths.join(', '); }
					else if (a.scope && a.tool !== 'theme_structure' && a.tool !== 'list_project_files') { label += ' ' + a.scope; }
					steps.push(label);
				});
				if (!steps.length) { return; }
				var det = document.createElement('details');
				det.className = 'wpab-ed__steps';
				var sum = document.createElement('summary');
				sum.textContent = steps.length + (steps.length === 1 ? ' step' : ' steps');
				det.appendChild(sum);
				var ol = document.createElement('ol');
				steps.forEach(function (t) {
					var li = document.createElement('li');
					li.textContent = t;
					ol.appendChild(li);
				});
				det.appendChild(ol);
				body.appendChild(det);
			}

			/* ---- Conversation memory ----------------------------------------
			   The chat replays recent messages, which stops working the moment a
			   conversation outgrows the window. The SaaS keeps a short list of what
			   this conversation established and sends it back with every answer;
			   showing it means the AI's memory is never a thing you have to guess
			   at. Full text on hover, because a chip is a reminder, not a record. */
			var memoryRow = $('wpab-ed-memory');
			function renderMemory(items) {
				if (!memoryRow) { return; }
				var list = Array.isArray(items) ? items : [];
				memoryRow.innerHTML = '';
				if (!list.length) { memoryRow.hidden = true; return; }
				var lead = document.createElement('span');
				lead.className = 'wpab-ed__memlead';
				lead.textContent = 'Remembering';
				memoryRow.appendChild(lead);
				list.forEach(function (item) {
					if (!item) { return; }
					var chip = document.createElement('span');
					chip.className = 'wpab-ed__memchip';
					chip.textContent = item;
					chip.title = item;
					memoryRow.appendChild(chip);
				});
				memoryRow.hidden = false;
			}

			function addTyping() {
				var wrap = document.createElement('div'); wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div><div class="wpab-typing">Thinking…</div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function setBusy(b) { if (sendBtn) { sendBtn.disabled = b; } }

			var frameLoad = $('wpab-ed-frameload');
			var frameLoadTxt = $('wpab-ed-frameload-txt');
			var frameBusySafety = null;
			function frameBusy(on, txt) {
				if (!frameLoad) { return; }
				if (frameBusySafety) { clearTimeout(frameBusySafety); frameBusySafety = null; }
				if (on) {
					if (frameLoadTxt) { frameLoadTxt.textContent = txt || 'Working\u2026'; }
					frameLoad.hidden = false;
					// Never allow a stuck overlay: force-hide after 30s no matter what.
					frameBusySafety = setTimeout(function () { frameLoad.hidden = true; }, 30000);
				} else {
					frameLoad.hidden = true;
				}
			}
			// Any successful iframe load always clears the overlay.
			(function () {
				var fr0 = $('wpab-ed-frame');
				if (fr0) { fr0.addEventListener('load', function () { frameBusy(false); }); }
			})();
			function reloadPreview() {
				var fr = $('wpab-ed-frame');
				if (!fr) { frameBusy(false); return; }
				frameBusy(true, 'Refreshing the preview\u2026');
				setTimeout(function () { frameBusy(false); }, 8000);
				try { fr.contentWindow.location.reload(); } catch (e) { fr.src = fr.src; }
			}
			function addUndoMessage(summary, files, inspected, notes) {
				var wrap = addMessage('assistant', '');
				var mbody = wrap.querySelector('.wpab-msg__body');
				if (!mbody) { return; }
				var head = document.createElement('div');
				head.className = 'wpab-ed__editdone';
				head.textContent = '✓ ' + (summary || 'Theme updated.');
				mbody.appendChild(head);
				// Anything the edit could not do, or that the check afterwards
				// spotted. Shown with the Undo button rather than left for the
				// user to find on the page.
				(notes || []).forEach(function (note) {
					if (!note) { return; }
					var warn = document.createElement('div');
					warn.className = 'wpab-ed__editnote';
					warn.textContent = note;
					mbody.appendChild(warn);
				});
				if (files && files.length) {
					var chips = document.createElement('div');
					chips.className = 'wpab-ed__chips2';
					var lead = document.createElement('span');
					lead.className = 'wpab-ed__chipslead'; lead.textContent = 'Edited';
					chips.appendChild(lead);
					var seen = {};
					for (var i = 0; i < files.length; i++) {
						var p = files[i];
						if (!p || seen[p]) { continue; }
						seen[p] = 1;
						var c = document.createElement('span');
						c.className = 'wpab-ed__filechip';
						c.textContent = friendlyName(p);
						c.title = p;
						chips.appendChild(c);
					}
					mbody.appendChild(chips);
				}
				if (inspected && inspected.length) {
					var ichips = document.createElement('div');
					ichips.className = 'wpab-ed__chips2';
					var ilead = document.createElement('span');
					ilead.className = 'wpab-ed__chipslead'; ilead.textContent = 'Inspected';
					ichips.appendChild(ilead);
					var iseen = {};
					for (var ii = 0; ii < inspected.length; ii++) {
						var ip = inspected[ii];
						if (!ip || iseen[ip]) { continue; }
						iseen[ip] = 1;
						var ic = document.createElement('span');
						ic.className = 'wpab-ed__filechip wpab-ed__filechip--soft';
						ic.textContent = friendlyName(ip);
						ic.title = ip;
						ichips.appendChild(ic);
					}
					mbody.appendChild(ichips);
				}
				if (cfg.restUndoEdit) {
					var b = document.createElement('button');
					b.type = 'button'; b.className = 'wpab-ed__undo'; b.textContent = 'Undo';
					b.addEventListener('click', function () {
						b.disabled = true; b.textContent = 'Undoing…';
						api('POST', cfg.restUndoEdit, {}).then(function (u) {
							if (u.ok && u.data && u.data.success) { b.textContent = 'Undone'; reloadPreview(); }
							else { b.disabled = false; b.textContent = (u.data && (u.data.message || u.data.error)) || 'Undo failed'; }
						}).catch(function () { b.disabled = false; b.textContent = 'Undo failed'; });
					});
					mbody.appendChild(b);
				}
			}
			function addPlanMessage(plan) {
				var wrap = addMessage('assistant', '');
				var mbody = wrap.querySelector('.wpab-msg__body');
				if (!mbody) { return; }
				var head = document.createElement('div');
				head.className = 'wpab-ed__editdone';
				head.textContent = 'Plan' + (plan.summary ? ': ' + plan.summary : '');
				mbody.appendChild(head);
				var ol = document.createElement('ol');
				ol.className = 'wpab-ed__plansteps';
				for (var pi = 0; pi < plan.steps.length; pi++) {
					var li = document.createElement('li');
					var st = plan.steps[pi];
					li.textContent = st.title + (st.detail ? ' — ' + st.detail : '');
					ol.appendChild(li);
				}
				mbody.appendChild(ol);
			}
			function runEdit(instruction, opts) {
				var typing = addTyping();
				var t = typing.querySelector('.wpab-typing');
				if (t) { t.textContent = 'Planning the change…'; }
				frameBusy(true, 'Planning the change…');
				// Micro-edits (one exact replacement) skip the planning stage — the
				// instruction already IS the whole plan.
				var planPromise = (cfg.restEditPlan && !(opts && opts.skipPlan))
					? api('POST', cfg.restEditPlan, { instruction: instruction, selected: lastSelFull || '' }).then(function (pOut) {
						return (pOut.ok && pOut.data && pOut.data.success && pOut.data.plan) ? pOut.data.plan : null;
					}).catch(function () { return null; })
					: Promise.resolve(null);
				return planPromise.then(function (plan) {
					if (plan && plan.steps && plan.steps.length) { addPlanMessage(plan); }
					var phases = (plan && plan.steps && plan.steps.length)
						? plan.steps.map(function (st, i) { return 'Step ' + (i + 1) + '/' + plan.steps.length + ' — ' + st.title + '…'; })
						: ['Reading the theme files…', 'Understanding the change…', 'Writing the update…', 'Almost there…'];
					var phase = 0;
					if (t) { t.textContent = phases[0]; }
					frameBusy(true, phases[0]);
					var ticker = setInterval(function () {
						phase = Math.min(phase + 1, phases.length - 1);
						if (t) { t.textContent = phases[phase]; }
						frameBusy(true, phases[phase]);
					}, 9000);
					var payload = { instruction: instruction, selected: lastSelFull || '' };
					if (plan && plan.steps) { payload.plan = plan.steps; }
					function finishOk(data) {
						clearInterval(ticker);
						typing.remove();
						addUndoMessage(data.summary, data.files, data.inspected, data.notes);
						reloadPreview();
					}
					function finishErr(msg) {
						clearInterval(ticker);
						frameBusy(false);
						typing.remove();
						addMessage('assistant', msg || 'Could not apply the change.');
					}
					function runSync() {
						return api('POST', cfg.restEditTheme, payload).then(function (out) {
							if (!out.ok || !out.data || out.data.success === false) { finishErr(out.data && (out.data.message || out.data.error)); return; }
							finishOk(out.data);
						}).catch(function () { finishErr('Network error applying the change.'); });
					}
					// Async path: start a job, poll it, apply the files locally — no
					// request stays open long enough for a hosting proxy to kill it.
					if (!cfg.restEditStart || !cfg.restBuildJob || !cfg.restEditApply) { return runSync(); }
					var editStarted = Date.now();
					return api('POST', cfg.restEditStart, payload).then(function (sOut) {
						if (sOut.status === 404) { return runSync(); }
						var jobId = sOut.ok && sOut.data && sOut.data.jobId;
						if (!jobId) { finishErr((sOut.data && (sOut.data.message || sOut.data.error)) || 'Could not start the edit.'); return; }
						function pollEdit() {
							if (Date.now() - editStarted > 480000) { finishErr('The edit timed out. Try again.'); return; }
							return new Promise(function (res) { setTimeout(res, 3000); }).then(function () {
								return api('POST', cfg.restBuildJob, { jobId: jobId });
							}).then(function (jOut) {
								var d = (jOut && jOut.data) || {};
								if (d.status === 'done' && d.result) {
									var r = d.result;
									if (t) { t.textContent = 'Applying the change\u2026'; }
									frameBusy(true, 'Applying the change\u2026');
									return api('POST', cfg.restEditApply, { files: r.files || [], summary: r.summary || '', inspected: r.inspected || [] }).then(function (aOut) {
										if (!aOut.ok || !aOut.data || aOut.data.success === false) { finishErr((aOut.data && (aOut.data.message || aOut.data.error)) || 'Could not apply the change.'); return; }
										// The apply response knows what was written; the job
										// result knows what the check found and what an anchor
										// could not do. The user needs both.
										var merged = {};
										for (var k in aOut.data) { if (Object.prototype.hasOwnProperty.call(aOut.data, k)) { merged[k] = aOut.data[k]; } }
										merged.notes = (r.notes || []).concat(r.review ? [r.review] : []);
										finishOk(merged);
									});
								}
								if (d.status === 'error') { finishErr(d.error || 'The edit failed.'); return; }
								if (!jOut.ok) { finishErr('The edit failed.'); return; }
								var prog = d.result && d.result.progress;
								if (prog && prog.note) {
									if (t) { t.textContent = prog.note; }
									frameBusy(true, prog.note);
								}
								return pollEdit();
							});
						}
						return pollEdit();
					}).catch(function () { finishErr('Network error applying the change.'); });
				});
			}

			/* One chat turn, taken the safest way this site allows.
			   The job path is tried first: it hands back an id in a second or
			   two and nothing stays open, so a host that cuts long requests has
			   nothing to cut. Anything unexpected — an older SaaS with no such
			   route, a missing job id — falls straight back to the inline call
			   that has always worked. */
			function chatRequest(body) {
				if (!cfg.restChatStart || !cfg.restBuildJob) {
					return api('POST', cfg.restChat, body);
				}
				return api('POST', cfg.restChatStart, body).then(function (sOut) {
					var jobId = sOut.ok && sOut.data && sOut.data.jobId;
					if (!jobId) { return api('POST', cfg.restChat, body); }
					var startedAt = Date.now();
					function poll() {
						if (Date.now() - startedAt > 330000) {
							return { ok: false, status: 504, data: { error: 'The answer took too long. Try a narrower question.' } };
						}
						return new Promise(function (res) { setTimeout(res, 2500); }).then(function () {
							return api('POST', cfg.restBuildJob, { jobId: jobId });
						}).then(function (jOut) {
							var d = (jOut && jOut.data) || {};
							if (d.status === 'done' && d.result) { return { ok: true, status: 200, data: d.result }; }
							if (d.status === 'error') { return { ok: false, status: 502, data: { error: d.error || 'The answer failed.' } }; }
							if (!jOut.ok && jOut.status !== 200) { return jOut; }
							return poll();
						});
					}
					return poll();
				}).catch(function () {
					return api('POST', cfg.restChat, body);
				});
			}
			function sendChat(message, displayText, sel, image) {
				addMessage('user', displayText || message, sel || null, image || null);
				setBusy(true);
				var typing = addTyping();
				var body = { message: message };
				if (image) { body.image = image; }
				if (conversationId) { body.conversationId = conversationId; }
				chatRequest(body).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						frameBusy(false);
						addMessage('assistant', (out.data && (out.data.message || out.data.error)) || 'Something went wrong. Please try again.');
						return;
					}
					if (out.data.conversationId) { rememberConv(out.data.conversationId); }
					if (out.data.memory) { renderMemory(out.data.memory); }
					var answer = out.data.answer || out.data.reply;
					if (answer) { addActivity(addMessage('assistant', answer), out.data.activity); }
					// The AI mapped the theme: show the tree, not its description.
					if (out.data.structure) { addStructure(out.data.structure); }
					if (out.data.editRequest && out.data.editRequest.instruction) {
						return runEdit(out.data.editRequest.instruction);
					}
					frameBusy(false);
					if (!answer) { addMessage('assistant', '(no answer)'); }
				}).catch(function () {
					typing.remove();
					frameBusy(false);
					addMessage('assistant', 'Network error. Please try again.');
				}).then(function () { setBusy(false); });
			}

			if (form) {
				form.addEventListener('submit', function (e) {
					e.preventDefault();
					var v = (input.value || '').trim();
					if (!v) { return; }
					input.value = ''; input.style.height = 'auto';
					var sel = selTarget;
					selTarget = null;
					renderSelChip();
					lastSelFull = sel ? sel.full : null;
					var img = pendingImage;
					setPendingImage(null);
					var full = sel ? sel.full + ' \u2014 ' + v : v;
					sendChat(full, v, sel, img);
				});
			}
			if (input) {
				input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
				input.addEventListener('keydown', function (e) {
					if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })); }
				});
			}

			// ---- Image attach: a photo or screenshot as visual context for the
			// chat. Downscaled client-side to a small JPEG data URL; sent with the
			// next message and shown as a thumbnail in the user's bubble. ----
			var attachBtn = $('wpab-ed-attach');
			var attachFile = $('wpab-ed-attachfile');
			var imgRow = $('wpab-ed-imgrow');
			var imgThumb = $('wpab-ed-imgthumb');
			var pendingImage = null;
			function setPendingImage(dataUrl) {
				pendingImage = dataUrl || null;
				if (!imgRow) { return; }
				if (!pendingImage) { imgRow.hidden = true; return; }
				if (imgThumb) { imgThumb.src = pendingImage; }
				imgRow.hidden = false;
			}
			function downscaleImage(file, cb) {
				try {
					var rd = new FileReader();
					rd.onload = function () {
						var im = new Image();
						im.onload = function () {
							var MAXDIM = 1400;
							var w = im.width, h = im.height;
							if (!w || !h) { cb(null); return; }
							var sc = Math.min(1, MAXDIM / Math.max(w, h));
							var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
							var cv = document.createElement('canvas');
							cv.width = cw; cv.height = ch;
							var ctx = cv.getContext('2d');
							if (!ctx) { cb(null); return; }
							ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
							ctx.drawImage(im, 0, 0, cw, ch);
							// The cap must match WPAB_Editor's server-side check
							// (1.5 MB): anything larger is dropped there, and the
							// model would then answer as if it had seen an image
							// it never received. Step the quality down instead of
							// throwing the screenshot away.
							var LIMIT = 1500000;
							var url = '';
							var qualities = [0.85, 0.7, 0.55, 0.4];
							for (var qi = 0; qi < qualities.length; qi++) {
								var attempt = '';
								try { attempt = cv.toDataURL('image/jpeg', qualities[qi]); } catch (e) { attempt = ''; }
								if (!attempt) { break; }
								url = attempt;
								if (url.length <= LIMIT) { break; }
							}
							cb(url && url.length <= LIMIT ? url : null);
						};
						im.onerror = function () { cb(null); };
						im.src = String(rd.result || '');
					};
					rd.onerror = function () { cb(null); };
					rd.readAsDataURL(file);
				} catch (e) { cb(null); }
			}
			function acceptImageFile(file) {
				if (!file || !/^image\//.test(file.type || '')) { return; }
				downscaleImage(file, function (url) {
					if (url) { setPendingImage(url); if (input) { input.focus(); } }
					else { addMessage('assistant', 'That image could not be read — try a PNG or JPEG.'); }
				});
			}
			if (attachBtn && attachFile) {
				attachBtn.addEventListener('click', function () { attachFile.click(); });
				attachFile.addEventListener('change', function () {
					if (attachFile.files && attachFile.files[0]) { acceptImageFile(attachFile.files[0]); }
					attachFile.value = '';
				});
			}
			(function () {
				var xb = $('wpab-ed-imgclear');
				if (xb) { xb.addEventListener('click', function () { setPendingImage(null); }); }
			})();
			// Paste a screenshot straight into the input.
			if (input) {
				input.addEventListener('paste', function (e) {
					var items = e.clipboardData && e.clipboardData.items;
					if (!items) { return; }
					for (var pi = 0; pi < items.length; pi++) {
						if (items[pi].kind === 'file' && /^image\//.test(items[pi].type || '')) {
							e.preventDefault();
							acceptImageFile(items[pi].getAsFile());
							return;
						}
					}
				});
			}

			var newBtn = $('wpab-ed-new');
			if (newBtn) {
				newBtn.addEventListener('click', function () {
					conversationId = null;
					clearWide();
					renderMemory([]);
					thread.innerHTML = '<p class="wpab-ed__empty">Ask anything about this site — its theme, templates, pages or content.</p>';
				});
			}

			// ---- Chat archive: every visit starts a FRESH chat (nothing persisted
			// in the browser); older conversations stay reachable via History. ----
			function rememberConv(id) {
				conversationId = id || conversationId;
			}
			function renderHistoryMessages(msgs) {
				thread.innerHTML = '';
				for (var hi = 0; hi < (msgs || []).length; hi++) {
					var hm = msgs[hi];
					if (hm && hm.content) { addMessage(hm.role === 'user' ? 'user' : 'assistant', hm.content); }
				}
				thread.scrollTop = thread.scrollHeight;
			}
			function loadConversation(id) {
				if (!cfg.restChatHistory || !id) { return; }
				api('POST', cfg.restChatHistory, { conversationId: id }).then(function (out) {
					if (out.ok && out.data && out.data.success && out.data.messages && out.data.messages.length) {
						rememberConv(id);
						renderMemory(out.data.memory);
						renderHistoryMessages(out.data.messages);
					}
				}).catch(function () {});
			}
			var histBtn = $('wpab-ed-history');
			var histMenu = $('wpab-ed-histmenu');
			function closeHistMenu() { if (histMenu) { histMenu.hidden = true; } }
			if (histBtn && histMenu) {
				histBtn.addEventListener('click', function () {
					if (!histMenu.hidden) { closeHistMenu(); return; }
					histBtn.disabled = true;
					api('POST', cfg.restChatHistory, {}).then(function (out) {
						histBtn.disabled = false;
						var rows = (out.ok && out.data && out.data.conversations) || [];
						histMenu.innerHTML = '';
						if (!rows.length) {
							histMenu.innerHTML = '<div class="wpab-ed__histitem" style="cursor:default;color:var(--ed-faint);">No saved chats yet.</div>';
						}
						for (var ri = 0; ri < rows.length; ri++) {
							(function (row) {
								var b = document.createElement('button');
								b.type = 'button';
								b.className = 'wpab-ed__histitem';
								var when = '';
								try { when = new Date(row.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) {}
								b.innerHTML = '<span></span><span class="d"></span>';
								b.firstChild.textContent = row.title || 'Untitled chat';
								b.lastChild.textContent = when;
								b.addEventListener('click', function () { closeHistMenu(); loadConversation(row.id); });
								histMenu.appendChild(b);
							})(rows[ri]);
						}
						histMenu.hidden = false;
					}).catch(function () { histBtn.disabled = false; });
				});
				document.addEventListener('click', function (e) {
					if (!histMenu.hidden && !histMenu.contains(e.target) && e.target !== histBtn) { closeHistMenu(); }
				});
			}
			// One-time cleanup of the old per-browser chat pointer.
			try { localStorage.removeItem('wpabChatConv'); } catch (e) {}

			// Not connected to the cloud yet: show a notice, disable chat.
			if (!cfg.connected) {
				var n = $('wpab-ed-notice');
				if (n) { n.hidden = false; n.innerHTML = 'This site is not connected to the Meikero cloud yet. <a href="' + cfg.cloudPage + '">Connect it</a> to use the chat.'; }
				setBusy(true);
				if (input) { input.disabled = true; }
			}

			// Live preview of the site. Hide the WordPress front-end admin bar
			// inside the iframe so the preview is clean (same-origin, so we can
			// inject a style; wrapped in try/catch in case it is ever blocked).
			var frame = $('wpab-ed-frame');
			if (frame && cfg.siteUrl) {
				frame.addEventListener('load', function () {
					try {
						var doc = frame.contentDocument;
						if (doc && doc.head && !doc.getElementById('wpab-hide-adminbar')) {
							var st = doc.createElement('style');
							st.id = 'wpab-hide-adminbar';
							st.textContent = '#wpadminbar{display:none!important} html{margin-top:0!important;padding-top:0!important}';
							doc.head.appendChild(st);
						}
					} catch (e) {}
				});
				frame.src = cfg.initialUrl || cfg.siteUrl;
			}

			// Credits, shown in the chrome. The handshake already carries the
			// balance, so this costs one request on load and tells the person
			// where they stand before a generation is refused instead of after.
			(function () {
				var pill = $('wpab-ed-credits');
				if (!pill || !cfg.restSession) { return; }

				function paint(credits, accountUrl) {
					if (!credits || typeof credits.balance !== 'number') { return; }
					var n = credits.balance;
					pill.textContent = Math.round(n).toLocaleString() + ' credits';
					pill.title = (credits.planName || 'Free') + ' plan · ' +
						(n > 0 ? 'click to manage your account' : 'top up to keep building');
					pill.classList.toggle('is-empty', n <= 0);
					if (accountUrl) { pill.href = accountUrl; }
					pill.hidden = false;
				}

				fetch(cfg.restSession, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' },
					credentials: 'same-origin',
					body: '{}'
				}).then(function (r) {
					return r.json();
				}).then(function (j) {
					var session = (j && j.session) ? j.session : j;
					if (session) { paint(session.credits, session.accountUrl); }
				}).catch(function () {
					// A missing balance is not worth an error state in the chrome.
				});

				// Generating spends credits, and the charge lands a moment after the
				// request returns. Rather than hooking every generation path, the
				// figure refreshes when the editor is likely to be stale: after a
				// quiet interval, and whenever the tab regains focus.
				var refreshTimer = null;

				function scheduleRefresh(delay) {
					if (refreshTimer) { clearTimeout(refreshTimer); }
					refreshTimer = setTimeout(function () {
						refreshTimer = null;
						window.wpabRefreshCredits();
					}, delay || 4000);
				}

				document.addEventListener('visibilitychange', function () {
					if (!document.hidden) { scheduleRefresh(300); }
				});

				// Any call to the editor's own REST surface may have spent credits.
				var originalFetch = window.fetch;
				window.fetch = function (input, init) {
					var url = typeof input === 'string' ? input : (input && input.url) || '';
					var ours = url && cfg.restSession && url.indexOf('/wp-ai-builder/v1/editor/') !== -1;
					return originalFetch.apply(this, arguments).then(function (response) {
						if (ours) { scheduleRefresh(4000); }
						return response;
					});
				};

				window.wpabRefreshCredits = function () {
					fetch(cfg.restSession, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' },
						credentials: 'same-origin',
						body: '{}'
					}).then(function (r) { return r.json(); }).then(function (j) {
						var session = (j && j.session) ? j.session : j;
						if (session) { paint(session.credits, session.accountUrl); }
					}).catch(function () {});
				};
			})();

			// Open the page currently shown in the preview in a real browser tab.
			(function () {
				var openPrev = $('wpab-ed-openpreview');
				if (!openPrev) { return; }
				openPrev.addEventListener('click', function () {
					var fr = $('wpab-ed-frame');
					var url = cfg.siteUrl || '';
					try {
						var u = fr && fr.contentWindow && fr.contentWindow.location.href;
						if (u && u.indexOf('http') === 0 && u !== 'about:blank') { url = u; }
					} catch (e) {}
					if (url) { window.open(url, '_blank', 'noopener'); }
				});
			})();

			// Preview device sizes.
			// ---- Inspect tool: pick an element in the preview, paste its
			// structure into the chat so the edit targets exactly that. ----
			var inspectBtn = $('wpab-ed-inspect');
			var inspectOn = false;
			var inspectDoc = null;
			var inspectHovered = null;

			// Shared overlay styling for the inspect/text tools, injected into the
			// preview document: a hint bar, strong highlights, mode cursors.
			function injectModeCss(doc) {
				try {
					if (doc.getElementById('wpab-mode-css')) { return; }
					var st = doc.createElement('style');
					st.id = 'wpab-mode-css';
					st.textContent =
						'body.wpab-mode-text{cursor:text!important}' +
						'body.wpab-mode-inspect{cursor:crosshair!important}' +
						'body.wpab-mode-text::before,body.wpab-mode-inspect::before{content:attr(data-wpab-hint);position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483600;background:rgba(20,19,18,.92);color:#fff;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;padding:9px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap}' +
						'.wpab-hl-text{outline:2px dashed #141312!important;outline-offset:3px!important;background:rgba(255,214,102,.45)!important;color:#141312!important;box-shadow:0 0 0 6px rgba(255,214,102,.2)!important;border-radius:3px;cursor:text!important}' +
						'.wpab-hl-editing{outline:2px solid #141312!important;outline-offset:3px!important;background:#fff!important;color:#141312!important;caret-color:#e05215!important;border-radius:4px;box-shadow:0 0 0 8px rgba(255,255,255,.55),0 16px 44px rgba(0,0,0,.35)!important}' +
						'.wpab-hl-inspect{outline:2px solid #141312!important;outline-offset:3px!important;background:rgba(20,19,18,.10)!important;box-shadow:0 0 0 6px rgba(20,19,18,.12)!important;border-radius:3px;cursor:crosshair!important}';
					(doc.head || doc.documentElement).appendChild(st);
				} catch (e) {}
			}
			function setDocMode(doc, mode, hint) {
				try {
					if (!doc || !doc.body) { return; }
					doc.body.classList.remove('wpab-mode-text', 'wpab-mode-inspect');
					if (mode) {
						injectModeCss(doc);
						doc.body.classList.add('wpab-mode-' + mode);
						doc.body.setAttribute('data-wpab-hint', hint || '');
					} else {
						doc.body.removeAttribute('data-wpab-hint');
					}
				} catch (e) {}
			}
			// Which page of the site the element lives on — travels with every
			// selection so the AI knows the context it is editing in.
			function pageContext(el) {
				var path = '', title = '';
				try {
					var d = el && el.ownerDocument;
					if (d) { path = (d.location && d.location.pathname) || ''; title = d.title || ''; }
				} catch (e) {}
				return { path: path, title: title };
			}

			function inspectDescriptor(el) {
				function tagOf(node) {
					var tg = node.tagName ? node.tagName.toLowerCase() : '';
					var cls = (node.className && typeof node.className === 'string')
						? node.className.trim().split(/\s+/).slice(0, 3).join('.')
						: '';
					return tg + (cls ? '.' + cls : '');
				}
				var parts = [];
				var cur = el;
				for (var d = 0; cur && d < 3 && cur.tagName && cur.tagName.toLowerCase() !== 'body'; d++) {
					parts.unshift(tagOf(cur));
					cur = cur.parentElement;
				}
				var sec = el.closest ? el.closest('section, header, footer') : null;
				var secName = '';
				if (sec) {
					var m = String(sec.className || '').match(/section-([a-z0-9-]+)/);
					if (m) { secName = 'section-' + m[1]; }
					else if (sec.tagName) { secName = sec.tagName.toLowerCase(); }
				}
				var txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
				var pg = pageContext(el);
				var full = 'Selected element: ' + parts.join(' > ');
				if (secName) { full += ' (inside ' + secName + ')'; }
				if (txt) { full += ', text: "' + txt + (txt.length >= 60 ? '\u2026' : '') + '"'; }
				if (pg.path) { full += ' \u2014 on page \u201c' + (pg.title || pg.path) + '\u201d (' + pg.path + ')'; }
				return { full: full, short: parts[parts.length - 1] || 'element', sec: secName, page: pg.path };
			}

			var selTarget = null;
			var lastSelFull = null;
			var selRow = $('wpab-ed-selrow');
			function renderSelChip() {
				if (!selRow) { return; }
				if (!selTarget) { selRow.hidden = true; return; }
				var tgt = $('wpab-ed-seltgt');
				var sec = $('wpab-ed-selsec');
				if (tgt) { tgt.textContent = '\u2316 ' + selTarget.short; }
				if (sec) { sec.textContent = selTarget.sec ? '\u00b7 ' + selTarget.sec : ''; }
				selRow.hidden = false;
			}
			(function () {
				var xBtn = $('wpab-ed-selclear');
				if (xBtn) { xBtn.addEventListener('click', function () { selTarget = null; renderSelChip(); }); }
			})();

			function inspectCleanup() {
				if (inspectHovered) {
					try { inspectHovered.classList.remove('wpab-hl-inspect'); } catch (e) {}
					inspectHovered = null;
				}
				if (inspectDoc) {
					try {
						inspectDoc.removeEventListener('mouseover', inspectHover, true);
						inspectDoc.removeEventListener('click', inspectClick, true);
						setDocMode(inspectDoc, null);
					} catch (e) {}
					inspectDoc = null;
				}
			}
			function inspectHover(e) {
				if (inspectHovered && inspectHovered !== e.target) {
					try { inspectHovered.classList.remove('wpab-hl-inspect'); } catch (er) {}
				}
				inspectHovered = e.target;
				try { inspectHovered.classList.add('wpab-hl-inspect'); } catch (er) {}
			}
			function inspectClick(e) {
				e.preventDefault();
				e.stopPropagation();
				try { e.target.classList.remove('wpab-hl-inspect'); } catch (er) {}
				selTarget = inspectDescriptor(e.target);
				setInspect(false);
				renderSelChip();
				if (input) { input.focus(); }
			}
			function inspectAttach() {
				var fr = $('wpab-ed-frame');
				if (!fr) { return false; }
				try {
					var doc = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document);
					if (!doc || !doc.body) { return false; }
					inspectDoc = doc;
					doc.addEventListener('mouseover', inspectHover, true);
					doc.addEventListener('click', inspectClick, true);
					setDocMode(doc, 'inspect', 'Inspect — click an element to attach it to the chat');
					return true;
				} catch (e) { return false; }
			}
			function setInspect(on) {
				inspectOn = !!on;
				if (inspectOn && textOn) { setTextMode(false); }
				inspectCleanup();
				if (inspectOn && !inspectAttach()) {
					inspectOn = false;
					addMessage('assistant', 'The preview cannot be inspected right now \u2014 wait for it to load and try again.');
				}
				if (inspectBtn) {
					inspectBtn.classList.toggle('is-on', inspectOn);
					inspectBtn.setAttribute('aria-pressed', inspectOn ? 'true' : 'false');
				}
			}
			if (inspectBtn) {
				inspectBtn.addEventListener('click', function () { setInspect(!inspectOn); });
			}
			// Re-attach after preview reloads while inspecting; drop mode if it navigated away.
			(function () {
				var fr0 = $('wpab-ed-frame');
				if (fr0) {
					fr0.addEventListener('load', function () {
						if (inspectOn) { inspectCleanup(); if (!inspectAttach()) { setInspect(false); } }
						if (textOn) { textCleanup(); if (!textAttach()) { setTextMode(false); } }
					});
				}
			})();

			// ---- Text tool: click any static text in the preview and edit it in
			// place. Enter/blur commits (a deterministic replace on the server, no
			// AI); Esc cancels. Dynamic content and ambiguous matches fall back. ----
			var textBtn = $('wpab-ed-textmode');
			var textOn = false;
			var textDoc = null;
			var textHovered = null;
			var textActive = null; // { el, orig, file }

			function textTargetOk(el) {
				if (!el || !el.tagName) { return false; }
				var tag = el.tagName.toLowerCase();
				if (tag === 'body' || tag === 'html' || tag === 'script' || tag === 'style' || tag === 'img' ||
					tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'svg') { return false; }
				if (el.children && el.children.length > 0) { return false; }
				var t = (el.textContent || '').trim();
				return t.length > 0 && t.length <= 1500;
			}
			function textFileFor(el) {
				var sec = el.closest ? el.closest('section, header, footer') : null;
				if (!sec) { return ''; }
				var tag = sec.tagName ? sec.tagName.toLowerCase() : '';
				if (tag === 'header') { return 'header.php'; }
				if (tag === 'footer') { return 'footer.php'; }
				var ds = sec.getAttribute ? (sec.getAttribute('data-section') || '') : '';
				if (ds && /^[a-z0-9-]+$/.test(ds)) { return 'template-parts/section-' + ds + '.php'; }
				var m = String(sec.className || '').match(/section-([a-z0-9-]+)/);
				if (m) { return 'template-parts/section-' + m[1] + '.php'; }
				return '';
			}
			function textHover(e) {
				if (textActive && (e.target === textActive.el || textActive.el.contains(e.target))) { return; }
				if (textHovered && textHovered !== e.target) {
					try { textHovered.classList.remove('wpab-hl-text'); } catch (er) {}
					textHovered = null;
				}
				if (!textTargetOk(e.target)) { return; }
				textHovered = e.target;
				try { textHovered.classList.add('wpab-hl-text'); } catch (er) {}
			}
			function textKeydown(e) {
				if (e.key === 'Enter') { e.preventDefault(); try { e.target.blur(); } catch (er) {} }
				if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); textCleanupActive(true); }
			}
			function textBlur() { textCommit(); }
			function textCleanupActive(restore) {
				if (!textActive) { return; }
				var el = textActive.el;
				var orig = textActive.orig;
				textActive = null;
				try {
					if (restore) { el.textContent = orig; }
					el.contentEditable = 'false';
					el.removeAttribute('contenteditable');
					el.classList.remove('wpab-hl-editing', 'wpab-hl-text');
					el.removeEventListener('keydown', textKeydown, true);
					el.removeEventListener('blur', textBlur, true);
				} catch (e) {}
			}
			function textCommit() {
				if (!textActive) { return; }
				var el = textActive.el;
				var orig = textActive.orig;
				var file = textActive.file;
				var page = textActive.page || '';
				var next = (el.textContent || '').trim();
				textCleanupActive(false);
				if (!next || next === orig.trim()) {
					try { el.textContent = orig; } catch (e) {}
					return;
				}
				applyTextChange(file, orig.trim(), next, el, orig, page);
			}
			function applyTextChange(file, oldText, newText, el, origRaw, page) {
				if (!cfg.restTextApply) { return textFallbackEdit(file, oldText, newText, page); }
				frameBusy(true, 'Saving the text…');
				api('POST', cfg.restTextApply, { file: file || '', oldText: oldText, newText: newText }).then(function (out) {
					frameBusy(false);
					if (out.ok && out.data && out.data.success) {
						addUndoMessage('Text updated' + (out.data.file ? ' — ' + friendlyName(out.data.file) : ''), out.data.file ? [out.data.file] : [], []);
						reloadPreview();
						return;
					}
					var reason = out.data && out.data.reason;
					if (reason === 'not_found') {
						try { if (el) { el.textContent = origRaw; } } catch (e) {}
						addMessage('assistant', 'That text looks like site content, not theme text — edit it in WordPress (Pages, Posts or Menus).');
						return;
					}
					// Ambiguous match or an apply error: let the AI make the precise change.
					textFallbackEdit((out.data && out.data.file) || file, oldText, newText, page);
				}).catch(function () {
					frameBusy(false);
					textFallbackEdit(file, oldText, newText, page);
				});
			}
			function textFallbackEdit(file, oldText, newText, page) {
				var where = file ? 'In ' + file + ', replace' : 'In the active theme, replace';
				var instruction = where + ' the exact text "' + oldText + '" with "' + newText + '". Change nothing else.'
					+ (page ? ' (The text appears on the page at ' + page + '.)' : '');
				addMessage('user', 'Change text: “' + oldText + '” → “' + newText + '”');
				runEdit(instruction, { skipPlan: true });
			}
			function textClick(e) {
				if (textActive && (e.target === textActive.el || textActive.el.contains(e.target))) { return; }
				e.preventDefault();
				e.stopPropagation();
				if (textActive) { try { textActive.el.blur(); } catch (er) {} textCleanupActive(false); }
				if (!textTargetOk(e.target)) { return; }
				var el = e.target;
				if (textHovered === el) {
					try { el.classList.remove('wpab-hl-text'); } catch (er) {}
					textHovered = null;
				}
				textActive = { el: el, orig: el.textContent || '', file: textFileFor(el), page: pageContext(el).path };
				try {
					el.contentEditable = 'true';
					el.classList.add('wpab-hl-editing');
					el.addEventListener('keydown', textKeydown, true);
					el.addEventListener('blur', textBlur, true);
					el.focus();
				} catch (er) {}
			}
			function textAttach() {
				var fr = $('wpab-ed-frame');
				if (!fr) { return false; }
				try {
					var doc = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document);
					if (!doc || !doc.body) { return false; }
					textDoc = doc;
					doc.addEventListener('mouseover', textHover, true);
					doc.addEventListener('click', textClick, true);
					setDocMode(doc, 'text', 'Text edit — click any text · Enter saves · Esc cancels');
					return true;
				} catch (e) { return false; }
			}
			function textCleanup() {
				textCleanupActive(true);
				if (textHovered) {
					try { textHovered.classList.remove('wpab-hl-text'); } catch (e) {}
					textHovered = null;
				}
				if (textDoc) {
					try {
						textDoc.removeEventListener('mouseover', textHover, true);
						textDoc.removeEventListener('click', textClick, true);
						setDocMode(textDoc, null);
					} catch (e) {}
					textDoc = null;
				}
			}
			function setTextMode(on) {
				textOn = !!on;
				if (textOn && inspectOn) { setInspect(false); }
				textCleanup();
				if (textOn && !textAttach()) {
					textOn = false;
					addMessage('assistant', 'The preview cannot be edited right now — wait for it to load and try again.');
				}
				if (textBtn) {
					textBtn.classList.toggle('is-on', textOn);
					textBtn.setAttribute('aria-pressed', textOn ? 'true' : 'false');
				}
			}
			if (textBtn) {
				textBtn.addEventListener('click', function () { setTextMode(!textOn); });
			}

			var devBar = $('wpab-ed-devbar');
			var frameWrap = $('wpab-ed-framewrap');
			if (devBar && frameWrap) {
				devBar.addEventListener('click', function (e) {
					var t = e.target;
					while (t && t !== devBar && !t.getAttribute('data-dev')) { t = t.parentNode; }
					if (!t || t === devBar) { return; }
					var dev = t.getAttribute('data-dev');
					var btns = devBar.querySelectorAll('[data-dev]');
					for (var di = 0; di < btns.length; di++) { btns[di].classList.remove('is-active'); }
					t.classList.add('is-active');
					frameWrap.className = 'wpab-ed__framewrap is-' + dev;
				});
			}

			// Chat panel expand / shrink.
			var chatPanel = $('wpab-ed-chatpanel');
			var expandBtn = $('wpab-ed-expand');
			if (expandBtn && chatPanel) {
				expandBtn.addEventListener('click', function () {
					setChatLarge(!chatPanel.classList.contains('is-large'));
				});
			}
			if (chatBack) {
				chatBack.addEventListener('click', function () { setChatLarge(false); });
			}
			document.addEventListener('keydown', function (e) {
				if (e.key !== 'Escape' || !chatPanel || !chatPanel.classList.contains('is-large')) { return; }
				// Esc belongs to whatever is on top, and the wizard sits above
				// the chat. `wizard` is declared below this line; the handler
				// only ever runs long after that, so the hoisted var is fine.
				if (wizard && !wizard.hidden) { return; }
				setChatLarge(false);
			});
			try {
				if (window.localStorage.getItem(CHAT_LARGE_KEY) === '1') { setChatLarge(true); }
			} catch (e) { /* private mode */ }

			// ---- New theme wizard: single prompt -> plan -> files -> write ----
			var wizard = $('wpab-ed-wizard');
			var wForm = $('wpab-ed-wform');
			var wGo = $('wpab-ed-wgo');
			var wCancel = $('wpab-ed-wcancel');
			var wResult = $('wpab-ed-wresult');
			var wProgress = $('wpab-ed-wprogress');
			var wBarFill = $('wpab-ed-wbarfill');
			var wStepEl = $('wpab-ed-wstep');
			var busy = false;
			// 90, not 60: the blueprint now plans 5-8 pages and 8-14 sections, and a
			// section costs two files. At 60 a full plan would have been trimmed —
			// silently, and from the end, which is exactly where the sections are.
			var MAX_FILES = 90;

			function val(id) { var e = $(id); return e ? (e.value || '').trim() : ''; }

			function collectBrief() {
				return { name: val('wpab-ed-name'), prompt: val('wpab-ed-prompt') };
			}

			var wStyles = $('wpab-ed-wstyles');
			function selectedStyle() {
				var on = wStyles ? wStyles.querySelector('.wpab-ed__wstyle.is-on') : null;
				return on ? on.getAttribute('data-style') : 'concept';
			}
			if (wStyles) {
				wStyles.addEventListener('click', function (e) {
					var b = e.target && e.target.closest ? e.target.closest('.wpab-ed__wstyle') : null;
					if (!b) { return; }
					var all = wStyles.querySelectorAll('.wpab-ed__wstyle');
					for (var i = 0; i < all.length; i++) { all[i].classList.remove('is-on'); }
					b.classList.add('is-on');
				});
			}

			function openWizard() {
				if (!wizard) { return; }
				busy = false;
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = ''; }
				if (wProgress) { wProgress.hidden = true; }
				if (wBarFill) { wBarFill.style.width = '0'; }
				if (wForm) { wForm.style.display = ''; }
				if (wGo) { wGo.disabled = false; wGo.hidden = false; wGo.textContent = 'Generate theme'; }
				wizard.hidden = false;
				offerResume();
				var p = $('wpab-ed-prompt'); if (p) { p.focus(); }
			}
			var closeWizard = function () { if (wizard && !busy) { wizard.hidden = true; } };

			var wOpen = $('wpab-ed-newtheme');
			var wOpen2 = $('wpab-ed-newtheme2');
			if (wOpen) { wOpen.addEventListener('click', openWizard); }
			if (wOpen2) { wOpen2.addEventListener('click', openWizard); }
			if (wCancel) { wCancel.addEventListener('click', function () { cancelGeneration(); }); }
			if (wizard) { wizard.addEventListener('click', function (e) { if (e.target === wizard) { closeWizard(); } }); }

			function wpost(url, payload, signal) {
				return fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' },
					credentials: 'same-origin',
					body: JSON.stringify(payload || {}),
					signal: signal || undefined
				}).then(function (r) {
					return r.text().then(function (t) {
						var j = null;
						try { j = t ? JSON.parse(t) : null; } catch (pe) { j = null; }
						return { ok: r.ok, status: r.status, data: j };
					});
				});
			}
			function setProgress(done, total, label) {
				if (wBarFill && total) { wBarFill.style.width = Math.round((done / total) * 100) + '%'; }
				if (wStepEl) { wStepEl.textContent = label || ''; }
			}
			function errText(out, fallback) { return (out && out.data && (out.data.message || out.data.error)) || (out && !out.ok && out.status ? 'HTTP ' + out.status : fallback); }

			// Animated step feedback ------------------------------------------------
			var PHASES = ['design', 'plan', 'build', 'write', 'check'];
			function stepEl(phase) { var s = $('wpab-ed-steps'); return s ? s.querySelector('[data-phase="' + phase + '"]') : null; }
			function stepState(phase, state, meta) {
				var el = stepEl(phase);
				if (!el) { return; }
				el.classList.remove('is-active', 'is-done');
				if (state) { el.classList.add(state === 'done' ? 'is-done' : 'is-active'); }
				var m = el.querySelector('.wpab-ed__stepmeta');
				if (m) { m.textContent = meta || ''; }
			}
			function phaseProgress(phase, extra) {
				var idx = PHASES.indexOf(phase);
				for (var i = 0; i < PHASES.length; i++) {
					if (i < idx) { stepState(PHASES[i], 'done'); }
					else if (i === idx) { stepState(PHASES[i], 'active', extra || ''); }
					else { stepState(PHASES[i], ''); }
				}
				setProgress(idx + (extra ? 0.5 : 0), PHASES.length, '');
			}
			function finishAllSteps() { for (var i = 0; i < PHASES.length; i++) { stepState(PHASES[i], 'done'); } setProgress(PHASES.length, PHASES.length, ''); }
			function friendlyName(path) {
				var map = { 'functions.php': 'theme setup', 'header.php': 'header', 'footer.php': 'footer', 'style.css': 'stylesheet', 'assets/css/main.css': 'design system', 'assets/css/base.css': 'design tokens', 'assets/css/header.css': 'header styles', 'assets/css/footer.css': 'footer styles', 'assets/js/main.js': 'interactions', 'front-page.php': 'home page' };
				if (map[path]) { return map[path]; }
				var sec = path.match(/template-parts\/section-(.+)\.php$/);
				if (sec) { return sec[1].replace(/-/g, ' ') + ' section'; }
				var pg = path.match(/page-(.+)\.php$/);
				if (pg) { return pg[1].replace(/-/g, ' ') + ' page'; }
				var tpl = path.match(/^(index|page|single|404|searchform)\.php$/);
				if (tpl) { return tpl[1] + ' template'; }
				return path.split('/').pop();
			}
			function batchLabel(paths) {
				var names = paths.map(friendlyName);
				if (names.length <= 2) { return names.join(' + '); }
				return names.slice(0, 2).join(', ') + ' +' + (names.length - 2) + ' more';
			}
			function setBuildDetail(text) { if (wStepEl) { wStepEl.textContent = text || ''; } }

			// ---- Run state: cancel, token accounting, resume ---------------------
			var genToken = 0;      // incremented on every start/cancel; stale runs see it change
			var genAbort = null;   // AbortController for the in-flight request
			var themeWritten = false;
			var tokIn = 0, tokOut = 0;
			var GEN_STATE_KEY = 'wpabGenState';

			function alive(tok) { return tok === genToken; }
			function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
			function addTok(d) {
				var u = d && d.usage;
				if (u) { tokIn += (u.inputTokens || u.input_tokens || 0); tokOut += (u.outputTokens || u.output_tokens || 0); }
			}
			function tokLabel() {
				var t = tokIn + tokOut;
				if (!t) { return ''; }
				return ' · ~' + (t >= 1000 ? (Math.round(t / 100) / 10) + 'k' : t) + ' tokens';
			}
			function saveGenState(brand, blueprint, built, mock) {
				try { localStorage.setItem(GEN_STATE_KEY, JSON.stringify({ brand: brand, blueprint: blueprint, built: built, mock: mock || null, tokIn: tokIn, tokOut: tokOut, t: Date.now() })); } catch (e) {}
			}
			function loadGenState() {
				try {
					var s = localStorage.getItem(GEN_STATE_KEY);
					var st = s ? JSON.parse(s) : null;
					if (!st || !st.blueprint || !Array.isArray(st.built) || !st.built.length) { return null; }
					if (st.t && (Date.now() - st.t) > 86400000) { return null; }
					return st;
				} catch (e) { return null; }
			}
			function clearGenState() { try { localStorage.removeItem(GEN_STATE_KEY); } catch (e) {} }

			function cancelGeneration() {
				if (!busy) { closeWizard(); return; }
				genToken++; // every checkpoint in the running chain now fails alive()
				if (genAbort) { try { genAbort.abort(); } catch (e) {} }
				busy = false;
				var mw = $('wpab-ed-mockwrap'); if (mw) { mw.hidden = true; }
				if (wizard) { wizard.classList.remove('is-design'); }
				var st = loadGenState();
				if (wResult) {
					wResult.className = 'wpab-ed__wresult is-err';
					wResult.textContent = themeWritten
						? 'Stopped. The theme was already written and stays active — only the remaining polish was skipped' + tokLabel() + '. Reloading…'
						: 'Generation stopped' + tokLabel() + (st ? '. Progress (' + st.built.length + ' files) is saved — reopen “New theme” to continue.' : '.');
				}
				if (wProgress) { wProgress.hidden = true; }
				if (wForm) { wForm.style.display = ''; }
				if (wGo) { wGo.disabled = false; wGo.textContent = 'Generate theme'; }
				if (wCancel) { wCancel.textContent = 'Cancel'; }
				if (themeWritten) {
					clearGenState();
					var back = (cfg.mode === 'design' && cfg.editorUrl) ? cfg.editorUrl : '';
					setTimeout(function () {
						if (back) { window.location.href = back; } else { location.reload(); }
					}, 1800);
				}
			}

			function offerResume() {
				var st = loadGenState();
				if (!st || !wResult || busy) { return; }
				var total = (st.blueprint.files || []).length;
				wResult.className = 'wpab-ed__wresult';
				wResult.textContent = '';
				var note = document.createElement('div');
				note.textContent = 'An earlier run for “' + (st.brand || 'your theme') + '” stopped after ' + st.built.length + ' of ' + total + ' files.';
				var row = document.createElement('div');
				row.style.marginTop = '8px';
				var go = document.createElement('button');
				go.type = 'button'; go.className = 'wpab-ed__wbtn'; go.textContent = 'Continue where it stopped';
				go.addEventListener('click', function () { resumeRun(st); });
				var drop = document.createElement('button');
				drop.type = 'button'; drop.className = 'wpab-ed__wbtn wpab-ed__wbtn--ghost'; drop.textContent = 'Discard';
				drop.style.marginLeft = '8px';
				drop.addEventListener('click', function () { clearGenState(); wResult.textContent = ''; });
				row.appendChild(go); row.appendChild(drop);
				wResult.appendChild(note); wResult.appendChild(row);
			}

			function beginBusyUI() {
				busy = true;
				themeWritten = false;
				if (wGo) { wGo.disabled = true; wGo.textContent = 'Generating…'; }
				if (wCancel) { wCancel.textContent = 'Stop'; }
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = ''; }
				if (wForm) { wForm.style.display = 'none'; }
				if (wProgress) { wProgress.hidden = false; }
				for (var pi = 0; pi < PHASES.length; pi++) { stepState(PHASES[pi], ''); }
			}

			function genFail(myRun) {
				return function (err) {
					if (!alive(myRun)) { return; } // cancelled — the cancel handler already reset the UI
					busy = false;
					var mw2 = $('wpab-ed-mockwrap'); if (mw2) { mw2.hidden = true; }
					if (wizard) { wizard.classList.remove('is-design'); }
					var st = loadGenState();
					if (wResult) {
						wResult.className = 'wpab-ed__wresult is-err';
						wResult.textContent = ((err && err.message) || 'Theme generation failed.') + tokLabel() + (st ? ' Progress (' + st.built.length + ' files) is saved — reopen “New theme” to continue.' : '');
					}
					if (wForm) { wForm.style.display = ''; }
					if (wProgress) { wProgress.hidden = true; }
					if (wGo) { wGo.disabled = false; wGo.textContent = 'Generate theme'; }
					if (wCancel) { wCancel.textContent = 'Cancel'; }
				};
			}

			// Correctness pass — non-fatal; resolves even if it fails.
			function reviewPass(myRun, sig, phase, focus) {
				if (!alive(myRun)) { return Promise.resolve(); }
				phaseProgress(phase);
				setBuildDetail('Scanning the theme for issues…');
				if (!cfg.restReviewTheme) { stepState(phase, 'done'); return Promise.resolve(); }
				return wpost(cfg.restReviewTheme, focus ? { focus: focus } : {}, sig).then(function (rOut) {
					addTok(rOut.data);
					var d = (rOut && rOut.data) || {};
					var meta = d.applied ? ('fixed ' + (d.updated || 0)) : 'clean';
					stepState(phase, 'done', meta);
				}).catch(function () { if (alive(myRun)) { stepState(phase, 'done'); } });
			}

			// Staged design elevation: get a punch-list, then apply each target
			// one at a time (small, timeout-safe calls with live per-file steps).
			function designRevise(myRun, sig, blueprint) {
				if (!alive(myRun)) { return Promise.resolve(); }
				phaseProgress('refine');
				setBuildDetail('Reviewing the design against its concept…');
				if (!cfg.restDesignPlan || !cfg.restEditTheme) { stepState('refine', 'done'); return Promise.resolve(); }
				return wpost(cfg.restDesignPlan, { concept: (blueprint && blueprint.concept) || null, blueprint: blueprint }, sig).then(function (pOut) {
					addTok(pOut.data);
					var targets = (pOut && pOut.data && Array.isArray(pOut.data.targets)) ? pOut.data.targets.slice(0, 6) : [];
					if (!targets.length) { stepState('refine', 'done', 'no changes'); return; }
					var i = 0, applied = 0;
					function nextTarget() {
						if (!alive(myRun)) { return; }
						if (i >= targets.length) { stepState('refine', 'done', 'elevated ' + applied); return; }
						var t = targets[i]; i++;
						stepState('refine', 'active', i + '/' + targets.length);
						setBuildDetail('Elevating ' + friendlyName(t.path) + '…');
						if (!t || typeof t.instruction !== 'string' || !t.instruction) { return nextTarget(); }
						return wpost(cfg.restEditTheme, { instruction: t.instruction }, sig).then(function (eOut) {
							addTok(eOut.data);
							if (eOut && eOut.data && eOut.data.success) { applied++; }
							return nextTarget();
						}).catch(function () { if (alive(myRun)) { return nextTarget(); } });
					}
					return nextTarget();
				}).catch(function () { if (alive(myRun)) { stepState('refine', 'done'); } });
			}

			// Deterministic "shadow copy" of the designed homepage: the text of every
			// approved mockup section, extracted client-side (no AI) into clean HTML
			// and stored as the front page's post_content. front-page.php still
			// renders the designed sections — this copy is what SEO plugins, site
			// search, RSS and other editors (e.g. Elementor, if this plugin is ever
			// disabled) see and can work with.
			function extractFrontContent(blueprint, mockCtx) {
				try {
					if (!mockCtx || !mockCtx.fragments || !blueprint || !blueprint.frontPage || typeof DOMParser === 'undefined') { return null; }
					var parts = [];
					var secs = blueprint.sections || [];
					var total = 0;
					for (var i = 0; i < secs.length; i++) {
						var slug = secs[i] && secs[i].slug;
						var frag = slug ? mockCtx.fragments['template-parts/section-' + slug + '.php'] : null;
						if (!frag) { continue; }
						var doc = new DOMParser().parseFromString(frag, 'text/html');
						var nodes = doc.body ? doc.body.querySelectorAll('h1,h2,h3,p,li') : [];
						var out = [];
						var listBuf = [];
						var seen = {};
						function flushList() {
							if (listBuf.length) { out.push('<ul>\n' + listBuf.join('\n') + '\n</ul>'); listBuf = []; }
						}
						for (var n = 0; n < nodes.length && out.length < 30; n++) {
							var el = nodes[n];
							var tag = el.tagName.toLowerCase();
							// Skip containers whose text comes from nested text elements.
							if (el.querySelector && el.querySelector('h1,h2,h3,p')) { continue; }
							var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
							if (!t || t.length < 2 || t.length > 600 || seen[t]) { continue; }
							seen[t] = 1;
							if (tag === 'li') { listBuf.push('<li>' + escapeHtml(t) + '</li>'); continue; }
							flushList();
							if (tag === 'h1') { tag = 'h2'; }
							out.push('<' + tag + '>' + escapeHtml(t) + '</' + tag + '>');
						}
						flushList();
						if (out.length) {
							var block = out.join('\n');
							total += block.length;
							parts.push(block);
							if (total > 18000) { break; }
						}
					}
					var html = parts.join('\n');
					return html.length > 40 ? html : null;
				} catch (e) { return null; }
			}

			// The build pipeline from a blueprint: batches -> write -> refine -> check.
			// prevBuilt carries already-generated files when resuming an earlier run.
			function runPipeline(myRun, sig, brand, blueprint, prevBuilt, mockCtx) {
				var files = (blueprint.files || []).filter(function (pp) { return typeof pp === 'string' && pp; });
				if (!files.length) { throw new Error('The plan returned no files.'); }
				if (files.length > MAX_FILES) {
					// Say so. A theme quietly missing its last four sections looks like
					// a generation that went wrong rather than a limit that was hit.
					var dropped = files.length - MAX_FILES;
					files = files.slice(0, MAX_FILES);
					addMessage('assistant', 'This plan asked for ' + (MAX_FILES + dropped) + ' files, which is more than one build can write. Building the first ' + MAX_FILES + '; the last ' + dropped + ' were left out.');
				}

				// Real page copy for the inner pages, written IN PARALLEL with the
				// build (cheap model) — stored as post_content when the pages are
				// created, so SEO tools and the WP editor see real content.
				var contentPromise = Promise.resolve(null);
				if (cfg.restPageContent) {
					var cBrief = collectBrief();
					contentPromise = wpost(cfg.restPageContent, {
						blueprint: blueprint,
						brief: { name: cBrief.name || brand, prompt: cBrief.prompt || ((blueprint.theme && blueprint.theme.description) || '') }
					}, sig).then(function (pcOut) {
						if (pcOut && pcOut.data) { addTok(pcOut.data); }
						return (pcOut && pcOut.ok && pcOut.data && pcOut.data.success && pcOut.data.content) ? pcOut.data.content : null;
					}).catch(function () { return null; });
				}

				var built = [];
				var repairsLeft = 2; // single-file regenerations allowed when the writer rejects a file
				var doneMap = {};
				for (var di = 0; di < (prevBuilt || []).length; di++) {
					var bf = prevBuilt[di];
					if (bf && typeof bf.path === 'string' && typeof bf.contents === 'string' && !doneMap[bf.path]) { built.push(bf); doneMap[bf.path] = 1; }
				}
				var remaining = files.filter(function (p) { return !doneMap[p]; });

				// Componentized build: many SMALL batches. Critical files go solo;
				// header/footer pair with their CSS; every section is its own batch
				// (php + its css); leftover templates are chunked by 2.
				var SOLO = { 'assets/css/main.css': 1, 'assets/css/base.css': 1, 'assets/css/components.css': 1, 'assets/js/main.js': 1, 'functions.php': 1 };
				var remSet = {};
				for (var ri = 0; ri < remaining.length; ri++) { remSet[remaining[ri]] = 1; }
				function take(pathName) { if (remSet[pathName]) { delete remSet[pathName]; return true; } return false; }
				var batches = [];
				// 1) solos
				for (var fi = 0; fi < remaining.length; fi++) {
					if (SOLO[remaining[fi]] && take(remaining[fi])) { batches.push([remaining[fi]]); }
				}
				// 2) header / footer with their stylesheets
				var hdr = [];
				if (take('header.php')) { hdr.push('header.php'); }
				if (take('assets/css/header.css')) { hdr.push('assets/css/header.css'); }
				if (hdr.length) { batches.push(hdr); }
				var ftr = [];
				if (take('footer.php')) { ftr.push('footer.php'); }
				if (take('assets/css/footer.css')) { ftr.push('assets/css/footer.css'); }
				if (ftr.length) { batches.push(ftr); }
				// 2b) the generic content template with its inner-page stylesheet
				var inr = [];
				if (take('page.php')) { inr.push('page.php'); }
				if (take('assets/css/inner.css')) { inr.push('assets/css/inner.css'); }
				if (inr.length) { batches.push(inr); }
				// 2c) the designed archive and 404 with the stylesheet they share
				var arc = [];
				if (take('archive.php')) { arc.push('archive.php'); }
				if (take('assets/css/pages.css')) { arc.push('assets/css/pages.css'); }
				if (take('404.php')) { arc.push('404.php'); }
				if (arc.length) { batches.push(arc); }
				// 3) one batch per section: its template part + its css
				for (var s2 = 0; s2 < remaining.length; s2++) {
					var mSec = remaining[s2].match(/^template-parts\/section-([a-z0-9-]+)\.php$/);
					if (!mSec || !remSet[remaining[s2]]) { continue; }
					var secBatch = [remaining[s2]];
					delete remSet[remaining[s2]];
					var cssP = 'assets/css/sections/' + mSec[1] + '.css';
					if (take(cssP)) { secBatch.push(cssP); }
					batches.push(secBatch);
				}
				// 4) whatever is left (templates, stray css), chunked by 2
				var rest = [];
				for (var r2 = 0; r2 < remaining.length; r2++) { if (remSet[remaining[r2]]) { rest.push(remaining[r2]); } }
				for (var bi = 0; bi < rest.length; bi += 2) { batches.push(rest.slice(bi, bi + 2)); }
				var totalB = batches.length;

				// In design-first mode each batch carries only the mockup pieces it
				// needs: the CSS for main.css, the HTML fragment for its own file.
				function batchPayload(paths) {
					var payload = { blueprint: blueprint, paths: paths };
					if (mockCtx) {
						var mk = { css: '', fonts: mockCtx.fonts || [], fragments: {} };
						var any = !!(mockCtx.fonts && mockCtx.fonts.length);
						function cssFragKey(pp) {
							if (pp === 'assets/css/header.css') { return 'header.php'; }
							if (pp === 'assets/css/footer.css') { return 'footer.php'; }
							var cm = pp.match(/^assets\/css\/sections\/([a-z0-9-]+)\.css$/);
							return cm ? ('template-parts/section-' + cm[1] + '.php') : null;
						}
						for (var mi = 0; mi < paths.length; mi++) {
							var mp2 = paths[mi];
							if (mockCtx.css && (mp2 === 'assets/css/main.css' || (/\.css$/.test(mp2) && mp2 !== 'style.css'))) { mk.css = mockCtx.css; any = true; }
							if (mockCtx.fragments && mockCtx.fragments[mp2]) { mk.fragments[mp2] = mockCtx.fragments[mp2]; any = true; }
							var fk = cssFragKey(mp2);
							if (fk && mockCtx.fragments && mockCtx.fragments[fk]) { mk.fragments[fk] = mockCtx.fragments[fk]; any = true; }
							// Content templates + inner.css carry the inner design pack.
							if (mockCtx.inner && (mp2 === 'assets/css/inner.css' || /^page(-[a-z0-9-]+)?\.php$/.test(mp2) || mp2 === 'single.php')) {
								mk.inner = mockCtx.inner; any = true;
							}
							// Each remaining pack goes only to the files that port it,
							// so no batch carries markup it will not use.
							if (mockCtx.components && mp2 === 'assets/css/components.css') { mk.components = mockCtx.components; any = true; }
							if (mockCtx.archive && (mp2 === 'archive.php' || mp2 === 'index.php' || mp2 === 'assets/css/pages.css')) { mk.archive = mockCtx.archive; any = true; }
							if (mockCtx.notFound && (mp2 === '404.php' || mp2 === 'assets/css/pages.css')) { mk.notFound = mockCtx.notFound; any = true; }
						}
						if (any) { payload.mockup = mk; }
					}
					return payload;
				}

				// Request one batch. Preferred path: start an async job on the SaaS
				// and poll it every few seconds — every HTTP request stays short, so
				// no host/proxy/function timeout can kill a long model call. Falls
				// back to the one-shot endpoint when the async pair is unavailable.
				function requestBatch(paths) {
					if (!cfg.restBuildFilesStart || !cfg.restBuildJob) {
						return wpost(cfg.restBuildFiles, batchPayload(paths), sig);
					}
					return wpost(cfg.restBuildFilesStart, batchPayload(paths), sig).then(function (sOut) {
						var jobId = sOut && sOut.data && sOut.data.jobId;
						if (!jobId) {
							if (sOut && sOut.status === 404) {
								// Older SaaS without the async endpoints — one-shot fallback.
								return wpost(cfg.restBuildFiles, batchPayload(paths), sig);
							}
							// Surface the start error instead of silently falling back to
							// the long synchronous call (which shared hosts kill with 504).
							return { ok: false, status: (sOut && sOut.status) || 0, data: (sOut && sOut.data) || { error: 'Could not start the generation job.' } };
						}
						var started = Date.now();
						function poll() {
							if (!alive(myRun)) { return Promise.reject(new Error('Stopped.')); }
							if (Date.now() - started > 480000) { return Promise.reject(new Error('Timed out waiting for the generator.')); }
							return delay(3500).then(function () {
								if (!alive(myRun)) { throw new Error('Stopped.'); }
								return wpost(cfg.restBuildJob, { jobId: jobId }, sig);
							}).then(function (jOut) {
								var d = (jOut && jOut.data) || {};
								if (d.status === 'done') { return { ok: true, status: 200, data: d.result || {} }; }
								if (d.status === 'error') { return { ok: false, status: 502, data: { error: d.error || 'Generation failed.' } }; }
								if (!jOut.ok) { return { ok: false, status: jOut.status || 0, data: d }; }
								var secs = Math.round((Date.now() - started) / 1000);
								setBuildDetail('Building ' + batchLabel(paths) + '… ' + secs + 's');
								return poll();
							});
						}
						return poll();
					});
				}

				// Fetch a batch resiliently. Missing paths are re-requested (up to 3
				// passes); a transport-level failure (timeout, 5xx) gets ONE more try
				// after a pause — repeating an expensive failure twice mostly burns
				// tokens for nothing.
				function fetchBatchFiles(wanted, bIndex, total) {
					var collected = {};
					function attempt(paths, left) {
						if (!alive(myRun)) { return Promise.reject(new Error('Stopped.')); }
						return requestBatch(paths).then(function (fOut) {
							addTok(fOut.data);
							var got = (fOut && fOut.data && Array.isArray(fOut.data.files)) ? fOut.data.files : [];
							for (var k = 0; k < got.length; k++) {
								var f = got[k];
								if (f && typeof f.path === 'string' && typeof f.contents === 'string') { collected[f.path] = f.contents; }
							}
							var missing = paths.filter(function (p) { return !collected[p]; });
							if (!missing.length) { return; }
							if (left > 1 && alive(myRun)) { phaseProgress('build', (bIndex + 1) + '/' + total + ' · retry — ' + String(errText(fOut, got.length ? 'missing ' + missing.length + ' of ' + paths.length : 'no files returned')).slice(0, 70)); return delay(800).then(function () { return attempt(missing, left - 1); }); }
							throw new Error(errText(fOut, 'Could not generate: ' + missing.join(', ')));
						}).catch(function (e) {
							if (!alive(myRun)) { throw e; }
							var missing = wanted.filter(function (p) { return !collected[p]; });
							if (left > 2 && missing.length) { phaseProgress('build', (bIndex + 1) + '/' + total + ' · retry — ' + String((e && e.message) || 'request failed').slice(0, 70)); return delay(2000).then(function () { return attempt(missing, 1); }); }
							throw e;
						});
					}
					return attempt(wanted, 3).then(function () {
						return wanted.map(function (p) { return { path: p, contents: collected[p] }; }).filter(function (x) { return x.contents; });
					});
				}

				function runBatch(b) {
					if (!alive(myRun)) { return; }
					if (b >= totalB) {
						stepState('build', 'done', built.length + ' files');
						phaseProgress('write');
						setBuildDetail('Creating pages, front page and menu…');
						return contentPromise.then(function (pageContent) {
							var contentMap = pageContent || {};
							// The designed homepage's text as the front page's content.
							var frontSlug = typeof blueprint.frontPage === 'string' ? blueprint.frontPage : '';
							if (frontSlug && !contentMap[frontSlug]) {
								var frontHtml = extractFrontContent(blueprint, mockCtx);
								if (frontHtml) { contentMap[frontSlug] = frontHtml; }
							}
							var createPayload = {
								brand: brand,
								description: (blueprint.theme && blueprint.theme.description) || '',
								files: built,
								blueprint: blueprint
							};
							var hasContent = false;
							for (var ck in contentMap) { if (Object.prototype.hasOwnProperty.call(contentMap, ck)) { hasContent = true; break; } }
							if (hasContent) { createPayload.content = contentMap; }
							return wpost(cfg.restCreateTheme, createPayload, sig);
						}).then(function (cOut) {
							if (!alive(myRun)) { return; }
							if (!cOut.ok || !cOut.data || cOut.data.success === false) {
								// The writer validates every file; when it names ONE bad file
								// (e.g. "PHP syntax error in 404.php"), regenerate just that
								// file and retry the write instead of discarding the whole run.
								var wmsg = String(errText(cOut, 'Could not write the theme.'));
								var bad = null;
								var fm = wmsg.match(/([A-Za-z0-9_\-\/.]+\.(?:php|css|js))/);
								if (fm) {
									for (var xi = 0; xi < built.length; xi++) {
										var bpp = built[xi].path;
										if (bpp === fm[1] || (fm[1].length > bpp.length && fm[1].slice(-bpp.length) === bpp)) { bad = bpp; break; }
									}
								}
								if (repairsLeft > 0 && bad) {
									repairsLeft--;
									stepState('write', 'active', 'repair');
									setBuildDetail('Regenerating ' + friendlyName(bad) + ' — ' + wmsg.slice(0, 70) + '…');
									built = built.filter(function (f) { return f.path !== bad; });
									delete doneMap[bad];
									saveGenState(brand, blueprint, built, mockCtx);
									return fetchBatchFiles([bad], 0, 1).then(function (got2) {
										if (!alive(myRun)) { return; }
										for (var gk = 0; gk < got2.length; gk++) { built.push(got2[gk]); doneMap[got2[gk].path] = 1; }
										saveGenState(brand, blueprint, built, mockCtx);
										return runBatch(totalB);
									});
								}
								throw new Error(wmsg);
							}
							themeWritten = true;
							clearGenState();
							var fin = cOut.data.finalize || {};
							var extra = fin.pages_created ? (fin.pages_created + ' pages' + (fin.menu_built ? ' + menu' : '')) : (cOut.data.files_written || built.length) + ' files';
							stepState('write', 'done', extra);
							var themeName = cOut.data.name || brand;
							// The design was approved at the mockup stage — go straight to
							// the correctness check. Non-fatal.
							return reviewPass(myRun, sig, 'check', 'any invisible or hidden content, header/nav or mobile-menu selector mismatches, PHP errors, horizontal overflow, empty image placeholders, page/single templates not rendering the_content(), or an enqueued stylesheet whose file is missing').then(function () {
								if (!alive(myRun)) { return; }
								finishAllSteps();
								// The theme exists now, so the next thing anybody wants is
								// the editor. Reloading the design page would put them back
								// in front of an empty wizard.
								var next = (cfg.mode === 'design' && cfg.editorUrl) ? cfg.editorUrl : '';
								if (wResult) {
									wResult.className = 'wpab-ed__wresult is-ok';
									wResult.textContent = '✓ “' + themeName + '” is ready (' + extra + tokLabel() + '), designed and activated. '
										+ (next ? 'Opening the editor…' : 'Reloading…');
								}
								setTimeout(function () {
									if (next) { window.location.href = next; } else { location.reload(); }
								}, 1500);
							});
						});
					}
					phaseProgress('build', (b + 1) + '/' + totalB);
					setBuildDetail('Building ' + batchLabel(batches[b]) + '…');
					return fetchBatchFiles(batches[b], b, totalB).then(function (got) {
						if (!alive(myRun)) { return; }
						for (var k = 0; k < got.length; k++) { built.push(got[k]); doneMap[got[k].path] = 1; }
						saveGenState(brand, blueprint, built, mockCtx);
						return runBatch(b + 1);
					});
				}

				return runBatch(0);
			}

			function generateTheme() {
				if (!wGo || !cfg.restBuildPlan || busy) { return; }
				var brief = collectBrief();
				if (!brief.prompt) {
					if (wResult) { wResult.className = 'wpab-ed__wresult is-err'; wResult.textContent = 'Please describe the website you want.'; }
					var pf = $('wpab-ed-prompt'); if (pf) { pf.focus(); }
					return;
				}

				genToken++;
				var myRun = genToken;
				genAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
				var sig = genAbort ? genAbort.signal : undefined;
				tokIn = 0; tokOut = 0;
				clearGenState();
				beginBusyUI();

				// Design-first: compose and approve the homepage BEFORE building.
				if (cfg.restMockupStart && cfg.restBuildJob) {
					startDesignPhase(myRun, sig, brief, '');
					return;
				}

				stepState('design', 'done', 'skipped');
				runPlan(myRun, sig, brief, [], null);
			}

			/**
			 * Build a theme from a design that was already generated and paid for.
			 *
			 * Designing is the expensive half of a run — around fifty credits of
			 * ninety — and every design is archived. Rebuilding from one skips
			 * straight to the build, so a second theme from an approved design
			 * costs roughly half. The pack comes back in the same shape a fresh
			 * generation produces, which is why nothing below this point has to
			 * know where the design came from.
			 */
			function startFromDesign(designId) {
				if (!designId || busy || !cfg.restBuildPlan) { return; }

				if (!cfg.restDesignPack) {
					// The plugin is older than the endpoint. Say so rather than
					// doing nothing, which is what a silent return looked like.
					if (wResult) {
						wResult.className = 'wpab-ed__wresult is-err';
						wResult.textContent = 'Update the Meikero plugin to build from a saved design.';
					}
					openWizard();
					return;
				}

				// The wizard is where every step, progress line and error appears.
				// Starting a run without opening it first ran the whole build behind
				// a hidden overlay: the page simply sat there.
				openWizard();

				genToken++;
				var myRun = genToken;
				genAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
				var sig = genAbort ? genAbort.signal : undefined;
				tokIn = 0; tokOut = 0;
				clearGenState();
				beginBusyUI();
				stepState('design', 'done', 'from archive');
				setBuildDetail('Loading the approved design…');

				wpost(cfg.restDesignPack, { designId: designId }, sig).then(function (out) {
					if (!alive(myRun)) { return; }
					var pack = (out && out.data) || {};
					if (!pack.success) { throw new Error(errText(out, 'That design could not be loaded.')); }

					var brief = (pack.brief && typeof pack.brief === 'object') ? pack.brief : {};
					if (!brief.prompt) { brief.prompt = pack.conceptName ? ('Rebuild the ' + pack.conceptName + ' design.') : 'Rebuild the approved design.'; }

					proceedFromMockup(myRun, sig, brief, pack);
				}).catch(genFail(myRun));
			}

			function runPlan(myRun, sig, brief, mockupSections, mockCtx, sitePages) {
				phaseProgress('plan');
				setBuildDetail('Planning the pages…');
				wpost(cfg.restBuildPlan, { brief: brief, mockupSections: mockupSections || [], sitePages: sitePages || [] }, sig).then(function (out) {
					if (!alive(myRun)) { return; }
					if (!out.ok || !out.data || out.data.success === false || !out.data.blueprint) {
						throw new Error(errText(out, 'Could not plan the theme.'));
					}
					addTok(out.data);
					stepState('plan', 'done');
					var blueprint = out.data.blueprint;
					var brand = brief.name || (blueprint.theme && blueprint.theme.name) || 'Custom Theme';
					return runPipeline(myRun, sig, brand, blueprint, [], mockCtx);
				}).catch(genFail(myRun));
			}

			// Design phase: one strong-model job composes the whole homepage as a
			// single HTML file; the user reviews it in an iframe and approves it
			// before a single theme file is written.
			function startDesignPhase(myRun, sig, brief, variation) {
				phaseProgress('design');
				setBuildDetail(variation ? 'Designing a different direction…' : 'Designing the homepage…');
				var started = Date.now();
				wpost(cfg.restMockupStart, { brief: brief, variation: variation || '', designStyle: selectedStyle() }, sig).then(function (sOut) {
					if (!alive(myRun)) { return; }
					var jobId = sOut && sOut.data && sOut.data.jobId;
					if (!jobId) { throw new Error(errText(sOut, 'Could not start the design step.')); }
					function poll() {
						if (!alive(myRun)) { throw new Error('Stopped.'); }
						// Must stay above the SaaS design function's own limit (800s) plus
						// its margin. Giving up first would show a timeout for a run that
						// is still working and about to succeed.
						if (Date.now() - started > 900000) { throw new Error('The design step timed out.'); }
						return delay(3500).then(function () {
							if (!alive(myRun)) { throw new Error('Stopped.'); }
							return wpost(cfg.restBuildJob, { jobId: jobId }, sig);
						}).then(function (jOut) {
							var d = (jOut && jOut.data) || {};
							if (d.status === 'done') { return d.result || {}; }
							if (d.status === 'error') { throw new Error(d.error || 'The design step failed.'); }
							if (!jOut.ok) { throw new Error(errText(jOut, 'The design step failed.')); }
							var prog = d.result && d.result.progress;
							var note = (prog && prog.note) ? prog.note : 'Designing the homepage…';
							setBuildDetail(note + ' ' + Math.round((Date.now() - started) / 1000) + 's');
							if (prog && prog.stage) { stepState('design', 'run', prog.stage === 'concept' ? 'concept' : (prog.stage === 'critique' ? 'review' : 'drawing')); }
							return poll();
						});
					}
					return poll();
				}).then(function (mock) {
					if (!alive(myRun) || !mock) { return; }
					addTok(mock);
					showMockup(myRun, sig, brief, mock);
				}).catch(genFail(myRun));
			}

			function showMockup(myRun, sig, brief, mock) {
				var stepMeta = (mock.conceptName ? '\u201c' + mock.conceptName + '\u201d \u00b7 ' : '') + (mock.sections && mock.sections.length ? mock.sections.length + ' sections' : '');
				stepState('design', 'done', stepMeta);
				var wrap = $('wpab-ed-mockwrap');
				var frame = $('wpab-ed-mockframe');
				var meta = $('wpab-ed-mockmeta');
				if (meta) {
					var parts = [];
					if (mock.conceptName) { parts.push('<b>Concept: \u201c' + String(mock.conceptName).replace(/[<>&]/g, '') + '\u201d</b>' + (mock.conceptIdea ? ' \u2014 ' + String(mock.conceptIdea).replace(/[<>&]/g, '') : '')); }
					if (mock.critique) { parts.push('AI review: ' + String(mock.critique).replace(/[<>&]/g, '')); }
					// A page that still failed its checks after a second attempt is
					// shipped anyway — a site missing Services is worse than one
					// whose Services page sits slightly wide — but saying so beats
					// letting the person find it themselves.
					if (Array.isArray(mock.pageFaults) && mock.pageFaults.length) {
						var names = [];
						for (var pf = 0; pf < mock.pageFaults.length; pf++) {
							var f = mock.pageFaults[pf];
							if (f && f.title) { names.push(String(f.title).replace(/[<>&]/g, '')); }
						}
						if (names.length) {
							parts.push('Worth a look: ' + names.join(', ')
								+ (names.length === 1 ? ' did not' : ' did not')
								+ ' come back matching the rest of the site. You can adjust it below, or rebuild.');
						}
					}
					if (parts.length) { meta.innerHTML = parts.join('<br>'); meta.hidden = false; } else { meta.hidden = true; }
				}
				if (!wrap || !frame) { return proceedFromMockup(myRun, sig, brief, mock); }
				if (wProgress) { wProgress.hidden = true; }
				// Walking the design like a site.
				//
				// The preview used to swallow every click, which kept a dead link
				// from navigating the iframe to nowhere but also made the design
				// feel like a screenshot. Now the framed page tells the parent
				// which link was pressed and the parent switches screens — the
				// nav, the footer, a card, a "read more" all lead somewhere, and
				// the design can be judged the way a visitor would meet it.
				//
				// In-page anchors are left alone so they still scroll. The iframe
				// has no same-origin access, so it can only post a string out; the
				// parent checks the message came from this frame and treats the
				// href as data, never as a URL to follow.
				var guard = '<script>(function(){'
					+ 'document.addEventListener("click",function(e){'
					+ 'var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;'
					+ 'var h=a.getAttribute("href")||"";'
					+ 'if(h.charAt(0)==="#")return;'
					+ 'e.preventDefault();'
					+ 'try{parent.postMessage({wpabNav:h},"*");}catch(err){}'
					+ '},true);'
					+ 'document.addEventListener("submit",function(e){e.preventDefault();},true);'
					+ '})();<' + '/script>';
				function guarded(d) { d = String(d || ''); return (d.indexOf('</body>') !== -1) ? d.replace('</body>', guard + '</body>') : d + guard; }

				// The pages this design has, as the server listed them.
				//
				// They arrive as {slug,label} now, in the order the site's own
				// menu lists them, so the rail and the header agree about what
				// this site is. An older job result held bare strings; both are
				// normalised here so a design generated before this change can
				// still be opened.
				var FILE_NAME = {
					home: 'index.html',
					archive: 'blog.html',
					post: 'blog-post.html',
					notfound: '404.html',
					inner: 'inner-page.html',
					components: 'components.html',
					brand: 'brand-sheet.html'
				};
				var LEGACY_LABEL = {
					home: 'Homepage', archive: 'Blog', post: 'Blog post', notfound: '404',
					inner: 'Inner page', components: 'Components', brand: 'Brand sheet'
				};

				function pageList() {
					var raw = (mock && Array.isArray(mock.pages) && mock.pages.length) ? mock.pages : ['home'];
					var out = [];
					for (var i = 0; i < raw.length; i++) {
						var it = raw[i];
						var slug = (typeof it === 'string') ? it : (it && it.slug ? String(it.slug) : '');
						if (!slug) { continue; }
						var label = (it && it.label) ? String(it.label)
							: (LEGACY_LABEL[slug] || slug.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }));
						out.push({ slug: slug, label: label, file: FILE_NAME[slug] || (slug + '.html') });
					}
					return out.length ? out : [{ slug: 'home', label: 'Homepage', file: 'index.html' }];
				}

				function hasPage(slug) {
					var list = pageList();
					for (var i = 0; i < list.length; i++) { if (list[i].slug === slug) { return true; } }
					return false;
				}

				// Where a link leads.
				//
				// Every page is really designed now, so a link is answered with
				// the page itself rather than with a template standing in for it.
				// A link to a page this design does not have goes to the 404 —
				// which is what a visitor would meet, and is more honest than
				// quietly showing the homepage as though the link had worked.
				function targetFor(href) {
					var h = String(href || '').trim();
					if (!h || h.charAt(0) === '#') { return null; }
					if (/^(mailto:|tel:|javascript:|data:)/i.test(h)) { return null; }
					if (/^https?:\/\//i.test(h) && h.indexOf(location.host) === -1) { return null; }

					var path = h.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].split('#')[0].toLowerCase();
					var home = hasPage('home') ? 'home' : pageList()[0].slug;

					if (!path || path === '/' || /^\/?(home|index)(\.html?)?\/?$/.test(path)) { return home; }

					var parts = path.replace(/^\/+|\/+$/g, '').split('/');
					var first = parts[0].replace(/\.html?$/, '');

										// Something under the blog is one post, and that has to be
					// decided before the blog's own page matches the first segment —
					// otherwise every post link stops at the listing it came from.
					var deep = parts.length > 1;
					var blogish = /^(archive|blog|news|journal|notes|articles|insights|posts|stories|updates)$/.test(first);

					if (deep && blogish && hasPage('post')) { return 'post'; }
					if (hasPage(first)) { return first; }
					if (deep && hasPage('post')) { return 'post'; }
					if (/^(404|not-?found)$/.test(first) && hasPage('notfound')) { return 'notfound'; }
					if (blogish && hasPage('archive')) { return 'archive'; }
					if (hasPage('notfound')) { return 'notfound'; }
					return home;
				}

				// The homepage and the blog post are already in memory; the rest
				// are fetched once each, on demand, and cached.
				var pageCache = { home: mock.html || '' };
				if (mock.innerHtml) { pageCache.post = mock.innerHtml; }
				var ways = Array.isArray(mock.colorways) ? mock.colorways : [];
				var curPage = 'home';
				var curWay = -1;

				// Every rule below :root goes through the custom properties, so
				// swapping that one block re-skins the whole document.
				function withWay(html) {
					if (curWay < 0 || !ways[curWay] || !ways[curWay].rootCss) { return html; }
					return String(html).replace(/:root\s*\{[\s\S]*?\}/, function () { return ways[curWay].rootCss; });
				}

				function paint() {
					var html = pageCache[curPage];
					frame.srcdoc = html ? guarded(withWay(html)) : guarded('<p style="font:14px system-ui;padding:24px">Loading…</p>');
				}

				function syncTabs(which) {
					var row = $('wpab-ed-mocktabs');
					if (!row) { return; }
					var all = row.querySelectorAll('[data-mocktab]');
					for (var i = 0; i < all.length; i++) {
						all[i].classList.toggle('is-on', all[i].getAttribute('data-mocktab') === which);
					}
				}

				function openPage(which) {
					curPage = which;
					syncTabs(which);
					if (pageCache[which]) { paint(); return; }
					if (!cfg.restDesignHtml || !mock.designId) { return; }
					paint();
					wpost(cfg.restDesignHtml, { designId: mock.designId, which: which }).then(function (out) {
						var d = (out && out.data) || {};
						pageCache[which] = d.html || '';
						if (curPage === which) { paint(); }
					}).catch(function () {
						pageCache[which] = '<p style="font:14px system-ui;padding:24px">This page could not be loaded.</p>';
						if (curPage === which) { paint(); }
					});
				}

				// Only this frame may drive the preview.
				window.addEventListener('message', function (e) {
					if (!frame || e.source !== frame.contentWindow) { return; }
					var data = e.data;
					if (!data || typeof data.wpabNav !== 'string') { return; }
					var target = targetFor(data.wpabNav);
					if (!target || target === curPage) { return; }
					openPage(target);
				});

				var mtabs = $('wpab-ed-mocktabs');
				function buildPageTabs() {
					if (!mtabs) { return; }
					var pages = pageList();
					mtabs.innerHTML = '';
					for (var pi = 0; pi < pages.length; pi++) {
						var b = document.createElement('button');
						b.type = 'button';
						b.className = 'wpab-ed__mocktab' + (pages[pi].slug === curPage ? ' is-on' : '');
						b.setAttribute('data-mocktab', pages[pi].slug);
						var nm = document.createElement('span');
						nm.className = 'wpab-ed__mocktabname';
						nm.textContent = pages[pi].label;
						var fl = document.createElement('span');
						fl.className = 'wpab-ed__mocktabfile';
						fl.textContent = pages[pi].file;
						b.appendChild(nm);
						b.appendChild(fl);
						mtabs.appendChild(b);
					}
					mtabs.hidden = pages.length < 2;
				}
				buildPageTabs();
				if (mtabs) {
					mtabs.onclick = function (e) {
						var t = e.target;
						while (t && t !== mtabs && !t.getAttribute('data-mocktab')) { t = t.parentNode; }
						if (!t || t === mtabs) { return; }
						openPage(t.getAttribute('data-mocktab'));
					};
				}

				// Adjusting the design before committing to it.
				//
				// The only way to change a design used to be generating another
				// one — a different design, at full price, rather than this one
				// with the hero made smaller. One cheap anchored edit keeps what
				// was approved and changes the part that was wrong.
				var editRow = $('wpab-ed-mockedit');
				var editInput = $('wpab-ed-mockeditinput');
				var editBtn = $('wpab-ed-mockeditgo');
				var editNote = $('wpab-ed-mockeditnote');
				if (editRow && mock.designId && cfg.restDesignEdit) { editRow.hidden = false; }

				function runDesignEdit() {
					var instruction = editInput ? (editInput.value || '').trim() : '';
					if (!instruction || !mock.designId || !cfg.restDesignEdit) { return; }
					if (editBtn) { editBtn.disabled = true; editBtn.textContent = 'Changing…'; }
					if (editInput) { editInput.disabled = true; }
					if (editNote) { editNote.textContent = 'Reading the design and making the change…'; }

					wpost(cfg.restDesignEdit, { designId: mock.designId, instruction: instruction })
						.then(function (out) {
							var d = (out && out.data) || {};
							if (!out.ok || !d.success || !d.html) {
								if (editNote) { editNote.textContent = d.error || d.message || 'That change could not be made.'; }
								return;
							}
							addTok(d);
							mock.html = d.html;
							// Every other screen borrows the homepage stylesheet, and
							// the server has just rewritten theirs too — so the cached
							// copies here are stale and must be fetched again.
							pageCache = { home: d.html };
							mock.innerHtml = '';
							if (Array.isArray(d.available) && d.available.length) { mock.pages = d.available; buildPageTabs(); }
							curPage = 'home';
							syncTabs('home');
							paint();
							if (editInput) { editInput.value = ''; }
							var said = d.summary || 'Done.';
							if (d.untouched && d.untouched.length) {
								said += ' (' + d.untouched.join(', ') + ' is drawn by us and was left as it is.)';
							}
							if (d.notes && d.notes.length) { said += ' ' + d.notes.join(' '); }
							if (editNote) { editNote.textContent = said; }
						})
						.catch(function () {
							if (editNote) { editNote.textContent = 'The change could not be sent. Try again.'; }
						})
						.then(function () {
							if (editBtn) { editBtn.disabled = false; editBtn.textContent = 'Change it'; }
							if (editInput) { editInput.disabled = false; editInput.focus(); }
						});
				}

				if (editBtn) { editBtn.addEventListener('click', runDesignEdit); }
				if (editInput) {
					editInput.addEventListener('keydown', function (e) {
						if (e.key === 'Enter') { e.preventDefault(); runDesignEdit(); }
					});
				}

				var mways = $('wpab-ed-mockways');
				if (mways) {
					mways.innerHTML = '';
					if (ways.length) {
						var names = ['As generated'];
						for (var wi = 0; wi < ways.length; wi++) { names.push(ways[wi].name || ('Option ' + (wi + 1))); }
						for (var wj = 0; wj < names.length; wj++) {
							var wb = document.createElement('button');
							wb.type = 'button';
							wb.className = 'wpab-ed__mocktab' + (wj === 0 ? ' is-on' : '');
							wb.setAttribute('data-mockway', String(wj - 1));
							wb.textContent = names[wj];
							mways.appendChild(wb);
						}
						mways.hidden = false;
						mways.onclick = function (e) {
							var t = e.target;
							while (t && t !== mways && !t.getAttribute('data-mockway')) { t = t.parentNode; }
							if (!t || t === mways) { return; }
							var all = mways.querySelectorAll('[data-mockway]');
							for (var q2 = 0; q2 < all.length; q2++) { all[q2].classList.toggle('is-on', all[q2] === t); }
							curWay = parseInt(t.getAttribute('data-mockway'), 10);
							paint();
						};
					} else {
						mways.hidden = true;
						mways.onclick = null;
					}
				}

				// Shown BEFORE the first paint. A design's scroll-reveal hides its
				// blocks behind html.js and reveals them with an IntersectionObserver;
				// inside a hidden iframe that observer has nothing to measure against,
				// so the preview came up as a header over an empty page.
				if (wizard) { wizard.classList.add('is-design'); }
				wrap.hidden = false;

				paint();
				setBuildDetail('');

				// Two moments, one screen. Before the rest of the site exists the
				// only question is whether this direction is right — and answering
				// it costs one page, not eight. Once the pages are drawn the
				// question becomes whether to build.
				var hasPages = pageList().length > 1;

				if (wResult) {
					wResult.className = 'wpab-ed__wresult';
					wResult.textContent = hasPages
						? 'The site is designed' + tokLabel() + ' — walk through it on the left, then build.'
						: 'Here is the homepage' + tokLabel() + '. If the direction is right, we design the rest of the site from it.';
				}

				var useBtn = $('wpab-ed-mockuse');
				var goBtn = $('wpab-ed-mockgo');
				var briefBtn = $('wpab-ed-mockbrief');
				var redoBtn = $('wpab-ed-mockredo');

				if (useBtn) { useBtn.hidden = !hasPages; }
				if (goBtn) { goBtn.hidden = hasPages; }
				// Going back to the brief once other pages exist would throw them
				// away without saying so; at that point the way back is a new run.
				if (briefBtn) { briefBtn.hidden = hasPages; }

				function markDesign(status) {
					if (cfg.restDesignStatus && mock && mock.designId) {
						wpost(cfg.restDesignStatus, { designId: mock.designId, status: status }).catch(function () {});
					}
				}

				function leaveReview() {
					if (wizard) { wizard.classList.remove('is-design'); }
					wrap.hidden = true;
					if (meta) { meta.hidden = true; }
					if (wProgress) { wProgress.hidden = false; }
					if (wResult) { wResult.textContent = ''; }
				}

				if (goBtn) {
					goBtn.onclick = function () {
						if (!alive(myRun) || !mock.designId || !cfg.restDesignPages) { return; }
						leaveReview();
						runPages(myRun, sig, brief, mock);
					};
				}

				if (useBtn) {
					useBtn.onclick = function () {
						if (!alive(myRun)) { return; }
						markDesign('used');
						leaveReview();
						proceedFromMockup(myRun, sig, brief, mock);
					};
				}

				// Back to the words that produced this, with them still in the box.
				// Rewriting the brief is the cheapest fix available at this point,
				// and until now the only way to it was cancelling the whole run.
				if (briefBtn) {
					briefBtn.onclick = function () {
						if (!alive(myRun)) { return; }
						markDesign('rejected');
						genToken++;
						busy = false;
						if (wizard) { wizard.classList.remove('is-design'); }
						wrap.hidden = true;
						if (meta) { meta.hidden = true; }
						if (wProgress) { wProgress.hidden = true; }
						if (wForm) { wForm.style.display = ''; }
						if (wGo) { wGo.hidden = false; wGo.disabled = false; wGo.textContent = 'Generate theme'; }
						if (wCancel) { wCancel.textContent = 'Cancel'; }
						if (wResult) {
							wResult.className = 'wpab-ed__wresult';
							wResult.textContent = 'Change the brief and generate again.';
						}
						var box = $('wpab-ed-prompt');
						if (box) { box.focus(); }
					};
				}

				if (redoBtn) {
					redoBtn.onclick = function () {
						if (!alive(myRun)) { return; }
						markDesign('rejected');
						leaveReview();
						startDesignPhase(myRun, sig, brief, 'The previous design direction was rejected. Take a clearly different visual direction: a different palette family, a different typography feel, a different hero structure.');
					};
				}
			}

			// The rest of the site, drawn only once somebody has said the homepage
			// is right. It used to run inside the homepage job, which meant paying
			// for eight pages before seeing whether the direction was even close.
			function runPages(myRun, sig, brief, mock) {
				phaseProgress('design');
				setBuildDetail('Designing the rest of the site…');
				var started = Date.now();

				wpost(cfg.restDesignPages, { designId: mock.designId }, sig).then(function (sOut) {
					if (!alive(myRun)) { return; }
					var jobId = sOut && sOut.data && sOut.data.jobId;
					if (!jobId) { throw new Error(errText(sOut, 'Could not start the page step.')); }
					function poll() {
						if (!alive(myRun)) { throw new Error('Stopped.'); }
						if (Date.now() - started > 900000) { throw new Error('The page step timed out.'); }
						return delay(3500).then(function () {
							if (!alive(myRun)) { throw new Error('Stopped.'); }
							return wpost(cfg.restBuildJob, { jobId: jobId }, sig);
						}).then(function (jOut) {
							var d = (jOut && jOut.data) || {};
							if (d.status === 'done') { return d.result || {}; }
							if (d.status === 'error') { throw new Error(d.error || 'The page step failed.'); }
							if (!jOut.ok) { throw new Error(errText(jOut, 'The page step failed.')); }
							var prog = d.result && d.result.progress;
							setBuildDetail((prog && prog.note ? prog.note : 'Designing the rest of the site…')
								+ ' ' + Math.round((Date.now() - started) / 1000) + 's');
							return poll();
						});
					}
					return poll();
				}).then(function (out) {
					if (!alive(myRun) || !out) { return; }
					addTok(out);
					// The homepage object gains the rest of the site. Same object, so
					// everything downstream — the build context, the rail, the edit
					// loop — sees one design rather than two halves.
					var carry = ['pages', 'innerHtml', 'innerCss', 'pageHero', 'pagesCss',
						'archiveCss', 'archiveBody', 'notfoundCss', 'notfoundBody', 'pageFaults'];
					for (var i = 0; i < carry.length; i++) {
						if (out[carry[i]] !== undefined) { mock[carry[i]] = out[carry[i]]; }
					}
					showMockup(myRun, sig, brief, mock);
				}).catch(genFail(myRun));
			}

			function buildMockCtx(mock) {
				var frags = {};
				if (mock.header) { frags['header.php'] = mock.header; }
				if (mock.footer) { frags['footer.php'] = mock.footer; }
				var secs = mock.sections || [];
				for (var si2 = 0; si2 < secs.length; si2++) {
					var sc = secs[si2];
					if (sc && sc.slug && sc.html) { frags['template-parts/section-' + sc.slug + '.php'] = sc.html; }
				}
				var ctx = { css: mock.css || '', fonts: mock.fonts || [], fragments: frags };
				// Inner-page design pack: page-hero fragment + extra CSS for the
				// content templates and assets/css/inner.css.
				if (mock.pageHero || mock.innerCss) {
					ctx.inner = { css: mock.innerCss || '', pageHero: mock.pageHero || '' };
				}
				// The design stage produces a whole site now. Without these, the
				// build model invents its own buttons, blog listing and 404 — and
				// they match nothing that was approved above.
				// The rules every content page adds. These used to come from a
				// component sheet nobody could reach; they are cut from the real
				// pages now, and an older design still has its sheet.
				var extraCss = mock.pagesCss || mock.componentsCss || '';
				if (extraCss) { ctx.components = { css: extraCss }; }
				if (mock.archiveBody || mock.archiveCss) {
					ctx.archive = { css: mock.archiveCss || '', body: mock.archiveBody || '' };
				}
				if (mock.notfoundBody || mock.notfoundCss) {
					ctx.notFound = { css: mock.notfoundCss || '', body: mock.notfoundBody || '' };
				}
				return ctx;
			}

			function proceedFromMockup(myRun, sig, brief, mock) {
				var slugs = [];
				var secs = mock.sections || [];
				for (var si3 = 0; si3 < secs.length; si3++) { if (secs[si3] && secs[si3].slug) { slugs.push(secs[si3].slug); } }
				runPlan(myRun, sig, brief, slugs, buildMockCtx(mock), mock.sitePages || []);
			}

			function resumeRun(st) {
				if (busy) { return; }
				genToken++;
				var myRun = genToken;
				genAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
				var sig = genAbort ? genAbort.signal : undefined;
				tokIn = st.tokIn || 0; tokOut = st.tokOut || 0;
				beginBusyUI();
				stepState('plan', 'done');
				Promise.resolve().then(function () {
					return runPipeline(myRun, sig, st.brand || 'Custom Theme', st.blueprint, st.built, st.mock || null);
				}).catch(genFail(myRun));
			}

			if (wGo) { wGo.addEventListener('click', generateTheme); }

			// Nothing here can be edited until a theme has been generated, so an
			// editor that opens onto an empty chat is a dead end: the AI can only
			// touch a theme this plugin made. When the active theme is not one,
			// the wizard is what the editor opens on.
			(function () {
				var picked = '';
				try {
					picked = new URLSearchParams(window.location.search).get('design') || '';
				} catch (e) { picked = ''; }

				// The design page IS the wizard: it opens straight away, and there
				// is nothing behind it to close back onto.
				if (cfg && cfg.mode === 'design') {
					closeWizard = function () {
						if (busy) { return; }
						window.location.href = cfg.dashboardUrl || cfg.editorUrl || '';
					};
					if (picked) { setTimeout(function () { startFromDesign(picked); }, 60); }
					else { setTimeout(openWizard, 40); }
					return;
				}

				// Arriving from the design archive with a design chosen: that IS the
				// intent, so it wins over the empty wizard.
				if (picked) {
					setTimeout(function () { startFromDesign(picked); }, 60);
					return;
				}

				// Nothing here can be edited until a theme has been generated — the
				// writer refuses any theme this plugin did not make. The editor
				// used to answer that by opening the wizard over itself; making a
				// theme is its own job now, so it sends you there instead of
				// pretending the chat behind the overlay is usable.
				var t = (cfg && cfg.theme) || {};
				if (!t.generated && cfg.designUrl) {
					window.location.replace(cfg.designUrl);
				}
			})();
		})();
		</script>
		<?php
	}
}
