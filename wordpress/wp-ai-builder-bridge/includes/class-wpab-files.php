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

	/**
	 * Snapshot limits.
	 *
	 * A snapshot travels inside every AI Editor request, so it is bounded far
	 * more tightly than a walk. These numbers mirror SNAPSHOT_LIMITS on the
	 * SaaS side; raising one without raising the other means the SaaS silently
	 * drops files and falls back to calling this site over HTTP, which is the
	 * exact failure the snapshot exists to remove.
	 *
	 * The total is what it is because of the ceiling above it: the SaaS runs on
	 * Vercel, which rejects a request body over 4.5 MB, and a chat message may
	 * also carry a 3 MB screenshot. 800 KB of theme survives JSON escaping with
	 * room to spare, and a generated theme is a fraction of that.
	 */
	public const SNAPSHOT_MAX_FILES       = 400;
	public const SNAPSHOT_MAX_FILE_BYTES  = 200000;
	public const SNAPSHOT_MAX_TOTAL_BYTES = 800000;

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

	/* ---------------------------------------------------------------------
	 * Structure — what the theme IS, not just what files it has
	 * ------------------------------------------------------------------ */

	/**
	 * Which group a theme file belongs in, and what it does.
	 *
	 * A flat list of thirty paths tells a person almost nothing; the same list
	 * grouped by role, with a line explaining each known WordPress filename, is
	 * a map. Classic themes have a fixed vocabulary, so this can be a table
	 * rather than a guess.
	 *
	 * This lives in PHP rather than on the SaaS deliberately: the plugin sends
	 * the structure with every request AND renders it in the chat on demand, so
	 * a second copy of the table would be a second thing to keep in step.
	 */
	private const FILE_ROLES = array(
		'index.php'      => array( 'templates', 'The fallback template WordPress uses when nothing more specific matches.' ),
		'front-page.php' => array( 'templates', 'The homepage.' ),
		'home.php'       => array( 'templates', 'The blog posts index.' ),
		'page.php'       => array( 'templates', 'A single page.' ),
		'single.php'     => array( 'templates', 'A single blog post.' ),
		'archive.php'    => array( 'templates', 'Category, tag, author and date listings.' ),
		'search.php'     => array( 'templates', 'Search results.' ),
		'404.php'        => array( 'templates', 'The not-found page.' ),
		'header.php'     => array( 'parts', 'The site header, opened on every page.' ),
		'footer.php'     => array( 'parts', 'The site footer, closed on every page.' ),
		'sidebar.php'    => array( 'parts', 'The widget sidebar.' ),
		'searchform.php' => array( 'parts', 'The search form markup.' ),
		'comments.php'   => array( 'parts', 'The comments list and form.' ),
		'functions.php'  => array( 'setup', 'Theme setup: menus, supports, enqueued styles and scripts.' ),
		'style.css'      => array( 'setup', 'The theme header WordPress reads, and the base stylesheet.' ),
		'theme.json'     => array( 'setup', 'Editor and global style settings.' ),
		'screenshot.png' => array( 'setup', 'The preview image shown in Appearance → Themes.' ),
		'readme.txt'     => array( 'setup', 'Theme readme.' ),
	);

	private const GROUP_LABELS = array(
		'templates' => 'Templates',
		'parts'     => 'Template parts',
		'setup'     => 'Theme setup',
		'styles'    => 'Styles',
		'scripts'   => 'Scripts',
		'features'  => 'Features',
		'other'     => 'Other files',
	);

	/** Group order: what someone looks for first comes first. */
	private const GROUP_ORDER = array( 'templates', 'parts', 'setup', 'styles', 'scripts', 'features', 'other' );

	private static function classify( string $path ): array {
		if ( isset( self::FILE_ROLES[ $path ] ) ) {
			return self::FILE_ROLES[ $path ];
		}

		$extension = WPAB_Scopes::extension( $path );

		if ( 0 === strpos( $path, 'template-parts/' ) ) {
			return array( 'parts', 'A reusable section included by the templates.' );
		}

		if ( 0 === strpos( $path, 'features/' ) ) {
			return array( 'features', 'A site feature added after generation.' );
		}

		if ( 0 === strpos( $path, 'patterns/' ) ) {
			return array( 'parts', 'A block pattern offered in the editor.' );
		}

		if ( 'css' === $extension ) {
			return array( 'styles', '' );
		}

		if ( 'js' === $extension ) {
			return array( 'scripts', '' );
		}

		if ( 'php' === $extension && false === strpos( $path, '/' ) ) {
			// A top-level PHP file we have no entry for is still a template:
			// page-about.php, single-product.php, taxonomy-genre.php and so on.
			return array( 'templates', 'A template for a specific page or post type.' );
		}

		return array( 'other', '' );
	}

	/**
	 * The theme, grouped by what each file is for.
	 *
	 * Bounded by the same walk as everything else here, and safe to call on
	 * every request: it reads names and sizes, never contents.
	 */
	public static function structure( string $scope = 'theme' ): array {
		$out = array(
			'scope'  => $scope,
			'theme'  => '',
			'count'  => 0,
			'bytes'  => 0,
			'groups' => array(),
		);

		if ( function_exists( 'wp_get_theme' ) ) {
			$out['theme'] = (string) wp_get_theme()->get( 'Name' );
		}

		$walk = self::walk( $scope, false );

		if ( is_wp_error( $walk ) ) {
			return $out;
		}

		$grouped = array();

		foreach ( $walk['files'] as $file ) {
			list( $group, $role ) = self::classify( $file['path'] );

			$grouped[ $group ][] = array(
				'path'  => $file['path'],
				'bytes' => (int) $file['bytes'],
				'role'  => $role,
			);

			++$out['count'];
			$out['bytes'] += (int) $file['bytes'];
		}

		foreach ( self::GROUP_ORDER as $group ) {
			if ( empty( $grouped[ $group ] ) ) {
				continue;
			}

			$out['groups'][] = array(
				'key'   => $group,
				'label' => self::GROUP_LABELS[ $group ],
				'files' => $grouped[ $group ],
			);
		}

		return $out;
	}

	/* ---------------------------------------------------------------------
	 * Snapshot — the theme, sent WITH the request
	 * ------------------------------------------------------------------ */

	/**
	 * The whole readable theme as path => content.
	 *
	 * The bridge was designed as a pull: the SaaS called back here over HTTP
	 * whenever the agent wanted a file. That needs this site to be reachable
	 * from the internet inside ten seconds, and most WordPress installs are
	 * not — behind Cloudflare, behind HTTP auth, on a host that blocks
	 * datacentre traffic, or just slow. Theme generation never noticed because
	 * it only ever pushes. Chat and edits died on the pull.
	 *
	 * So we send the theme instead of waiting to be asked for it. Reading it is
	 * local and costs milliseconds; the site no longer has to be reachable at
	 * all for the AI Editor to work.
	 *
	 * Never returns a WP_Error: a snapshot that cannot be built is simply an
	 * empty one, and the SaaS falls back to the old pull.
	 */
	public static function snapshot( string $scope = 'theme' ): array {
		$out = array(
			'scope'     => $scope,
			'files'     => array(),
			'structure' => null,
			'truncated' => false,
			'skipped'   => 0,
		);

		$root = WPAB_Scopes::root( $scope );
		$walk = is_wp_error( $root ) ? $root : self::walk( $scope, false );

		if ( is_wp_error( $root ) || is_wp_error( $walk ) ) {
			$out['truncated'] = true;

			return $out;
		}

		// The grouped map travels with the files: a few kilobytes, and it saves
		// the SaaS from having to reinvent the same classification table.
		$out['structure'] = self::structure( $scope );

		$out['truncated'] = ! empty( $walk['truncated'] );
		$out['skipped']   = (int) $walk['skipped'];

		$total = 0;

		foreach ( $walk['files'] as $file ) {
			if ( count( $out['files'] ) >= self::SNAPSHOT_MAX_FILES ) {
				$out['truncated'] = true;
				break;
			}

			if ( $file['bytes'] > self::SNAPSHOT_MAX_FILE_BYTES ) {
				$out['truncated'] = true;
				++$out['skipped'];
				continue;
			}

			if ( $total + $file['bytes'] > self::SNAPSHOT_MAX_TOTAL_BYTES ) {
				$out['truncated'] = true;
				break;
			}

			$content = @file_get_contents( $root . $file['path'] );

			if ( false === $content || ! self::is_sendable_text( $content ) ) {
				// One unreadable or non-UTF-8 file must not take the request
				// down with it: wp_json_encode() fails on the whole payload if
				// any string in it is invalid UTF-8.
				//
				// Deliberately NOT truncated: the SaaS reads that flag as "ask
				// the site for anything missing", and a file that is not valid
				// UTF-8 is no more readable over HTTP than it is here. Marking
				// it would buy nothing and cost a ten-second timeout on every
				// miss. A file dropped for SIZE above is different — the bridge
				// serves those, so that path does set the flag.
				++$out['skipped'];
				continue;
			}

			$out['files'][ $file['path'] ] = $content;
			$total                        += $file['bytes'];
		}

		return $out;
	}

	/** Text that survives JSON encoding: no NUL bytes, valid UTF-8. */
	private static function is_sendable_text( string $content ): bool {
		if ( false !== strpos( $content, "\0" ) ) {
			return false;
		}

		return '' === $content || 1 === preg_match( '//u', $content );
	}

	/**
	 * Add the theme snapshot to an outbound SaaS payload.
	 *
	 * Attached only when there is something to send — an empty snapshot would
	 * JSON-encode as [] rather than {}, and the SaaS would reject it and fall
	 * back to the pull anyway.
	 */
	public static function attach_snapshot( array $payload, string $scope = 'theme' ): array {
		$snapshot = self::snapshot( $scope );

		if ( ! empty( $snapshot['files'] ) ) {
			$payload['project'] = $snapshot;
		}

		return $payload;
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

		foreach ( array( 'theme' ) as $scope ) {
			$descriptor = WPAB_Scopes::theme();

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
