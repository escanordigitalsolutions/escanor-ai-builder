<?php
/**
 * ESCANOR SEO module — read and write SEO fields through the site's own SEO
 * plugin (Yoast SEO or Rank Math), never a parallel store.
 *
 * The point of the module is no lock-in: the AI writes into exactly the meta
 * keys the active SEO plugin already uses, so everything stays visible and
 * editable in that plugin's own UI with ESCANOR turned off. If neither plugin
 * is active, SEO writes are unavailable (we do not invent our own <title>).
 *
 * Reads are local (post meta); the AI drafting happens on the SaaS side, and
 * applying is a plain update_post_meta here.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Seo {

	/** Field length guidance (soft caps used when sanitising writes). */
	private const MAX_TITLE = 70;
	private const MAX_DESC   = 165;
	private const MAX_FOCUS  = 100;

	/**
	 * Which SEO plugin is driving this site. Detection is by the public
	 * markers each plugin defines, so it does not depend on load order.
	 */
	public static function detect(): array {
		if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Options' ) ) {
			return array( 'plugin' => 'yoast', 'label' => 'Yoast SEO', 'active' => true );
		}

		if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) || defined( 'RANK_MATH_FILE' ) ) {
			return array( 'plugin' => 'rankmath', 'label' => 'Rank Math', 'active' => true );
		}

		if ( defined( 'AIOSEO_VERSION' ) || function_exists( 'aioseo' ) || defined( 'AIOSEO_FILE' ) ) {
			return array( 'plugin' => 'aioseo', 'label' => 'All in One SEO', 'active' => true );
		}

		return array( 'plugin' => 'none', 'label' => 'No SEO plugin', 'active' => false );
	}

	/* ---------------------------------------------------------------------
	 * Field access per plugin. Yoast and Rank Math store SEO fields in post
	 * meta; All in One SEO (v4+) keeps them in its own {prefix}aioseo_posts
	 * table, so it needs a $wpdb adapter. Reads degrade to empty strings and
	 * writes return a clear error rather than throwing.
	 * ------------------------------------------------------------------ */

	private static function aioseo_table(): ?string {
		global $wpdb;

		$table = $wpdb->prefix . 'aioseo_posts';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );

		return $found === $table ? $table : null;
	}

	private static function aioseo_row( int $id ): ?array {
		global $wpdb;

		$table = self::aioseo_table();

		if ( ! $table ) {
			return null;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE post_id = %d", $id ), ARRAY_A );

		return is_array( $row ) ? $row : null;
	}

	private static function aioseo_focus( ?array $row ): string {
		if ( ! $row || empty( $row['keyphrases'] ) ) {
			return '';
		}

		$kp = json_decode( (string) $row['keyphrases'], true );

		return isset( $kp['focus']['keyphrase'] ) ? (string) $kp['focus']['keyphrase'] : '';
	}

	/** Current SEO title / description / focus keyphrase for one post. */
	private static function read_basic( int $id, string $plugin ): array {
		if ( 'aioseo' === $plugin ) {
			$row = self::aioseo_row( $id );

			return array(
				'title' => $row ? (string) $row['title'] : '',
				'desc'  => $row ? (string) $row['description'] : '',
				'focus' => self::aioseo_focus( $row ),
			);
		}

		$keys = self::meta_keys( $plugin );

		if ( ! $keys ) {
			return array( 'title' => '', 'desc' => '', 'focus' => '' );
		}

		return array(
			'title' => (string) get_post_meta( $id, $keys['title'], true ),
			'desc'  => (string) get_post_meta( $id, $keys['desc'], true ),
			'focus' => (string) get_post_meta( $id, $keys['focus'], true ),
		);
	}

	/** Persist new title/desc/focus. $vals uses keys title/desc/focus. */
	private static function persist_basic( int $id, string $plugin, array $vals ) {
		if ( 'aioseo' === $plugin ) {
			global $wpdb;

			$table = self::aioseo_table();

			if ( ! $table ) {
				return new WP_Error( 'wpab_seo_aioseo_missing', 'All in One SEO storage was not found.', array( 'status' => 400 ) );
			}

			$row = self::aioseo_row( $id );

			$keyphrases = array( 'focus' => array( 'keyphrase' => (string) $vals['focus'], 'score' => 0, 'analysis' => array() ), 'additional' => array() );

			if ( $row && ! empty( $row['keyphrases'] ) ) {
				$existing = json_decode( (string) $row['keyphrases'], true );
				if ( is_array( $existing ) ) {
					$existing['focus'] = array_merge(
						isset( $existing['focus'] ) && is_array( $existing['focus'] ) ? $existing['focus'] : array(),
						array( 'keyphrase' => (string) $vals['focus'] )
					);
					$keyphrases = $existing;
				}
			}

			$data = array(
				'title'       => (string) $vals['title'],
				'description' => (string) $vals['desc'],
				'keyphrases'  => wp_json_encode( $keyphrases ),
				'updated'     => current_time( 'mysql' ),
			);

			if ( $row ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->update( $table, $data, array( 'post_id' => $id ) );
			} else {
				$data['post_id'] = $id;
				$data['context'] = 'post';
				$data['created'] = current_time( 'mysql' );
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->insert( $table, $data );
			}

			if ( false === $ok ) {
				return new WP_Error( 'wpab_seo_aioseo_write', 'Could not write to All in One SEO.', array( 'status' => 500 ) );
			}

			return true;
		}

		$keys = self::meta_keys( $plugin );

		if ( ! $keys ) {
			return new WP_Error( 'wpab_seo_no_plugin', 'No SEO plugin is active.', array( 'status' => 400 ) );
		}

		$pairs = array( 'title' => $keys['title'], 'desc' => $keys['desc'], 'focus' => $keys['focus'] );

		foreach ( $pairs as $k => $meta_key ) {
			if ( '' === (string) $vals[ $k ] ) {
				delete_post_meta( $id, $meta_key );
			} else {
				update_post_meta( $id, $meta_key, (string) $vals[ $k ] );
			}
		}

		return true;
	}

	/** The three meta keys the active plugin uses, or null when none is active. */
	private static function meta_keys( string $plugin ): ?array {
		if ( 'yoast' === $plugin ) {
			return array(
				'title' => '_yoast_wpseo_title',
				'desc'  => '_yoast_wpseo_metadesc',
				'focus' => '_yoast_wpseo_focuskw',
			);
		}

		if ( 'rankmath' === $plugin ) {
			return array(
				'title' => 'rank_math_title',
				'desc'  => 'rank_math_description',
				'focus' => 'rank_math_focus_keyword',
			);
		}

		return null;
	}

	/**
	 * Site-level SEO facts: whether search engines are allowed at all (the
	 * single most important switch), the SEO plugin, sitemap URL and the basic
	 * identity. Read-only.
	 */
	public static function site(): array {
		$detect = self::detect();
		$public = 1 === (int) get_option( 'blog_public', 1 );

		$sitemap = '';
		if ( 'yoast' === $detect['plugin'] || 'rankmath' === $detect['plugin'] ) {
			$sitemap = home_url( '/sitemap_index.xml' );
		} elseif ( 'aioseo' === $detect['plugin'] ) {
			$sitemap = home_url( '/sitemap.xml' );
		}

		return array(
			'success'       => true,
			'plugin'        => $detect['plugin'],
			'plugin_label'  => $detect['label'],
			'writable'      => (bool) $detect['active'],
			'search_public' => $public,
			'site_title'    => (string) get_bloginfo( 'name' ),
			'tagline'       => (string) get_bloginfo( 'description' ),
			'home_url'      => (string) home_url( '/' ),
			'sitemap_url'   => $sitemap,
			'reading_url'   => admin_url( 'options-reading.php' ),
		);
	}

	/** Only real, editable post types (never menus/media). */
	private static function guard_item( string $type, int $id ) {
		if ( ! WPAB_Content::is_editable_type( $type ) ) {
			return new WP_Error( 'wpab_seo_bad_type', 'SEO applies to pages, posts and products.', array( 'status' => 400 ) );
		}

		if ( $id < 1 ) {
			return new WP_Error( 'wpab_seo_bad_id', 'A valid content id is required.', array( 'status' => 400 ) );
		}

		$post = get_post( $id );

		if ( ! $post || $post->post_type !== $type ) {
			return new WP_Error( 'wpab_seo_not_found', 'Content not found.', array( 'status' => 404 ) );
		}

		return $post;
	}

	/** Count H1s in the body — a common on-page SEO smell when there are 0 or >1. */
	private static function count_h1( string $content ): int {
		$html = preg_match_all( '/<h1[\s>]/i', $content );
		$block = preg_match_all( '/"level"\s*:\s*1\b/', $content );

		return (int) $html + (int) $block;
	}

	public static function get_item( string $type, int $id ) {
		$post = self::guard_item( $type, $id );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$detect = self::detect();
		$basic  = self::read_basic( $id, $detect['plugin'] );

		$meta_title = $basic['title'];
		$meta_desc  = $basic['desc'];
		$focus      = $basic['focus'];

		$content = (string) $post->post_content;

		return array(
			'success'         => true,
			'plugin'          => $detect['plugin'],
			'plugin_label'    => $detect['label'],
			'writable'        => (bool) $detect['active'],
			'type'            => $type,
			'id'              => $id,
			'title'           => (string) get_the_title( $post ),
			'slug'            => (string) $post->post_name,
			'url'             => (string) get_permalink( $post ),
			'edit_url'        => (string) get_edit_post_link( $id, 'raw' ),
			'metaTitle'       => $meta_title,
			'metaDescription' => $meta_desc,
			'focusKeyword'    => $focus,
			'checks'          => array(
				'title_len' => strlen( $meta_title ),
				'desc_len'  => strlen( $meta_desc ),
				'has_focus' => '' !== trim( $focus ),
				'h1_count'  => self::count_h1( $content ),
			),
			'analysis'        => self::analyze(
				$post,
				(string) get_the_title( $post ),
				$meta_title,
				$meta_desc,
				$focus,
				$detect['plugin']
			),
			'advanced'        => self::advanced( $id, $detect['plugin'] ),
		);
	}

	/* ---------------------------------------------------------------------
	 * Analysis — a plugin-agnostic recommendation checklist plus whatever
	 * score the active SEO plugin has already stored. The detailed live
	 * checklist inside Yoast/Rank Math is computed in their JS and is not
	 * stored, so we recompute the same signals here from the content and the
	 * focus keyphrase, and surface the plugin's own numeric score alongside.
	 * ------------------------------------------------------------------ */

	private static function plugin_scores( int $id, string $plugin ): array {
		if ( 'yoast' === $plugin ) {
			$seo  = get_post_meta( $id, '_yoast_wpseo_linkdex', true );
			$read = get_post_meta( $id, '_yoast_wpseo_content_score', true );

			return array(
				'score'       => '' === $seo ? null : (int) $seo,
				'readability' => '' === $read ? null : (int) $read,
			);
		}

		if ( 'rankmath' === $plugin ) {
			$seo = get_post_meta( $id, 'rank_math_seo_score', true );

			return array(
				'score'       => '' === $seo ? null : (int) $seo,
				'readability' => null,
			);
		}

		if ( 'aioseo' === $plugin ) {
			$row = self::aioseo_row( $id );

			return array(
				'score'       => ( $row && isset( $row['seo_score'] ) && '' !== (string) $row['seo_score'] ) ? (int) $row['seo_score'] : null,
				'readability' => null,
			);
		}

		return array( 'score' => null, 'readability' => null );
	}

	/**
	 * Deeper per-post fields the SEO plugin stores beyond the three basics:
	 * indexing/robots, canonical, social (Open Graph / Twitter) and the
	 * cornerstone/pillar flag. Normalised across Yoast and Rank Math.
	 */
	private static function advanced( int $id, string $plugin ): array {
		$out = array(
			'robots_index'        => true,
			'robots_follow'       => true,
			'canonical'           => '',
			'og_title'            => '',
			'og_description'      => '',
			'og_image'            => '',
			'twitter_title'       => '',
			'twitter_description' => '',
			'cornerstone'         => false,
			'breadcrumb_title'    => '',
		);

		if ( 'yoast' === $plugin ) {
			$out['robots_index']        = '1' !== (string) get_post_meta( $id, '_yoast_wpseo_meta-robots-noindex', true );
			$out['robots_follow']       = '1' !== (string) get_post_meta( $id, '_yoast_wpseo_meta-robots-nofollow', true );
			$out['canonical']           = (string) get_post_meta( $id, '_yoast_wpseo_canonical', true );
			$out['og_title']            = (string) get_post_meta( $id, '_yoast_wpseo_opengraph-title', true );
			$out['og_description']      = (string) get_post_meta( $id, '_yoast_wpseo_opengraph-description', true );
			$out['og_image']            = (string) get_post_meta( $id, '_yoast_wpseo_opengraph-image', true );
			$out['twitter_title']       = (string) get_post_meta( $id, '_yoast_wpseo_twitter-title', true );
			$out['twitter_description'] = (string) get_post_meta( $id, '_yoast_wpseo_twitter-description', true );
			$out['cornerstone']         = '1' === (string) get_post_meta( $id, '_yoast_wpseo_is_cornerstone', true );
			$out['breadcrumb_title']    = (string) get_post_meta( $id, '_yoast_wpseo_bctitle', true );
		} elseif ( 'rankmath' === $plugin ) {
			$robots = get_post_meta( $id, 'rank_math_robots', true );
			if ( is_array( $robots ) ) {
				$out['robots_index']  = ! in_array( 'noindex', $robots, true );
				$out['robots_follow'] = ! in_array( 'nofollow', $robots, true );
			}
			$out['canonical']           = (string) get_post_meta( $id, 'rank_math_canonical_url', true );
			$out['og_title']            = (string) get_post_meta( $id, 'rank_math_facebook_title', true );
			$out['og_description']      = (string) get_post_meta( $id, 'rank_math_facebook_description', true );
			$out['og_image']            = (string) get_post_meta( $id, 'rank_math_facebook_image', true );
			$out['twitter_title']       = (string) get_post_meta( $id, 'rank_math_twitter_title', true );
			$out['twitter_description'] = (string) get_post_meta( $id, 'rank_math_twitter_description', true );
			$out['cornerstone']         = 'on' === (string) get_post_meta( $id, 'rank_math_pillar_content', true );
		} elseif ( 'aioseo' === $plugin ) {
			$row = self::aioseo_row( $id );
			if ( $row ) {
				$default = ! empty( $row['robots_default'] );
				$out['robots_index']        = $default ? true : empty( $row['robots_noindex'] );
				$out['robots_follow']       = $default ? true : empty( $row['robots_nofollow'] );
				$out['canonical']           = (string) ( $row['canonical_url'] ?? '' );
				$out['og_title']            = (string) ( $row['og_title'] ?? '' );
				$out['og_description']      = (string) ( $row['og_description'] ?? '' );
				$out['twitter_title']       = (string) ( $row['twitter_title'] ?? '' );
				$out['twitter_description'] = (string) ( $row['twitter_description'] ?? '' );
				$out['cornerstone']         = ! empty( $row['pillar_content'] );
			}
		}

		return $out;
	}

	private static function plain_text( string $content ): string {
		$text = strip_shortcodes( $content );
		$text = wp_strip_all_tags( $text );
		$text = html_entity_decode( $text, ENT_QUOTES, 'UTF-8' );

		return trim( preg_replace( '/\s+/', ' ', $text ) );
	}

	private static function contains_phrase( string $haystack, string $needle ): bool {
		$needle = trim( $needle );

		if ( '' === $needle ) {
			return false;
		}

		return false !== mb_stripos( $haystack, $needle );
	}

	private static function check( string $label, string $status, string $hint = '' ): array {
		return array( 'label' => $label, 'status' => $status, 'hint' => $hint );
	}

	/**
	 * @param WP_Post $post
	 */
	private static function analyze( $post, string $title, string $meta_title, string $meta_desc, string $focus, string $plugin ): array {
		$content = (string) $post->post_content;
		$text    = self::plain_text( $content );
		$words   = '' === $text ? 0 : count( preg_split( '/\s+/', $text ) );
		$focus   = trim( $focus );

		// Structure stats.
		preg_match_all( '/<h2[\s>]/i', $content, $h2m );
		preg_match_all( '/"level"\s*:\s*2\b/', $content, $h2b );
		$h2_count = count( $h2m[0] ) + count( $h2b[0] );

		preg_match_all( '/<img\b[^>]*>/i', $content, $imgs );
		$img_count   = count( $imgs[0] );
		$img_no_alt  = 0;
		foreach ( $imgs[0] as $img ) {
			if ( ! preg_match( '/\balt\s*=\s*("[^"]*[^"\s][^"]*"|\'[^\']*[^\'\s][^\']*\')/i', $img ) ) {
				$img_no_alt++;
			}
		}

		$home_host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		preg_match_all( '/<a\b[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>/i', $content, $links );
		$internal = 0;
		$external = 0;
		foreach ( $links[1] as $href ) {
			if ( 0 === strpos( $href, '#' ) ) {
				continue;
			}
			$host = (string) wp_parse_url( $href, PHP_URL_HOST );
			if ( '' === $host || $host === $home_host ) {
				$internal++;
			} else {
				$external++;
			}
		}

		// First paragraph / subheading text for keyphrase placement.
		$first_para = '';
		if ( preg_match( '/<p[^>]*>(.*?)<\/p>/is', $content, $pm ) ) {
			$first_para = self::plain_text( $pm[1] );
		} elseif ( '' !== $text ) {
			$first_para = mb_substr( $text, 0, 300 );
		}

		preg_match_all( '/<h[2-4][^>]*>(.*?)<\/h[2-4]>/is', $content, $subs );
		$sub_text = self::plain_text( implode( ' ', $subs[1] ) );

		$effective_title = '' !== $meta_title ? $meta_title : $title;

		$checks = array();

		if ( '' === $focus ) {
			$checks[] = self::check( 'Focus keyphrase', 'bad', 'No focus keyphrase set. Add one so the page can be optimized — the AI can suggest it.' );
		} else {
			$checks[] = self::check( 'Focus keyphrase', 'good', 'Set to “' . $focus . '”.' );
			$checks[] = self::check( 'Keyphrase in SEO title', self::contains_phrase( $effective_title, $focus ) ? 'good' : 'warn', 'The focus keyphrase should appear in the SEO title.' );
			$checks[] = self::check( 'Keyphrase in meta description', self::contains_phrase( $meta_desc, $focus ) ? 'good' : 'warn', 'Use the focus keyphrase in the meta description.' );
			$checks[] = self::check( 'Keyphrase in slug', self::contains_phrase( str_replace( '-', ' ', (string) $post->post_name ), $focus ) ? 'good' : 'warn', 'The URL slug should contain the focus keyphrase.' );
			$checks[] = self::check( 'Keyphrase in introduction', self::contains_phrase( $first_para, $focus ) ? 'good' : 'warn', 'Mention the focus keyphrase in the first paragraph.' );
			$checks[] = self::check( 'Keyphrase in subheadings', self::contains_phrase( $sub_text, $focus ) ? 'good' : 'warn', 'Use the focus keyphrase in at least one subheading.' );

			$occ     = @preg_match_all( '/' . preg_quote( $focus, '/' ) . '/i', $text );
			$occ     = is_int( $occ ) ? $occ : 0;
			$density = $words > 0 ? ( $occ / $words * 100 ) : 0;
			$checks[] = self::check(
				'Keyphrase density',
				( $density >= 0.4 && $density <= 3.0 ) ? 'good' : 'warn',
				number_format( $density, 1 ) . '% (' . $occ . '×). Aim for roughly 0.5–2.5%.'
			);
		}

		$title_len = strlen( $effective_title );
		$checks[] = self::check(
			'SEO title length',
			( $title_len >= 30 && $title_len <= 60 ) ? 'good' : 'warn',
			'' === $meta_title ? 'No SEO title set — falling back to the page title (' . $title_len . ' chars). Aim for 30–60.' : 'SEO title is ' . $title_len . ' characters. Aim for 30–60.'
		);

		$desc_len = strlen( $meta_desc );
		$checks[] = self::check(
			'Meta description',
			'' === $meta_desc ? 'bad' : ( ( $desc_len >= 120 && $desc_len <= 156 ) ? 'good' : 'warn' ),
			'' === $meta_desc ? 'No meta description set. Add one (120–156 characters).' : 'Meta description is ' . $desc_len . ' characters. Aim for 120–156.'
		);

		$checks[] = self::check(
			'Content length',
			$words >= 300 ? 'good' : ( $words >= 150 ? 'warn' : 'bad' ),
			$words . ' words. Aim for at least 300 for a content page.'
		);

		$checks[] = self::check(
			'Subheadings',
			$h2_count >= 1 ? 'good' : 'warn',
			$h2_count . ' H2 subheading(s). Break up the content with subheadings.'
		);

		if ( $img_count > 0 ) {
			$checks[] = self::check(
				'Image alt text',
				0 === $img_no_alt ? 'good' : 'bad',
				0 === $img_no_alt ? 'All ' . $img_count . ' image(s) have alt text.' : $img_no_alt . ' of ' . $img_count . ' image(s) are missing alt text.'
			);
		}

		$checks[] = self::check(
			'Internal links',
			$internal >= 1 ? 'good' : 'warn',
			$internal . ' internal link(s). Link to related pages on your site.'
		);

		$scores = self::plugin_scores( (int) $post->ID, $plugin );

		return array(
			'score'       => $scores['score'],
			'readability' => $scores['readability'],
			'word_count'  => $words,
			'stats'       => array(
				'h2'             => $h2_count,
				'images'         => $img_count,
				'images_no_alt'  => $img_no_alt,
				'links_internal' => $internal,
				'links_external' => $external,
			),
			'checks'      => $checks,
		);
	}

	/**
	 * Site-wide audit: a compact SEO summary for every item of one type, so the
	 * whole site's SEO health is visible at a glance and any item can be opened
	 * for optimization. Deliberately light per item (no heavy content parsing) —
	 * it grades on the three essentials: focus keyphrase, meta title, meta
	 * description.
	 */
	public static function audit( string $type, int $limit = 100 ) {
		$type = trim( $type );

		if ( ! WPAB_Content::is_editable_type( $type ) ) {
			return new WP_Error( 'wpab_seo_bad_type', 'SEO applies to pages, posts and products.', array( 'status' => 400 ) );
		}

		$limit  = max( 1, min( 200, $limit ) );
		$detect = self::detect();

		$posts = get_posts(
			array(
				'post_type'        => $type,
				'numberposts'      => $limit,
				'post_status'      => array( 'publish', 'future', 'draft', 'pending', 'private' ),
				'orderby'          => 'modified',
				'order'            => 'DESC',
				'suppress_filters' => false,
			)
		);

		$items       = array();
		$need_work   = 0;
		$skipped     = array();

		foreach ( $posts as $post ) {
			try {
			$id     = (int) $post->ID;
			$basic  = self::read_basic( $id, $detect['plugin'] );
			$scores = self::plugin_scores( $id, $detect['plugin'] );

			$tlen      = strlen( $basic['title'] );
			$dlen      = strlen( $basic['desc'] );
			$has_focus = '' !== trim( $basic['focus'] );
			$has_title = '' !== $basic['title'];
			$has_desc  = '' !== $basic['desc'];

			$issues = 0;
			if ( ! $has_focus ) {
				$issues++;
			}
			if ( ! $has_title || $tlen < 30 || $tlen > 60 ) {
				$issues++;
			}
			if ( ! $has_desc || $dlen < 120 || $dlen > 156 ) {
				$issues++;
			}

			$grade = 0 === $issues ? 'good' : ( 1 === $issues ? 'warn' : 'bad' );

			if ( $issues > 0 ) {
				$need_work++;
			}

			$items[] = array(
				'id'        => $id,
				'title'     => (string) get_the_title( $post ),
				'status'    => (string) $post->post_status,
				'url'       => (string) get_permalink( $post ),
				'edit_url'  => (string) get_edit_post_link( $id, 'raw' ),
				'score'     => $scores['score'],
				'has_focus' => $has_focus,
				'has_title' => $has_title,
				'has_desc'  => $has_desc,
				'issues'    => $issues,
				'grade'     => $grade,
			);
			} catch ( \Throwable $e ) {
				if ( count( $skipped ) < 3 ) {
					$skipped[] = $e->getMessage();
				}
				continue;
			}
		}

		return array(
			'success'      => true,
			'plugin'       => $detect['plugin'],
			'plugin_label' => $detect['label'],
			'writable'     => (bool) $detect['active'],
			'type'         => $type,
			'count'        => count( $items ),
			'need_work'    => $need_work,
			'items'        => $items,
			'skipped'      => $skipped,
		);
	}

	/**
	 * Write SEO fields into the active plugin's own meta. $fields may contain
	 * metaTitle, metaDescription, focusKeyword. Returns before/after so the UI
	 * can confirm and offer Undo.
	 */
	public static function apply( string $type, int $id, array $fields ) {
		$post = self::guard_item( $type, $id );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$detect = self::detect();

		if ( ! $detect['active'] ) {
			return new WP_Error( 'wpab_seo_no_plugin', 'No SEO plugin is active. Install Yoast SEO, Rank Math or All in One SEO to write SEO fields.', array( 'status' => 400 ) );
		}

		$plugin  = $detect['plugin'];
		$current = self::read_basic( $id, $plugin );

		// field name -> internal key + length cap
		$map = array(
			'metaTitle'       => array( 'key' => 'title', 'max' => self::MAX_TITLE ),
			'metaDescription' => array( 'key' => 'desc', 'max' => self::MAX_DESC ),
			'focusKeyword'    => array( 'key' => 'focus', 'max' => self::MAX_FOCUS ),
		);

		$before  = array();
		$after   = array();
		$changed = 0;
		$vals    = $current; // title/desc/focus, start from current

		foreach ( $map as $field => $conf ) {
			if ( ! array_key_exists( $field, $fields ) ) {
				continue;
			}

			$new = sanitize_text_field( substr( (string) $fields[ $field ], 0, $conf['max'] ) );
			$old = (string) $current[ $conf['key'] ];

			$before[ $field ] = $old;

			if ( $new === $old ) {
				$after[ $field ] = $old;
				continue;
			}

			$vals[ $conf['key'] ] = $new;
			$after[ $field ]      = $new;
			$changed++;
		}

		if ( $changed > 0 ) {
			$saved = self::persist_basic( $id, $plugin, $vals );

			if ( is_wp_error( $saved ) ) {
				return $saved;
			}
		}

		WPAB_Log::add(
			'seo_updated',
			array(
				'type'    => $type,
				'id'      => $id,
				'plugin'  => $detect['plugin'],
				'changed' => $changed,
			)
		);

		return array(
			'success'  => true,
			'plugin'   => $detect['plugin'],
			'type'     => $type,
			'id'       => $id,
			'url'      => (string) get_permalink( $id ),
			'edit_url' => (string) get_edit_post_link( $id, 'raw' ),
			'changed'  => $changed,
			'before'   => $before,
			'after'    => $after,
		);
	}
}
