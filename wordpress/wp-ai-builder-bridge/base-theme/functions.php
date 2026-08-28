<?php
/**
 * ESCANOR Base — a neutral block-theme skeleton.
 *
 * This theme is never meant to be activated on its own. The ESCANOR AI Builder
 * copies it into a unique per-site theme (escanor-{brand}) and rewrites the
 * palette, typography and content. Everything here is intentionally minimal:
 * the design lives in theme.json, the layout in templates/ and parts/, and the
 * sections are added as block patterns at generation time.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'escanor_base_setup' ) ) {
	function escanor_base_setup() {
		add_theme_support( 'wp-block-styles' );
		add_theme_support( 'align-wide' );
		add_theme_support( 'responsive-embeds' );
		add_theme_support( 'editor-styles' );
		add_theme_support( 'post-thumbnails' );
		add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
	}
}
add_action( 'after_setup_theme', 'escanor_base_setup' );

/**
 * Register the "Escanor" pattern category. Section patterns generated for the
 * site are filed here so the client finds them in the block inserter.
 */
if ( ! function_exists( 'escanor_base_pattern_category' ) ) {
	function escanor_base_pattern_category() {
		if ( function_exists( 'register_block_pattern_category' ) ) {
			register_block_pattern_category(
				'escanor',
				array( 'label' => __( 'Escanor', 'escanor-base' ) )
			);
		}
	}
}
add_action( 'init', 'escanor_base_pattern_category' );
