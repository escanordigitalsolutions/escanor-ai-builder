<?php
/**
 * Bridge token authentication — the SaaS-to-WordPress direction.
 *
 * The token is generated here, shown to the administrator exactly once, and
 * stored only as a SHA-256 hash. A leaked database backup therefore does not
 * hand an attacker a working bridge token.
 *
 * Comparison is constant time, and repeated failures from one address are
 * throttled so the token cannot be ground down by brute force.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Auth {

	private const HASH_OPTION      = 'wpab_bridge_token_hash';
	private const CREATED_OPTION   = 'wpab_bridge_token_created';
	private const LAST_USED_OPTION = 'wpab_bridge_token_last_used';
	private const HINT_OPTION      = 'wpab_bridge_token_hint';

	private const TOKEN_PREFIX = 'wpab_';
	private const TOKEN_BYTES  = 32;

	private const MAX_FAILURES  = 12;
	private const FAILURE_WINDOW = 600;

	/* ---------------------------------------------------------------------
	 * Token lifecycle
	 * ------------------------------------------------------------------ */

	public static function has_token(): bool {
		return '' !== (string) get_option( self::HASH_OPTION, '' );
	}

	/**
	 * Creates (or replaces) the bridge token and returns the plaintext.
	 * This is the only moment the plaintext exists.
	 */
	public static function generate_token(): string {
		$token = self::TOKEN_PREFIX . bin2hex( random_bytes( self::TOKEN_BYTES ) );

		update_option( self::HASH_OPTION, hash( 'sha256', $token ), false );
		update_option( self::CREATED_OPTION, gmdate( 'c' ), false );
		update_option( self::HINT_OPTION, substr( $token, 0, 11 ) . '...', false );
		delete_option( self::LAST_USED_OPTION );

		return $token;
	}

	public static function revoke_token(): void {
		delete_option( self::HASH_OPTION );
		delete_option( self::CREATED_OPTION );
		delete_option( self::LAST_USED_OPTION );
		delete_option( self::HINT_OPTION );
	}

	public static function token_hint(): string {
		return (string) get_option( self::HINT_OPTION, '' );
	}

	public static function created_at(): string {
		return (string) get_option( self::CREATED_OPTION, '' );
	}

	public static function last_used_at(): string {
		return (string) get_option( self::LAST_USED_OPTION, '' );
	}

	/* ---------------------------------------------------------------------
	 * Request authentication
	 * ------------------------------------------------------------------ */

	/**
	 * Pulls the presented token out of the request.
	 *
	 * Authorization is the documented transport, but a meaningful number of
	 * shared hosts strip it before PHP sees it, so the redirected variants and
	 * an explicit X-WPAB-Token header are accepted as well.
	 */
	private static function presented_token( WP_REST_Request $request ): string {
		$header = (string) $request->get_header( 'authorization' );

		if ( '' === $header ) {
			foreach ( array( 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_AUTHORIZATION' ) as $key ) {
				if ( ! empty( $_SERVER[ $key ] ) ) {
					$header = (string) wp_unslash( $_SERVER[ $key ] );
					break;
				}
			}
		}

		if ( '' !== $header && preg_match( '/^Bearer\s+(.+)$/i', trim( $header ), $matches ) ) {
			return trim( $matches[1] );
		}

		$fallback = (string) $request->get_header( 'x-wpab-token' );

		return trim( $fallback );
	}

	private static function client_ip(): string {
		$candidates = array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR' );

		foreach ( $candidates as $key ) {
			if ( empty( $_SERVER[ $key ] ) ) {
				continue;
			}

			$value = (string) wp_unslash( $_SERVER[ $key ] );
			$value = trim( explode( ',', $value )[0] );

			if ( '' !== $value ) {
				return substr( $value, 0, 100 );
			}
		}

		return 'unknown';
	}

	private static function failure_key(): string {
		return 'wpab_auth_fail_' . md5( self::client_ip() );
	}

	private static function is_throttled(): bool {
		return (int) get_transient( self::failure_key() ) >= self::MAX_FAILURES;
	}

	private static function record_failure(): void {
		$key   = self::failure_key();
		$count = (int) get_transient( $key );

		set_transient( $key, $count + 1, self::FAILURE_WINDOW );
	}

	private static function clear_failures(): void {
		delete_transient( self::failure_key() );
	}

	/**
	 * REST permission callback for every bridge route.
	 *
	 * @return true|WP_Error
	 */
	public static function rest_permission( WP_REST_Request $request ) {
		if ( ! self::has_token() ) {
			return new WP_Error(
				'wpab_not_connected',
				'This site has no AI Builder bridge token yet. Generate one in wp-admin under AI Builder.',
				array( 'status' => 503 )
			);
		}

		if ( self::is_throttled() ) {
			return new WP_Error(
				'wpab_throttled',
				'Too many failed bridge authentication attempts. Try again later.',
				array( 'status' => 429 )
			);
		}

		$presented = self::presented_token( $request );

		if ( '' === $presented ) {
			self::record_failure();

			return new WP_Error(
				'wpab_missing_token',
				'Missing bridge token.',
				array( 'status' => 401 )
			);
		}

		$expected = (string) get_option( self::HASH_OPTION, '' );

		if ( ! hash_equals( $expected, hash( 'sha256', $presented ) ) ) {
			self::record_failure();

			WPAB_Log::add( 'auth_rejected', array( 'ip' => self::client_ip() ) );

			return new WP_Error(
				'wpab_invalid_token',
				'Invalid bridge token.',
				array( 'status' => 401 )
			);
		}

		self::clear_failures();
		self::touch_last_used();

		return true;
	}

	/**
	 * Written at most once a minute — the bridge is chatty and this is only
	 * ever read by a human on the settings screen.
	 */
	private static function touch_last_used(): void {
		$last = (string) get_option( self::LAST_USED_OPTION, '' );

		if ( '' !== $last && ( time() - (int) strtotime( $last ) ) < 60 ) {
			return;
		}

		update_option( self::LAST_USED_OPTION, gmdate( 'c' ), false );
	}
}
