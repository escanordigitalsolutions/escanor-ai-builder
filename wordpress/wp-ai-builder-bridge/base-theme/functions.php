<?php
/**
 * Base block-theme skeleton.
 *
 * This theme is never meant to be activated on its own. The AI Builder copies
 * it into a unique per-site theme (named after the client's own brand), then
 * rewrites the palette, typography and content. Everything here is
 * intentionally minimal: the design lives in theme.json, the layout in
 * templates/ and parts/, and the sections are added as block patterns at
 * generation time.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'site_theme_setup' ) ) {
	function site_theme_setup() {
		add_theme_support( 'wp-block-styles' );
		add_theme_support( 'align-wide' );
		add_theme_support( 'responsive-embeds' );
		add_theme_support( 'editor-styles' );
		add_theme_support( 'post-thumbnails' );
		add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
	}
}
add_action( 'after_setup_theme', 'site_theme_setup' );

/**
 * Register the "Sections" pattern category. Section patterns generated for the
 * site are filed here so the client finds them in the block inserter.
 */
if ( ! function_exists( 'site_pattern_category' ) ) {
	function site_pattern_category() {
		if ( function_exists( 'register_block_pattern_category' ) ) {
			register_block_pattern_category(
				'sections',
				array( 'label' => __( 'Sections', 'default' ) )
			);
		}
	}
}
add_action( 'init', 'site_pattern_category' );

/**
 * Auto-load every site feature dropped into features/ (booking, custom post
 * types, custom blocks, etc.). Features live inside the theme — there is no
 * companion plugin — so adding a capability is just writing a file here. Each
 * feature file is self-contained and self-initialising.
 */
if ( ! function_exists( 'site_features_autoload' ) ) {
	function site_features_autoload() {
		$dir = get_stylesheet_directory() . '/features';
		if ( ! is_dir( $dir ) ) {
			return;
		}
		$items = scandir( $dir );
		if ( ! is_array( $items ) ) {
			return;
		}
		sort( $items );
		foreach ( $items as $f ) {
			if ( 'index.php' !== $f && '.php' === substr( $f, -4 ) ) {
				require_once $dir . '/' . $f;
			}
		}
	}
	site_features_autoload();
}
