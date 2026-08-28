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
		$params = self::json_params( $request );
		$brief  = isset( $params['brief'] ) && is_array( $params['brief'] ) ? $params['brief'] : array();

		if ( empty( $brief ) ) {
			return new WP_Error( 'wpab_plan_empty', 'A brief is required.', array( 'status' => 400 ) );
		}

		$result = WPAB_Cloud::request( 'agent/build-plan', array( 'brief' => $brief ), 90 );

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

		$result = WPAB_Cloud::request(
			'agent/build-files',
			array(
				'blueprint' => $blueprint,
				'paths'     => $paths,
			),
			180
		);

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
	}

	/** Phase F: edit the active generated theme from a plain-language instruction. */
	public static function rest_edit_theme( WP_REST_Request $request ) {
		$params      = self::json_params( $request );
		$instruction = isset( $params['instruction'] ) ? trim( (string) $params['instruction'] ) : '';

		if ( '' === $instruction ) {
			return new WP_Error( 'wpab_edit_empty', 'An instruction is required.', array( 'status' => 400 ) );
		}
		if ( strlen( $instruction ) > 2000 ) {
			$instruction = substr( $instruction, 0, 2000 );
		}

		$result = WPAB_Cloud::request( 'agent/edit-theme', array( 'instruction' => $instruction ), 180 );

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

		if ( empty( $files ) ) {
			return new WP_REST_Response(
				array( 'success' => true, 'applied' => false, 'updated' => 0, 'summary' => $summary ),
				200
			);
		}

		$applied = WPAB_Theme_Writer::update( $files );

		if ( is_wp_error( $applied ) ) {
			// Keep the already-working theme rather than failing generation.
			return new WP_REST_Response(
				array( 'success' => true, 'applied' => false, 'updated' => 0, 'summary' => $summary ),
				200
			);
		}

		return new WP_REST_Response(
			array(
				'success' => true,
				'applied' => true,
				'updated' => isset( $applied['updated'] ) ? (int) $applied['updated'] : count( $files ),
				'summary' => $summary,
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
			'restContext'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/context' ) ),
			'restCreateTheme' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/create-theme' ) ),
			'restBuildPlan'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/plan' ) ),
			'restBuildFile'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/file' ) ),
			'restBuildFiles'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/files' ) ),
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
					</div>

					<div id="wpab-ed-wprogress" class="wpab-ed__wprogress" hidden>
						<ol class="wpab-ed__steps" id="wpab-ed-steps">
							<li class="wpab-ed__step" data-phase="plan"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Setting the art direction</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="build"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Building the theme</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="write"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Writing files</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="refine"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Elevating the design</span><span class="wpab-ed__stepmeta"></span></li>
							<li class="wpab-ed__step" data-phase="check"><span class="wpab-ed__stepicon"></span><span class="wpab-ed__steptext">Final quality check</span><span class="wpab-ed__stepmeta"></span></li>
						</ol>
						<div class="wpab-ed__wbar"><span id="wpab-ed-wbarfill" class="wpab-ed__wbarfill"></span></div>
						<div id="wpab-ed-wstep" class="wpab-ed__wstep"></div>
					</div>

					<div id="wpab-ed-wresult" class="wpab-ed__wresult"></div>

					<div class="wpab-ed__wactions">
						<button type="button" id="wpab-ed-wcancel" class="wpab-ed__wbtn wpab-ed__wbtn--ghost">Cancel</button>
						<button type="button" id="wpab-ed-wgo" class="wpab-ed__wbtn">Generate theme</button>
					</div>
				</div>
			</div>

			<div class="wpab-ed__preview">
				<iframe id="wpab-ed-frame" class="wpab-ed__frame" title="Site preview"></iframe>
			</div>

			<aside class="wpab-ed__chat" id="wpab-ed-chatpanel">
				<div class="wpab-ed__chathead">
					<span class="wpab-ed__chattitle">AI chat</span>
					<button type="button" id="wpab-ed-expand" class="wpab-ed__expand" title="Expand / shrink">⤢</button>
				</div>
				<div id="wpab-ed-notice" class="wpab-ed__notice" hidden></div>
				<div id="wpab-ed-thread" class="wpab-ed__thread" aria-live="polite">
					<div class="wpab-ed__empty">
						<p>Ask anything about this site — its theme, templates, pages or content.</p>
						<button type="button" id="wpab-ed-newtheme2" class="wpab-ed__newtheme" style="margin-top:10px">✨ Generate a custom theme</button>
					</div>
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

		<style>
			#wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
			#wpfooter, #wpadminbar, #adminmenumain, #adminmenuwrap, #adminmenuback { display: none !important; }
			html.wp-toolbar { padding-top: 0 !important; }
			#wpcontent { margin-left: 0 !important; }
			.wpab-ed { position: fixed; inset: 0; z-index: 99990; background: var(--ed-bg); color: var(--ed-text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
				--ed-bg: #f6f5f3; --ed-surface: #ffffff; --ed-surface-2: #faf9f7; --ed-border: #e8e5df; --ed-border-strong: #d9d5cc;
				--ed-text: #1b1a18; --ed-muted: #6f6b64; --ed-faint: #9b968d; --ed-accent: #6366f1; --ed-accent-2: #8b5cf6; --ed-accent-soft: rgba(99,102,241,.1);
				--ed-radius: 14px; --ed-shadow: 0 1px 2px rgba(20,18,16,.05), 0 10px 30px rgba(20,18,16,.09); --ed-shadow-lg: 0 24px 70px rgba(20,18,16,.20); }
			.wpab-ed__float { position: absolute; top: 14px; right: 16px; z-index: 20; display: flex; align-items: center; gap: 10px; }
			.wpab-ed__exit { color: var(--ed-muted); text-decoration: none; font-size: 13px; border: 1px solid var(--ed-border); border-radius: 9px; padding: 7px 14px; background: rgba(255,255,255,.85); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: var(--ed-shadow); }
			.wpab-ed__exit:hover { background: #fff; color: var(--ed-text); }
			.wpab-ed__newtheme { background: var(--ed-accent); color: #fff; border: 0; border-radius: 9px; padding: 8px 15px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(99,102,241,.3); }
			.wpab-ed__newtheme:hover { background: #5457e5; }
			.wpab-ed__wizard { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: radial-gradient(1200px 620px at 50% -12%, rgba(99,102,241,.14), transparent 60%), rgba(28,26,22,.32); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); padding: 24px; }
			.wpab-ed__wizard[hidden] { display: none !important; }
			.wpab-ed__wcard { position: relative; width: 100%; max-width: 500px; max-height: 88vh; overflow-y: auto; background: rgba(255,255,255,.86); border: 1px solid rgba(20,18,16,.08); border-radius: 20px; padding: 28px; box-shadow: var(--ed-shadow-lg); -webkit-backdrop-filter: blur(22px) saturate(1.3); backdrop-filter: blur(22px) saturate(1.3); animation: wpab-ed-cardin .45s cubic-bezier(.2,.75,.25,1); }
			.wpab-ed__wcard::before { content: ""; position: absolute; inset: 0; border-radius: 20px; padding: 1px; background: linear-gradient(135deg, rgba(99,102,241,.4), rgba(139,92,246,.12) 42%, transparent 72%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
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
			.wpab-ed__step.is-active .wpab-ed__stepicon { border-color: rgba(99,102,241,.25); border-top-color: var(--ed-accent); border-right-color: var(--ed-accent); animation: wpab-ed-spin .7s linear infinite; }
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
			.wpab-ed__wbtn:hover:not(:disabled) { background: #5457e5; }
			.wpab-ed__wbtn:disabled { opacity: .55; cursor: default; }
			.wpab-ed__wbtn--ghost { background: transparent; border: 1px solid var(--ed-border-strong); color: var(--ed-muted); box-shadow: none; }
			.wpab-ed__wbtn--ghost:hover:not(:disabled) { background: var(--ed-surface-2); color: var(--ed-text); }
			.wpab-ed__preview { position: absolute; inset: 0; background: #fff; }
			.wpab-ed__frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
			.wpab-ed__chat { position: absolute; left: 25%; width: 50%; bottom: 14px; z-index: 15; height: 340px; min-height: 80px; max-height: 78vh; display: flex; flex-direction: column; background: rgba(255,255,255,.9); border: 1px solid var(--ed-border); border-radius: var(--ed-radius); box-shadow: var(--ed-shadow-lg); -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3); overflow: hidden; }
			.wpab-ed__chat.is-large { height: 78vh; }
			@media (max-width: 1100px) { .wpab-ed__chat { left: 6%; width: 88%; } }
			.wpab-ed__chathead { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--ed-border); flex: 0 0 auto; }
			.wpab-ed__chattitle { font-size: 12px; font-weight: 600; color: var(--ed-muted); letter-spacing: .04em; text-transform: uppercase; }
			.wpab-ed__expand { background: none; border: 0; color: var(--ed-muted); font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 7px; border-radius: 6px; }
			.wpab-ed__expand:hover { background: var(--ed-surface-2); color: var(--ed-text); }
			.wpab-ed__notice { margin: 12px; padding: 11px 13px; border-radius: 10px; background: #fdecec; border: 1px solid #f5c2c2; color: #b42318; font-size: 13px; }
			.wpab-ed__notice a { color: #b42318; }
			.wpab-ed__thread { flex: 1 1 auto; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
			.wpab-ed__empty { color: var(--ed-faint); font-size: 13px; line-height: 1.6; margin: 0; }
			.wpab-msg { display: flex; flex-direction: column; gap: 5px; }
			.wpab-msg__role { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ed-faint); }
			.wpab-msg__body { font-size: 14px; line-height: 1.6; color: #33312d; word-wrap: break-word; }
			.wpab-msg__body code { background: var(--ed-surface-2); border: 1px solid var(--ed-border); padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
			.wpab-msg__body pre { background: var(--ed-surface-2); border: 1px solid var(--ed-border); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
			.wpab-msg__body a { color: var(--ed-accent); }
			.wpab-msg--user .wpab-msg__body { color: var(--ed-text); font-weight: 500; }
			.wpab-typing { color: var(--ed-muted); font-size: 13px; }
			.wpab-ed__form { border-top: 1px solid var(--ed-border); padding: 12px; flex: 0 0 auto; background: rgba(250,249,247,.7); }
			.wpab-ed__input { width: 100%; box-sizing: border-box; resize: none; background: var(--ed-surface); border: 1px solid var(--ed-border-strong); border-radius: 10px; color: var(--ed-text); font: inherit; font-size: 14px; padding: 10px 12px; max-height: 160px; }
			.wpab-ed__input::placeholder { color: var(--ed-faint); }
			.wpab-ed__input:focus { outline: none; border-color: var(--ed-accent); box-shadow: 0 0 0 3px var(--ed-accent-soft); }
			.wpab-ed__formrow { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
			.wpab-ed__new { background: none; border: 0; color: var(--ed-muted); font-size: 12px; cursor: pointer; }
			.wpab-ed__new:hover { color: var(--ed-text); }
			.wpab-ed__send { appearance: none; border: 0; border-radius: 9px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--ed-accent); color: #fff; }
			.wpab-ed__send:hover:not(:disabled) { background: #5457e5; }
			.wpab-ed__send:disabled { opacity: .55; cursor: default; }
			.wpab-ed__undo { margin-top: 8px; appearance: none; border: 1px solid var(--ed-border-strong); border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--ed-surface); color: var(--ed-text); }
			.wpab-ed__undo:hover:not(:disabled) { border-color: var(--ed-accent); color: var(--ed-accent); }
			.wpab-ed__undo:disabled { opacity: .55; cursor: default; }
			.wpab-ed__editdone { font-weight: 600; color: var(--ed-text); }
			.wpab-ed__chips2 { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
			.wpab-ed__chipslead { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--ed-faint); margin-right: 2px; }
			.wpab-ed__filechip { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; background: var(--ed-accent-soft); border: 1px solid rgba(99,102,241,.2); color: var(--ed-accent); font-size: 11.5px; font-weight: 600; }
			.wpab-ed__editdone + .wpab-ed__chips2 + .wpab-ed__undo, .wpab-ed__chips2 + .wpab-ed__undo { margin-top: 10px; }
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

			function reloadPreview() {
				var fr = $('wpab-ed-frame');
				if (!fr) { return; }
				try { fr.contentWindow.location.reload(); } catch (e) { fr.src = fr.src; }
			}
			function addUndoMessage(summary, files) {
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
			function runEdit(instruction) {
				var typing = addTyping();
				var t = typing.querySelector('.wpab-typing'); if (t) { t.textContent = 'Applying your change…'; }
				return api('POST', cfg.restEditTheme, { instruction: instruction }).then(function (out) {
					typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						addMessage('assistant', (out.data && (out.data.message || out.data.error)) || 'Could not apply the change.');
						return;
					}
					addUndoMessage(out.data.summary, out.data.files);
					reloadPreview();
				}).catch(function () {
					typing.remove();
					addMessage('assistant', 'Network error applying the change.');
				});
			}

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
					var answer = out.data.answer || out.data.reply;
					if (answer) { addMessage('assistant', answer); }
					if (out.data.editRequest && out.data.editRequest.instruction) {
						return runEdit(out.data.editRequest.instruction);
					}
					if (!answer) { addMessage('assistant', '(no answer)'); }
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

			// Chat panel expand / shrink.
			var chatPanel = $('wpab-ed-chatpanel');
			var expandBtn = $('wpab-ed-expand');
			if (expandBtn && chatPanel) {
				expandBtn.addEventListener('click', function () {
					chatPanel.classList.toggle('is-large');
					expandBtn.textContent = chatPanel.classList.contains('is-large') ? '⤡' : '⤢';
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

			function openWizard() {
				if (!wizard) { return; }
				busy = false;
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = ''; }
				if (wProgress) { wProgress.hidden = true; }
				if (wBarFill) { wBarFill.style.width = '0'; }
				if (wForm) { wForm.style.display = ''; }
				if (wGo) { wGo.disabled = false; wGo.hidden = false; wGo.textContent = 'Generate theme'; }
				wizard.hidden = false;
				var p = $('wpab-ed-prompt'); if (p) { p.focus(); }
			}
			function closeWizard() { if (wizard && !busy) { wizard.hidden = true; } }

			var wOpen = $('wpab-ed-newtheme');
			var wOpen2 = $('wpab-ed-newtheme2');
			if (wOpen) { wOpen.addEventListener('click', openWizard); }
			if (wOpen2) { wOpen2.addEventListener('click', openWizard); }
			if (wCancel) { wCancel.addEventListener('click', closeWizard); }
			if (wizard) { wizard.addEventListener('click', function (e) { if (e.target === wizard) { closeWizard(); } }); }

			function wpost(url, payload) {
				return fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' },
					credentials: 'same-origin',
					body: JSON.stringify(payload || {})
				}).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); });
			}
			function setProgress(done, total, label) {
				if (wBarFill && total) { wBarFill.style.width = Math.round((done / total) * 100) + '%'; }
				if (wStepEl) { wStepEl.textContent = label || ''; }
			}
			function errText(out, fallback) { return (out && out.data && (out.data.message || out.data.error)) || fallback; }

			// Animated step feedback ------------------------------------------------
			var PHASES = ['plan', 'build', 'write', 'refine', 'check'];
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
				var map = { 'functions.php': 'theme setup', 'header.php': 'header', 'footer.php': 'footer', 'style.css': 'stylesheet', 'assets/css/main.css': 'design system', 'assets/js/main.js': 'interactions', 'front-page.php': 'home page' };
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

			function generateTheme() {
				if (!wGo || !cfg.restBuildPlan) { return; }
				var brief = collectBrief();
				if (!brief.prompt) {
					if (wResult) { wResult.className = 'wpab-ed__wresult is-err'; wResult.textContent = 'Please describe the website you want.'; }
					var pf = $('wpab-ed-prompt'); if (pf) { pf.focus(); }
					return;
				}

				busy = true;
				wGo.disabled = true;
				wGo.textContent = 'Generating…';
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = ''; }
				if (wForm) { wForm.style.display = 'none'; }
				if (wProgress) { wProgress.hidden = false; }
				for (var pi = 0; pi < PHASES.length; pi++) { stepState(PHASES[pi], ''); }
				phaseProgress('plan');
				setBuildDetail('Designing the layout, palette and sections…');

				// Correctness pass — non-fatal; resolves even if it fails.
				function reviewPass(phase, focus) {
					phaseProgress(phase);
					setBuildDetail('Scanning the theme for issues…');
					if (!cfg.restReviewTheme) { stepState(phase, 'done'); return Promise.resolve(); }
					return wpost(cfg.restReviewTheme, focus ? { focus: focus } : {}).then(function (rOut) {
						var d = (rOut && rOut.data) || {};
						var meta = d.applied ? ('fixed ' + (d.updated || 0)) : 'clean';
						stepState(phase, 'done', meta);
					}).catch(function () { stepState(phase, 'done'); });
				}

				// Staged design elevation: get a punch-list, then apply each target
				// one at a time (small, timeout-safe calls with live per-file steps).
				function designRevise(blueprint) {
					phaseProgress('refine');
					setBuildDetail('Reviewing the design against its concept…');
					if (!cfg.restDesignPlan || !cfg.restEditTheme) { stepState('refine', 'done'); return Promise.resolve(); }
					return wpost(cfg.restDesignPlan, { concept: (blueprint && blueprint.concept) || null, blueprint: blueprint }).then(function (pOut) {
						var targets = (pOut && pOut.data && Array.isArray(pOut.data.targets)) ? pOut.data.targets.slice(0, 6) : [];
						if (!targets.length) { stepState('refine', 'done', 'no changes'); return; }
						var i = 0, applied = 0;
						function nextTarget() {
							if (i >= targets.length) { stepState('refine', 'done', 'elevated ' + applied); return; }
							var t = targets[i]; i++;
							stepState('refine', 'active', i + '/' + targets.length);
							setBuildDetail('Elevating ' + friendlyName(t.path) + '…');
							if (!t || typeof t.instruction !== 'string' || !t.instruction) { return nextTarget(); }
							return wpost(cfg.restEditTheme, { instruction: t.instruction }).then(function (eOut) {
								if (eOut && eOut.data && eOut.data.success) { applied++; }
								return nextTarget();
							}).catch(function () { return nextTarget(); });
						}
						return nextTarget();
					}).catch(function () { stepState('refine', 'done'); });
				}

				wpost(cfg.restBuildPlan, { brief: brief }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false || !out.data.blueprint) {
						throw new Error(errText(out, 'Could not plan the theme.'));
					}
					stepState('plan', 'done');
					var blueprint = out.data.blueprint;
					var brand = brief.name || (blueprint.theme && blueprint.theme.name) || 'Custom Theme';
					var files = (blueprint.files || []).filter(function (pp) { return typeof pp === 'string' && pp; });
					if (!files.length) { throw new Error('The plan returned no files.'); }
					if (files.length > MAX_FILES) { files = files.slice(0, MAX_FILES); }

					var built = [];
					// Big, critical files each get their own batch so they never share a
					// token budget and get truncated; everything else is chunked by 3.
					var SOLO = { 'assets/css/main.css': 1, 'assets/js/main.js': 1, 'functions.php': 1 };
					var solo = [], rest = [];
					for (var fi = 0; fi < files.length; fi++) { (SOLO[files[fi]] ? solo : rest).push(files[fi]); }
					var batches = [];
					for (var si = 0; si < solo.length; si++) { batches.push([solo[si]]); }
					for (var bi = 0; bi < rest.length; bi += 3) { batches.push(rest.slice(bi, bi + 3)); }
					var totalB = batches.length;

					// Fetch a batch resiliently: retry on failure and re-request ONLY the
					// paths still missing (so a truncated final file never kills the run).
					function fetchBatchFiles(wanted, bIndex, total) {
						var collected = {};
						function attempt(paths, left) {
							return wpost(cfg.restBuildFiles, { blueprint: blueprint, paths: paths }).then(function (fOut) {
								var got = (fOut && fOut.data && Array.isArray(fOut.data.files)) ? fOut.data.files : [];
								for (var k = 0; k < got.length; k++) {
									var f = got[k];
									if (f && typeof f.path === 'string' && typeof f.contents === 'string') { collected[f.path] = f.contents; }
								}
								var missing = paths.filter(function (p) { return !collected[p]; });
								if (!missing.length) { return; }
								if (left > 1) { phaseProgress('build', (bIndex + 1) + '/' + total + ' · retry'); return attempt(missing, left - 1); }
								throw new Error(errText(fOut, 'Could not generate: ' + missing.join(', ')));
							}).catch(function (e) {
								var missing = wanted.filter(function (p) { return !collected[p]; });
								if (left > 1 && missing.length) { phaseProgress('build', (bIndex + 1) + '/' + total + ' · retry'); return attempt(missing, left - 1); }
								throw e;
							});
						}
						return attempt(wanted, 3).then(function () {
							return wanted.map(function (p) { return { path: p, contents: collected[p] }; }).filter(function (x) { return x.contents; });
						});
					}

					function runBatch(b) {
						if (b >= totalB) {
							stepState('build', 'done', totalB + ' batches');
							phaseProgress('write');
							setBuildDetail('Creating pages, front page and menu…');
							return wpost(cfg.restCreateTheme, {
								brand: brand,
								description: (blueprint.theme && blueprint.theme.description) || '',
								files: built,
								blueprint: blueprint
							}).then(function (cOut) {
								if (!cOut.ok || !cOut.data || cOut.data.success === false) {
									throw new Error(errText(cOut, 'Could not write the theme.'));
								}
								var fin = cOut.data.finalize || {};
								var extra = fin.pages_created ? (fin.pages_created + ' pages' + (fin.menu_built ? ' + menu' : '')) : (cOut.data.files_written || built.length) + ' files';
								stepState('write', 'done', extra);
								var themeName = cOut.data.name || brand;
								// Elevate the design (staged, per-file), then a final correctness
								// check to clean up anything the elevation touched. Both non-fatal.
								return designRevise(blueprint).then(function () {
									return reviewPass('check', 'any invisible or hidden content, header/nav or mobile-menu selector mismatches, JS using a library that functions.php does not enqueue, PHP errors, horizontal overflow, or empty image placeholders');
								}).then(function () {
									finishAllSteps();
									if (wResult) { wResult.className = 'wpab-ed__wresult is-ok'; wResult.textContent = '✓ “' + themeName + '” is ready (' + extra + '), designed and activated. Reloading…'; }
									setTimeout(function () { location.reload(); }, 1500);
								});
							});
						}
						phaseProgress('build', (b + 1) + '/' + totalB);
						setBuildDetail('Building ' + batchLabel(batches[b]) + '…');
						return fetchBatchFiles(batches[b], b, totalB).then(function (got) {
							for (var k = 0; k < got.length; k++) { built.push(got[k]); }
							return runBatch(b + 1);
						});
					}

					return runBatch(0);
				}).catch(function (err) {
					busy = false;
					if (wResult) { wResult.className = 'wpab-ed__wresult is-err'; wResult.textContent = (err && err.message) || 'Theme generation failed.'; }
					if (wForm) { wForm.style.display = ''; }
					if (wProgress) { wProgress.hidden = true; }
					wGo.disabled = false;
					wGo.textContent = 'Generate theme';
				});
			}

			if (wGo) { wGo.addEventListener('click', generateTheme); }
		})();
		</script>
		<?php
	}
}
