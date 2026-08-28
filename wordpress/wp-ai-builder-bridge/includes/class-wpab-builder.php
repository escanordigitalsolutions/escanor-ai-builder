<?php
/**
 * ESCANOR Builder — generate a standalone, per-site theme.
 *
 * The Builder wizard turns a short brief into a real, activated block theme
 * that is uniquely the user's. Rather than hand-write a theme from scratch (a
 * lot of surface area to get wrong), it FORKS the proven ESCANOR Native block
 * theme into a new folder (escanor-{slug}), rewrites the style.css header so it
 * is its own theme, applies the brief's palette and typography into theme.json,
 * activates it and sets the site title/tagline.
 *
 * Because every ESCANOR pattern and template references palette/typography
 * through CSS custom properties, swapping the theme.json presets re-themes the
 * whole site consistently. Sections, pages, the companion plugin and AI images
 * are layered on in later Builder phases through the normal, snapshotted write
 * pipeline (this theme is the active theme, so the writer targets it).
 *
 * This is the one deliberately privileged operation that writes outside the
 * active-theme scope — it creates a new theme — so it is admin-only, nonce and
 * entitlement gated at the REST layer, and never executes anything it received.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Builder {

	/**
	 * The base skeleton is bundled inside this plugin (base-theme/), so a fresh
	 * WordPress with ONLY the bridge installed can generate a theme — no other
	 * theme has to be present. It is copied and re-themed per site; it is never
	 * activated on its own.
	 */
	private static function base_theme_dir(): string {
		return rtrim( wp_normalize_path( WPAB_DIR ), '/' ) . '/base-theme';
	}

	/** Curated, dependency-free font stacks selectable in the wizard. */
	private static function font_stack( string $vibe ): string {
		switch ( $vibe ) {
			case 'serif':
				return "Georgia, Cambria, 'Times New Roman', Times, serif";
			case 'editorial':
				return "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
			case 'rounded':
				return "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
			case 'mono':
				return "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
			case 'sans':
			default:
				return "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
		}
	}

	private static function clamp_hex( string $hex, string $fallback ): string {
		$hex = trim( $hex );
		if ( preg_match( '/^#?[0-9a-fA-F]{6}$/', $hex ) ) {
			return '#' . ltrim( strtolower( $hex ), '#' );
		}
		return $fallback;
	}

	/** Darken a #rrggbb by a factor (0..1). */
	private static function darken( string $hex, float $factor ): string {
		$hex = ltrim( $hex, '#' );
		$r   = (int) round( hexdec( substr( $hex, 0, 2 ) ) * ( 1 - $factor ) );
		$g   = (int) round( hexdec( substr( $hex, 2, 2 ) ) * ( 1 - $factor ) );
		$b   = (int) round( hexdec( substr( $hex, 4, 2 ) ) * ( 1 - $factor ) );

		return sprintf( '#%02x%02x%02x', max( 0, $r ), max( 0, $g ), max( 0, $b ) );
	}

	/** Build the palette override map from the brief. */
	private static function palette( array $spec ): array {
		$primary = self::clamp_hex( (string) ( $spec['primary'] ?? '' ), '#3a5bff' );
		$dark    = ! empty( $spec['dark'] );

		$map = array(
			'primary'       => $primary,
			'primary-hover' => self::darken( $primary, 0.14 ),
		);

		if ( $dark ) {
			$map['base']      = '#0e1013';
			$map['contrast']  = '#f4f5f7';
			$map['surface']   = '#17191d';
			$map['surface-2'] = '#1f2228';
			$map['border']    = '#2a2e35';
			$map['muted']     = '#9aa1ac';
		} else {
			$map['base']      = '#ffffff';
			$map['contrast']  = '#14161a';
			$map['surface']   = '#f5f6f8';
			$map['surface-2'] = '#eceef2';
			$map['border']    = '#e2e5ea';
			$map['muted']     = '#6b7280';
		}

		return $map;
	}

	private static function fs() {
		global $wp_filesystem;

		if ( ! $wp_filesystem ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			WP_Filesystem();
		}

		return $wp_filesystem;
	}

	private static function unique_slug( string $brand ): string {
		$base = sanitize_title( $brand );
		if ( '' === $base ) {
			$base = 'site';
		}
		$base = 'escanor-' . $base;
		$slug = $base;
		$n    = 2;

		while ( is_dir( get_theme_root() . '/' . $slug ) || wp_get_theme( $slug )->exists() ) {
			$slug = $base . '-' . $n;
			$n++;
			if ( $n > 50 ) {
				$slug = $base . '-' . wp_generate_password( 5, false, false );
				break;
			}
		}

		return $slug;
	}

	private static function write_style_header( string $dest, string $brand, string $slug ): void {
		$fs   = self::fs();
		$path = $dest . '/style.css';

		$existing = $fs ? (string) $fs->get_contents( $path ) : '';
		$body     = '';

		// Preserve any CSS that lived after the original header comment.
		if ( '' !== $existing && preg_match( '/\*\/(.*)$/s', $existing, $m ) ) {
			$body = trim( $m[1] );
		}

		$header  = "/*\n";
		$header .= 'Theme Name: ' . $brand . "\n";
		$header .= "Theme URI: https://builder.escanor.lt\n";
		$header .= "Author: ESCANOR AI Builder\n";
		$header .= "Author URI: https://escanor.lt\n";
		$header .= 'Description: A custom block theme generated for ' . $brand . " by the ESCANOR AI Builder. Fully editable in WordPress.\n";
		$header .= "Requires at least: 6.4\n";
		$header .= "Tested up to: 6.6\n";
		$header .= "Requires PHP: 7.4\n";
		$header .= "Version: 1.0.0\n";
		$header .= "License: GPL-2.0-or-later\n";
		$header .= "License URI: https://www.gnu.org/licenses/gpl-2.0.html\n";
		$header .= 'Text Domain: ' . $slug . "\n";
		$header .= "Tags: full-site-editing, block-patterns, blog, portfolio, e-commerce\n";
		$header .= "*/\n";

		if ( '' !== $body ) {
			$header .= "\n" . $body . "\n";
		}

		if ( $fs ) {
			$fs->put_contents( $path, $header, FS_CHMOD_FILE );
		}
	}

	private static function write_theme_json( string $base_dir, string $dest, array $spec ): void {
		$fs  = self::fs();
		$raw = $fs ? (string) $fs->get_contents( $base_dir . '/theme.json' ) : '';

		$json = json_decode( $raw, true );

		if ( ! is_array( $json ) ) {
			return; // Leave the copied theme.json untouched if it cannot be parsed.
		}

		$palette = self::palette( $spec );
		$stack   = self::font_stack( isset( $spec['font'] ) ? (string) $spec['font'] : 'sans' );

		// Recolour existing palette slugs in place (keeps every pattern working).
		if ( isset( $json['settings']['color']['palette'] ) && is_array( $json['settings']['color']['palette'] ) ) {
			foreach ( $json['settings']['color']['palette'] as $i => $entry ) {
				$slug = isset( $entry['slug'] ) ? $entry['slug'] : '';
				if ( isset( $palette[ $slug ] ) ) {
					$json['settings']['color']['palette'][ $i ]['color'] = $palette[ $slug ];
				}
			}
		}

		// Swap the primary sans stack (body + headings inherit it).
		if ( isset( $json['settings']['typography']['fontFamilies'] ) && is_array( $json['settings']['typography']['fontFamilies'] ) ) {
			foreach ( $json['settings']['typography']['fontFamilies'] as $i => $entry ) {
				if ( isset( $entry['slug'] ) && 'sans' === $entry['slug'] ) {
					$json['settings']['typography']['fontFamilies'][ $i ]['fontFamily'] = $stack;
				}
			}
		}

		$encoded = wp_json_encode( $json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );

		if ( $fs && false !== $encoded ) {
			$fs->put_contents( $dest . '/theme.json', $encoded, FS_CHMOD_FILE );
		}
	}

	/**
	 * Create + activate a new per-site theme from the brief. Returns theme info
	 * or a WP_Error.
	 */
	public static function scaffold_theme( array $spec ) {
		$base_dir = self::base_theme_dir();

		if ( ! is_dir( $base_dir ) ) {
			return new WP_Error(
				'wpab_builder_base_missing',
				'The bundled base theme is missing from the bridge plugin. Re-upload the plugin and try again.',
				array( 'status' => 500 )
			);
		}

		$brand = trim( sanitize_text_field( (string) ( $spec['brand'] ?? '' ) ) );
		if ( '' === $brand ) {
			$brand = 'My Site';
		}
		$brand = mb_substr( $brand, 0, 60 );

		$fs = self::fs();
		if ( ! $fs ) {
			return new WP_Error( 'wpab_builder_fs', 'WordPress could not get filesystem access to create the theme on this host.', array( 'status' => 500 ) );
		}

		$slug = self::unique_slug( $brand );
		$dest = get_theme_root() . '/' . $slug;

		require_once ABSPATH . 'wp-admin/includes/file.php';

		// copy_dir() copies files INTO $dest, so the destination must exist first.
		if ( ! $fs->is_dir( $dest ) && ! $fs->mkdir( $dest, FS_CHMOD_DIR ) ) {
			return new WP_Error( 'wpab_builder_mkdir', 'Could not create the new theme folder.', array( 'status' => 500 ) );
		}

		$copied = copy_dir( $base_dir, $dest );

		if ( is_wp_error( $copied ) ) {
			return $copied;
		}

		self::write_style_header( $dest, $brand, $slug );
		self::write_theme_json( $base_dir, $dest, $spec );

		// Refresh theme caches so WordPress sees the new theme immediately.
		wp_clean_themes_cache();

		$theme = wp_get_theme( $slug );

		if ( ! $theme->exists() ) {
			return new WP_Error( 'wpab_builder_invalid', 'The generated theme could not be registered by WordPress.', array( 'status' => 500 ) );
		}

		switch_theme( $slug );

		update_option( 'blogname', $brand );
		if ( isset( $spec['tagline'] ) ) {
			update_option( 'blogdescription', mb_substr( sanitize_text_field( (string) $spec['tagline'] ), 0, 120 ) );
		}

		// Every generated theme gets its OWN companion plugin created and
		// activated right away — the per-site home for custom code (booking,
		// post types, shortcodes, anything the client later asks for). Features
		// are written into it as auto-loaded files. A hiccup here must not fail
		// the theme, so it is best-effort and reported back.
		$companion = null;
		try {
			$companion = self::ensure_companion_plugin( $brand );
		} catch ( \Throwable $e ) {
			$companion = new WP_Error( 'wpab_companion', $e->getMessage() );
		}

		WPAB_Log::add(
			'theme_generated',
			array(
				'slug'  => $slug,
				'brand' => $brand,
				'type'  => isset( $spec['site_type'] ) ? sanitize_key( (string) $spec['site_type'] ) : '',
			)
		);

		$out = array(
			'success'       => true,
			'theme_slug'    => $slug,
			'theme_name'    => $brand,
			'preview_url'   => home_url( '/' ),
			'editor_url'    => admin_url( 'site-editor.php' ),
			'primary'       => self::clamp_hex( (string) ( $spec['primary'] ?? '' ), '#3a5bff' ),
		);

		if ( is_array( $companion ) ) {
			$out['plugin_slug'] = $companion['slug'];
			$out['plugin_name'] = $companion['name'];
		}

		return $out;
	}

	/* ---------------------------------------------------------------------
	 * Site generation (B1b): create the AI-designed pages, set the home page
	 * and wire the header navigation, in the currently active (generated) theme.
	 * ------------------------------------------------------------------ */

	/** Make the active theme render the front page's own content (a page). */
	private static function front_page_template_to_content(): void {
		$fs = self::fs();
		if ( ! $fs ) {
			return;
		}

		$path = get_stylesheet_directory() . '/templates/front-page.html';

		$tpl  = '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->' . "\n\n";
		$tpl .= '<!-- wp:group {"tagName":"main","align":"full","layout":{"type":"constrained"}} -->' . "\n";
		$tpl .= '<main class="wp-block-group alignfull">' . "\n";
		$tpl .= '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->' . "\n";
		$tpl .= '</main>' . "\n";
		$tpl .= '<!-- /wp:group -->' . "\n\n";
		$tpl .= '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->' . "\n";

		$fs->put_contents( $path, $tpl, FS_CHMOD_FILE );
	}

	/** A single wp_navigation post the header's Navigation block resolves to. */
	private static function build_navigation( array $pages ): void {
		$links = '';

		foreach ( $pages as $p ) {
			$attrs = wp_json_encode(
				array(
					'label' => $p['title'],
					'type'  => 'page',
					'id'    => (int) $p['id'],
					'url'   => $p['url'],
					'kind'  => 'post-type',
				)
			);

			if ( false !== $attrs ) {
				$links .= '<!-- wp:navigation-link ' . $attrs . ' /-->' . "\n";
			}
		}

		$existing = get_posts(
			array(
				'post_type'   => 'wp_navigation',
				'numberposts' => 1,
				'post_status' => 'publish',
			)
		);

		$navarr = array(
			'post_type'    => 'wp_navigation',
			'post_title'   => 'Navigation',
			'post_status'  => 'publish',
			'post_content' => $links,
		);

		if ( $existing ) {
			$navarr['ID'] = (int) $existing[0]->ID;
			wp_update_post( wp_slash( $navarr ) );
		} else {
			wp_insert_post( wp_slash( $navarr ) );
		}
	}

	/**
	 * Create the generated pages (published), set the home page as the static
	 * front page, point the theme's front-page template at page content, and
	 * build the header navigation. Returns the created pages.
	 */
	/** Write reusable section patterns into the active theme's /patterns folder. */
	private static function write_patterns( array $patterns ): int {
		if ( empty( $patterns ) ) {
			return 0;
		}

		$fs = self::fs();
		if ( ! $fs ) {
			return 0;
		}

		$dir = get_stylesheet_directory() . '/patterns';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}

		$theme = get_stylesheet();
		$count = 0;

		foreach ( $patterns as $p ) {
			if ( ! is_array( $p ) ) {
				continue;
			}

			$title  = trim( sanitize_text_field( (string) ( $p['title'] ?? '' ) ) );
			$blocks = (string) ( $p['blocks'] ?? '' );

			if ( '' === $title || '' === trim( $blocks ) ) {
				continue;
			}

			// A pattern file is executed as PHP — never allow PHP tags in the body.
			if ( false !== strpos( $blocks, '<?' ) ) {
				continue;
			}

			$slug = sanitize_title( (string) ( $p['slug'] ?? $title ) );
			if ( '' === $slug ) {
				continue;
			}

			$file = $dir . '/' . $slug . '.php';
			if ( file_exists( $file ) ) {
				$slug .= '-' . wp_generate_password( 4, false, false );
				$file  = $dir . '/' . $slug . '.php';
			}

			$header  = "<?php\n/**\n";
			$header .= ' * Title: ' . $title . "\n";
			$header .= ' * Slug: ' . $theme . '/' . $slug . "\n";
			$header .= " * Categories: escanor\n";
			$header .= " */\n?>\n";

			if ( $fs->put_contents( $file, $header . $blocks . "\n", FS_CHMOD_FILE ) ) {
				$count++;
			}
		}

		return $count;
	}

	public static function apply_site( array $pages, array $patterns = array() ) {
		$created  = array();
		$front_id = 0;
		$can_raw  = current_user_can( 'unfiltered_html' );

		foreach ( $pages as $p ) {
			if ( ! is_array( $p ) ) {
				continue;
			}

			$title  = trim( sanitize_text_field( (string) ( $p['title'] ?? '' ) ) );
			$blocks = (string) ( $p['blocks'] ?? '' );

			if ( '' === $title || '' === trim( $blocks ) ) {
				continue;
			}

			if ( strlen( $blocks ) > 200000 ) {
				$blocks = substr( $blocks, 0, 200000 );
			}

			$content = $can_raw ? $blocks : wp_kses_post( $blocks );
			$slug    = ( isset( $p['slug'] ) && '' !== trim( (string) $p['slug'] ) ) ? sanitize_title( (string) $p['slug'] ) : sanitize_title( $title );

			$id = wp_insert_post(
				wp_slash(
					array(
						'post_type'    => 'page',
						'post_title'   => $title,
						'post_name'    => $slug,
						'post_content' => $content,
						'post_status'  => 'publish',
					)
				),
				true
			);

			if ( is_wp_error( $id ) ) {
				continue;
			}

			$id = (int) $id;

			$created[] = array(
				'id'    => $id,
				'title' => (string) get_the_title( $id ),
				'slug'  => (string) get_post_field( 'post_name', $id ),
				'url'   => (string) get_permalink( $id ),
				'front' => ! empty( $p['front'] ),
			);

			if ( ! empty( $p['front'] ) && ! $front_id ) {
				$front_id = $id;
			}
		}

		if ( empty( $created ) ) {
			return new WP_Error( 'wpab_build_no_pages', 'No pages could be created.', array( 'status' => 500 ) );
		}

		if ( ! $front_id ) {
			$front_id = $created[0]['id'];
		}

		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $front_id );

		self::front_page_template_to_content();
		self::build_navigation( $created );

		$pattern_count = self::write_patterns( $patterns );

		WPAB_Log::add(
			'site_generated',
			array(
				'pages'    => count( $created ),
				'patterns' => $pattern_count,
			)
		);

		return array(
			'success'  => true,
			'pages'    => $created,
			'patterns' => $pattern_count,
			'front_id' => $front_id,
			'home_url' => home_url( '/' ),
		);
	}

	/**
	 * Multi-step generation: create ONE published page from its block markup.
	 * The dashboard calls this once per page so progress is visible and no
	 * single request is slow. Returns the created page info or a WP_Error.
	 */
	public static function apply_single_page( array $p ) {
		$title  = trim( sanitize_text_field( (string) ( $p['title'] ?? '' ) ) );
		$blocks = (string) ( $p['blocks'] ?? '' );

		if ( '' === $title || '' === trim( $blocks ) ) {
			return new WP_Error( 'wpab_page_empty', 'The page had no title or content.', array( 'status' => 400 ) );
		}

		if ( strlen( $blocks ) > 200000 ) {
			$blocks = substr( $blocks, 0, 200000 );
		}

		$content = current_user_can( 'unfiltered_html' ) ? $blocks : wp_kses_post( $blocks );
		$slug    = ( isset( $p['slug'] ) && '' !== trim( (string) $p['slug'] ) ) ? sanitize_title( (string) $p['slug'] ) : sanitize_title( $title );

		$id = wp_insert_post(
			wp_slash(
				array(
					'post_type'    => 'page',
					'post_title'   => $title,
					'post_name'    => $slug,
					'post_content' => $content,
					'post_status'  => 'publish',
				)
			),
			true
		);

		if ( is_wp_error( $id ) ) {
			return $id;
		}

		$id = (int) $id;

		return array(
			'id'    => $id,
			'title' => (string) get_the_title( $id ),
			'slug'  => (string) get_post_field( 'post_name', $id ),
			'url'   => (string) get_permalink( $id ),
			'front' => ! empty( $p['front'] ),
		);
	}

	/**
	 * Multi-step generation: after all pages exist, set the home page, wire the
	 * menu, point the front-page template at page content, and write any
	 * reusable patterns. $created is the list of apply_single_page() results.
	 */
	public static function finalize_site( array $created, int $front_id = 0, array $patterns = array() ) {
		$created = array_values(
			array_filter(
				$created,
				static function ( $c ) {
					return is_array( $c ) && ! empty( $c['id'] );
				}
			)
		);

		if ( empty( $created ) ) {
			return new WP_Error( 'wpab_finalize_empty', 'No pages to finalize.', array( 'status' => 400 ) );
		}

		if ( ! $front_id ) {
			foreach ( $created as $c ) {
				if ( ! empty( $c['front'] ) ) {
					$front_id = (int) $c['id'];
					break;
				}
			}
		}
		if ( ! $front_id ) {
			$front_id = (int) $created[0]['id'];
		}

		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $front_id );

		self::front_page_template_to_content();
		self::build_navigation( $created );

		$pattern_count = self::write_patterns( $patterns );

		WPAB_Log::add(
			'site_generated',
			array(
				'pages'    => count( $created ),
				'patterns' => $pattern_count,
				'mode'     => 'multi-step',
			)
		);

		return array(
			'success'  => true,
			'front_id' => $front_id,
			'patterns' => $pattern_count,
			'home_url' => home_url( '/' ),
		);
	}

	/* ---------------------------------------------------------------------
	 * Images (B1d): sideload AI-generated images into the media library and
	 * place a gallery on the home page.
	 * ------------------------------------------------------------------ */

	/**
	 * Decode a base64 image, store it in the media library and return a compact
	 * descriptor { id, url, alt }. Returns WP_Error on any failure so the caller
	 * (the per-image loop) can surface a precise reason.
	 */
	public static function sideload_b64( string $b64, string $alt ) {
		$alt  = trim( sanitize_text_field( $alt ) );
		$data = base64_decode( $b64, true );

		if ( false === $data || '' === $data ) {
			return new WP_Error( 'wpab_img_decode', 'The image data could not be decoded.', array( 'status' => 502 ) );
		}

		$name   = 'escanor-' . wp_generate_password( 8, false, false ) . '.png';
		$upload = wp_upload_bits( $name, null, $data );

		if ( ! empty( $upload['error'] ) || empty( $upload['file'] ) ) {
			$msg = ! empty( $upload['error'] ) ? (string) $upload['error'] : 'The upload directory is not writable.';
			return new WP_Error( 'wpab_img_upload', $msg, array( 'status' => 500 ) );
		}

		$file     = $upload['file'];
		$filetype = wp_check_filetype( basename( $file ), null );

		$attach_id = wp_insert_attachment(
			array(
				'post_mime_type' => $filetype['type'] ? $filetype['type'] : 'image/png',
				'post_title'     => '' !== $alt ? $alt : 'ESCANOR image',
				'post_content'   => '',
				'post_status'    => 'inherit',
			),
			$file
		);

		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return is_wp_error( $attach_id ) ? $attach_id : new WP_Error( 'wpab_img_attach', 'The image could not be attached.', array( 'status' => 500 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';

		$meta = wp_generate_attachment_metadata( (int) $attach_id, $file );
		wp_update_attachment_metadata( (int) $attach_id, $meta );

		if ( '' !== $alt ) {
			update_post_meta( (int) $attach_id, '_wp_attachment_image_alt', $alt );
		}

		return array(
			'id'  => (int) $attach_id,
			'url' => (string) wp_get_attachment_url( (int) $attach_id ),
			'alt' => $alt,
		);
	}

	private static function append_gallery_to_page( int $id, array $images ): void {
		$post = get_post( $id );
		if ( ! $post ) {
			return;
		}

		$cols  = min( 3, max( 1, count( $images ) ) );
		$inner = '';

		foreach ( $images as $im ) {
			$inner .= '<!-- wp:image {"id":' . (int) $im['id'] . ',"sizeSlug":"large","linkDestination":"none"} -->' . "\n";
			$inner .= '<figure class="wp-block-image size-large"><img src="' . esc_url( $im['url'] ) . '" alt="' . esc_attr( $im['alt'] ) . '" class="wp-image-' . (int) $im['id'] . '"/></figure>' . "\n";
			$inner .= '<!-- /wp:image -->' . "\n";
		}

		$section  = "\n\n" . '<!-- wp:group {"tagName":"section","align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|50","bottom":"var:preset|spacing|50"}}},"layout":{"type":"constrained"}} -->' . "\n";
		$section .= '<section class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--50);padding-bottom:var(--wp--preset--spacing--50)">' . "\n";
		$section .= '<!-- wp:heading {"textAlign":"center"} --><h2 class="wp-block-heading has-text-align-center">Gallery</h2><!-- /wp:heading -->' . "\n";
		$section .= '<!-- wp:gallery {"columns":' . $cols . ',"linkTo":"none"} -->' . "\n";
		$section .= '<figure class="wp-block-gallery has-nested-images columns-' . $cols . ' is-cropped">' . "\n" . $inner . '</figure>' . "\n";
		$section .= '<!-- /wp:gallery -->' . "\n";
		$section .= '</section>' . "\n";
		$section .= '<!-- /wp:group -->' . "\n";

		wp_update_post(
			wp_slash(
				array(
					'ID'           => $id,
					'post_content' => (string) $post->post_content . $section,
				)
			)
		);
	}

	/**
	 * Place already-sideloaded attachments as a gallery on the front page.
	 *
	 * Used by the per-image loop: the dashboard sideloads each image on its own
	 * request, then calls this once with the collected attachment ids.
	 */
	public static function place_gallery( array $ids ) {
		$images = array();

		foreach ( $ids as $id ) {
			$id = (int) $id;
			if ( $id < 1 ) {
				continue;
			}

			$url = (string) wp_get_attachment_url( $id );
			if ( '' === $url ) {
				continue;
			}

			$alt = (string) get_post_meta( $id, '_wp_attachment_image_alt', true );

			$images[] = array(
				'id'  => $id,
				'url' => $url,
				'alt' => $alt,
			);
		}

		if ( empty( $images ) ) {
			return new WP_Error( 'wpab_build_gallery', 'None of the given images were found.', array( 'status' => 400 ) );
		}

		$front = (int) get_option( 'page_on_front' );
		if ( ! $front ) {
			return new WP_Error( 'wpab_build_gallery_nofront', 'There is no front page to place the gallery on. Generate the site first.', array( 'status' => 409 ) );
		}

		self::append_gallery_to_page( $front, $images );

		WPAB_Log::add( 'gallery_placed', array( 'count' => count( $images ) ) );

		return array(
			'success'  => true,
			'placed'   => count( $images ),
			'home_url' => home_url( '/' ),
		);
	}

	/* ---------------------------------------------------------------------
	 * Features (B1c): scaffold a per-site companion plugin. The first feature
	 * is a booking system (custom post type + public form + email on submit).
	 * The plugin is generated from a fixed, safe template — never from anything
	 * received over the wire — activated, and registered as the approved
	 * companion scope so it can be refined later through the normal write
	 * pipeline (nonce + entitlement gated at the REST layer).
	 * ------------------------------------------------------------------ */

	private static function unique_plugin_slug( string $base ): string {
		$base = sanitize_title( $base );
		if ( '' === $base ) {
			$base = 'escanor-features';
		}
		$slug = $base;
		$n    = 2;

		while ( is_dir( WP_PLUGIN_DIR . '/' . $slug ) ) {
			$slug = $base . '-' . $n;
			$n++;
			if ( $n > 50 ) {
				$slug = $base . '-' . wp_generate_password( 5, false, false );
				break;
			}
		}

		return $slug;
	}

	/** Normalise a brand string for safe use in plugin headers/names. */
	private static function safe_brand( $brand ): string {
		$brand = trim( sanitize_text_field( (string) $brand ) );
		if ( '' === $brand ) {
			$brand = (string) wp_get_theme()->get( 'Name' );
		}
		if ( '' === $brand ) {
			$brand = 'My Site';
		}
		return str_replace( array( '*/', '<', '>' ), '', mb_substr( $brand, 0, 60 ) );
	}

	/**
	 * Ensure this site's companion plugin exists, is active, and is registered
	 * as the approved write scope. Created at theme-generation time as the home
	 * for all custom code; features are later written into its features/ folder
	 * as auto-loaded files. Reuses an existing companion if one is registered.
	 *
	 * Returns array{ slug, file, dir, name } or a WP_Error.
	 */
	public static function ensure_companion_plugin( string $brand ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		$fs = self::fs();
		if ( ! $fs ) {
			return new WP_Error( 'wpab_companion_fs', 'WordPress could not get filesystem access to create the companion plugin.', array( 'status' => 500 ) );
		}

		$brand = self::safe_brand( $brand );

		// Reuse an already-approved companion plugin if it is still installed.
		$existing = (string) get_option( WPAB_Scopes::PLUGIN_OPTION, '' );
		if ( '' !== $existing && false !== strpos( $existing, '/' ) ) {
			$slug = explode( '/', $existing )[0];
			$dir  = WP_PLUGIN_DIR . '/' . $slug;

			if ( is_dir( $dir ) && $slug !== dirname( WPAB_BASENAME ) ) {
				if ( ! $fs->is_dir( $dir . '/features' ) ) {
					$fs->mkdir( $dir . '/features', FS_CHMOD_DIR );
				}
				if ( ! is_plugin_active( $existing ) ) {
					activate_plugin( $existing );
				}
				return array(
					'slug' => $slug,
					'file' => $existing,
					'dir'  => $dir,
					'name' => $brand,
				);
			}
		}

		$theme_slug = get_stylesheet();
		$base_slug  = ( 0 === strpos( $theme_slug, 'escanor-' ) ? $theme_slug : 'escanor-' . sanitize_title( $brand ) ) . '-features';
		$slug       = self::unique_plugin_slug( $base_slug );

		$dir  = WP_PLUGIN_DIR . '/' . $slug;
		$file = $slug . '/' . $slug . '.php';
		$path = $dir . '/' . $slug . '.php';

		if ( ! $fs->is_dir( $dir ) && ! $fs->mkdir( $dir, FS_CHMOD_DIR ) ) {
			return new WP_Error( 'wpab_companion_mkdir', 'Could not create the companion plugin folder.', array( 'status' => 500 ) );
		}
		if ( ! $fs->is_dir( $dir . '/features' ) && ! $fs->mkdir( $dir . '/features', FS_CHMOD_DIR ) ) {
			return new WP_Error( 'wpab_companion_mkdir', 'Could not create the features folder.', array( 'status' => 500 ) );
		}

		// Keep the features folder loadable even before any feature is added.
		$fs->put_contents( $dir . '/features/index.php', "<?php\n// Silence is golden.\n", FS_CHMOD_FILE );

		if ( ! $fs->put_contents( $path, self::companion_bootstrap_source( $brand, $slug ), FS_CHMOD_FILE ) ) {
			return new WP_Error( 'wpab_companion_write', 'Could not write the companion plugin.', array( 'status' => 500 ) );
		}

		wp_clean_plugins_cache();

		$activated = activate_plugin( $file );
		if ( is_wp_error( $activated ) ) {
			return new WP_Error( 'wpab_companion_activate', 'The companion plugin was created but could not be activated: ' . $activated->get_error_message(), array( 'status' => 500 ) );
		}

		update_option( WPAB_Scopes::PLUGIN_OPTION, $file );

		WPAB_Log::add( 'companion_plugin_created', array( 'slug' => $slug ) );

		return array(
			'slug' => $slug,
			'file' => $file,
			'dir'  => $dir,
			'name' => $brand,
		);
	}

	/**
	 * Add one feature to this site's companion plugin by writing a self-loading
	 * file into its features/ folder. The plugin is created first if needed, so
	 * this works whether or not a theme was generated through the Builder.
	 * Returns feature info or a WP_Error.
	 */
	public static function scaffold_feature_plugin( array $spec ) {
		$feature = isset( $spec['feature'] ) ? sanitize_key( (string) $spec['feature'] ) : 'booking';

		if ( 'booking' !== $feature ) {
			return new WP_Error( 'wpab_feature_unknown', 'Only the booking feature is available so far.', array( 'status' => 400 ) );
		}

		$brand     = self::safe_brand( (string) ( $spec['brand'] ?? '' ) );
		$companion = self::ensure_companion_plugin( $brand );

		if ( is_wp_error( $companion ) ) {
			return $companion;
		}

		$fs = self::fs();
		if ( ! $fs ) {
			return new WP_Error( 'wpab_feature_fs', 'WordPress could not get filesystem access to write the feature.', array( 'status' => 500 ) );
		}

		$feat_path = $companion['dir'] . '/features/booking.php';

		if ( ! $fs->put_contents( $feat_path, self::booking_feature_source( $brand ), FS_CHMOD_FILE ) ) {
			return new WP_Error( 'wpab_feature_write', 'Could not write the booking feature.', array( 'status' => 500 ) );
		}

		// Give the feature an immediate home: a published page with the form.
		$page_id = self::ensure_booking_page();

		WPAB_Log::add( 'feature_added', array( 'feature' => $feature, 'plugin' => $companion['slug'] ) );

		$result = array(
			'success'     => true,
			'feature'     => $feature,
			'plugin_slug' => $companion['slug'],
			'plugin_name' => $companion['name'],
			'admin_url'   => admin_url( 'edit.php?post_type=esk_booking' ),
		);

		if ( $page_id ) {
			$result['page_url'] = (string) get_permalink( $page_id );
		}

		return $result;
	}

	/** The companion plugin bootstrap — auto-loads every file in features/. */
	private static function companion_bootstrap_source( string $brand, string $slug ): string {
		$template = <<<'ESKBOOT'
<?php
/**
 * Plugin Name: {{PLUGIN_NAME}}
 * Description: Custom features generated for {{BRAND}} by the ESCANOR AI Builder — booking, post types, shortcodes and anything else this site needs. Every file in features/ is auto-loaded, so adding a capability is just adding a file.
 * Version: 1.0.0
 * Author: ESCANOR AI Builder
 * Author URI: https://escanor.lt
 * Text Domain: {{SLUG}}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ESCANOR_FEATURES_DIR', plugin_dir_path( __FILE__ ) );
define( 'ESCANOR_FEATURES_URL', plugin_dir_url( __FILE__ ) );

/**
 * Auto-load every feature dropped into features/. Each feature file is
 * self-contained and self-initialising, so adding one is just writing a file.
 */
$escanor_features_path = ESCANOR_FEATURES_DIR . 'features';

if ( is_dir( $escanor_features_path ) ) {
	$escanor_feature_files = scandir( $escanor_features_path );

	if ( is_array( $escanor_feature_files ) ) {
		sort( $escanor_feature_files );

		foreach ( $escanor_feature_files as $escanor_feature_file ) {
			if ( 'index.php' === $escanor_feature_file ) {
				continue;
			}
			if ( '.php' === substr( $escanor_feature_file, -4 ) ) {
				require_once $escanor_features_path . '/' . $escanor_feature_file;
			}
		}
	}
}
ESKBOOT;

		return strtr(
			$template,
			array(
				'{{PLUGIN_NAME}}' => $brand,
				'{{SLUG}}'        => $slug,
				'{{BRAND}}'       => $brand,
			)
		);
	}

	/** Create (once) a published "Book" page carrying the booking shortcode. */
	private static function ensure_booking_page(): int {
		$existing = get_page_by_path( 'book' );
		if ( $existing instanceof WP_Post ) {
			return (int) $existing->ID;
		}

		$content  = '<!-- wp:heading {"textAlign":"center","level":1} --><h1 class="wp-block-heading has-text-align-center">Book now</h1><!-- /wp:heading -->' . "\n";
		$content .= '<!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">Fill in the form below and we will get back to you.</p><!-- /wp:paragraph -->' . "\n";
		$content .= '<!-- wp:shortcode -->[escanor_booking]<!-- /wp:shortcode -->';

		$id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => 'Book',
				'post_name'    => 'book',
				'post_content' => $content,
			),
			true
		);

		return is_wp_error( $id ) ? 0 : (int) $id;
	}

	/** The booking feature's source — a self-loading file for features/. */
	private static function booking_feature_source( string $brand ): string {
		$template = <<<'ESKPLUGIN'
<?php
/**
 * Feature: Booking
 * Generated for {{BRAND}} by the ESCANOR AI Builder. Adds a booking form, stores
 * requests as Bookings, and emails you on each new one. Auto-loaded by the
 * companion plugin — no plugin header of its own.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( class_exists( 'Escanor_Feature_Booking' ) ) {
	return;
}

final class Escanor_Feature_Booking {

	const CPT = 'esk_booking';
	const NS  = 'escanor/v1';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'register_cpt' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_shortcode( 'escanor_booking', array( __CLASS__, 'form_shortcode' ) );
		add_filter( 'manage_' . self::CPT . '_posts_columns', array( __CLASS__, 'columns' ) );
		add_action( 'manage_' . self::CPT . '_posts_custom_column', array( __CLASS__, 'render_column' ), 10, 2 );
	}

	public static function register_cpt() {
		register_post_type(
			self::CPT,
			array(
				'labels'          => array(
					'name'          => 'Bookings',
					'singular_name' => 'Booking',
					'menu_name'     => 'Bookings',
				),
				'public'          => false,
				'show_ui'         => true,
				'show_in_menu'    => true,
				'menu_icon'       => 'dashicons-calendar-alt',
				'supports'        => array( 'title' ),
				'capability_type' => 'post',
				'map_meta_cap'    => true,
			)
		);
	}

	public static function register_routes() {
		register_rest_route(
			self::NS,
			'/book',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_booking' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public static function handle_booking( WP_REST_Request $req ) {
		// Honeypot: real visitors never fill a hidden field.
		if ( '' !== trim( (string) $req->get_param( 'company' ) ) ) {
			return new WP_REST_Response( array( 'success' => true, 'message' => 'Thank you! Your request has been received.' ), 200 );
		}

		$name    = sanitize_text_field( (string) $req->get_param( 'name' ) );
		$email   = sanitize_email( (string) $req->get_param( 'email' ) );
		$date    = sanitize_text_field( (string) $req->get_param( 'date' ) );
		$message = sanitize_textarea_field( (string) $req->get_param( 'message' ) );

		if ( '' === $name || ! is_email( $email ) ) {
			return new WP_Error( 'esk_book_invalid', 'Please enter your name and a valid email address.', array( 'status' => 400 ) );
		}

		$title = $name . ( '' !== $date ? ' - ' . $date : '' );

		$post_id = wp_insert_post(
			array(
				'post_type'   => self::CPT,
				'post_status' => 'publish',
				'post_title'  => $title,
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return new WP_Error( 'esk_book_save', 'Your request could not be saved. Please try again.', array( 'status' => 500 ) );
		}

		update_post_meta( $post_id, '_esk_name', $name );
		update_post_meta( $post_id, '_esk_email', $email );
		update_post_meta( $post_id, '_esk_date', $date );
		update_post_meta( $post_id, '_esk_message', $message );
		update_post_meta( $post_id, '_esk_status', 'new' );

		$to      = get_option( 'admin_email' );
		$subject = 'New booking - ' . wp_specialchars_decode( (string) get_bloginfo( 'name' ) );
		$body    = "You have a new booking request.\n\n";
		$body   .= 'Name: ' . $name . "\n";
		$body   .= 'Email: ' . $email . "\n";
		$body   .= 'Preferred date: ' . ( '' !== $date ? $date : '(none given)' ) . "\n\n";
		$body   .= "Message:\n" . ( '' !== $message ? $message : '(none)' ) . "\n";

		wp_mail( $to, $subject, $body );

		return new WP_REST_Response(
			array( 'success' => true, 'message' => 'Thank you! Your request has been received.' ),
			200
		);
	}

	public static function form_shortcode( $atts = array() ) {
		$endpoint = esc_url( rest_url( self::NS . '/book' ) );
		$uid      = 'esk-book-' . wp_rand( 1000, 9999 );
		$a        = esc_attr( $uid );

		$css = '<style>'
			. '.esk-book{max-width:560px;margin:0 auto;display:grid;gap:14px}'
			. '.esk-book label{display:block;font-weight:600;margin-bottom:4px}'
			. '.esk-book input,.esk-book textarea{width:100%;padding:11px 13px;border:1px solid var(--wp--preset--color--border,#d9dce1);border-radius:10px;background:var(--wp--preset--color--surface,#fff);color:inherit;font:inherit;box-sizing:border-box}'
			. '.esk-book textarea{min-height:120px;resize:vertical}'
			. '.esk-book__hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}'
			. '.esk-book__btn{appearance:none;border:0;border-radius:10px;padding:13px 22px;font:inherit;font-weight:600;cursor:pointer;background:var(--wp--preset--color--primary,#3a5bff);color:#fff}'
			. '.esk-book__btn:disabled{opacity:.6;cursor:default}'
			. '.esk-book__msg{padding:12px 14px;border-radius:10px;font-size:14px}'
			. '.esk-book__msg.is-ok{background:rgba(46,160,67,.12);color:#1a7f37}'
			. '.esk-book__msg.is-err{background:rgba(207,34,46,.1);color:#cf222e}'
			. '</style>';

		$form  = '<form class="esk-book" id="' . $a . '" data-endpoint="' . $endpoint . '" novalidate>';
		$form .= '<div><label for="' . $a . '-name">Name</label><input id="' . $a . '-name" name="name" type="text" required></div>';
		$form .= '<div><label for="' . $a . '-email">Email</label><input id="' . $a . '-email" name="email" type="email" required></div>';
		$form .= '<div><label for="' . $a . '-date">Preferred date</label><input id="' . $a . '-date" name="date" type="date"></div>';
		$form .= '<div><label for="' . $a . '-message">Message</label><textarea id="' . $a . '-message" name="message"></textarea></div>';
		$form .= '<div class="esk-book__hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>';
		$form .= '<div><button type="submit" class="esk-book__btn">Request booking</button></div>';
		$form .= '<div class="esk-book__msg" role="status" hidden></div>';
		$form .= '</form>';

		$js  = '<script>(function(){';
		$js .= 'var f=document.getElementById("' . esc_js( $uid ) . '");if(!f){return;}';
		$js .= 'f.addEventListener("submit",function(e){e.preventDefault();';
		$js .= 'var el=f.elements,msg=f.querySelector(".esk-book__msg"),btn=f.querySelector(".esk-book__btn");';
		$js .= 'var data={name:el["name"].value,email:el["email"].value,date:el["date"].value,message:el["message"].value,company:el["company"].value};';
		$js .= 'btn.disabled=true;msg.hidden=true;';
		$js .= 'fetch(f.dataset.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})';
		$js .= '.then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})';
		$js .= '.then(function(res){msg.hidden=false;if(res.ok&&res.j&&res.j.success){msg.className="esk-book__msg is-ok";msg.textContent=res.j.message||"Thank you!";f.reset();}else{msg.className="esk-book__msg is-err";msg.textContent=(res.j&&(res.j.message||res.j.error))||"Something went wrong. Please try again.";}})';
		$js .= '.catch(function(){msg.hidden=false;msg.className="esk-book__msg is-err";msg.textContent="Network error. Please try again.";})';
		$js .= '.then(function(){btn.disabled=false;});});})();</script>';

		return $css . $form . $js;
	}

	public static function columns( $columns ) {
		$new = array();
		foreach ( $columns as $key => $label ) {
			$new[ $key ] = $label;
			if ( 'title' === $key ) {
				$new['esk_email'] = 'Email';
				$new['esk_date']  = 'Preferred date';
			}
		}
		return $new;
	}

	public static function render_column( $column, $post_id ) {
		if ( 'esk_email' === $column ) {
			$email = (string) get_post_meta( $post_id, '_esk_email', true );
			echo $email ? '<a href="mailto:' . esc_attr( $email ) . '">' . esc_html( $email ) . '</a>' : '&mdash;';
		} elseif ( 'esk_date' === $column ) {
			$date = (string) get_post_meta( $post_id, '_esk_date', true );
			echo $date ? esc_html( $date ) : '&mdash;';
		}
	}
}

Escanor_Feature_Booking::init();
ESKPLUGIN;

		return strtr(
			$template,
			array(
				'{{BRAND}}' => $brand,
			)
		);
	}
}
