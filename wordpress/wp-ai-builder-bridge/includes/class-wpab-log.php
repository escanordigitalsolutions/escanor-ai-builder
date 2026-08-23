<?php
/**
 * Rolling activity log.
 *
 * Deliberately an option rather than a custom table: the log is a short
 * operator-facing trail ("what did the builder do to my site"), not analytics.
 * It is capped so it can never grow into a problem, and it never stores file
 * contents or secrets — only paths, counts and outcomes.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Log {

	private const OPTION = 'wpab_activity_log';
	private const LIMIT  = 60;

	public static function add( string $event, array $context = array() ): void {
		$entries = self::all();

		array_unshift(
			$entries,
			array(
				'event'   => sanitize_key( $event ),
				'time'    => gmdate( 'c' ),
				'actor'   => self::actor(),
				'context' => self::scrub( $context ),
			)
		);

		if ( count( $entries ) > self::LIMIT ) {
			$entries = array_slice( $entries, 0, self::LIMIT );
		}

		update_option( self::OPTION, $entries, false );
	}

	public static function all(): array {
		$entries = get_option( self::OPTION, array() );

		return is_array( $entries ) ? $entries : array();
	}

	public static function clear(): void {
		delete_option( self::OPTION );
	}

	private static function actor(): string {
		if ( ! function_exists( 'wp_get_current_user' ) ) {
			return 'system';
		}

		$user = wp_get_current_user();

		if ( $user && $user->ID > 0 ) {
			return (string) $user->user_login;
		}

		return 'bridge';
	}

	/**
	 * Keeps the log shallow and free of anything that could carry a secret or
	 * a whole file body.
	 */
	private static function scrub( array $context ): array {
		$clean = array();

		foreach ( $context as $key => $value ) {
			$key = sanitize_key( (string) $key );

			if ( in_array( $key, array( 'token', 'key', 'content', 'secret' ), true ) ) {
				continue;
			}

			if ( is_scalar( $value ) || null === $value ) {
				$clean[ $key ] = is_string( $value ) ? substr( $value, 0, 300 ) : $value;
				continue;
			}

			if ( is_array( $value ) ) {
				$flat = array();

				foreach ( array_slice( $value, 0, 12 ) as $item ) {
					if ( is_scalar( $item ) ) {
						$flat[] = substr( (string) $item, 0, 200 );
					}
				}

				$clean[ $key ] = $flat;
			}
		}

		return $clean;
	}
}
