<?php
/**
 * Write side of the bridge: preflight, apply, snapshot, rollback.
 *
 * The contract with the SaaS is that a deployment is all-or-nothing and always
 * reversible:
 *
 *   1. preflight   every file is checked in memory. Nothing touches disk.
 *   2. snapshot    the current bytes of every file about to change are copied.
 *   3. write       atomic temp-file + rename, one file at a time.
 *   4. health      the front page and the REST root are fetched back.
 *   5. rollback    on any failure in 3 or 4, the snapshot is restored before
 *                  the request returns.
 *
 * A "modify" only proceeds when the file on disk still hashes to the SHA-256
 * the SaaS planned against, so two people editing the same file can never
 * silently clobber each other. A "create" only proceeds when the path does not
 * exist, so create can never be used to overwrite anything.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Writer {

	public const WRITE_OPTION       = 'wpab_write_enabled';
	public const CREATE_OPTION      = 'wpab_create_enabled';
	public const GUARD_OPTION       = 'wpab_block_risky_code';
	public const SNAPSHOT_LIMIT_OPT = 'wpab_snapshot_limit';
	private const STORAGE_KEY_OPT   = 'wpab_storage_key';
	private const LOCK_OPTION       = 'wpab_apply_lock';

	public const MAX_FILES_PER_APPLY = 10;
	public const MAX_FILE_BYTES      = 512000;
	public const MAX_TOTAL_BYTES     = 2000000;

	private const LOCK_TTL              = 180;
	private const DEFAULT_SNAPSHOT_KEEP = 20;

	/** Constructs that have no business appearing in generated theme code. */
	private const RISKY_FUNCTIONS = array(
		'eval',
		'assert',
		'create_function',
		'shell_exec',
		'passthru',
		'proc_open',
		'popen',
		'pcntl_exec',
		'base64_decode',
		'gzinflate',
		'str_rot13',
	);

	/* ---------------------------------------------------------------------
	 * Settings
	 * ------------------------------------------------------------------ */

	public static function write_enabled(): bool {
		return '0' !== (string) get_option( self::WRITE_OPTION, '1' );
	}

	public static function create_enabled(): bool {
		return '0' !== (string) get_option( self::CREATE_OPTION, '1' );
	}

	public static function guard_enabled(): bool {
		return '0' !== (string) get_option( self::GUARD_OPTION, '1' );
	}

	public static function snapshot_keep(): int {
		$value = (int) get_option( self::SNAPSHOT_LIMIT_OPT, self::DEFAULT_SNAPSHOT_KEEP );

		return max( 3, min( 100, $value ) );
	}

	/* ---------------------------------------------------------------------
	 * Storage
	 * ------------------------------------------------------------------ */

	/**
	 * Snapshots live under uploads in a directory whose name carries a random
	 * suffix, and which is additionally denied at the web server level. The
	 * random suffix matters because uploads is world-readable on plenty of
	 * hosts where .htaccess is ignored.
	 */
	public static function storage_dir(): string {
		$key = (string) get_option( self::STORAGE_KEY_OPT, '' );

		if ( '' === $key ) {
			$key = bin2hex( random_bytes( 8 ) );
			update_option( self::STORAGE_KEY_OPT, $key, false );
		}

		$uploads = wp_get_upload_dir();

		return trailingslashit( wp_normalize_path( $uploads['basedir'] ) ) . 'wp-ai-builder-' . $key . '/';
	}

	public static function snapshots_dir(): string {
		return self::storage_dir() . 'snapshots/';
	}

	public static function prepare_storage(): bool {
		$dir = self::storage_dir();

		if ( ! wp_mkdir_p( self::snapshots_dir() ) ) {
			return false;
		}

		$guards = array(
			$dir . '.htaccess'  => "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n",
			$dir . 'index.php'  => "<?php\n// Silence is golden.\n",
			$dir . 'web.config' => "<configuration>\n  <system.webServer>\n    <authorization>\n      <deny users=\"*\" />\n    </authorization>\n  </system.webServer>\n</configuration>\n",
		);

		foreach ( $guards as $path => $contents ) {
			if ( ! file_exists( $path ) ) {
				@file_put_contents( $path, $contents, LOCK_EX );
			}
		}

		return true;
	}

	/* ---------------------------------------------------------------------
	 * Input normalisation
	 * ------------------------------------------------------------------ */

	/**
	 * @return array|WP_Error List of raw file intents.
	 */
	private static function normalize_input( $files ) {
		if ( ! is_array( $files ) || array() === $files ) {
			return new WP_Error( 'wpab_no_files', 'No files were supplied.', array( 'status' => 400 ) );
		}

		if ( count( $files ) > self::MAX_FILES_PER_APPLY ) {
			return new WP_Error(
				'wpab_too_many_files',
				sprintf( 'A single deployment may contain at most %d files.', self::MAX_FILES_PER_APPLY ),
				array( 'status' => 400 )
			);
		}

		$normalized = array();

		foreach ( array_values( $files ) as $index => $file ) {
			if ( ! is_array( $file ) ) {
				return new WP_Error( 'wpab_bad_file_entry', sprintf( 'File entry %d is malformed.', $index ), array( 'status' => 400 ) );
			}

			$normalized[] = array(
				'operation'       => isset( $file['operation'] ) ? strtolower( trim( (string) $file['operation'] ) ) : 'modify',
				'scope'           => isset( $file['scope'] ) ? strtolower( trim( (string) $file['scope'] ) ) : '',
				'path'            => isset( $file['path'] ) ? (string) $file['path'] : '',
				'expected_sha256' => isset( $file['expected_sha256'] ) && is_string( $file['expected_sha256'] )
					? strtolower( trim( $file['expected_sha256'] ) )
					: null,
				'content'         => isset( $file['content'] ) && is_string( $file['content'] ) ? $file['content'] : null,
			);
		}

		return $normalized;
	}

	/* ---------------------------------------------------------------------
	 * Preflight
	 * ------------------------------------------------------------------ */

	/**
	 * Validates a whole change set without writing anything.
	 *
	 * Always returns a report array (never a WP_Error) so the SaaS can show the
	 * operator exactly which file failed and why.
	 */
	public static function preflight( $files ): array {
		$report = array(
			'ready'          => false,
			'write_enabled'  => self::write_enabled(),
			'create_enabled' => self::create_enabled(),
			'file_count'     => 0,
			'total_bytes'    => 0,
			'global_error'   => null,
			'files'          => array(),
			'checked_at'     => gmdate( 'c' ),
			'bridge_version' => WPAB_VERSION,
		);

		$normalized = self::normalize_input( $files );

		if ( is_wp_error( $normalized ) ) {
			$report['global_error'] = $normalized->get_error_message();

			return $report;
		}

		$report['file_count'] = count( $normalized );

		$seen        = array();
		$total_bytes = 0;
		$all_ready   = true;

		foreach ( $normalized as $index => $file ) {
			$result = self::preflight_file( $index, $file, $seen );

			$seen[ $file['scope'] . ':' . $file['path'] ] = true;

			$total_bytes += (int) $result['bytes'];

			if ( ! $result['ready'] ) {
				$all_ready = false;
			}

			$report['files'][] = $result;
		}

		$report['total_bytes'] = $total_bytes;

		if ( $total_bytes > self::MAX_TOTAL_BYTES ) {
			$all_ready              = false;
			$report['global_error'] = sprintf(
				'The deployment is %d bytes, above the %d byte limit.',
				$total_bytes,
				self::MAX_TOTAL_BYTES
			);
		}

		if ( ! self::write_enabled() ) {
			$all_ready              = false;
			$report['global_error'] = 'Writes are disabled on this site. Enable them in wp-admin under AI Builder.';
		}

		if ( self::is_locked() ) {
			$all_ready              = false;
			$report['global_error'] = 'Another deployment is currently running on this site.';
		}

		$report['ready'] = $all_ready;

		return $report;
	}

	private static function preflight_file( int $index, array $file, array $seen ): array {
		$result = array(
			'index'          => $index,
			'ready'          => false,
			'operation'      => $file['operation'],
			'scope'          => $file['scope'],
			'path'           => $file['path'],
			'bytes'          => null === $file['content'] ? 0 : strlen( $file['content'] ),
			'current_sha256' => null,
			'target_sha256'  => null === $file['content'] ? null : hash( 'sha256', $file['content'] ),
			'syntax'         => 'skipped',
			'warnings'       => array(),
			'error'          => null,
		);

		$fail = static function ( $code, $message ) use ( &$result ) {
			$result['error'] = array(
				'code'    => $code,
				'message' => $message,
			);

			return $result;
		};

		if ( ! in_array( $file['operation'], array( 'modify', 'create' ), true ) ) {
			return $fail( 'wpab_bad_operation', 'Only modify and create operations are supported.' );
		}

		if ( 'create' === $file['operation'] && ! self::create_enabled() ) {
			return $fail( 'wpab_create_disabled', 'Creating new files is disabled on this site.' );
		}

		if ( ! WPAB_Scopes::is_valid_scope( $file['scope'] ) ) {
			return $fail( 'wpab_bad_scope', 'Scope must be theme or plugin.' );
		}

		if ( null === $file['content'] ) {
			return $fail( 'wpab_missing_content', 'Full file content is required.' );
		}

		if ( false !== strpos( $file['content'], "\0" ) ) {
			return $fail( 'wpab_binary_content', 'File content must be text.' );
		}

		if ( $result['bytes'] > self::MAX_FILE_BYTES ) {
			return $fail(
				'wpab_file_too_large',
				sprintf( 'That file is %d bytes, above the %d byte per-file limit.', $result['bytes'], self::MAX_FILE_BYTES )
			);
		}

		if ( isset( $seen[ $file['scope'] . ':' . $file['path'] ] ) ) {
			return $fail( 'wpab_duplicate_file', 'The same file appears twice in this deployment.' );
		}

		$resolved = WPAB_Scopes::resolve( $file['scope'], $file['path'], 'modify' === $file['operation'] );

		if ( is_wp_error( $resolved ) ) {
			return $fail( $resolved->get_error_code(), $resolved->get_error_message() );
		}

		$result['path'] = $resolved['relative'];

		if ( ! WPAB_Scopes::is_writable_extension( $resolved['relative'] ) ) {
			return $fail(
				'wpab_unwritable_type',
				sprintf( 'Only these file types can be written: %s.', implode( ', ', WPAB_Scopes::writable_extensions() ) )
			);
		}

		if ( 'modify' === $file['operation'] ) {
			if ( ! $resolved['exists'] ) {
				return $fail( 'wpab_not_found', 'That file no longer exists. It cannot be modified.' );
			}

			if ( ! is_writable( $resolved['absolute'] ) ) {
				return $fail( 'wpab_not_writable', 'That file is not writable by the web server.' );
			}

			$current = WPAB_Files::hash_file( $resolved['absolute'] );

			if ( null === $current ) {
				return $fail( 'wpab_unreadable', 'That file could not be read to verify its state.' );
			}

			$result['current_sha256'] = $current;

			if ( empty( $file['expected_sha256'] ) ) {
				return $fail( 'wpab_missing_expected_sha', 'An expected SHA-256 is required to modify a file.' );
			}

			if ( ! hash_equals( $current, (string) $file['expected_sha256'] ) ) {
				return $fail(
					'wpab_sha_mismatch',
					'That file changed on the site after this change was planned. Regenerate the proposal.'
				);
			}

			if ( hash_equals( $current, (string) $result['target_sha256'] ) ) {
				return $fail( 'wpab_no_change', 'The proposed content is identical to the file on disk.' );
			}
		} else {
			if ( $resolved['exists'] ) {
				return $fail( 'wpab_already_exists', 'That file already exists. Use modify instead of create.' );
			}

			$parent = dirname( $resolved['absolute'] );

			if ( is_dir( $parent ) ) {
				if ( ! is_writable( $parent ) ) {
					return $fail( 'wpab_parent_not_writable', 'The target directory is not writable by the web server.' );
				}
			} else {
				$existing = $parent;

				while ( ! is_dir( $existing ) && strlen( $existing ) > strlen( $resolved['root'] ) ) {
					$existing = dirname( $existing );
				}

				if ( ! is_writable( $existing ) ) {
					return $fail( 'wpab_parent_not_writable', 'The new directory could not be created: the parent is not writable.' );
				}
			}
		}

		$syntax = self::syntax_check( $file['content'], $resolved['relative'] );

		if ( 'error' === $syntax['status'] ) {
			return $fail( 'wpab_syntax_error', $syntax['message'] );
		}

		$result['syntax']   = $syntax['status'];
		$result['warnings'] = self::risk_scan( $file['content'], $resolved['relative'] );

		if ( self::guard_enabled() && ! empty( $result['warnings'] ) ) {
			return $fail(
				'wpab_risky_code',
				sprintf(
					'Blocked risky PHP construct: %s. Disable "Block risky PHP constructs" in wp-admin to allow it.',
					implode( ', ', $result['warnings'] )
				)
			);
		}

		$result['ready'] = true;

		return $result;
	}

	/**
	 * Parses without executing.
	 *
	 * token_get_all() with TOKEN_PARSE runs the real PHP parser and throws on
	 * invalid syntax, which is exactly what is wanted here: no shelling out to
	 * `php -l` (blocked on many hosts) and no eval.
	 *
	 * @return array { status: ok|skipped|unavailable|error, message: string }
	 */
	public static function syntax_check( string $content, string $path ): array {
		$extension = WPAB_Scopes::extension( $path );

		if ( 'json' === $extension ) {
			json_decode( $content );

			if ( JSON_ERROR_NONE !== json_last_error() ) {
				return array(
					'status'  => 'error',
					'message' => 'Invalid JSON: ' . json_last_error_msg(),
				);
			}

			return array( 'status' => 'ok', 'message' => '' );
		}

		if ( 'php' !== $extension ) {
			return array( 'status' => 'skipped', 'message' => '' );
		}

		if ( ! function_exists( 'token_get_all' ) || ! defined( 'TOKEN_PARSE' ) ) {
			return array( 'status' => 'unavailable', 'message' => '' );
		}

		try {
			token_get_all( $content, TOKEN_PARSE );
		} catch ( ParseError $error ) {
			return array(
				'status'  => 'error',
				'message' => 'PHP syntax error on line ' . $error->getLine() . ': ' . $error->getMessage(),
			);
		} catch ( Error $error ) {
			return array(
				'status'  => 'error',
				'message' => 'PHP could not parse that file: ' . $error->getMessage(),
			);
		}

		return array( 'status' => 'ok', 'message' => '' );
	}

	/**
	 * @return string[] Human labels of risky constructs found.
	 */
	public static function risk_scan( string $content, string $path ): array {
		if ( 'php' !== WPAB_Scopes::extension( $path ) ) {
			return array();
		}

		$found = array();

		foreach ( self::RISKY_FUNCTIONS as $name ) {
			// `\s*\(` catches `eval ( $x )`; the lookbehind keeps a project's
			// own my_eval() or $obj->eval() from being flagged.
			$pattern = '/(?<![a-z0-9_$>\-])' . preg_quote( $name, '/' ) . '\s*\(/i';

			if ( preg_match( $pattern, $content ) ) {
				$found[] = $name . '()';
			}
		}

		return $found;
	}

	/* ---------------------------------------------------------------------
	 * Locking
	 * ------------------------------------------------------------------ */

	private static function is_locked(): bool {
		$lock = get_option( self::LOCK_OPTION, array() );

		if ( ! is_array( $lock ) || empty( $lock['time'] ) ) {
			return false;
		}

		return ( time() - (int) $lock['time'] ) < self::LOCK_TTL;
	}

	private static function acquire_lock( string $owner ): bool {
		if ( self::is_locked() ) {
			return false;
		}

		update_option(
			self::LOCK_OPTION,
			array(
				'time'  => time(),
				'owner' => substr( $owner, 0, 100 ),
			),
			false
		);

		return true;
	}

	private static function release_lock(): void {
		delete_option( self::LOCK_OPTION );
	}

	/* ---------------------------------------------------------------------
	 * Apply
	 * ------------------------------------------------------------------ */

	/**
	 * @return array|WP_Error
	 */
	public static function apply( string $proposal_id, $files ) {
		if ( ! self::write_enabled() ) {
			return new WP_Error(
				'wpab_write_disabled',
				'Writes are disabled on this site. Enable them in wp-admin under AI Builder.',
				array( 'status' => 403 )
			);
		}

		$report = self::preflight( $files );

		if ( true !== $report['ready'] ) {
			return new WP_Error(
				'wpab_preflight_failed',
				self::first_error( $report ),
				array(
					'status'    => 409,
					'preflight' => $report,
				)
			);
		}

		if ( ! self::acquire_lock( $proposal_id ) ) {
			return new WP_Error(
				'wpab_locked',
				'Another deployment is currently running on this site.',
				array( 'status' => 409 )
			);
		}

		$normalized = self::normalize_input( $files );

		if ( is_wp_error( $normalized ) ) {
			self::release_lock();

			return $normalized;
		}

		if ( ! self::prepare_storage() ) {
			self::release_lock();

			return new WP_Error(
				'wpab_storage_unavailable',
				'Snapshot storage could not be created inside uploads. Deployment refused.',
				array( 'status' => 500 )
			);
		}

		$snapshot_id  = 'snap_' . gmdate( 'Ymd-His' ) . '_' . bin2hex( random_bytes( 3 ) );
		$snapshot_dir = self::snapshots_dir() . $snapshot_id . '/';

		if ( ! wp_mkdir_p( $snapshot_dir ) ) {
			self::release_lock();

			return new WP_Error(
				'wpab_snapshot_failed',
				'The pre-deployment snapshot directory could not be created. Deployment refused.',
				array( 'status' => 500 )
			);
		}

		$meta = array(
			'id'             => $snapshot_id,
			'proposal_id'    => substr( $proposal_id, 0, 100 ),
			'created_at'     => gmdate( 'c' ),
			'bridge_version' => WPAB_VERSION,
			'rolled_back_at' => null,
			'files'          => array(),
			'created_dirs'   => array(),
		);

		$applied = array();

		foreach ( $normalized as $index => $file ) {
			$resolved = WPAB_Scopes::resolve( $file['scope'], $file['path'], 'modify' === $file['operation'] );

			if ( is_wp_error( $resolved ) ) {
				return self::abort( $meta, $snapshot_dir, $resolved->get_error_message(), 'wpab_apply_failed' );
			}

			$entry = array(
				'operation'        => $file['operation'],
				'scope'            => $file['scope'],
				'path'             => $resolved['relative'],
				'absolute'         => $resolved['absolute'],
				'previous_sha256'  => null,
				'backup'           => null,
				'deployed_sha256'  => null,
				'bytes'            => strlen( $file['content'] ),
			);

			if ( 'modify' === $file['operation'] ) {
				$backup_name = sprintf( '%02d-%s.bak', $index, substr( md5( $file['scope'] . '/' . $resolved['relative'] ), 0, 12 ) );

				if ( ! @copy( $resolved['absolute'], $snapshot_dir . $backup_name ) ) {
					return self::abort( $meta, $snapshot_dir, sprintf( 'Could not snapshot %s before writing it.', $resolved['relative'] ), 'wpab_snapshot_failed' );
				}

				$entry['backup']          = $backup_name;
				$entry['previous_sha256'] = WPAB_Files::hash_file( $resolved['absolute'] );
			} else {
				$parent = dirname( $resolved['absolute'] );

				if ( ! is_dir( $parent ) ) {
					$created = self::create_directories( $parent, $resolved['root'] );

					if ( is_wp_error( $created ) ) {
						return self::abort( $meta, $snapshot_dir, $created->get_error_message(), 'wpab_mkdir_failed' );
					}

					$meta['created_dirs'] = array_merge( $meta['created_dirs'], $created );
				}
			}

			$written = self::write_atomic( $resolved['absolute'], $file['content'] );

			if ( is_wp_error( $written ) ) {
				$meta['files'][] = $entry;

				return self::abort( $meta, $snapshot_dir, $written->get_error_message(), 'wpab_write_failed' );
			}

			$entry['deployed_sha256'] = hash( 'sha256', $file['content'] );

			$meta['files'][] = $entry;

			$applied[] = array(
				'operation'       => $entry['operation'],
				'scope'           => $entry['scope'],
				'path'            => $entry['path'],
				'bytes'           => $entry['bytes'],
				'sha256'          => $entry['deployed_sha256'],
				'previous_sha256' => $entry['previous_sha256'],
			);
		}

		self::write_meta( $snapshot_dir, $meta );

		$health = self::health_check();

		if ( true !== $health['ok'] ) {
			$restore = self::restore( $meta, true );

			self::write_meta(
				$snapshot_dir,
				array_merge(
					$meta,
					array(
						'rolled_back_at' => gmdate( 'c' ),
						'rollback_cause' => 'health_check_failed',
					)
				)
			);

			self::release_lock();

			WPAB_Log::add(
				'deploy_rolled_back',
				array(
					'snapshot_id' => $snapshot_id,
					'proposal_id' => $meta['proposal_id'],
					'reason'      => 'health_check_failed',
				)
			);

			return new WP_Error(
				'wpab_health_check_failed',
				'The site failed its health check after deployment, so every change was rolled back automatically.',
				array(
					'status'      => 500,
					'health'      => $health,
					'rolled_back' => true,
					'restored'    => $restore['restored'],
					'removed'     => $restore['removed'],
					'snapshot_id' => $snapshot_id,
				)
			);
		}

		self::prune_snapshots();
		self::release_lock();

		WPAB_Log::add(
			'deploy_applied',
			array(
				'snapshot_id' => $snapshot_id,
				'proposal_id' => $meta['proposal_id'],
				'files'       => wp_list_pluck( $applied, 'path' ),
			)
		);

		return array(
			'success'        => true,
			'proposal_id'    => $meta['proposal_id'],
			'snapshot_id'    => $snapshot_id,
			'bridge_version' => WPAB_VERSION,
			'applied_at'     => gmdate( 'c' ),
			'file_count'     => count( $applied ),
			'files'          => $applied,
			'health'         => $health,
		);
	}

	/**
	 * Undo whatever has already been written, then fail the request.
	 */
	private static function abort( array $meta, string $snapshot_dir, string $message, string $code ) {
		$restore = self::restore( $meta, true );

		self::write_meta(
			$snapshot_dir,
			array_merge(
				$meta,
				array(
					'rolled_back_at' => gmdate( 'c' ),
					'rollback_cause' => $code,
				)
			)
		);

		self::release_lock();

		WPAB_Log::add(
			'deploy_failed',
			array(
				'snapshot_id' => $meta['id'],
				'proposal_id' => $meta['proposal_id'],
				'reason'      => $message,
			)
		);

		return new WP_Error(
			$code,
			$message . ' Every file in this deployment was rolled back.',
			array(
				'status'      => 500,
				'rolled_back' => true,
				'restored'    => $restore['restored'],
				'removed'     => $restore['removed'],
				'snapshot_id' => $meta['id'],
			)
		);
	}

	/**
	 * Writes through a temp file in the same directory so a reader never sees
	 * a half-written PHP file, and mirrors the previous file's permissions.
	 *
	 * @return true|WP_Error
	 */
	private static function write_atomic( string $absolute, string $content ) {
		$dir  = dirname( $absolute );
		$temp = $dir . '/.wpab-' . bin2hex( random_bytes( 6 ) ) . '.tmp';

		$bytes = @file_put_contents( $temp, $content, LOCK_EX );

		if ( false === $bytes || $bytes !== strlen( $content ) ) {
			@unlink( $temp );

			return new WP_Error( 'wpab_write_failed', sprintf( 'Could not write %s.', basename( $absolute ) ) );
		}

		$mode = file_exists( $absolute ) ? ( @fileperms( $absolute ) & 0777 ) : 0;

		if ( ! $mode ) {
			$mode = defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : 0644;
		}

		@chmod( $temp, $mode );

		if ( ! @rename( $temp, $absolute ) ) {
			@unlink( $temp );

			return new WP_Error( 'wpab_rename_failed', sprintf( 'Could not replace %s.', basename( $absolute ) ) );
		}

		clearstatcache( true, $absolute );

		if ( function_exists( 'opcache_invalidate' ) ) {
			@opcache_invalidate( $absolute, true );
		}

		return true;
	}

	/**
	 * @return array|WP_Error List of directories created, deepest last.
	 */
	private static function create_directories( string $target, string $root ) {
		$created = array();
		$missing = array();
		$cursor  = $target;

		while ( ! is_dir( $cursor ) && strlen( $cursor ) > strlen( $root ) ) {
			$missing[] = $cursor;
			$cursor    = dirname( $cursor );
		}

		foreach ( array_reverse( $missing ) as $dir ) {
			if ( ! @mkdir( $dir, 0755 ) && ! is_dir( $dir ) ) {
				return new WP_Error( 'wpab_mkdir_failed', sprintf( 'Could not create directory %s.', basename( $dir ) ) );
			}

			$created[] = $dir;
		}

		return $created;
	}

	/* ---------------------------------------------------------------------
	 * Snapshots and rollback
	 * ------------------------------------------------------------------ */

	private static function write_meta( string $snapshot_dir, array $meta ): void {
		// Absolute paths are an implementation detail of this machine; they are
		// kept in the meta file (rollback needs them) but never returned.
		@file_put_contents( $snapshot_dir . 'meta.json', wp_json_encode( $meta, JSON_PRETTY_PRINT ), LOCK_EX );
	}

	private static function read_meta( string $snapshot_id ): ?array {
		$id = self::sanitize_snapshot_id( $snapshot_id );

		if ( '' === $id ) {
			return null;
		}

		$path = self::snapshots_dir() . $id . '/meta.json';

		if ( ! is_file( $path ) ) {
			return null;
		}

		$raw  = @file_get_contents( $path );
		$meta = is_string( $raw ) ? json_decode( $raw, true ) : null;

		return is_array( $meta ) ? $meta : null;
	}

	private static function sanitize_snapshot_id( string $id ): string {
		return preg_match( '/^snap_[0-9]{8}-[0-9]{6}_[a-f0-9]{6}$/', $id ) ? $id : '';
	}

	/**
	 * Restores a snapshot.
	 *
	 * A modified file is only restored when the bytes on disk still match what
	 * this deployment wrote, and a created file is only deleted under the same
	 * rule — otherwise somebody edited it afterwards and rolling back would
	 * destroy their work. `$force` skips that check and is used only for the
	 * automatic rollback inside a failed apply, where the deployment is known
	 * to be seconds old.
	 */
	private static function restore( array $meta, bool $force = false ): array {
		$restored = array();
		$removed  = array();
		$skipped  = array();

		$files = isset( $meta['files'] ) && is_array( $meta['files'] ) ? $meta['files'] : array();

		foreach ( array_reverse( $files ) as $entry ) {
			$absolute = isset( $entry['absolute'] ) ? (string) $entry['absolute'] : '';
			$label    = ( isset( $entry['scope'] ) ? $entry['scope'] : '?' ) . '/' . ( isset( $entry['path'] ) ? $entry['path'] : '?' );

			if ( '' === $absolute ) {
				$skipped[] = array( 'path' => $label, 'reason' => 'missing_record' );
				continue;
			}

			$current  = WPAB_Files::hash_file( $absolute );
			$deployed = isset( $entry['deployed_sha256'] ) ? (string) $entry['deployed_sha256'] : '';

			if ( ! $force && '' !== $deployed && null !== $current && ! hash_equals( $deployed, $current ) ) {
				$skipped[] = array( 'path' => $label, 'reason' => 'changed_since_deployment' );
				continue;
			}

			if ( 'create' === ( isset( $entry['operation'] ) ? $entry['operation'] : 'modify' ) ) {
				if ( null === $current ) {
					$skipped[] = array( 'path' => $label, 'reason' => 'already_removed' );
					continue;
				}

				if ( @unlink( $absolute ) ) {
					$removed[] = $label;
				} else {
					$skipped[] = array( 'path' => $label, 'reason' => 'delete_failed' );
				}

				continue;
			}

			$backup = isset( $entry['backup'] ) ? (string) $entry['backup'] : '';

			if ( '' === $backup ) {
				$skipped[] = array( 'path' => $label, 'reason' => 'no_backup' );
				continue;
			}

			$backup_path = self::snapshots_dir() . $meta['id'] . '/' . $backup;

			if ( ! is_file( $backup_path ) ) {
				$skipped[] = array( 'path' => $label, 'reason' => 'backup_missing' );
				continue;
			}

			$content = @file_get_contents( $backup_path );

			if ( false === $content ) {
				$skipped[] = array( 'path' => $label, 'reason' => 'backup_unreadable' );
				continue;
			}

			$written = self::write_atomic( $absolute, $content );

			if ( is_wp_error( $written ) ) {
				$skipped[] = array( 'path' => $label, 'reason' => 'restore_failed' );
				continue;
			}

			$restored[] = $label;
		}

		foreach ( array_reverse( isset( $meta['created_dirs'] ) && is_array( $meta['created_dirs'] ) ? $meta['created_dirs'] : array() ) as $dir ) {
			if ( is_dir( $dir ) && self::is_empty_dir( $dir ) ) {
				@rmdir( $dir );
			}
		}

		return array(
			'restored' => $restored,
			'removed'  => $removed,
			'skipped'  => $skipped,
		);
	}

	private static function is_empty_dir( string $dir ): bool {
		$handle = @opendir( $dir );

		if ( false === $handle ) {
			return false;
		}

		while ( false !== ( $entry = readdir( $handle ) ) ) {
			if ( '.' !== $entry && '..' !== $entry ) {
				closedir( $handle );

				return false;
			}
		}

		closedir( $handle );

		return true;
	}

	/**
	 * Operator- and SaaS-facing rollback of a completed deployment.
	 *
	 * @return array|WP_Error
	 */
	public static function rollback( string $snapshot_id, bool $force = false ) {
		$meta = self::read_meta( $snapshot_id );

		if ( null === $meta ) {
			return new WP_Error( 'wpab_snapshot_not_found', 'That snapshot does not exist on this site.', array( 'status' => 404 ) );
		}

		if ( ! empty( $meta['rolled_back_at'] ) ) {
			return new WP_Error( 'wpab_already_rolled_back', 'That snapshot has already been rolled back.', array( 'status' => 409 ) );
		}

		if ( ! self::acquire_lock( 'rollback:' . $meta['id'] ) ) {
			return new WP_Error( 'wpab_locked', 'Another deployment is currently running on this site.', array( 'status' => 409 ) );
		}

		$result = self::restore( $meta, $force );

		$meta['rolled_back_at'] = gmdate( 'c' );
		$meta['rollback_cause'] = 'requested';

		self::write_meta( self::snapshots_dir() . $meta['id'] . '/', $meta );
		self::release_lock();

		$health = self::health_check();

		WPAB_Log::add(
			'rollback',
			array(
				'snapshot_id' => $meta['id'],
				'restored'    => $result['restored'],
				'removed'     => $result['removed'],
			)
		);

		return array(
			'success'        => true,
			'snapshot_id'    => $meta['id'],
			'proposal_id'    => isset( $meta['proposal_id'] ) ? $meta['proposal_id'] : null,
			'rolled_back_at' => $meta['rolled_back_at'],
			'bridge_version' => WPAB_VERSION,
			'restored'       => $result['restored'],
			'removed'        => $result['removed'],
			'skipped'        => $result['skipped'],
			'health'         => $health,
		);
	}

	/**
	 * GET /snapshots
	 */
	public static function snapshots(): array {
		$dir     = self::snapshots_dir();
		$records = array();

		if ( is_dir( $dir ) ) {
			$handle = @opendir( $dir );

			if ( false !== $handle ) {
				while ( false !== ( $entry = readdir( $handle ) ) ) {
					if ( '' === self::sanitize_snapshot_id( $entry ) ) {
						continue;
					}

					$meta = self::read_meta( $entry );

					if ( null === $meta ) {
						continue;
					}

					$bytes = 0;
					$files = array();

					foreach ( ( isset( $meta['files'] ) && is_array( $meta['files'] ) ? $meta['files'] : array() ) as $file ) {
						$bytes  += isset( $file['bytes'] ) ? (int) $file['bytes'] : 0;
						$files[] = array(
							'operation' => isset( $file['operation'] ) ? $file['operation'] : 'modify',
							'scope'     => isset( $file['scope'] ) ? $file['scope'] : null,
							'path'      => isset( $file['path'] ) ? $file['path'] : null,
						);
					}

					$records[] = array(
						'id'             => $meta['id'],
						'proposal_id'    => isset( $meta['proposal_id'] ) ? $meta['proposal_id'] : null,
						'created_at'     => isset( $meta['created_at'] ) ? $meta['created_at'] : null,
						'rolled_back_at' => isset( $meta['rolled_back_at'] ) ? $meta['rolled_back_at'] : null,
						'bridge_version' => isset( $meta['bridge_version'] ) ? $meta['bridge_version'] : null,
						'file_count'     => count( $files ),
						'bytes'          => $bytes,
						'files'          => $files,
					);
				}

				closedir( $handle );
			}
		}

		usort(
			$records,
			static function ( $a, $b ) {
				return strcmp( (string) $b['id'], (string) $a['id'] );
			}
		);

		return array(
			'success'        => true,
			'bridge_version' => WPAB_VERSION,
			'count'          => count( $records ),
			'keep'           => self::snapshot_keep(),
			'snapshots'      => $records,
		);
	}

	public static function delete_snapshot( string $snapshot_id ): bool {
		$id = self::sanitize_snapshot_id( $snapshot_id );

		if ( '' === $id ) {
			return false;
		}

		return self::delete_dir( self::snapshots_dir() . $id . '/' );
	}

	private static function prune_snapshots(): void {
		$snapshots = self::snapshots();
		$keep      = self::snapshot_keep();

		if ( $snapshots['count'] <= $keep ) {
			return;
		}

		foreach ( array_slice( $snapshots['snapshots'], $keep ) as $snapshot ) {
			self::delete_snapshot( (string) $snapshot['id'] );
		}
	}

	private static function delete_dir( string $dir ): bool {
		if ( ! is_dir( $dir ) ) {
			return false;
		}

		$handle = @opendir( $dir );

		if ( false === $handle ) {
			return false;
		}

		while ( false !== ( $entry = readdir( $handle ) ) ) {
			if ( '.' === $entry || '..' === $entry ) {
				continue;
			}

			$path = trailingslashit( $dir ) . $entry;

			if ( is_dir( $path ) && ! is_link( $path ) ) {
				self::delete_dir( $path );
				continue;
			}

			@unlink( $path );
		}

		closedir( $handle );

		return @rmdir( $dir );
	}

	/* ---------------------------------------------------------------------
	 * Health
	 * ------------------------------------------------------------------ */

	/**
	 * Fetches the front page and the REST root back over HTTP.
	 *
	 * A host that blocks loopback requests is common and is not a deployment
	 * failure, so a transport error is reported as "unavailable" and does not
	 * trigger a rollback. Only a real 5xx or a visible PHP fatal does.
	 */
	public static function health_check(): array {
		$checks = array(
			'home' => home_url( '/' ),
			'rest' => rest_url(),
		);

		$results = array();
		$ok      = true;

		foreach ( $checks as $name => $url ) {
			$response = wp_remote_get(
				add_query_arg( 'wpab_health', (string) time(), $url ),
				array(
					'timeout'     => 15,
					'redirection' => 2,
					'sslverify'   => false,
					'headers'     => array( 'X-WPAB-Health-Check' => '1' ),
					'cookies'     => array(),
				)
			);

			if ( is_wp_error( $response ) ) {
				$results[ $name ] = array(
					'ok'     => true,
					'status' => null,
					'note'   => 'unavailable',
					'error'  => $response->get_error_message(),
				);

				continue;
			}

			$status = (int) wp_remote_retrieve_response_code( $response );
			$body   = (string) wp_remote_retrieve_body( $response );
			$fatal  = (bool) preg_match( '/\b(Fatal error|Parse error)\s*:/i', substr( $body, 0, 20000 ) );

			$passed = $status > 0 && $status < 500 && ! $fatal;

			$results[ $name ] = array(
				'ok'     => $passed,
				'status' => $status,
				'note'   => $fatal ? 'php_fatal_in_output' : 'checked',
			);

			if ( ! $passed ) {
				$ok = false;
			}
		}

		return array(
			'ok'         => $ok,
			'checked_at' => gmdate( 'c' ),
			'checks'     => $results,
			'home'       => $results['home'],
			'rest'       => $results['rest'],
		);
	}

	/* ---------------------------------------------------------------------
	 * Helpers
	 * ------------------------------------------------------------------ */

	public static function first_error( array $report ): string {
		foreach ( ( isset( $report['files'] ) ? $report['files'] : array() ) as $file ) {
			if ( empty( $file['ready'] ) && ! empty( $file['error']['message'] ) ) {
				return sprintf( '%s/%s: %s', $file['scope'], $file['path'], $file['error']['message'] );
			}
		}

		if ( ! empty( $report['global_error'] ) ) {
			return (string) $report['global_error'];
		}

		return 'The deployment did not pass preflight.';
	}
}
