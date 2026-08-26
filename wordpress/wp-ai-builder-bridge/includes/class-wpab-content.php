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

	public static function is_editable_type( string $type ): bool {
		$type = trim( $type );

		if ( 'menu' === $type || 'media' === $type || '' === $type ) {
			return false;
		}

		return self::is_allowed_type( $type ) && post_type_exists( $type );
	}

	/**
	 * Apply a set of field changes to one content item. $fields may contain any
	 * of: title, content, excerpt, status, and (products only) a product map of
	 * regular_price / sale_price / sku / stock_status. Returns before/after so
	 * the caller can render a diff and offer Undo.
	 */
	public static function update( string $type, int $id, array $fields ) {
		$type = trim( $type );

		if ( ! self::is_editable_type( $type ) ) {
			return new WP_Error( 'wpab_content_not_editable', 'This content type cannot be edited here.', array( 'status' => 400 ) );
		}

		if ( $id < 1 ) {
			return new WP_Error( 'wpab_content_bad_id', 'A valid content id is required.', array( 'status' => 400 ) );
		}

		$post = get_post( $id );

		if ( ! $post || $post->post_type !== $type ) {
			return new WP_Error( 'wpab_content_not_found', 'Content not found.', array( 'status' => 404 ) );
		}

		$before = array(
			'title'   => (string) $post->post_title,
			'content' => (string) $post->post_content,
			'excerpt' => (string) $post->post_excerpt,
			'status'  => (string) $post->post_status,
		);

		$postarr = array( 'ID' => $id );

		if ( array_key_exists( 'title', $fields ) ) {
			$postarr['post_title'] = sanitize_text_field( substr( (string) $fields['title'], 0, 400 ) );
		}

		if ( array_key_exists( 'content', $fields ) ) {
			$content = (string) $fields['content'];
			if ( strlen( $content ) > 200000 ) {
				return new WP_Error( 'wpab_content_too_long', 'The new content is too large.', array( 'status' => 400 ) );
			}
			$postarr['post_content'] = wp_kses_post( $content );
		}

		if ( array_key_exists( 'excerpt', $fields ) ) {
			$postarr['post_excerpt'] = wp_kses_post( substr( (string) $fields['excerpt'], 0, 20000 ) );
		}

		if ( array_key_exists( 'status', $fields ) ) {
			$status = sanitize_key( (string) $fields['status'] );
			if ( ! in_array( $status, self::EDITABLE_STATUSES, true ) ) {
				return new WP_Error( 'wpab_content_bad_status', 'Unsupported status.', array( 'status' => 400 ) );
			}
			$postarr['post_status'] = $status;
		}

		// Apply the post columns (if any). wp_update_post expects slashed data
		// and saves a revision automatically for revisioned post types.
		if ( count( $postarr ) > 1 ) {
			$result = wp_update_post( wp_slash( $postarr ), true );

			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}

		// Product-specific fields, via WooCommerce so _price is recomputed and
		// the product cache is cleared correctly.
		if ( 'product' === $type && self::woocommerce_active() && isset( $fields['product'] ) && is_array( $fields['product'] ) && function_exists( 'wc_get_product' ) ) {
			$p = $fields['product'];
			$product = wc_get_product( $id );

			if ( $product ) {
				try {
					if ( array_key_exists( 'regular_price', $p ) ) {
						$product->set_regular_price( wc_format_decimal( (string) $p['regular_price'] ) );
					}
					if ( array_key_exists( 'sale_price', $p ) ) {
						$product->set_sale_price( '' === trim( (string) $p['sale_price'] ) ? '' : wc_format_decimal( (string) $p['sale_price'] ) );
					}
					if ( array_key_exists( 'sku', $p ) ) {
						$product->set_sku( sanitize_text_field( (string) $p['sku'] ) );
					}
					if ( array_key_exists( 'stock_status', $p ) ) {
						$ss = sanitize_key( (string) $p['stock_status'] );
						if ( in_array( $ss, array( 'instock', 'outofstock', 'onbackorder' ), true ) ) {
							$product->set_stock_status( $ss );
						}
					}
					$product->save();
				} catch ( Exception $e ) {
					return new WP_Error( 'wpab_content_product_error', $e->getMessage(), array( 'status' => 400 ) );
				}
			}
		}

		$fresh = get_post( $id );
		$after = array(
			'title'   => (string) $fresh->post_title,
			'content' => (string) $fresh->post_content,
			'excerpt' => (string) $fresh->post_excerpt,
			'status'  => (string) $fresh->post_status,
		);

		$revisions   = wp_get_post_revisions( $id, array( 'numberposts' => 1 ) );
		$revision    = is_array( $revisions ) && $revisions ? reset( $revisions ) : null;
		$revision_id = $revision ? (int) $revision->ID : 0;

		WPAB_Log::add(
			'content_updated',
			array(
				'type'        => $type,
				'id'          => $id,
				'revision_id' => $revision_id,
			)
		);

		return array(
			'success'     => true,
			'type'        => $type,
			'id'          => $id,
			'url'         => (string) get_permalink( $id ),
			'edit_url'    => (string) get_edit_post_link( $id, 'raw' ),
			'revision_id' => $revision_id,
			'before'      => $before,
			'after'       => $after,
		);
	}
}
