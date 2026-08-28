<?php
/**
 * Project scopes and path safety.
 *
 * The builder only ever addresses one scope:
 *
 *   theme   the active stylesheet directory (the child theme if one is active)
 *
 * Everything else on the filesystem is out of reach. This class is the single
 * place that turns an untrusted relative path from the network into an
 * absolute path, and it is deliberately paranoid: traversal, absolute paths,
 * denied directories, denied filenames, denied extensions and symlinks that
 * escape the scope root are all rejected before any file function runs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Scopes {

	/** Directory names that are never readable or writable, at any depth. */
	private const DENIED_SEGMENTS = array(
		'node_modules',
		'vendor',
		'.git',
		'.github',
		'.svn',
		'.hg',
		'.idea',
		'.vscode',
		'__macosx',
		'.ddev',
		'.cache',
		'uploads',
	);

	/** Filenames that are never readable or writable. */
	private const DENIED_BASENAMES = array(
		'wp-config.php',
		'wp-config-sample.php',
		'.htaccess',
		'.htpasswd',
		'.user.ini',
		'php.ini',
		'web.config',
		'.env',
		'.env.local',
		'.env.production',
		'.npmrc',
		'.git-credentials',
		'id_rsa',
	);

	private const READ_EXTENSIONS = array(
		'php', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
		'json', 'html', 'htm', 'txt', 'md', 'xml', 'svg', 'po', 'pot',
		'twig', 'yml', 'yaml',
	);

	private const WRITE_EXTENSIONS = array(
		'php', 'css', 'scss', 'js', 'mjs', 'json', 'html', 'txt', 'md',
		'svg', 'xml', 'po', 'pot', 'twig', 'yml', 'yaml',
	);

	public const MAX_PATH_LENGTH = 300;

	/* ---------------------------------------------------------------------
	 * Scope descriptors
	 * ------------------------------------------------------------------ */

	public static function theme(): array {
		$theme = wp_get_theme();

		if ( ! $theme->exists() ) {
			return array(
				'available' => false,
				'reason'    => 'No active theme could be resolved.',
			);
		}

		$path = wp_normalize_path( get_stylesheet_directory() );

		return array(
			'available' => is_dir( $path ),
			'slug'      => (string) $theme->get_stylesheet(),
			'label'     => (string) $theme->get( 'Name' ),
			'version'   => (string) $theme->get( 'Version' ),
			'is_child'  => get_stylesheet() !== get_template(),
			'parent'    => get_stylesheet() !== get_template() ? (string) get_template() : null,
			'path'      => $path,
		);
	}

	public static function describe(): array {
		return array(
			'theme' => self::public_view( self::theme() ),
		);
	}

	/**
	 * Absolute paths are useful internally and pointless (plus mildly
	 * revealing) over the wire, so they are dropped from API output.
	 */
	private static function public_view( array $scope ): array {
		unset( $scope['path'] );

		return $scope;
	}

	public static function is_valid_scope( $scope ): bool {
		return 'theme' === $scope;
	}

	/**
	 * @return string|WP_Error Normalised, trailing-slashed scope root.
	 */
	public static function root( string $scope ) {
		if ( ! self::is_valid_scope( $scope ) ) {
			return new WP_Error( 'wpab_bad_scope', 'Unknown project scope.', array( 'status' => 400 ) );
		}

		$descriptor = self::theme();

		if ( empty( $descriptor['available'] ) || empty( $descriptor['path'] ) ) {
			return new WP_Error(
				'wpab_scope_unavailable',
				isset( $descriptor['reason'] ) ? (string) $descriptor['reason'] : 'That project scope is not available.',
				array( 'status' => 409 )
			);
		}

		$real = realpath( $descriptor['path'] );

		if ( false === $real ) {
			return new WP_Error( 'wpab_scope_missing', 'The project scope directory no longer exists.', array( 'status' => 409 ) );
		}

		return trailingslashit( wp_normalize_path( $real ) );
	}

	/* ---------------------------------------------------------------------
	 * Path resolution
	 * ------------------------------------------------------------------ */

	public static function is_readable_extension( string $path ): bool {
		return in_array( self::extension( $path ), self::READ_EXTENSIONS, true );
	}

	public static function is_writable_extension( string $path ): bool {
		return in_array( self::extension( $path ), self::WRITE_EXTENSIONS, true );
	}

	public static function extension( string $path ): string {
		return strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
	}

	public static function writable_extensions(): array {
		return self::WRITE_EXTENSIONS;
	}

	/**
	 * Validates the shape of a relative path without touching the filesystem.
	 *
	 * @return string|WP_Error Clean relative path.
	 */
	public static function clean_relative_path( string $path ) {
		$path = wp_normalize_path( trim( $path ) );

		if ( '' === $path ) {
			return new WP_Error( 'wpab_empty_path', 'A file path is required.', array( 'status' => 400 ) );
		}

		if ( strlen( $path ) > self::MAX_PATH_LENGTH ) {
			return new WP_Error( 'wpab_path_too_long', 'That file path is too long.', array( 'status' => 400 ) );
		}

		if ( false !== strpos( $path, "\0" ) ) {
			return new WP_Error( 'wpab_path_null_byte', 'That file path contains an illegal character.', array( 'status' => 400 ) );
		}

		if ( '/' === $path[0] || preg_match( '#^[a-zA-Z]:#', $path ) || 0 === strpos( $path, '\\\\' ) ) {
			return new WP_Error( 'wpab_absolute_path', 'File paths must be relative to the project scope.', array( 'status' => 400 ) );
		}

		if ( preg_match( '#^(https?|file|phar|data):#i', $path ) ) {
			return new WP_Error( 'wpab_stream_path', 'File paths must be plain relative paths.', array( 'status' => 400 ) );
		}

		$segments = explode( '/', $path );
		$clean    = array();

		foreach ( $segments as $segment ) {
			if ( '' === $segment || '.' === $segment ) {
				return new WP_Error( 'wpab_path_shape', 'File paths must not contain empty or "." segments.', array( 'status' => 400 ) );
			}

			if ( '..' === $segment ) {
				return new WP_Error( 'wpab_path_traversal', 'File paths must not traverse outside the project scope.', array( 'status' => 400 ) );
			}

			if ( in_array( strtolower( $segment ), self::DENIED_SEGMENTS, true ) ) {
				return new WP_Error(
					'wpab_denied_directory',
					sprintf( 'The "%s" directory is not part of the editable project.', $segment ),
					array( 'status' => 403 )
				);
			}

			$clean[] = $segment;
		}

		$basename = strtolower( (string) end( $clean ) );

		if ( in_array( $basename, self::DENIED_BASENAMES, true ) ) {
			return new WP_Error(
				'wpab_denied_file',
				sprintf( '"%s" can never be read or written through the bridge.', $basename ),
				array( 'status' => 403 )
			);
		}

		return implode( '/', $clean );
	}

	/**
	 * Full resolution: shape check plus containment check against the scope
	 * root. Symlinks are resolved, so a link inside the theme that points at
	 * wp-config.php still fails.
	 *
	 * @return array|WP_Error { relative, absolute, exists }
	 */
	public static function resolve( string $scope, string $path, bool $must_exist = true ) {
		$root = self::root( $scope );

		if ( is_wp_error( $root ) ) {
			return $root;
		}

		$relative = self::clean_relative_path( $path );

		if ( is_wp_error( $relative ) ) {
			return $relative;
		}

		$absolute = $root . $relative;
		$exists   = file_exists( $absolute );

		if ( $must_exist && ! $exists ) {
			return new WP_Error(
				'wpab_not_found',
				sprintf( '%s does not exist in the %s scope.', $relative, $scope ),
				array( 'status' => 404 )
			);
		}

		if ( $exists ) {
			if ( is_dir( $absolute ) ) {
				return new WP_Error( 'wpab_is_directory', 'That path is a directory, not a file.', array( 'status' => 400 ) );
			}

			$real = realpath( $absolute );

			if ( false === $real || 0 !== strpos( wp_normalize_path( $real ), $root ) ) {
				return new WP_Error( 'wpab_escaped_scope', 'That path resolves outside the project scope.', array( 'status' => 403 ) );
			}

			$absolute = wp_normalize_path( $real );
		} else {
			// For a file that does not exist yet, walk up to the deepest
			// existing ancestor and verify *that* is still inside the scope.
			$ancestor = dirname( $absolute );

			while ( ! file_exists( $ancestor ) && strlen( $ancestor ) > strlen( $root ) ) {
				$ancestor = dirname( $ancestor );
			}

			$real_ancestor = realpath( $ancestor );

			if ( false === $real_ancestor ) {
				return new WP_Error( 'wpab_bad_parent', 'The parent directory could not be resolved.', array( 'status' => 400 ) );
			}

			$real_ancestor = trailingslashit( wp_normalize_path( $real_ancestor ) );

			if ( 0 !== strpos( $real_ancestor, $root ) ) {
				return new WP_Error( 'wpab_escaped_scope', 'That path resolves outside the project scope.', array( 'status' => 403 ) );
			}
		}

		return array(
			'relative' => $relative,
			'absolute' => $absolute,
			'root'     => $root,
			'exists'   => $exists,
		);
	}

	/**
	 * Directory names skipped while walking a scope.
	 */
	public static function denied_segments(): array {
		return self::DENIED_SEGMENTS;
	}

	public static function denied_basenames(): array {
		return self::DENIED_BASENAMES;
	}

	public static function read_extensions(): array {
		return self::READ_EXTENSIONS;
	}
}
