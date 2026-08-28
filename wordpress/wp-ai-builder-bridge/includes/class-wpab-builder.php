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

	private const BASE_THEME = 'escanor-native';

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
		$base_dir = get_theme_root() . '/' . self::BASE_THEME;

		if ( ! is_dir( $base_dir ) ) {
			return new WP_Error(
				'wpab_builder_base_missing',
				'The ESCANOR Native theme is required as the base for generated themes. Install and keep it, then try again.',
				array( 'status' => 400 )
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

		WPAB_Log::add(
			'theme_generated',
			array(
				'slug'  => $slug,
				'brand' => $brand,
				'type'  => isset( $spec['site_type'] ) ? sanitize_key( (string) $spec['site_type'] ) : '',
			)
		);

		return array(
			'success'       => true,
			'theme_slug'    => $slug,
			'theme_name'    => $brand,
			'preview_url'   => home_url( '/' ),
			'editor_url'    => admin_url( 'site-editor.php' ),
			'primary'       => self::clamp_hex( (string) ( $spec['primary'] ?? '' ), '#3a5bff' ),
		);
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
	public static function apply_site( array $pages ) {
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

		WPAB_Log::add( 'site_generated', array( 'pages' => count( $created ) ) );

		return array(
			'success'  => true,
			'pages'    => $created,
			'front_id' => $front_id,
			'home_url' => home_url( '/' ),
		);
	}
}
