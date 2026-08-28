<?php
/**
 * Module entitlements (WordPress side).
 *
 * The SaaS is the source of truth for which modules a project is licensed for.
 * The session handshake (WPAB_Cloud::session) returns a `modules` map and a
 * `plan` label; this class caches them in options and answers "is this module
 * enabled?" for the admin UI and, later, for per-module route guards.
 *
 * The cache is a convenience for rendering. It is refreshed every time a
 * session handshake runs (the Dashboard pings it on load). Real enforcement
 * still happens on the SaaS: a locked module's route returns 403 regardless of
 * what this cache says.
 *
 * Module keys: content (base, always on), seo, health, build.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Modules {

	private const OPTION      = 'wpab_modules';
	private const PLAN_OPTION = 'wpab_plan';

	public const KEYS = array( 'content', 'seo', 'health', 'build' );

	/**
	 * Default before any handshake has run. Permissive to match the SaaS
	 * default (an unconfigured project is not locked), except that nothing is
	 * assumed about the plan. `content` is the base module and is always on.
	 */
	public static function defaults(): array {
		return array(
			'content' => true,
			'seo'     => true,
			'health'  => true,
			'build'   => true,
		);
	}

	/**
	 * The full boolean map, merging the cached values over the defaults so a
	 * partial or stale cache still yields every key. `content` never locks.
	 */
	public static function all(): array {
		$stored = get_option( self::OPTION, null );
		$out    = self::defaults();

		if ( is_array( $stored ) ) {
			foreach ( self::KEYS as $key ) {
				if ( array_key_exists( $key, $stored ) ) {
					$out[ $key ] = (bool) $stored[ $key ];
				}
			}
		}

		$out['content'] = true;

		return $out;
	}

	public static function is_enabled( string $key ): bool {
		$all = self::all();

		return ! empty( $all[ $key ] );
	}

	public static function plan(): string {
		$plan = (string) get_option( self::PLAN_OPTION, '' );

		return '' !== $plan ? $plan : 'free';
	}

	/**
	 * Whether the cache has ever been populated from a handshake. Lets the UI
	 * distinguish "known" entitlements from the permissive default.
	 */
	public static function known(): bool {
		return is_array( get_option( self::OPTION, null ) );
	}

	/**
	 * Persist what a session handshake returned. Sanitises to the known keys and
	 * coerces to booleans so a malformed payload cannot poison the cache.
	 */
	public static function store( $modules, string $plan = '' ): void {
		if ( ! is_array( $modules ) ) {
			return;
		}

		$clean = array();

		foreach ( self::KEYS as $key ) {
			$clean[ $key ] = ! empty( $modules[ $key ] );
		}

		$clean['content'] = true;

		update_option( self::OPTION, $clean, false );

		if ( '' !== $plan ) {
			update_option( self::PLAN_OPTION, sanitize_text_field( $plan ), false );
		}
	}
}
