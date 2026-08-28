<?php
/**
 * REST surface consumed by the AI Builder.
 *
 * Every route below is authenticated by the bridge token and nothing else —
 * there is no cookie path into these, so a logged-in administrator browsing
 * the site cannot be tricked into anything via CSRF. This surface is
 * READ-ONLY: it lets the AI Editor inspect the theme and content, nothing more.
 *
 *   GET  /wp-json/wp-ai-builder/v1/status
 *   GET  /wp-json/wp-ai-builder/v1/project
 *   GET  /wp-json/wp-ai-builder/v1/manifest
 *   GET  /wp-json/wp-ai-builder/v1/files?scope=theme
 *   GET  /wp-json/wp-ai-builder/v1/file?scope=theme&path=style.css
 *   GET  /wp-json/wp-ai-builder/v1/content-types
 *   GET  /wp-json/wp-ai-builder/v1/content?type=page
 *   GET  /wp-json/wp-ai-builder/v1/content-item?type=page&id=12
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
					'read_files'   => true,
					'manifest'     => true,
					'read_content' => true,
					'cloud_client' => WPAB_Cloud::has_key(),
					'write_files'  => false,
					'delete_files' => false,
					'rename_files' => false,
				),

				'limits'  => array(
					'max_read_bytes'   => WPAB_Files::MAX_READ_BYTES,
					'max_listed_files' => WPAB_Files::MAX_FILES,
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
}
