<?php
/**
 * Update channel for a plugin that does not live in the WordPress directory.
 *
 * Meikero is installed by uploading a zip, and WordPress has no idea where
 * that zip came from — so without this class every customer stays on whatever
 * version they first installed, and a fix reaches nobody. These two filters
 * are what put "Update available" on their Plugins screen, exactly as for any
 * plugin from wordpress.org.
 *
 * The manifest is public and unauthenticated on purpose: it carries only a
 * version number and a download URL, WordPress fetches it with no credentials,
 * and the plugin is GPL anyway.
 *
 * @package Meikero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Updater {

	/** Where the manifest lives, relative to the Meikero endpoint. */
	private const MANIFEST_PATH = '/api/plugin/version';

	/** Cache the manifest so a Plugins-screen visit is not a network call. */
	private const CACHE_KEY = 'wpab_update_manifest';
	// One hour, not six. A published fix that takes most of a working day to
	// become visible is a fix nobody has.
	private const CACHE_TTL = HOUR_IN_SECONDS;

	public static function init(): void {
		add_filter( 'pre_set_site_transient_update_plugins', array( __CLASS__, 'offer_update' ) );
		add_filter( 'plugins_api', array( __CLASS__, 'plugin_details' ), 20, 3 );

		// A finished update should not leave a stale manifest behind.
		add_action( 'upgrader_process_complete', array( __CLASS__, 'flush' ), 10, 0 );
	}

	public static function flush(): void {
		delete_transient( self::CACHE_KEY );
	}

	/**
	 * The published version, when it is newer than this one. Null otherwise.
	 *
	 * Public so the admin notice can ask the same question the Plugins screen
	 * asks, without a second copy of the comparison.
	 */
	public static function newer_version(): ?string {
		$manifest = self::manifest();

		if ( ! $manifest || empty( $manifest['version'] ) ) {
			return null;
		}

		$current = defined( 'WPAB_VERSION' ) ? (string) WPAB_VERSION : '0.0.0';
		$latest  = (string) $manifest['version'];

		return version_compare( $latest, $current, '>' ) ? $latest : null;
	}

	/** Our own directory name, e.g. wp-ai-builder-bridge/wp-ai-builder-bridge.php */
	private static function basename(): string {
		return defined( 'WPAB_BASENAME' ) ? (string) WPAB_BASENAME : plugin_basename( __FILE__ );
	}

	private static function slug(): string {
		return dirname( self::basename() );
	}

	/**
	 * The published manifest, or null when it cannot be read.
	 *
	 * Every failure here is silent by design: an update check that cannot
	 * reach the internet must not put a warning on someone's Plugins screen.
	 */
	private static function manifest(): ?array {
		$cached = get_transient( self::CACHE_KEY );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		if ( ! class_exists( 'WPAB_Cloud' ) ) {
			return null;
		}

		$url = WPAB_Cloud::builder_url() . self::MANIFEST_PATH;

		$response = wp_remote_get(
			$url,
			array(
				'timeout' => 8,
				'headers' => array( 'Accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			// Cache the miss briefly so a broken endpoint is not hammered.
			set_transient( self::CACHE_KEY, array(), 15 * MINUTE_IN_SECONDS );
			return null;
		}

		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $data ) || empty( $data['version'] ) || empty( $data['download_url'] ) ) {
			return null;
		}

		set_transient( self::CACHE_KEY, $data, self::CACHE_TTL );

		return $data;
	}

	/**
	 * Add ourselves to the update list when a newer version is published.
	 *
	 * @param mixed $transient The update_plugins site transient.
	 * @return mixed
	 */
	public static function offer_update( $transient ) {
		if ( ! is_object( $transient ) ) {
			return $transient;
		}

		$manifest = self::manifest();

		if ( ! $manifest ) {
			return $transient;
		}

		$current = defined( 'WPAB_VERSION' ) ? (string) WPAB_VERSION : '0.0.0';
		$latest  = (string) $manifest['version'];

		if ( ! version_compare( $latest, $current, '>' ) ) {
			return $transient;
		}

		$basename = self::basename();

		$offer = (object) array(
			'slug'         => self::slug(),
			'plugin'       => $basename,
			'new_version'  => $latest,
			'package'      => (string) $manifest['download_url'],
			'url'          => isset( $manifest['homepage'] ) ? (string) $manifest['homepage'] : '',
			'tested'       => isset( $manifest['tested'] ) ? (string) $manifest['tested'] : '',
			'requires_php' => isset( $manifest['requires_php'] ) ? (string) $manifest['requires_php'] : '',
		);

		if ( ! isset( $transient->response ) || ! is_array( $transient->response ) ) {
			$transient->response = array();
		}

		$transient->response[ $basename ] = $offer;

		return $transient;
	}

	/**
	 * Fill the "View details" modal, which otherwise 404s against wordpress.org.
	 *
	 * @param mixed  $result The value being filtered.
	 * @param string $action The plugins_api action.
	 * @param mixed  $args   Query arguments.
	 * @return mixed
	 */
	public static function plugin_details( $result, $action, $args ) {
		if ( 'plugin_information' !== $action ) {
			return $result;
		}

		if ( ! isset( $args->slug ) || self::slug() !== $args->slug ) {
			return $result;
		}

		$manifest = self::manifest();

		if ( ! $manifest ) {
			return $result;
		}

		return (object) array(
			'name'          => 'Meikero Bridge',
			'slug'          => self::slug(),
			'version'       => (string) $manifest['version'],
			'author'        => '<a href="https://escanor.lt">ESCANOR Digital Solutions</a>',
			'homepage'      => isset( $manifest['homepage'] ) ? (string) $manifest['homepage'] : '',
			'download_link' => (string) $manifest['download_url'],
			'requires'      => isset( $manifest['requires'] ) ? (string) $manifest['requires'] : '',
			'requires_php'  => isset( $manifest['requires_php'] ) ? (string) $manifest['requires_php'] : '',
			'tested'        => isset( $manifest['tested'] ) ? (string) $manifest['tested'] : '',
			'last_updated'  => isset( $manifest['last_updated'] ) ? (string) $manifest['last_updated'] : '',
			'sections'      => array(
				'description' => isset( $manifest['description'] ) ? (string) $manifest['description'] : '',
				'changelog'   => isset( $manifest['changelog'] ) ? (string) $manifest['changelog'] : '',
			),
		);
	}
}
