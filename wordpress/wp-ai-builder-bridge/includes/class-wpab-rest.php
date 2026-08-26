<?php
/**
 * REST surface consumed by the AI Builder.
 *
 * Every route below is authenticated by the bridge token and nothing else —
 * there is no cookie path into these, so a logged-in administrator browsing
 * the site cannot be tricked into performing a deployment via CSRF.
 *
 *   GET  /wp-json/wp-ai-builder/v1/status
 *   GET  /wp-json/wp-ai-builder/v1/project
 *   GET  /wp-json/wp-ai-builder/v1/manifest
 *   GET  /wp-json/wp-ai-builder/v1/files?scope=theme
 *   GET  /wp-json/wp-ai-builder/v1/file?scope=theme&path=style.css
 *   POST /wp-json/wp-ai-builder/v1/preflight
 *   POST /wp-json/wp-ai-builder/v1/apply
 *   POST /wp-json/wp-ai-builder/v1/rollback
 *   GET  /wp-json/wp-ai-builder/v1/snapshots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_REST {

	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	private static function permission() {
		return array( 'WPAB_Auth', 'rest_permission' );
	}

	public static function register_routes(): void {
		$namespace = WPAB_REST_NAMESPACE;

		register_rest_route(
			$namespace,
			'/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'status' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/project',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'project' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/manifest',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'manifest' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/files',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'files' ),
				'permission_callback' => self::permission(),
				'args'                => array(
					'scope' => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'theme', 'plugin' ),
					),
				),
			)
		);

		register_rest_route(
			$namespace,
			'/file',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'file' ),
				'permission_callback' => self::permission(),
				'args'                => array(
					'scope' => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'theme', 'plugin' ),
					),
					'path'  => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			)
		);

		register_rest_route(
			$namespace,
			'/preflight',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'preflight' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/apply',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'apply' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/rollback',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rollback' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/snapshots',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'snapshots' ),
				'permission_callback' => self::permission(),
			)
		);

		// Native content visibility (Phase 1, read-only): pages, posts, custom
		// post types, WooCommerce products, menus, media. Lets the AI "see" the
		// site's real content, not just theme/plugin source files.
		register_rest_route(
			$namespace,
			'/content-types',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'content_types' ),
				'permission_callback' => self::permission(),
			)
		);

		register_rest_route(
			$namespace,
			'/content',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'content_list' ),
				'permission_callback' => self::permission(),
				'args'                => array(
					'type'  => array(
						'required' => true,
						'type'     => 'string',
					),
					'limit' => array(
						'required' => false,
						'type'     => 'integer',
					),
				),
			)
		);

		register_rest_route(
			$namespace,
			'/content-item',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'content_item' ),
				'permission_callback' => self::permission(),
				'args'                => array(
					'type' => array(
						'required' => true,
						'type'     => 'string',
					),
					'id'   => array(
						'required' => true,
						'type'     => 'integer',
					),
				),
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Native content (read-only)
	 * ------------------------------------------------------------------ */

	public static function content_types( WP_REST_Request $request ) {
		return new WP_REST_Response( WPAB_Content::types(), 200 );
	}

	public static function content_list( WP_REST_Request $request ) {
		$limit  = (int) $request->get_param( 'limit' );
		$result = WPAB_Content::listing(
			(string) $request->get_param( 'type' ),
			$limit > 0 ? $limit : 30
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	public static function content_item( WP_REST_Request $request ) {
		$result = WPAB_Content::get_item(
			(string) $request->get_param( 'type' ),
			(int) $request->get_param( 'id' )
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/* ---------------------------------------------------------------------
	 * Read routes
	 * ------------------------------------------------------------------ */

	public static function status( WP_REST_Request $request ) {
		$theme  = WPAB_Scopes::theme();
		$plugin = WPAB_Scopes::plugin();

		$syntax = WPAB_Writer::syntax_check( "<?php\n", 'probe.php' );

		return new WP_REST_Response(
			array(
				'success' => true,

				'bridge'  => array(
					'version'      => WPAB_VERSION,
					'namespace'    => WPAB_REST_NAMESPACE,
					'installed_at' => (string) get_option( 'wpab_installed_at', '' ),
					'token_set_at' => WPAB_Auth::created_at(),
				),

				'site'    => array(
					'url'          => home_url( '/' ),
					'rest_url'     => rest_url( WPAB_REST_NAMESPACE ),
					'name'         => get_bloginfo( 'name' ),
					'wp_version'   => get_bloginfo( 'version' ),
					'php_version'  => PHP_VERSION,
					'is_multisite' => is_multisite(),
					'locale'       => get_locale(),
					'timezone'     => wp_timezone_string(),
				),

				'theme'   => array(
					'name'       => isset( $theme['label'] ) ? $theme['label'] : null,
					'stylesheet' => isset( $theme['slug'] ) ? $theme['slug'] : null,
					'version'    => isset( $theme['version'] ) ? $theme['version'] : null,
					'is_child'   => ! empty( $theme['is_child'] ),
					'parent'     => isset( $theme['parent'] ) ? $theme['parent'] : null,
					'available'  => ! empty( $theme['available'] ),
				),

				'plugin'  => array(
					'name'      => isset( $plugin['label'] ) ? $plugin['label'] : null,
					'slug'      => isset( $plugin['slug'] ) ? $plugin['slug'] : null,
					'active'    => ! empty( $plugin['active'] ),
					'available' => ! empty( $plugin['available'] ),
				),

				// The builder gates its UI on these, so they describe what this
				// installation can actually do right now — not what the plugin
				// supports in principle.
				'capabilities' => array(
					'read_files'       => true,
					'manifest'         => true,
					'preflight'        => true,
					'controlled_write' => true,
					'write_files'      => WPAB_Writer::write_enabled(),
					'create_files'     => WPAB_Writer::write_enabled() && WPAB_Writer::create_enabled(),
					'snapshots'        => true,
					'rollback'         => true,
					'health_check'     => true,
					'syntax_check'     => 'unavailable' !== $syntax['status'],
					'risky_code_guard' => WPAB_Writer::guard_enabled(),
					'cloud_client'     => WPAB_Cloud::has_key(),
					'delete_files'     => false,
					'rename_files'     => false,
				),

				'limits'  => array(
					'max_files_per_apply' => WPAB_Writer::MAX_FILES_PER_APPLY,
					'max_file_bytes'      => WPAB_Writer::MAX_FILE_BYTES,
					'max_total_bytes'     => WPAB_Writer::MAX_TOTAL_BYTES,
					'max_read_bytes'      => WPAB_Files::MAX_READ_BYTES,
					'max_listed_files'    => WPAB_Files::MAX_FILES,
					'writable_extensions' => WPAB_Scopes::writable_extensions(),
					'snapshot_keep'       => WPAB_Writer::snapshot_keep(),
				),
			),
			200
		);
	}

	public static function project( WP_REST_Request $request ) {
		$scopes = WPAB_Scopes::describe();

		foreach ( array( 'theme', 'plugin' ) as $scope ) {
			if ( empty( $scopes[ $scope ]['available'] ) ) {
				$scopes[ $scope ]['file_count'] = 0;
				continue;
			}

			$walk = WPAB_Files::walk( $scope, false );

			$scopes[ $scope ]['file_count'] = is_wp_error( $walk ) ? 0 : count( $walk['files'] );
		}

		return new WP_REST_Response(
			array(
				'success'        => true,
				'bridge_version' => WPAB_VERSION,
				'site_url'       => home_url( '/' ),
				'scopes'         => $scopes,
			),
			200
		);
	}

	public static function manifest( WP_REST_Request $request ) {
		return new WP_REST_Response( WPAB_Files::manifest(), 200 );
	}

	public static function files( WP_REST_Request $request ) {
		$result = WPAB_Files::listing( (string) $request->get_param( 'scope' ) );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	public static function file( WP_REST_Request $request ) {
		$result = WPAB_Files::read(
			(string) $request->get_param( 'scope' ),
			(string) $request->get_param( 'path' )
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	/* ---------------------------------------------------------------------
	 * Write routes
	 * ------------------------------------------------------------------ */

	private static function files_param( WP_REST_Request $request ) {
		$body = $request->get_json_params();

		if ( ! is_array( $body ) || ! isset( $body['files'] ) || ! is_array( $body['files'] ) ) {
			return new WP_Error(
				'wpab_missing_files',
				'A files array is required.',
				array( 'status' => 400 )
			);
		}

		return $body['files'];
	}

	public static function preflight( WP_REST_Request $request ) {
		$files = self::files_param( $request );

		if ( is_wp_error( $files ) ) {
			return $files;
		}

		// A preflight always answers 200: "not ready" is a valid answer, not a
		// transport failure, and the builder renders the per-file reasons.
		return new WP_REST_Response( WPAB_Writer::preflight( $files ), 200 );
	}

	public static function apply( WP_REST_Request $request ) {
		$body  = $request->get_json_params();
		$files = self::files_param( $request );

		if ( is_wp_error( $files ) ) {
			return $files;
		}

		$proposal_id = isset( $body['proposal_id'] ) ? sanitize_text_field( (string) $body['proposal_id'] ) : '';

		if ( '' === $proposal_id ) {
			return new WP_Error( 'wpab_missing_proposal', 'A proposal_id is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Writer::apply( $proposal_id, $files );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	public static function rollback( WP_REST_Request $request ) {
		$body = $request->get_json_params();

		$snapshot_id = is_array( $body ) && isset( $body['snapshot_id'] )
			? sanitize_text_field( (string) $body['snapshot_id'] )
			: '';

		if ( '' === $snapshot_id ) {
			return new WP_Error( 'wpab_missing_snapshot', 'A snapshot_id is required.', array( 'status' => 400 ) );
		}

		$force = is_array( $body ) && ! empty( $body['force'] );

		$result = WPAB_Writer::rollback( $snapshot_id, $force );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	public static function snapshots( WP_REST_Request $request ) {
		return new WP_REST_Response( WPAB_Writer::snapshots(), 200 );
	}
}
