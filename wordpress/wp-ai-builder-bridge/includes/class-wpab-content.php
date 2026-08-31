<?php
/**
 * ESCANOR AI Builder — native WordPress content reader (v3A, Phase 1).
 *
 * Read-only visibility into the site's native content: pages, posts, any
 * public custom post type (WooCommerce products included when WooCommerce is
 * active), navigation menus and the media library.
 *
 * Two callers share this one reader so both stay consistent:
 *   - WPAB_Editor  -> the wp-admin Studio "Content" browser (nonce auth).
 *   - WPAB_REST    -> the SaaS agent's list_content / get_content tools
 *                     (bridge-token auth), so the AI can "see" the site.
 *
 * Nothing here writes, deletes or executes anything. Every string returned is
 * plain content data; callers treat it as untrusted (escaped in the browser,
 * quoted as data for the model).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Content {

	/** Hard caps so a huge site or a huge page can never blow up a response. */
	/**
	 * Snapshot limits.
	 *
	 * A content snapshot rides along with every chat message, so it is bounded
	 * hard. These mirror CONTENT_SNAPSHOT_LIMITS on the SaaS side; the ceiling
	 * over both is Vercel's 4.5 MB request body, which this shares with the
	 * theme snapshot and an optional screenshot.
	 */
	public const SNAPSHOT_MAX_TYPES       = 12;
	public const SNAPSHOT_ITEMS_PER_TYPE  = 30;
	public const SNAPSHOT_MAX_BODIES      = 40;
	public const SNAPSHOT_MAX_BODY_BYTES  = 20000;
	public const SNAPSHOT_MAX_TOTAL_BYTES = 300000;

	private const MAX_ITEMS       = 100;
	private const MAX_CONTENT     = 40000;
	private const MAX_MENU_ITEMS  = 200;

	/** Post statuses we surface (everything an editor would see in wp-admin). */
	private const POST_STATUSES = array( 'publish', 'future', 'draft', 'pending', 'private' );

	/** Internal post types that must never be offered as browsable content. */
	private const HIDDEN_TYPES = array(
		'attachment',
		'revision',
		'nav_menu_item',
		'custom_css',
		'customize_changeset',
		'oembed_cache',
		'user_request',
		'wp_block',
		'wp_template',
		'wp_template_part',
		'wp_global_styles',
		'wp_navigation',
	);

	/* ---------------------------------------------------------------------
	 * Type discovery
	 * ------------------------------------------------------------------ */

	public static function woocommerce_active(): bool {
		return class_exists( 'WooCommerce' );
	}

	/**
	 * The list of content types this site actually has, with a friendly label
	 * and a rough count, so the browser can render exactly the tabs that apply
	 * (Products only appears when WooCommerce is installed).
	 */
	public static function types(): array {
		$types = array();

		$post_types = get_post_types( array( 'show_ui' => true ), 'objects' );

		// Keep page/post first and in a predictable order, then any CPT.
		uasort(
			$post_types,
			static function ( $a, $b ) {
				$order = array( 'page' => 0, 'post' => 1, 'product' => 2 );
				$ra    = isset( $order[ $a->name ] ) ? $order[ $a->name ] : 50;
				$rb    = isset( $order[ $b->name ] ) ? $order[ $b->name ] : 50;
				if ( $ra === $rb ) {
					return strcmp( (string) $a->label, (string) $b->label );
				}
				return $ra - $rb;
			}
		);

		foreach ( $post_types as $pt ) {
			if ( in_array( $pt->name, self::HIDDEN_TYPES, true ) ) {
				continue;
			}

			$counts = wp_count_posts( $pt->name );
			$total  = 0;
			foreach ( self::POST_STATUSES as $status ) {
				if ( isset( $counts->$status ) ) {
					$total += (int) $counts->$status;
				}
			}

			$types[] = array(
				'key'   => $pt->name,
				'label' => (string) $pt->label,
				'kind'  => 'post_type',
				'count' => $total,
			);
		}

		// Navigation menus.
		$menus = wp_get_nav_menus();
		$types[] = array(
			'key'   => 'menu',
			'label' => 'Menus',
			'kind'  => 'menu',
			'count' => is_array( $menus ) ? count( $menus ) : 0,
		);

		// Media library.
		$media_counts = wp_count_posts( 'attachment' );
		$types[] = array(
			'key'   => 'media',
			'label' => 'Media',
			'kind'  => 'media',
			'count' => isset( $media_counts->inherit ) ? (int) $media_counts->inherit : 0,
		);

		return array(
			'success'     => true,
			'woocommerce' => self::woocommerce_active(),
			'types'       => $types,
		);
	}

	/* ---------------------------------------------------------------------
	 * Snapshot — the site's content, sent WITH the request
	 * ------------------------------------------------------------------ */

	/**
	 * What the chat can answer about this site's content without calling back.
	 *
	 * Same reasoning as WPAB_Files::snapshot(): the SaaS can only reach a site
	 * that is publicly reachable from the internet inside ten seconds, and a
	 * great many WordPress installs are not. Reading this locally costs a few
	 * database queries; being asked for it over HTTP costs a failed request.
	 *
	 * Three layers, cheapest first, each bounded:
	 *   types    — every content type with a count. A few hundred bytes.
	 *   listings — the most recently modified items per type, titles only.
	 *   bodies   — the actual content of a few of those items. Pages first:
	 *              they are few, and they are what people ask about.
	 *
	 * Never returns a WP_Error. What does not fit is simply absent, and the
	 * snapshot says so, which is what lets the SaaS decide whether a missing
	 * item is worth one attempt at the old HTTP pull.
	 */
	public static function snapshot(): array {
		$out = array(
			'types'     => array(),
			'listings'  => array(),
			'bodies'    => array(),
			'truncated' => false,
		);

		$types = self::types();
		$list  = isset( $types['types'] ) && is_array( $types['types'] ) ? $types['types'] : array();

		$out['types']       = $types;
		$out['woocommerce'] = ! empty( $types['woocommerce'] );

		if ( count( $list ) > self::SNAPSHOT_MAX_TYPES ) {
			$list             = array_slice( $list, 0, self::SNAPSHOT_MAX_TYPES );
			$out['truncated'] = true;
		}

		$budget = self::SNAPSHOT_MAX_TOTAL_BYTES;

		// Layer two: what exists, by type.
		foreach ( $list as $type ) {
			$key = isset( $type['key'] ) ? (string) $type['key'] : '';

			if ( '' === $key || empty( $type['count'] ) ) {
				continue;
			}

			$listing = self::listing( $key, self::SNAPSHOT_ITEMS_PER_TYPE );

			if ( is_wp_error( $listing ) || empty( $listing['items'] ) ) {
				continue;
			}

			$cost = strlen( (string) wp_json_encode( $listing['items'] ) );

			if ( $cost > $budget ) {
				$out['truncated'] = true;
				break;
			}

			$budget                  -= $cost;
			$out['listings'][ $key ]  = $listing['items'];
		}

		// Layer three: the text itself, for as many items as the budget allows.
		foreach ( self::body_candidates( $out['listings'] ) as $candidate ) {
			if ( count( $out['bodies'] ) >= self::SNAPSHOT_MAX_BODIES ) {
				$out['truncated'] = true;
				break;
			}

			$item = self::get_item( $candidate['type'], $candidate['id'] );

			if ( is_wp_error( $item ) ) {
				continue;
			}

			$cost = strlen( (string) wp_json_encode( $item ) );

			if ( $cost > self::SNAPSHOT_MAX_BODY_BYTES || $cost > $budget ) {
				// One long page must not crowd out every short one after it,
				// so this skips rather than stopping — unless nothing fits.
				$out['truncated'] = true;

				if ( $cost > $budget ) {
					break;
				}

				continue;
			}

			$budget                                                        -= $cost;
			$out['bodies'][ $candidate['type'] . ':' . $candidate['id'] ]  = $item;
		}

		return $out;
	}

	/**
	 * Which items are worth sending the text of, most useful first.
	 *
	 * Pages before posts before anything else: a site has a handful of pages
	 * and people ask about them by name, while posts are many and are usually
	 * discussed as a list. Media and menus carry no body worth sending.
	 */
	private static function body_candidates( array $listings ): array {
		$order      = array( 'page' => 0, 'post' => 1, 'product' => 2 );
		$candidates = array();

		$keys = array_keys( $listings );

		usort(
			$keys,
			static function ( $a, $b ) use ( $order ) {
				$ra = isset( $order[ $a ] ) ? $order[ $a ] : 50;
				$rb = isset( $order[ $b ] ) ? $order[ $b ] : 50;

				return $ra === $rb ? strcmp( $a, $b ) : $ra - $rb;
			}
		);

		foreach ( $keys as $type ) {
			if ( 'media' === $type || 'menu' === $type ) {
				continue;
			}

			foreach ( $listings[ $type ] as $item ) {
				if ( empty( $item['id'] ) ) {
					continue;
				}

				$candidates[] = array(
					'type' => $type,
					'id'   => (int) $item['id'],
				);
			}
		}

		return $candidates;
	}

	/** Add the content snapshot to an outbound SaaS payload. */
	public static function attach_snapshot( array $payload ): array {
		$payload['content'] = self::snapshot();

		return $payload;
	}

	/**
	 * Is $type something we are willing to read? Post types must be registered
	 * with a UI and not on the internal denylist; menu and media are synthetic.
	 */
	private static function is_allowed_type( string $type ): bool {
		if ( 'menu' === $type || 'media' === $type ) {
			return true;
		}

		if ( in_array( $type, self::HIDDEN_TYPES, true ) ) {
			return false;
		}

		$obj = get_post_type_object( $type );

		return $obj && ( ! empty( $obj->show_ui ) || ! empty( $obj->public ) );
	}

	/* ---------------------------------------------------------------------
	 * Listing
	 * ------------------------------------------------------------------ */

	public static function listing( string $type, int $limit = 30 ) {
		$type  = trim( $type );
		$limit = max( 1, min( self::MAX_ITEMS, $limit ) );

		if ( '' === $type || ! self::is_allowed_type( $type ) ) {
			return new WP_Error( 'wpab_content_bad_type', 'Unknown content type.', array( 'status' => 400 ) );
		}

		if ( 'menu' === $type ) {
			return array(
				'success' => true,
				'type'    => 'menu',
				'items'   => self::list_menus(),
			);
		}

		if ( 'media' === $type ) {
			return array(
				'success' => true,
				'type'    => 'media',
				'items'   => self::list_media( $limit ),
			);
		}

		return array(
			'success' => true,
			'type'    => $type,
			'items'   => self::list_posts( $type, $limit ),
		);
	}

	private static function list_posts( string $type, int $limit ): array {
		$posts = get_posts(
			array(
				'post_type'        => $type,
				'numberposts'      => $limit,
				'post_status'      => self::POST_STATUSES,
				'orderby'          => 'modified',
				'order'            => 'DESC',
				'suppress_filters' => false,
			)
		);

		$is_product = ( 'product' === $type && self::woocommerce_active() );
		$items      = array();

		foreach ( $posts as $post ) {
			$row = array(
				'id'       => (int) $post->ID,
				'title'    => (string) get_the_title( $post ),
				'status'   => (string) $post->post_status,
				'type'     => (string) $post->post_type,
				'url'      => (string) get_permalink( $post ),
				'edit_url' => (string) get_edit_post_link( $post->ID, 'raw' ),
				'modified' => (string) get_post_modified_time( 'c', true, $post ),
			);

			if ( $is_product ) {
				$row['sku']   = (string) get_post_meta( $post->ID, '_sku', true );
				$row['price'] = (string) get_post_meta( $post->ID, '_price', true );
			}

			$items[] = $row;
		}

		return $items;
	}

	private static function list_menus(): array {
		$menus = wp_get_nav_menus();
		$items = array();

		if ( ! is_array( $menus ) ) {
			return $items;
		}

		foreach ( $menus as $menu ) {
			$items[] = array(
				'id'    => (int) $menu->term_id,
				'title' => (string) $menu->name,
				'type'  => 'menu',
				'count' => (int) $menu->count,
			);
		}

		return $items;
	}

	private static function list_media( int $limit ): array {
		$attachments = get_posts(
			array(
				'post_type'   => 'attachment',
				'post_status' => 'inherit',
				'numberposts' => $limit,
				'orderby'     => 'date',
				'order'       => 'DESC',
			)
		);

		$items = array();

		foreach ( $attachments as $att ) {
			$items[] = array(
				'id'       => (int) $att->ID,
				'title'    => (string) get_the_title( $att ),
				'type'     => 'media',
				'mime'     => (string) $att->post_mime_type,
				'url'      => (string) wp_get_attachment_url( $att->ID ),
				'modified' => (string) get_post_modified_time( 'c', true, $att ),
			);
		}

		return $items;
	}

	/* ---------------------------------------------------------------------
	 * Single item
	 * ------------------------------------------------------------------ */

	public static function get_item( string $type, int $id ) {
		$type = trim( $type );

		if ( '' === $type || $id < 1 || ! self::is_allowed_type( $type ) ) {
			return new WP_Error( 'wpab_content_bad_type', 'Unknown content type or id.', array( 'status' => 400 ) );
		}

		if ( 'menu' === $type ) {
			return self::get_menu( $id );
		}

		if ( 'media' === $type ) {
			return self::get_media( $id );
		}

		return self::get_post_item( $type, $id );
	}

	private static function get_post_item( string $type, int $id ) {
		$post = get_post( $id );

		if ( ! $post || $post->post_type !== $type ) {
			return new WP_Error( 'wpab_content_not_found', 'Content not found.', array( 'status' => 404 ) );
		}

		$content   = (string) $post->post_content;
		$truncated = false;

		if ( strlen( $content ) > self::MAX_CONTENT ) {
			$content   = substr( $content, 0, self::MAX_CONTENT );
			$truncated = true;
		}

		$item = array(
			'id'            => (int) $post->ID,
			'title'         => (string) get_the_title( $post ),
			'status'        => (string) $post->post_status,
			'type'          => (string) $post->post_type,
			'slug'          => (string) $post->post_name,
			'url'           => (string) get_permalink( $post ),
			'edit_url'      => (string) get_edit_post_link( $post->ID, 'raw' ),
			'excerpt'       => (string) get_the_excerpt( $post ),
			'template'      => (string) get_page_template_slug( $post->ID ),
			'parent'        => (int) $post->post_parent,
			'menu_order'    => (int) $post->menu_order,
			'modified'      => (string) get_post_modified_time( 'c', true, $post ),
			'created'       => (string) get_post_time( 'c', true, $post ),
			'content'       => $content,
			'content_chars' => strlen( (string) $post->post_content ),
			'truncated'     => $truncated,
		);

		if ( 'product' === $type && self::woocommerce_active() ) {
			$item['product'] = array(
				'sku'           => (string) get_post_meta( $id, '_sku', true ),
				'price'         => (string) get_post_meta( $id, '_price', true ),
				'regular_price' => (string) get_post_meta( $id, '_regular_price', true ),
				'sale_price'    => (string) get_post_meta( $id, '_sale_price', true ),
				'stock_status'  => (string) get_post_meta( $id, '_stock_status', true ),
			);
		}

		return array(
			'success' => true,
			'item'    => $item,
		);
	}

	private static function get_menu( int $id ) {
		$menu = wp_get_nav_menu_object( $id );

		if ( ! $menu ) {
			return new WP_Error( 'wpab_content_not_found', 'Menu not found.', array( 'status' => 404 ) );
		}

		$raw   = wp_get_nav_menu_items( $id );
		$items = array();

		if ( is_array( $raw ) ) {
			$raw = array_slice( $raw, 0, self::MAX_MENU_ITEMS );
			foreach ( $raw as $mi ) {
				$items[] = array(
					'id'        => (int) $mi->ID,
					'title'     => (string) $mi->title,
					'url'       => (string) $mi->url,
					'object'    => (string) $mi->object,
					'type'      => (string) $mi->type,
					'parent'    => (int) $mi->menu_item_parent,
					'order'     => (int) $mi->menu_order,
				);
			}
		}

		return array(
			'success' => true,
			'item'    => array(
				'id'    => (int) $menu->term_id,
				'title' => (string) $menu->name,
				'type'  => 'menu',
				'count' => (int) $menu->count,
				'items' => $items,
			),
		);
	}

	private static function get_media( int $id ) {
		$att = get_post( $id );

		if ( ! $att || 'attachment' !== $att->post_type ) {
			return new WP_Error( 'wpab_content_not_found', 'Media not found.', array( 'status' => 404 ) );
		}

		$meta = wp_get_attachment_metadata( $id );

		return array(
			'success' => true,
			'item'    => array(
				'id'       => (int) $att->ID,
				'title'    => (string) get_the_title( $att ),
				'type'     => 'media',
				'mime'     => (string) $att->post_mime_type,
				'url'      => (string) wp_get_attachment_url( $id ),
				'alt'      => (string) get_post_meta( $id, '_wp_attachment_image_alt', true ),
				'caption'  => (string) $att->post_excerpt,
				'width'    => isset( $meta['width'] ) ? (int) $meta['width'] : null,
				'height'   => isset( $meta['height'] ) ? (int) $meta['height'] : null,
				'modified' => (string) get_post_modified_time( 'c', true, $att ),
			),
		);
	}

	/* ---------------------------------------------------------------------
	 * Editing (Phase 3) — controlled, revision-backed content writes.
	 *
	 * Only page/post/product/CPT bodies are editable here (never menus or
	 * media). Only a small whitelist of fields is touched, content is run
	 * through wp_kses_post, and WordPress saves a revision on every update so
	 * the change is reversible from wp-admin — and the editor also offers a
	 * one-click Undo by re-applying the captured "before" values.
	 * ------------------------------------------------------------------ */

	/** Statuses an edit may set — never trash/auto-draft/inherit. */
	private const EDITABLE_STATUSES = array( 'draft', 'publish', 'pending', 'private' );
}
