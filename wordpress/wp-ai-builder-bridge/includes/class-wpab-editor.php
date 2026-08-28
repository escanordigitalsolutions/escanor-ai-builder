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

		return is_wp_error( $result ) ? $result : new WP_REST_Response( $result, 200 );
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
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'cloudPage'   => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder-cloud' ) ),
			'exitUrl'     => esc_url_raw( admin_url( 'admin.php?page=wp-ai-builder' ) ),
			'siteUrl'     => esc_url_raw( home_url( '/' ) ),
			'connected'   => (bool) WPAB_Cloud::has_key(),
		);
		?>
		<div class="wpab-ed" id="wpab-ed">
			<header class="wpab-ed__top">
				<div class="wpab-ed__brand">
					<span class="wpab-ed__dot"></span>
					<span class="wpab-ed__name">AI Editor</span>
					<span id="wpab-ed-theme" class="wpab-ed__theme"></span>
				</div>
				<div class="wpab-ed__actions">
					<button type="button" id="wpab-ed-newtheme" class="wpab-ed__newtheme">New theme</button>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=wp-ai-builder' ) ); ?>" class="wpab-ed__exit">Exit</a>
				</div>
			</header>

			<div id="wpab-ed-wizard" class="wpab-ed__wizard" hidden>
				<div class="wpab-ed__wcard">
					<h2 class="wpab-ed__wtitle">Generate a custom theme</h2>
					<p class="wpab-ed__whint">Describe your site and the AI builds a full custom classic PHP theme — templates, sections and styles — then activates it.</p>

					<div id="wpab-ed-wform">
						<label class="wpab-ed__wlabel" for="wpab-ed-wname">Site / theme name</label>
						<input type="text" id="wpab-ed-wname" class="wpab-ed__winput" placeholder="e.g. Aurora Studio" />

						<label class="wpab-ed__wlabel" for="wpab-ed-wtype">Site type</label>
						<input type="text" id="wpab-ed-wtype" class="wpab-ed__winput" placeholder="e.g. design agency, restaurant, portfolio" />

						<div class="wpab-ed__wrow">
							<div class="wpab-ed__wcol">
								<label class="wpab-ed__wlabel" for="wpab-ed-wstyle">Style</label>
								<select id="wpab-ed-wstyle" class="wpab-ed__winput">
									<option value="modern">Modern</option>
									<option value="minimal">Minimal</option>
									<option value="bold">Bold</option>
									<option value="elegant">Elegant</option>
									<option value="editorial">Editorial</option>
									<option value="playful">Playful</option>
								</select>
							</div>
							<div class="wpab-ed__wcol">
								<label class="wpab-ed__wlabel" for="wpab-ed-wcolor">Primary color</label>
								<input type="color" id="wpab-ed-wcolor" class="wpab-ed__wcolor" value="#3a5bff" />
							</div>
						</div>

						<label class="wpab-ed__wlabel" for="wpab-ed-wextra">Anything else (pages, sections, tone…)</label>
						<textarea id="wpab-ed-wextra" class="wpab-ed__winput" rows="3" placeholder="e.g. Home, Services, Pricing, About, Contact. Include a testimonials section. Friendly, confident tone."></textarea>
					</div>

					<div id="wpab-ed-wprogress" class="wpab-ed__wprogress" hidden>
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

			<div class="wpab-ed__body">
				<div class="wpab-ed__preview">
					<div id="wpab-ed-pbar" class="wpab-ed__pbar">Loading preview…</div>
					<iframe id="wpab-ed-frame" class="wpab-ed__frame" title="Site preview"></iframe>
				</div>

				<aside class="wpab-ed__chat">
					<div id="wpab-ed-notice" class="wpab-ed__notice" hidden></div>
					<div id="wpab-ed-thread" class="wpab-ed__thread" aria-live="polite">
						<p class="wpab-ed__empty">Ask anything about this site — its theme, templates, pages or content.</p>
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
		</div>

		<style>
			#wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
			#wpfooter { display: none; }
			.wpab-ed { position: fixed; inset: 0; top: 32px; left: 160px; display: flex; flex-direction: column; background: #0e1013; color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; z-index: 9990; }
			.auto-fold .wpab-ed { left: 36px; }
			.folded .wpab-ed { left: 36px; }
			@media (max-width: 782px) { .wpab-ed { left: 0; top: 46px; } }
			.wpab-ed__top { display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 18px; border-bottom: 1px solid #23262b; background: #14171b; flex: 0 0 auto; }
			.wpab-ed__brand { display: flex; align-items: center; gap: 10px; }
			.wpab-ed__dot { width: 10px; height: 10px; border-radius: 50%; background: #3a5bff; box-shadow: 0 0 0 4px rgba(58,91,255,.18); }
			.wpab-ed__name { font-weight: 600; font-size: 14px; }
			.wpab-ed__theme { font-size: 12px; color: #9aa1ac; }
			.wpab-ed__exit { color: #c9ced4; text-decoration: none; font-size: 13px; border: 1px solid #2c3037; border-radius: 8px; padding: 6px 14px; }
			.wpab-ed__exit:hover { background: #1c1f24; color: #fff; }
			.wpab-ed__actions { display: flex; align-items: center; gap: 10px; }
			.wpab-ed__newtheme { background: #3a5bff; color: #fff; border: 0; border-radius: 8px; padding: 7px 15px; font-size: 13px; font-weight: 600; cursor: pointer; }
			.wpab-ed__newtheme:hover { background: #2f4ae0; }
			.wpab-ed__wizard { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: rgba(8,10,13,.72); padding: 24px; }
			.wpab-ed__wcard { width: 100%; max-width: 480px; max-height: 88vh; overflow-y: auto; background: #14171b; border: 1px solid #23262b; border-radius: 16px; padding: 26px; }
			.wpab-ed__winput + .wpab-ed__wlabel { margin-top: 14px; }
			.wpab-ed__wlabel { margin-top: 14px; }
			.wpab-ed__wlabel:first-of-type { margin-top: 0; }
			textarea.wpab-ed__winput { resize: vertical; font-family: inherit; }
			.wpab-ed__wrow { display: flex; gap: 12px; }
			.wpab-ed__wcol { flex: 1 1 0; }
			.wpab-ed__wcolor { width: 100%; height: 42px; background: #0e1013; border: 1px solid #2c3037; border-radius: 10px; padding: 4px; cursor: pointer; }
			.wpab-ed__wprogress { margin-top: 16px; }
			.wpab-ed__wbar { height: 8px; background: #23262b; border-radius: 999px; overflow: hidden; }
			.wpab-ed__wbarfill { display: block; height: 100%; width: 0; background: #3a5bff; transition: width .3s ease; }
			.wpab-ed__wstep { margin-top: 8px; font-size: 12px; color: #9aa1ac; }
			.wpab-ed__wtitle { margin: 0 0 6px; font-size: 19px; font-weight: 600; color: #f4f5f7; }
			.wpab-ed__whint { margin: 0 0 18px; font-size: 13px; color: #9aa1ac; line-height: 1.55; }
			.wpab-ed__wlabel { display: block; font-size: 12px; color: #9aa1ac; margin-bottom: 6px; }
			.wpab-ed__winput { width: 100%; box-sizing: border-box; background: #0e1013; border: 1px solid #2c3037; border-radius: 10px; color: #f4f5f7; font-size: 14px; padding: 11px 13px; }
			.wpab-ed__winput:focus { outline: none; border-color: #3a5bff; }
			.wpab-ed__wresult { font-size: 13px; margin-top: 12px; min-height: 18px; color: #9aa1ac; }
			.wpab-ed__wresult.is-err { color: #ff9d9d; }
			.wpab-ed__wresult.is-ok { color: #7fd6a3; }
			.wpab-ed__wactions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
			.wpab-ed__wbtn { appearance: none; border: 0; border-radius: 9px; padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: #3a5bff; color: #fff; }
			.wpab-ed__wbtn:disabled { opacity: .55; cursor: default; }
			.wpab-ed__wbtn--ghost { background: transparent; border: 1px solid #2c3037; color: #c9ced4; }
			.wpab-ed__body { flex: 1 1 auto; display: flex; min-height: 0; }
			.wpab-ed__preview { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; background: #17191d; }
			.wpab-ed__pbar { height: 30px; display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: #9aa1ac; border-bottom: 1px solid #23262b; }
			.wpab-ed__frame { flex: 1 1 auto; width: 100%; border: 0; background: #fff; }
			.wpab-ed__chat { width: 400px; max-width: 42vw; flex: 0 0 auto; display: flex; flex-direction: column; border-left: 1px solid #23262b; background: #101216; min-height: 0; }
			@media (max-width: 900px) { .wpab-ed__chat { width: 320px; } }
			.wpab-ed__notice { margin: 12px; padding: 11px 13px; border-radius: 10px; background: #2a1d1d; border: 1px solid #4a2b2b; color: #f0c9c9; font-size: 13px; }
			.wpab-ed__notice a { color: #ff9d9d; }
			.wpab-ed__thread { flex: 1 1 auto; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
			.wpab-ed__empty { color: #7c828b; font-size: 13px; line-height: 1.6; margin: 0; }
			.wpab-msg { display: flex; flex-direction: column; gap: 5px; }
			.wpab-msg__role { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7c828b; }
			.wpab-msg__body { font-size: 14px; line-height: 1.6; color: #e7e9ec; word-wrap: break-word; }
			.wpab-msg__body code { background: #1c1f24; padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
			.wpab-msg__body pre { background: #1c1f24; padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
			.wpab-msg__body a { color: #8bb6ff; }
			.wpab-msg--user .wpab-msg__body { color: #f4f5f7; }
			.wpab-typing { color: #9aa1ac; font-size: 13px; }
			.wpab-ed__form { border-top: 1px solid #23262b; padding: 12px; flex: 0 0 auto; background: #14171b; }
			.wpab-ed__input { width: 100%; box-sizing: border-box; resize: none; background: #0e1013; border: 1px solid #2c3037; border-radius: 10px; color: #f4f5f7; font: inherit; font-size: 14px; padding: 10px 12px; max-height: 160px; }
			.wpab-ed__input:focus { outline: none; border-color: #3a5bff; }
			.wpab-ed__formrow { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
			.wpab-ed__new { background: none; border: 0; color: #9aa1ac; font-size: 12px; cursor: pointer; }
			.wpab-ed__new:hover { color: #fff; }
			.wpab-ed__send { appearance: none; border: 0; border-radius: 9px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: #3a5bff; color: #fff; }
			.wpab-ed__send:disabled { opacity: .55; cursor: default; }
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
					addMessage('assistant', out.data.answer || out.data.reply || '(no answer)');
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

			// Live preview of the site.
			var frame = $('wpab-ed-frame'), pbar = $('wpab-ed-pbar');
			if (frame && cfg.siteUrl) {
				frame.addEventListener('load', function () { if (pbar) { pbar.textContent = cfg.siteUrl; } });
				frame.src = cfg.siteUrl;
			}

			// Theme recognition: show the active theme's name in the top bar.
			if (cfg.restContext) {
				fetch(cfg.restContext, { headers: { 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' }, credentials: 'same-origin' })
					.then(function (r) { return r.json(); })
					.then(function (d) {
						var t = d && d.context && d.context.theme;
						var el = $('wpab-ed-theme');
						if (t && el) { el.textContent = '· ' + (t.name || t.slug || ''); }
					})
					.catch(function () {});
			}

			// ---- New theme (Phase B+C): plan -> generate each file -> write ----
			var wizard = $('wpab-ed-wizard');
			var wName = $('wpab-ed-wname');
			var wType = $('wpab-ed-wtype');
			var wStyle = $('wpab-ed-wstyle');
			var wColor = $('wpab-ed-wcolor');
			var wExtra = $('wpab-ed-wextra');
			var wGo = $('wpab-ed-wgo');
			var wCancel = $('wpab-ed-wcancel');
			var wResult = $('wpab-ed-wresult');
			var wOpen = $('wpab-ed-newtheme');
			var wForm = $('wpab-ed-wform');
			var wProgress = $('wpab-ed-wprogress');
			var wBarFill = $('wpab-ed-wbarfill');
			var wStep = $('wpab-ed-wstep');
			var MAX_FILES = 60;

			function openWizard() {
				if (!wizard) { return; }
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = ''; }
				if (wProgress) { wProgress.hidden = true; }
				if (wBarFill) { wBarFill.style.width = '0'; }
				if (wForm) { wForm.style.display = ''; }
				if (wGo) { wGo.disabled = false; wGo.textContent = 'Generate theme'; }
				wizard.hidden = false;
				if (wName) { wName.focus(); }
			}
			function closeWizard() { if (wizard && (!wGo || !wGo.disabled)) { wizard.hidden = true; } }

			if (wOpen) { wOpen.addEventListener('click', openWizard); }
			if (wCancel) { wCancel.addEventListener('click', closeWizard); }
			if (wizard) {
				wizard.addEventListener('click', function (e) { if (e.target === wizard && (!wGo || !wGo.disabled)) { closeWizard(); } });
			}

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
				if (wStep) { wStep.textContent = label || ''; }
			}
			function errText(out, fallback) {
				return (out && out.data && (out.data.message || out.data.error)) || fallback;
			}

			function generateTheme() {
				if (!wGo || !cfg.restBuildPlan) { return; }
				var brand = wName ? (wName.value || '').trim() : '';
				if (!brand) { if (wResult) { wResult.className = 'wpab-ed__wresult is-err'; wResult.textContent = 'Please enter a site / theme name.'; } return; }

				var brief = {
					name: brand,
					type: wType ? (wType.value || '').trim() : '',
					style: wStyle ? wStyle.value : 'modern',
					primaryColor: wColor ? wColor.value : '#3a5bff',
					extra: wExtra ? (wExtra.value || '').trim() : ''
				};

				wGo.disabled = true;
				wGo.textContent = 'Generating…';
				if (wResult) { wResult.className = 'wpab-ed__wresult'; wResult.textContent = ''; }
				if (wForm) { wForm.style.display = 'none'; }
				if (wProgress) { wProgress.hidden = false; }
				setProgress(0, 1, 'Planning your theme…');

				wpost(cfg.restBuildPlan, { brief: brief }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false || !out.data.blueprint) {
						throw new Error(errText(out, 'Could not plan the theme.'));
					}
					var blueprint = out.data.blueprint;
					var files = (blueprint.files || []).filter(function (p) { return typeof p === 'string' && p; });
					if (!files.length) { throw new Error('The plan returned no files.'); }
					if (files.length > MAX_FILES) { files = files.slice(0, MAX_FILES); }

					var built = [];
					var total = files.length;

					function next(i) {
						if (i >= total) {
							setProgress(total, total, 'Writing theme…');
							return wpost(cfg.restCreateTheme, {
								brand: brand,
								description: (blueprint.theme && blueprint.theme.description) || '',
								files: built
							}).then(function (cOut) {
								if (!cOut.ok || !cOut.data || cOut.data.success === false) {
									throw new Error(errText(cOut, 'Could not write the theme.'));
								}
								if (wResult) { wResult.className = 'wpab-ed__wresult is-ok'; wResult.textContent = '✓ “' + (cOut.data.name || brand) + '” created (' + (cOut.data.files_written || built.length) + ' files) and activated. Reloading…'; }
								setTimeout(function () { location.reload(); }, 1200);
							});
						}
						var path = files[i];
						setProgress(i, total, 'Generating ' + path + ' (' + (i + 1) + '/' + total + ')');
						return wpost(cfg.restBuildFile, { blueprint: blueprint, path: path }).then(function (fOut) {
							if (!fOut.ok || !fOut.data || fOut.data.success === false || typeof fOut.data.contents !== 'string') {
								throw new Error(errText(fOut, 'Could not generate ' + path + '.'));
							}
							built.push({ path: path, contents: fOut.data.contents });
							return next(i + 1);
						});
					}

					return next(0);
				}).catch(function (err) {
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
