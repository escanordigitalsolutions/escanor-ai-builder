<?php
/**
 * Read side of the bridge: listing, hashing and reading project files.
 *
 * Everything here is bounded. A theme with a build directory in it should slow
 * nothing down and must never be able to make the SaaS request an unbounded
 * response, so the walker has a depth limit, a file-count limit and a byte
 * limit, and reports honestly when it truncates.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Files {

	public const MAX_FILES      = 1200;
	public const MAX_DEPTH      = 9;
	public const MAX_READ_BYTES = 1000000;

	/* ---------------------------------------------------------------------
	 * Walking
	 * ------------------------------------------------------------------ */

	/**
	 * @return array|WP_Error
	 */
	public static function walk( string $scope, bool $with_hashes = false ) {
		$root = WPAB_Scopes::root( $scope );

		if ( is_wp_error( $root ) ) {
			return $root;
		}

		$files     = array();
		$truncated = false;
		$skipped   = 0;

		$queue = array( array( 'dir' => $root, 'depth' => 0 ) );

		while ( ! empty( $queue ) ) {
			$current = array_shift( $queue );
			$handle  = @opendir( $current['dir'] );

			if ( false === $handle ) {
				continue;
			}

			$entries = array();

			while ( false !== ( $entry = readdir( $handle ) ) ) {
				if ( '.' === $entry || '..' === $entry ) {
					continue;
				}

				$entries[] = $entry;
			}

			closedir( $handle );
			sort( $entries, SORT_STRING );

			foreach ( $entries as $entry ) {
				$absolute = $current['dir'] . $entry;

				if ( is_link( $absolute ) ) {
					// Symlinks are never followed: a link is the easiest way
					// to smuggle a path out of the scope.
					++$skipped;
					continue;
				}

				if ( is_dir( $absolute ) ) {
					if ( in_array( strtolower( $entry ), WPAB_Scopes::denied_segments(), true ) ) {
						continue;
					}

					if ( $current['depth'] + 1 > self::MAX_DEPTH ) {
						$truncated = true;
						continue;
					}

					$queue[] = array(
						'dir'   => trailingslashit( $absolute ),
						'depth' => $current['depth'] + 1,
					);

					continue;
				}

				if ( ! is_file( $absolute ) || ! is_readable( $absolute ) ) {
					++$skipped;
					continue;
				}

				if ( ! WPAB_Scopes::is_readable_extension( $entry ) ) {
					continue;
				}

				if ( in_array( strtolower( $entry ), WPAB_Scopes::denied_basenames(), true ) ) {
					continue;
				}

				if ( count( $files ) >= self::MAX_FILES ) {
					$truncated = true;
					break 2;
				}

				$relative = ltrim( substr( wp_normalize_path( $absolute ), strlen( $root ) ), '/' );
				$bytes    = (int) filesize( $absolute );

				$record = array(
					'path'      => $relative,
					'bytes'     => $bytes,
					'extension' => WPAB_Scopes::extension( $entry ),
					'modified'  => gmdate( 'c', (int) filemtime( $absolute ) ),
					'writable'  => WPAB_Scopes::is_writable_extension( $entry ) && is_writable( $absolute ),
					'readable'  => $bytes <= self::MAX_READ_BYTES,
				);

				if ( $with_hashes ) {
					$hash = @hash_file( 'sha256', $absolute );

					if ( false === $hash ) {
						++$skipped;
						continue;
					}

					$record['sha256'] = $hash;
				}

				$files[] = $record;
			}
		}

		usort(
			$files,
			static function ( $a, $b ) {
				return strcmp( $a['path'], $b['path'] );
			}
		);

		return array(
			'files'     => $files,
			'truncated' => $truncated,
			'skipped'   => $skipped,
		);
	}

	/**
	 * GET /files
	 *
	 * @return array|WP_Error
	 */
	public static function listing( string $scope ) {
		$walk = self::walk( $scope, false );

		if ( is_wp_error( $walk ) ) {
			return $walk;
		}

		$total_bytes = 0;

		foreach ( $walk['files'] as $file ) {
			$total_bytes += $file['bytes'];
		}

		return array(
			'success'     => true,
			'scope'       => $scope,
			'count'       => count( $walk['files'] ),
			'total_bytes' => $total_bytes,
			'truncated'   => $walk['truncated'],
			'skipped'     => $walk['skipped'],
			'limits'      => array(
				'max_files'      => self::MAX_FILES,
				'max_depth'      => self::MAX_DEPTH,
				'max_read_bytes' => self::MAX_READ_BYTES,
			),
			'files'       => $walk['files'],
		);
	}

	/**
	 * GET /manifest — path + SHA-256 for every readable file in both scopes.
	 *
	 * The SaaS uses this to know exactly which files exist and what state it
	 * believes them to be in, which is what makes a later apply safe.
	 *
	 * @return array
	 */
	public static function manifest(): array {
		$scopes = array();

		foreach ( array( 'theme', 'plugin' ) as $scope ) {
			$descriptor = 'theme' === $scope ? WPAB_Scopes::theme() : WPAB_Scopes::plugin();

			if ( empty( $descriptor['available'] ) ) {
				$scopes[ $scope ] = array(
					'available'   => false,
					'reason'      => isset( $descriptor['reason'] ) ? (string) $descriptor['reason'] : 'Scope unavailable.',
					'file_count'  => 0,
					'total_bytes' => 0,
					'fingerprint' => null,
					'files'       => array(),
				);

				continue;
			}

			$walk = self::walk( $scope, true );

			if ( is_wp_error( $walk ) ) {
				$scopes[ $scope ] = array(
					'available'   => false,
					'reason'      => $walk->get_error_message(),
					'file_count'  => 0,
					'total_bytes' => 0,
					'fingerprint' => null,
					'files'       => array(),
				);

				continue;
			}

			$total_bytes = 0;
			$fingerprint = '';

			foreach ( $walk['files'] as $file ) {
				$total_bytes += $file['bytes'];
				$fingerprint .= $file['path'] . ':' . $file['sha256'] . "\n";
			}

			$scopes[ $scope ] = array(
				'available'   => true,
				'slug'        => isset( $descriptor['slug'] ) ? $descriptor['slug'] : null,
				'label'       => isset( $descriptor['label'] ) ? $descriptor['label'] : null,
				'file_count'  => count( $walk['files'] ),
				'total_bytes' => $total_bytes,
				'truncated'   => $walk['truncated'],
				'fingerprint' => hash( 'sha256', $fingerprint ),
				'files'       => $walk['files'],
			);
		}

		return array(
			'success'        => true,
			'bridge_version' => WPAB_VERSION,
			'generated_at'   => gmdate( 'c' ),
			'scopes'         => $scopes,
		);
	}

	/**
	 * GET /file
	 *
	 * @return array|WP_Error
	 */
	public static function read( string $scope, string $path ) {
		$resolved = WPAB_Scopes::resolve( $scope, $path, true );

		if ( is_wp_error( $resolved ) ) {
			return $resolved;
		}

		if ( ! WPAB_Scopes::is_readable_extension( $resolved['relative'] ) ) {
			return new WP_Error(
				'wpab_unreadable_type',
				'That file type cannot be read through the bridge.',
				array( 'status' => 403 )
			);
		}

		$absolute = $resolved['absolute'];
		$bytes    = (int) filesize( $absolute );

		if ( $bytes > self::MAX_READ_BYTES ) {
			return new WP_Error(
				'wpab_file_too_large',
				sprintf( 'That file is %d bytes, above the %d byte bridge read limit.', $bytes, self::MAX_READ_BYTES ),
				array( 'status' => 413 )
			);
		}

		$content = @file_get_contents( $absolute );

		if ( false === $content ) {
			return new WP_Error( 'wpab_read_failed', 'That file could not be read.', array( 'status' => 500 ) );
		}

		return array(
			'success'   => true,
			'scope'     => $scope,
			'path'      => $resolved['relative'],
			'bytes'     => $bytes,
			'sha256'    => hash( 'sha256', $content ),
			'extension' => WPAB_Scopes::extension( $resolved['relative'] ),
			'modified'  => gmdate( 'c', (int) filemtime( $absolute ) ),
			'writable'  => WPAB_Scopes::is_writable_extension( $resolved['relative'] ) && is_writable( $absolute ),
			'content'   => $content,
		);
	}

	/**
	 * SHA-256 of a file on disk, or null if it is unreadable.
	 */
	public static function hash_file( string $absolute ): ?string {
		if ( ! is_file( $absolute ) || ! is_readable( $absolute ) ) {
			return null;
		}

		$hash = @hash_file( 'sha256', $absolute );

		return false === $hash ? null : $hash;
	}
}
