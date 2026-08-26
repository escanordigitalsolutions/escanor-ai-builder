<?php
/**
 * ESCANOR AI Builder — read-only site analysis (SEO, Insights, Recommendations).
 *
 * Computes a deterministic audit of the live site from WordPress core data:
 * a content inventory (analytics) and a set of SEO signals across a sample of
 * pages/posts/products. Nothing here writes anything. The AI "Recommendations"
 * view (in the SaaS) is layered on top of this same audit.
 *
 * Shared by:
 *   - WPAB_Editor  -> the wp-admin Studio SEO / Insights panels (nonce auth).
 *   - WPAB_REST    -> the SaaS /analyze endpoint the recommender reads.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Analysis {

	/** How many items to actually open and inspect for SEO signals. */
	private const SEO_SAMPLE = 40;

	/** Word count below which a page is flagged as thin. */
	private const THIN_WORDS = 300;

	public static function audit(): array {
		return array(
			'success'   => true,
			'generated' => gmdate( 'c' ),
			'site'      => self::site_checks(),
			'inventory' => self::inventory(),
			'seo'       => self::seo(),
		);
	}

	/* ---------------------------------------------------------------------
	 * Site-level checks
	 * ------------------------------------------------------------------ */

	private static function site_checks(): array {
		$permalink = (string) get_option( 'permalink_structure', '' );
		$tagline   = (string) get_bloginfo( 'description' );

		return array(
			'title'             => (string) get_bloginfo( 'name' ),
			'tagline'           => $tagline,
			'tagline_default'   => ( 'Just another WordPress site' === trim( $tagline ) ),
			'tagline_empty'     => ( '' === trim( $tagline ) ),
			'permalink_plain'   => ( '' === $permalink ),
			'https'             => ( 'https' === wp_parse_url( home_url(), PHP_URL_SCHEME ) ),
			'front_page_static' => ( 'page' === get_option( 'show_on_front' ) ),
			'search_indexable'  => ( '1' === (string) get_option( 'blog_public', '1' ) ),
			'seo_plugin'        => self::seo_plugin(),
			'home_url'          => (string) home_url( '/' ),
		);
	}

	private static function seo_plugin() {
		if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Meta' ) ) {
			return 'yoast';
		}
		if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
			return 'rankmath';
		}
		if ( defined( 'AIOSEO_VERSION' ) ) {
			return 'aioseo';
		}
		return null;
	}

	private static function meta_description( int $id, $plugin ): string {
		if ( 'yoast' === $plugin ) {
			return (string) get_post_meta( $id, '_yoast_wpseo_metadesc', true );
		}
		if ( 'rankmath' === $plugin ) {
			return (string) get_post_meta( $id, 'rank_math_description', true );
		}
		if ( 'aioseo' === $plugin ) {
			return (string) get_post_meta( $id, '_aioseo_description', true );
		}
		return '';
	}

	/* ---------------------------------------------------------------------
	 * Inventory / analytics
	 * ------------------------------------------------------------------ */

	private static function inventory(): array {
		$statuses = array( 'publish', 'future', 'draft', 'pending', 'private' );
		$types    = array();

		$post_types = get_post_types( array( 'show_ui' => true ), 'objects' );

		foreach ( $post_types as $pt ) {
			if ( in_array( $pt->name, array( 'attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'nav_menu_item' ), true ) ) {
				continue;
			}
			$counts    = wp_count_posts( $pt->name );
			$published = isset( $counts->publish ) ? (int) $counts->publish : 0;
			$draft     = 0;
			foreach ( array( 'draft', 'pending', 'future', 'private' ) as $st ) {
				if ( isset( $counts->$st ) ) {
					$draft += (int) $counts->$st;
				}
			}
			if ( 0 === $published && 0 === $draft && ! in_array( $pt->name, array( 'page', 'post' ), true ) ) {
				continue;
			}
			$types[] = array(
				'key'       => $pt->name,
				'label'     => (string) $pt->label,
				'published' => $published,
				'draft'     => $draft,
				'total'     => $published + $draft,
			);
		}

		$media_counts = wp_count_posts( 'attachment' );
		$menus        = wp_get_nav_menus();

		$inventory = array(
			'types' => $types,
			'media' => isset( $media_counts->inherit ) ? (int) $media_counts->inherit : 0,
			'menus' => is_array( $menus ) ? count( $menus ) : 0,
		);

		// WooCommerce product stock split.
		if ( class_exists( 'WooCommerce' ) && post_type_exists( 'product' ) ) {
			$instock    = self::count_meta( 'product', '_stock_status', 'instock' );
			$outofstock = self::count_meta( 'product', '_stock_status', 'outofstock' );
			$inventory['products'] = array(
				'instock'    => $instock,
				'outofstock' => $outofstock,
			);
		}

		// A few most-recently modified items, for an "activity" glance.
		$recent = get_posts(
			array(
				'post_type'        => array( 'page', 'post' ),
				'numberposts'      => 5,
				'post_status'      => $statuses,
				'orderby'          => 'modified',
				'order'            => 'DESC',
				'suppress_filters' => false,
			)
		);
		$inventory['recent'] = array();
		foreach ( $recent as $r ) {
			$inventory['recent'][] = array(
				'id'       => (int) $r->ID,
				'title'    => (string) get_the_title( $r ),
				'type'     => (string) $r->post_type,
				'status'   => (string) $r->post_status,
				'modified' => (string) get_post_modified_time( 'c', true, $r ),
			);
		}

		return $inventory;
	}

	private static function count_meta( string $type, string $key, string $value ): int {
		$q = get_posts(
			array(
				'post_type'   => $type,
				'post_status' => 'publish',
				'numberposts' => -1,
				'fields'      => 'ids',
				'meta_key'    => $key,
				'meta_value'  => $value,
			)
		);
		return is_array( $q ) ? count( $q ) : 0;
	}

	/* ---------------------------------------------------------------------
	 * SEO signals
	 * ------------------------------------------------------------------ */

	private static function seo(): array {
		$plugin = self::seo_plugin();

		$sample_types = array( 'page', 'post' );
		if ( class_exists( 'WooCommerce' ) && post_type_exists( 'product' ) ) {
			$sample_types[] = 'product';
		}

		$posts = get_posts(
			array(
				'post_type'        => $sample_types,
				'post_status'      => 'publish',
				'numberposts'      => self::SEO_SAMPLE,
				'orderby'          => 'modified',
				'order'            => 'DESC',
				'suppress_filters' => false,
			)
		);

		$issues = array(
			'missing_meta'  => 0,
			'short_title'   => 0,
			'long_title'    => 0,
			'thin_content'  => 0,
			'images_no_alt' => 0,
			'multi_h1'      => 0,
		);

		$items = array();

		foreach ( $posts as $post ) {
			$flags   = array();
			$title   = (string) get_the_title( $post );
			$tlen    = function_exists( 'mb_strlen' ) ? mb_strlen( $title ) : strlen( $title );
			$content = (string) $post->post_content;
			$text    = wp_strip_all_tags( $content );
			$words   = str_word_count( $text );

			if ( $tlen > 0 && $tlen < 15 ) {
				$flags[] = 'short_title';
				$issues['short_title']++;
			}
			if ( $tlen > 65 ) {
				$flags[] = 'long_title';
				$issues['long_title']++;
			}
			if ( $words < self::THIN_WORDS ) {
				$flags[] = 'thin_content';
				$issues['thin_content']++;
			}

			if ( $plugin ) {
				$desc = trim( self::meta_description( (int) $post->ID, $plugin ) );
				if ( '' === $desc ) {
					$flags[] = 'missing_meta';
					$issues['missing_meta']++;
				}
			}

			// Images without alt text.
			if ( preg_match_all( '/<img\b[^>]*>/i', $content, $imgs ) ) {
				$no_alt = 0;
				foreach ( $imgs[0] as $img ) {
					if ( ! preg_match( '/\balt\s*=\s*("[^"]+"|\'[^\']+\')/i', $img ) ) {
						$no_alt++;
					}
				}
				if ( $no_alt > 0 ) {
					$flags[]  = 'images_no_alt';
					$issues['images_no_alt']++;
				}
			}

			// More than one H1 in the body (theme already renders the title H1).
			if ( preg_match_all( '/<h1\b/i', $content, $h1s ) && count( $h1s[0] ) > 1 ) {
				$flags[] = 'multi_h1';
				$issues['multi_h1']++;
			}

			if ( ! empty( $flags ) ) {
				$items[] = array(
					'id'    => (int) $post->ID,
					'type'  => (string) $post->post_type,
					'title' => $title,
					'url'   => (string) get_permalink( $post ),
					'words' => (int) $words,
					'flags' => $flags,
				);
			}
		}

		// Worst offenders first, capped.
		usort(
			$items,
			static function ( $a, $b ) {
				return count( $b['flags'] ) - count( $a['flags'] );
			}
		);
		$items = array_slice( $items, 0, 20 );

		return array(
			'seo_plugin' => $plugin,
			'checked'    => count( $posts ),
			'issues'     => $issues,
			'items'      => $items,
		);
	}
}
