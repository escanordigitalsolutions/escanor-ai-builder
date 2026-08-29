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
			'/editor/edit-plan',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_edit_plan' ),
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
	public static function rest_design_html( WP_REST_Request $request ) {
		$params    = self::json_params( $request );
		$design_id = isset( $params['designId'] ) ? trim( (string) $params['designId'] ) : '';

		if ( '' === $design_id ) {
			return new WP_Error( 'wpab_dhtml_bad', 'A designId is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/design-html', array( 'designId' => $design_id ), 20 );

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Design archive: mark a design used/rejected on the SaaS. Best-effort. */
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
		$result = WPAB_Cloud::request( 'agent/edit-theme', $edit_payload, 180 );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$files = ( isset( $result['files'] ) && is_array( $result['files'] ) ) ? $result['files'] : array();

		if ( empty( $files ) ) {
			$msg = isset( $result['error'] ) ? (string) $result['error'] : 'The editor returned no changes.';
			return new WP_Error( 'wpab_edit_empty_files', $msg, array( 'status' => 502 ) );
		}

		$applied = WPAB_Theme_Writer::update( $files );

		if ( is_wp_error( $applied ) ) {
			return $applied;
		}

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

		$applied = WPAB_Theme_Writer::update( $files );

		if ( is_wp_error( $applied ) ) {
			// Keep the already-working theme rather than failing generation.
			return new WP_REST_Response(
				array( 'success' => true, 'applied' => false, 'updated' => 0, 'summary' => $summary, 'usage' => $usage ),
				200
			);
		}

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

		if ( ! empty( $blueprint ) ) {
			try {
				$result['finalize'] = self::finalize_generated_site( $blueprint );
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
	private static function finalize_generated_site( array $blueprint ): array {
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

			$existing = get_page_by_path( $slug );

			if ( $existing instanceof WP_Post ) {
				$created[ $slug ] = (int) $existing->ID;
			} else {
				$id = wp_insert_post(
					array(
						'post_type'    => 'page',
						'post_status'  => 'publish',
						'post_title'   => $title,
						'post_name'    => $slug,
						'post_content' => '',
					),
					true
				);

				if ( is_wp_error( $id ) ) {
					continue;
				}

				$created[ $slug ] = (int) $id;
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

		return array(
			'ok'            => true,
			'pages_created' => count( $created ),
			'front_page'    => $front_id > 0,
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
		$payload = array( 'instruction' => $instruction );
		if ( isset( $params['plan'] ) && is_array( $params['plan'] ) ) {
			$payload['plan'] = array_slice( $params['plan'], 0, 8 );
		}
		if ( isset( $params['selected'] ) && is_string( $params['selected'] ) ) {
			$payload['selected'] = substr( $params['selected'], 0, 600 );
		}
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
		$applied = WPAB_Theme_Writer::update( $files );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}
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

	/** Edit planning: the cheap model turns an instruction into a numbered plan. */
	public static function rest_edit_plan( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';
		if ( '' === $instruction ) {
			return new WP_Error( 'wpab_plan_empty', 'An instruction is required.', array( 'status' => 400 ) );
		}
		$plan_payload = array( 'instruction' => $instruction );
		if ( isset( $params['selected'] ) && is_string( $params['selected'] ) ) {
			$plan_payload['selected'] = substr( $params['selected'], 0, 600 );
		}
		$result = WPAB_Cloud::request( 'agent/edit-plan', $plan_payload, 90 );
		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
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


	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$config = array(
			'restSession'     => esc_url_raw( rest_url( self::NAMESPACE . '/cloud/session' ) ),
			'restChat'        => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat' ) ),
			'restChatHistory' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/chat/history' ) ),
			'restEditPlan'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-plan' ) ),
			'restEditStart'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-start' ) ),
			'restEditApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-apply' ) ),
			'restContext'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/context' ) ),
			'restCreateTheme' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/create-theme' ) ),
			'restBuildPlan'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/plan' ) ),
			'restBuildFile'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/file' ) ),
			'restBuildFiles'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/files' ) ),
			'restBuildFilesStart' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/files-start' ) ),
			'restBuildJob'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/job' ) ),
			'restMockupStart' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/mockup-start' ) ),
			'restDesignStatus' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design/status' ) ),
			'restEditTheme'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/edit-theme' ) ),
			'restUndoEdit'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/undo-edit' ) ),
			'restReviewTheme' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/review-theme' ) ),
			'restDesignPlan'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/design-plan' ) ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'cloudPage'   => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'exitUrl'     => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'siteUrl'     => esc_url_raw( home_url( '/' ) ),
			'connected'   => (bool) WPAB_Cloud::has_key(),
		);
		?>
		<div class="wpab-ed" id="wpab-ed">
			<div class="wpab-ed__float">
				<button type="button" id="wpab-ed-newtheme" class="wpab-ed__newtheme">✨ New theme</button>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=wp-ai-builder' ) ); ?>" class="wpab-ed__exit">Exit</a>
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
						<iframe id="wpab-ed-mockframe" class="wpab-ed__mockframe" title="Design preview" sandbox="allow-scripts"></iframe>
						<div id="wpab-ed-mockmeta" class="wpab-ed__mockmeta" hidden></div>
						<div class="wpab-ed__mockactions">
							<button type="button" id="wpab-ed-mockuse" class="wpab-ed__wbtn">Use this design</button>
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

			<aside class="wpab-ed__chat" id="wpab-ed-chatpanel">
				<div id="wpab-ed-notice" class="wpab-ed__notice" hidden></div>
				<div id="wpab-ed-thread" class="wpab-ed__thread" aria-live="polite">
					<div class="wpab-ed__empty">
						<p>Ask anything about this site — or tell me what to change.</p>
					</div>
				</div>
				<form id="wpab-ed-form" class="wpab-ed__form" autocomplete="off">
					<div id="wpab-ed-selrow" class="wpab-ed__selrow" hidden>
						<span class="wpab-ed__seltag"><span class="tgt" id="wpab-ed-seltgt"></span><span class="sec" id="wpab-ed-selsec"></span><button type="button" class="x" id="wpab-ed-selclear" title="Remove selection">&times;</button></span>
					</div>
					<textarea id="wpab-ed-input" class="wpab-ed__input" rows="1" placeholder="Ask about this site…"></textarea>
					<div class="wpab-ed__formrow">
						<span class="wpab-ed__formtools">
							<button type="button" id="wpab-ed-new" class="wpab-ed__new">New chat</button>
							<button type="button" id="wpab-ed-history" class="wpab-ed__new" title="Chat history">History</button>
							<button type="button" id="wpab-ed-expand" class="wpab-ed__expand" title="Expand / shrink chat history">⤢</button>
							<button type="button" id="wpab-ed-inspect" class="wpab-ed__dev wpab-ed__inspect" title="Select an element on the page to edit" aria-pressed="false">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.5 18 2.2-7.3L21 12.5z"/><path d="M4 4l8.5 8.5"/></svg>
							</button>
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
				--ed-radius: 14px; --ed-shadow: 0 1px 2px rgba(20,18,16,.05), 0 10px 30px rgba(20,18,16,.09); --ed-shadow-lg: 0 24px 70px rgba(20,18,16,.20); }
			.wpab-ed__float { position: absolute; top: 14px; right: 16px; z-index: 20; display: flex; align-items: center; gap: 10px; }
			.wpab-ed__exit { color: var(--ed-muted); text-decoration: none; font-size: 13px; border: 1px solid var(--ed-border); border-radius: 9px; padding: 7px 14px; background: rgba(255,255,255,.85); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: var(--ed-shadow); }
			.wpab-ed__exit:hover { background: #fff; color: var(--ed-text); }
			.wpab-ed__newtheme { background: var(--ed-accent); color: #fff; border: 0; border-radius: 9px; padding: 8px 15px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(20,19,18,.22); }
			.wpab-ed__newtheme:hover { background: #000; }
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
			.wpab-ed__thread { flex: 0 1 auto; overflow-y: auto; max-height: 132px; padding: 20px 2px 12px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: none; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 34px); mask-image: linear-gradient(to bottom, transparent 0, #000 34px); }
			.wpab-ed__thread::-webkit-scrollbar { display: none; }
			.wpab-ed__chat.is-large .wpab-ed__thread { flex: 1 1 auto; overflow-y: auto; max-height: none; justify-content: flex-start; padding: 14px; -webkit-mask-image: none; mask-image: none; scrollbar-width: thin; }
			.wpab-ed__chat.is-large .wpab-ed__thread::-webkit-scrollbar { display: block; width: 8px; }
			.wpab-ed__empty { display: none; }
			.wpab-ed__chat.is-large .wpab-ed__empty { display: block; color: var(--ed-faint); font-size: 13px; line-height: 1.6; margin: 0; }
			.wpab-msg { display: flex; flex-direction: column; gap: 2px; animation: wpabmsgin .85s cubic-bezier(.16,.7,.2,1); transition: opacity 1.4s ease, transform 1.4s ease; }
			@keyframes wpabmsgin { from { opacity: 0; transform: translateY(22px) scale(.985); filter: blur(2px); } to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); } }
			.wpab-msg__role { display: none; }
			.wpab-msg__body { font-size: 13.5px; line-height: 1.55; color: #33312d; word-wrap: break-word; max-width: 82%; padding: 9px 14px; border-radius: 16px; background: rgba(255,255,255,.62); border: 1px solid rgba(255,255,255,.75); box-shadow: 0 10px 30px -14px rgba(20,19,18,.28); -webkit-backdrop-filter: blur(14px) saturate(1.25); backdrop-filter: blur(14px) saturate(1.25); align-self: flex-start; border-bottom-left-radius: 5px; }
			.wpab-ed__chat.is-large .wpab-msg__body { background: rgba(20,19,18,.05); border-color: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
			.wpab-msg--user { align-items: flex-end; }
			.wpab-msg--user .wpab-msg__body { background: rgba(20,19,18,.82); border-color: rgba(20,19,18,.6); color: #fff; align-self: flex-end; border-bottom-left-radius: 16px; border-bottom-right-radius: 5px; }
			.wpab-ed__chat.is-large .wpab-msg--user .wpab-msg__body { background: #141312; }
			.wpab-msg--user .wpab-msg__body a { color: #cfc9ff; }
			.wpab-msg--assistant .wpab-typing { align-self: flex-start; background: rgba(255,255,255,.62); border: 1px solid rgba(255,255,255,.75); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border-radius: 16px; border-bottom-left-radius: 5px; padding: 9px 14px; font-size: 13px; box-shadow: 0 10px 30px -14px rgba(20,19,18,.28); }
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
			.wpab-ed__send { appearance: none; border: 0; border-radius: 9px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--ed-accent); color: #fff; }
			.wpab-ed__send:hover:not(:disabled) { background: #000; }
			.wpab-ed__send:disabled { opacity: .55; cursor: default; }
			.wpab-ed__undo { margin-top: 8px; appearance: none; border: 1px solid var(--ed-border-strong); border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--ed-surface); color: var(--ed-text); }
			.wpab-ed__undo:hover:not(:disabled) { border-color: var(--ed-accent); color: var(--ed-accent); }
			.wpab-ed__undo:disabled { opacity: .55; cursor: default; }
			.wpab-ed__editdone { font-weight: 600; color: var(--ed-text); }
			.wpab-ed__selrow[hidden] { display: none !important; }
			.wpab-ed__selrow { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; animation: wpabmsgin .5s ease; }
			.wpab-ed__seltag { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; background: rgba(20,19,18,.06); border: 1px solid rgba(20,19,18,.12); border-radius: 9px; padding: 5px 10px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #141312; }
			.wpab-ed__seltag .tgt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
			.wpab-ed__seltag .sec { color: var(--ed-faint); font-family: inherit; }
			.wpab-ed__seltag .x { border: 0; background: none; cursor: pointer; color: var(--ed-muted); font-size: 13px; line-height: 1; padding: 0 2px; }
			.wpab-ed__seltag .x:hover { color: #141312; }
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
		.wpab-ed__framewrap { flex: 1; display: flex; justify-content: center; overflow: auto; background: #f1f0ee; min-height: 0; position: relative; }
		.wpab-ed__frameload[hidden] { display: none !important; }
		.wpab-ed__frameload { position: absolute; inset: 0; z-index: 12; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(241,240,238,.66); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
		.wpab-ed__spin { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(20,19,18,.15); border-top-color: #141312; animation: wpabspin .8s linear infinite; }
		@keyframes wpabspin { to { transform: rotate(360deg); } }
		.wpab-ed__frameloadtxt { font-size: 12.5px; color: #5c5955; font-weight: 500; }
		.wpab-ed__framewrap .wpab-ed__frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; transition: width .25s ease; }
		.wpab-ed__framewrap.is-laptop .wpab-ed__frame { width: 1280px; max-width: 100%; }
		.wpab-ed__framewrap.is-tablet .wpab-ed__frame { width: 834px; max-width: 100%; border-left: 1px solid rgba(20,19,18,.08); border-right: 1px solid rgba(20,19,18,.08); }
		.wpab-ed__framewrap.is-mobile .wpab-ed__frame { width: 390px; max-width: 100%; border-left: 1px solid rgba(20,19,18,.08); border-right: 1px solid rgba(20,19,18,.08); }
		.wpab-ed__wbtn { background: #141312 !important; box-shadow: none !important; border-radius: 10px; }
		.wpab-ed__wbtn:hover { background: #000 !important; }
		.wpab-ed__wbtn--ghost { background: transparent !important; color: #4b4945 !important; border: 1px solid rgba(20,19,18,.22) !important; }
		.wpab-ed__wbtn--ghost:hover { background: rgba(20,19,18,.05) !important; color: #141312 !important; }
		.wpab-ed__wizard.is-design .wpab-ed__wcard { max-width: min(1400px, 96vw); width: 100%; }
		.wpab-ed__mockmeta { margin-top: 10px; font-size: 12.5px; line-height: 1.55; color: var(--ed-muted); background: rgba(20,19,18,.04); border: 1px solid rgba(20,19,18,.07); border-radius: 12px; padding: 10px 14px; }
		.wpab-ed__mockmeta b { color: #141312; }
		.wpab-ed__wizard.is-design .wpab-ed__mockframe { height: 68vh; }
		.wpab-ed__mockwrap { margin-top: 14px; }
		.wpab-ed__mockframe { width: 100%; height: 440px; border: 1px solid rgba(20,18,16,0.1); border-radius: 12px; background: #fff; display: block; }
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
				}).then(function (r) {
					return r.text().then(function (t) {
						var j = null;
						try { j = t ? JSON.parse(t) : null; } catch (pe) { j = null; }
						return { ok: r.ok, status: r.status, data: j };
					});
				});
			}
			function addMessage(role, body, sel) {
				var empty = thread.querySelector('.wpab-ed__empty');
				if (empty) { empty.remove(); }
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--' + role;
				if (sel) {
					var chip = document.createElement('span');
					chip.className = 'wpab-ed__seltag';
					chip.innerHTML = '<span class="tgt"></span><span class="sec"></span>';
					chip.firstChild.textContent = '\u2316 ' + sel.short;
					chip.lastChild.textContent = sel.sec ? '\u00b7 ' + sel.sec : '';
					wrap.appendChild(chip);
				}
				var html = role === 'assistant' ? renderMarkdown(body) : escapeHtml(body);
				wrap.innerHTML = '<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="wpab-msg__body">' + html + '</div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight;
				return wrap;
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
			function addUndoMessage(summary, files, inspected) {
				var wrap = addMessage('assistant', '');
				var mbody = wrap.querySelector('.wpab-msg__body');
				if (!mbody) { return; }
				var head = document.createElement('div');
				head.className = 'wpab-ed__editdone';
				head.textContent = '✓ ' + (summary || 'Theme updated.');
				mbody.appendChild(head);
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
			function runEdit(instruction) {
				var typing = addTyping();
				var t = typing.querySelector('.wpab-typing');
				if (t) { t.textContent = 'Planning the change…'; }
				frameBusy(true, 'Planning the change…');
				var planPromise = cfg.restEditPlan
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
						addUndoMessage(data.summary, data.files, data.inspected);
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
										finishOk(aOut.data);
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

			function sendChat(message, displayText, sel) {
				addMessage('user', displayText || message, sel || null);
				setBusy(true);
				var typing = addTyping();
				var body = { message: message };
				if (conversationId) { body.conversationId = conversationId; }
				api('POST', cfg.restChat, body).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						frameBusy(false);
						addMessage('assistant', (out.data && (out.data.message || out.data.error)) || 'Something went wrong. Please try again.');
						return;
					}
					if (out.data.conversationId) { rememberConv(out.data.conversationId); }
					var answer = out.data.answer || out.data.reply;
					if (answer) { addMessage('assistant', answer); }
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
					var full = sel ? sel.full + ' \u2014 ' + v : v;
					sendChat(full, v, sel);
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
					try { localStorage.removeItem('wpabChatConv'); } catch (e) {}
					thread.innerHTML = '<p class="wpab-ed__empty">Ask anything about this site — its theme, templates, pages or content.</p>';
				});
			}

			// ---- Chat archive: restore the last conversation, browse older ones. ----
			function rememberConv(id) {
				conversationId = id || conversationId;
				try { if (conversationId) { localStorage.setItem('wpabChatConv', conversationId); } } catch (e) {}
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
			// Restore the last conversation on load.
			(function () {
				if (!cfg.connected) { return; }
				var saved = null;
				try { saved = localStorage.getItem('wpabChatConv'); } catch (e) {}
				if (saved) { loadConversation(saved); }
			})();

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
				frame.src = cfg.siteUrl;
			}

			// Preview device sizes.
			// ---- Inspect tool: pick an element in the preview, paste its
			// structure into the chat so the edit targets exactly that. ----
			var inspectBtn = $('wpab-ed-inspect');
			var inspectOn = false;
			var inspectDoc = null;
			var inspectHovered = null;

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
				var full = 'Selected element: ' + parts.join(' > ');
				if (secName) { full += ' (inside ' + secName + ')'; }
				if (txt) { full += ', text: "' + txt + (txt.length >= 60 ? '\u2026' : '') + '"'; }
				return { full: full, short: parts[parts.length - 1] || 'element', sec: secName };
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
					try { inspectHovered.style.outline = ''; inspectHovered.style.outlineOffset = ''; } catch (e) {}
					inspectHovered = null;
				}
				if (inspectDoc) {
					try {
						inspectDoc.removeEventListener('mouseover', inspectHover, true);
						inspectDoc.removeEventListener('click', inspectClick, true);
						if (inspectDoc.body) { inspectDoc.body.style.cursor = ''; }
					} catch (e) {}
					inspectDoc = null;
				}
			}
			function inspectHover(e) {
				if (inspectHovered && inspectHovered !== e.target) {
					try { inspectHovered.style.outline = ''; inspectHovered.style.outlineOffset = ''; } catch (er) {}
				}
				inspectHovered = e.target;
				try {
					inspectHovered.style.outline = '2px solid #141312';
					inspectHovered.style.outlineOffset = '2px';
				} catch (er) {}
			}
			function inspectClick(e) {
				e.preventDefault();
				e.stopPropagation();
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
					doc.body.style.cursor = 'crosshair';
					return true;
				} catch (e) { return false; }
			}
			function setInspect(on) {
				inspectOn = !!on;
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
					});
				}
			})();

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
					chatPanel.classList.toggle('is-large');
					var large = chatPanel.classList.contains('is-large');
					expandBtn.textContent = large ? '⤡' : '⤢';
					thread.scrollTop = thread.scrollHeight;
				});
			}

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
			var MAX_FILES = 60;

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
			function closeWizard() { if (wizard && !busy) { wizard.hidden = true; } }

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
				if (themeWritten) { clearGenState(); setTimeout(function () { location.reload(); }, 1800); }
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

			// The build pipeline from a blueprint: batches -> write -> refine -> check.
			// prevBuilt carries already-generated files when resuming an earlier run.
			function runPipeline(myRun, sig, brand, blueprint, prevBuilt, mockCtx) {
				var files = (blueprint.files || []).filter(function (pp) { return typeof pp === 'string' && pp; });
				if (!files.length) { throw new Error('The plan returned no files.'); }
				if (files.length > MAX_FILES) { files = files.slice(0, MAX_FILES); }

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
				var SOLO = { 'assets/css/main.css': 1, 'assets/css/base.css': 1, 'assets/js/main.js': 1, 'functions.php': 1 };
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
						return wpost(cfg.restCreateTheme, {
							brand: brand,
							description: (blueprint.theme && blueprint.theme.description) || '',
							files: built,
							blueprint: blueprint
						}, sig).then(function (cOut) {
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
							return reviewPass(myRun, sig, 'check', 'any invisible or hidden content, header/nav or mobile-menu selector mismatches, PHP errors, horizontal overflow, or empty image placeholders').then(function () {
								if (!alive(myRun)) { return; }
								finishAllSteps();
								if (wResult) { wResult.className = 'wpab-ed__wresult is-ok'; wResult.textContent = '✓ “' + themeName + '” is ready (' + extra + tokLabel() + '), designed and activated. Reloading…'; }
								setTimeout(function () { location.reload(); }, 1500);
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

			function runPlan(myRun, sig, brief, mockupSections, mockCtx) {
				phaseProgress('plan');
				setBuildDetail('Planning the pages…');
				wpost(cfg.restBuildPlan, { brief: brief, mockupSections: mockupSections || [] }, sig).then(function (out) {
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
						if (Date.now() - started > 480000) { throw new Error('The design step timed out.'); }
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
					if (parts.length) { meta.innerHTML = parts.join('<br>'); meta.hidden = false; } else { meta.hidden = true; }
				}
				if (!wrap || !frame) { return proceedFromMockup(myRun, sig, brief, mock); }
				if (wProgress) { wProgress.hidden = true; }
				var guard = '<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a"):null;if(a){e.preventDefault();}},true);document.addEventListener("submit",function(e){e.preventDefault();},true);<' + '/script>';
				var doc = String(mock.html || '');
				frame.srcdoc = (doc.indexOf('</body>') !== -1) ? doc.replace('</body>', guard + '</body>') : doc + guard;
				if (wizard) { wizard.classList.add('is-design'); }
				wrap.hidden = false;
				setBuildDetail('');
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = 'Review the design' + tokLabel() + ' — use it, or try another direction.'; }
				var useBtn = $('wpab-ed-mockuse');
				var redoBtn = $('wpab-ed-mockredo');
				function markDesign(status) {
					if (cfg.restDesignStatus && mock && mock.designId) {
						wpost(cfg.restDesignStatus, { designId: mock.designId, status: status }).catch(function () {});
					}
				}
				if (useBtn) {
					useBtn.onclick = function () {
						if (!alive(myRun)) { return; }
						markDesign('used');
						if (wizard) { wizard.classList.remove('is-design'); }
						wrap.hidden = true;
						if (meta) { meta.hidden = true; }
						if (wProgress) { wProgress.hidden = false; }
						if (wResult) { wResult.textContent = ''; }
						proceedFromMockup(myRun, sig, brief, mock);
					};
				}
				if (redoBtn) {
					redoBtn.onclick = function () {
						if (!alive(myRun)) { return; }
						markDesign('rejected');
						if (wizard) { wizard.classList.remove('is-design'); }
						wrap.hidden = true;
						if (meta) { meta.hidden = true; }
						if (wProgress) { wProgress.hidden = false; }
						if (wResult) { wResult.textContent = ''; }
						startDesignPhase(myRun, sig, brief, 'The previous design direction was rejected. Take a clearly different visual direction: a different palette family, a different typography feel, a different hero structure.');
					};
				}
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
				return { css: mock.css || '', fonts: mock.fonts || [], fragments: frags };
			}

			function proceedFromMockup(myRun, sig, brief, mock) {
				var slugs = [];
				var secs = mock.sections || [];
				for (var si3 = 0; si3 < secs.length; si3++) { if (secs[si3] && secs[si3].slug) { slugs.push(secs[si3].slug); } }
				runPlan(myRun, sig, brief, slugs, buildMockCtx(mock));
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
		})();
		</script>
		<?php
	}
}
