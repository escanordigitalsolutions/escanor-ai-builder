<?php
/**
 * Create-only theme writer.
 *
 * Given a brand and a set of files, this creates a brand-new classic PHP theme
 * folder and writes the files into it — then activates it. It NEVER edits an
 * existing theme or any file outside the new folder. Every path is validated
 * for traversal, denied directories, denied filenames and allowed extensions;
 * every .php file is syntax-checked (without executing it) and scanned for a
 * denylist of dangerous functions before a single byte is written. If anything
 * fails after the folder is created, the whole folder is removed so a broken
 * theme is never left behind.
 *
 * This is the write foundation the theme-generation wizard builds on.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Theme_Writer {

	public const GENERATED_OPTION = 'wpab_generated_theme';

	private const MAX_FILES       = 250;
	private const MAX_FILE_BYTES  = 512000;      // 500 KB per file.
	private const MAX_TOTAL_BYTES = 8388608;     // 8 MB per theme.
	private const MAX_PATH_LENGTH = 300;

	/** Directory names that may never appear in a theme path. */
	private const DENIED_SEGMENTS = array(
		'node_modules', 'vendor', '.git', '.github', '.svn', '.hg',
		'.idea', '.vscode', '__macosx', '.ddev', '.cache',
	);

	/** Filenames that may never be written. */
	private const DENIED_BASENAMES = array(
		'wp-config.php', 'wp-config-sample.php', '.htaccess', '.htpasswd',
		'.user.ini', 'php.ini', 'web.config', '.env', '.env.local',
		'.env.production', '.npmrc', '.git-credentials', 'id_rsa',
	);

	/** Extensions a generated theme is allowed to contain. */
	private const ALLOWED_EXTENSIONS = array(
		'php', 'css', 'scss', 'js', 'mjs', 'json', 'html', 'txt', 'md',
		'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
		'woff', 'woff2', 'ttf', 'eot', 'xml', 'po', 'pot',
	);

	/**
	 * Functions a generated theme has no legitimate reason to call. A .php file
	 * that invokes any of these fails validation before it is written.
	 */
	private const DENIED_FUNCTIONS = array(
		'eval', 'assert', 'create_function', 'shell_exec', 'exec', 'system',
		'passthru', 'proc_open', 'popen', 'pcntl_exec', 'dl',
		'call_user_func', 'call_user_func_array', 'preg_replace_callback',
		'base64_decode', 'gzinflate', 'gzuncompress', 'str_rot13',
		'move_uploaded_file', 'unlink', 'rmdir', 'fopen', 'fwrite',
		'file_put_contents', 'file_get_contents', 'curl_exec',
		'wp_remote_get', 'wp_remote_post',
	);

	/* ---------------------------------------------------------------------
	 * Public API
	 * ------------------------------------------------------------------ */

	/**
	 * Create + activate a new classic theme.
	 *
	 * @param string $brand  Human brand name; the folder slug is derived from it.
	 * @param array  $files  List of array{ path:string, contents:string }.
	 * @param array  $meta   Optional { name, description, author } for style.css.
	 *
	 * @return array|WP_Error { slug, name, preview_url, files_written }
	 */
	public static function create( string $brand, array $files, array $meta = array() ) {
		$brand = trim( wp_strip_all_tags( $brand ) );

		if ( '' === $brand ) {
			return new WP_Error( 'wpab_tw_no_brand', 'A theme name is required.', array( 'status' => 400 ) );
		}

		if ( empty( $files ) || ! is_array( $files ) ) {
			return new WP_Error( 'wpab_tw_no_files', 'No files to write.', array( 'status' => 400 ) );
		}

		if ( count( $files ) > self::MAX_FILES ) {
			return new WP_Error( 'wpab_tw_too_many', 'Too many files for one theme.', array( 'status' => 400 ) );
		}

		// ---- Validate EVERY file before touching the filesystem. ----
		$clean = array();
		$total = 0;
		$has_style = false;

		foreach ( $files as $file ) {
			if ( ! is_array( $file ) || ! isset( $file['path'] ) ) {
				return new WP_Error( 'wpab_tw_bad_file', 'Each file needs a path and contents.', array( 'status' => 400 ) );
			}

			$rel = self::clean_relative_path( (string) $file['path'] );

			if ( is_wp_error( $rel ) ) {
				return $rel;
			}

			$contents = isset( $file['contents'] ) ? (string) $file['contents'] : '';
			$bytes    = strlen( $contents );

			if ( $bytes > self::MAX_FILE_BYTES ) {
				return new WP_Error( 'wpab_tw_file_big', sprintf( '%s is too large.', $rel ), array( 'status' => 400 ) );
			}

			$total += $bytes;

			if ( $total > self::MAX_TOTAL_BYTES ) {
				return new WP_Error( 'wpab_tw_total_big', 'The theme is too large in total.', array( 'status' => 400 ) );
			}

			if ( 'php' === self::extension( $rel ) ) {
				$lint = self::validate_php( $contents, $rel );

				if ( is_wp_error( $lint ) ) {
					return $lint;
				}
			}

			if ( isset( $clean[ $rel ] ) ) {
				return new WP_Error( 'wpab_tw_dupe', sprintf( 'Duplicate file path: %s', $rel ), array( 'status' => 400 ) );
			}

			$clean[ $rel ] = $contents;

			if ( 'style.css' === $rel ) {
				$has_style = true;
			}
		}

		// A theme is invalid to WordPress without a style.css header.
		if ( ! $has_style ) {
			$clean = array_merge( array( 'style.css' => self::default_style_header( $brand, $meta ) ), $clean );
		} else {
			$clean['style.css'] = self::ensure_style_header( $clean['style.css'], $brand, $meta );
		}

		// ---- Resolve a fresh folder. ----
		$slug = self::unique_slug( $brand );
		$root = trailingslashit( wp_normalize_path( get_theme_root() ) );
		$dir  = $root . $slug;

		if ( file_exists( $dir ) ) {
			return new WP_Error( 'wpab_tw_exists', 'A theme folder with that name already exists.', array( 'status' => 409 ) );
		}

		$fs = self::fs();

		if ( ! $fs ) {
			return new WP_Error( 'wpab_tw_fs', 'WordPress could not get filesystem access to write the theme.', array( 'status' => 500 ) );
		}

		if ( ! $fs->mkdir( $dir, FS_CHMOD_DIR ) ) {
			return new WP_Error( 'wpab_tw_mkdir', 'Could not create the theme folder.', array( 'status' => 500 ) );
		}

		// ---- Write every file (folder exists now; clean up on any failure). ----
		foreach ( $clean as $rel => $contents ) {
			$abs     = $dir . '/' . $rel;
			$sub_dir = dirname( $abs );

			if ( ! $fs->is_dir( $sub_dir ) && ! wp_mkdir_p( $sub_dir ) ) {
				self::delete_dir( $dir );
				return new WP_Error( 'wpab_tw_subdir', sprintf( 'Could not create the folder for %s.', $rel ), array( 'status' => 500 ) );
			}

			if ( ! $fs->put_contents( $abs, $contents, FS_CHMOD_FILE ) ) {
				self::delete_dir( $dir );
				return new WP_Error( 'wpab_tw_write', sprintf( 'Could not write %s.', $rel ), array( 'status' => 500 ) );
			}
		}

		// ---- Verify WordPress accepts it, then activate. ----
		wp_clean_themes_cache();

		$theme = wp_get_theme( $slug );

		if ( ! $theme->exists() ) {
			self::delete_dir( $dir );
			return new WP_Error( 'wpab_tw_invalid', 'The generated theme could not be registered by WordPress.', array( 'status' => 500 ) );
		}

		switch_theme( $slug );
		update_option( self::GENERATED_OPTION, $slug, false );

		return array(
			'success'       => true,
			'slug'          => $slug,
			'name'          => $brand,
			'preview_url'   => home_url( '/' ),
			'files_written' => count( $clean ),
		);
	}

	public const UNDO_OPTION = 'wpab_theme_undo';

	/**
	 * Edit files in the ACTIVE generated theme. Only the theme this plugin
	 * generated (tracked by wpab_generated_theme) can be edited — never a
	 * stock or third-party theme. Existing files are updated and new ones may
	 * be created inside the theme; every file is validated exactly like create().
	 * The previous contents are stored so a single-level undo can restore them.
	 *
	 * @param array $files List of array{ path:string, contents:string }.
	 * @return array|WP_Error { updated, undo_available }
	 */
	public static function update( array $files ) {
		$active    = get_stylesheet();
		$generated = (string) get_option( self::GENERATED_OPTION, '' );

		if ( '' === $generated || $generated !== $active ) {
			return new WP_Error( 'wpab_tw_not_generated', 'Editing is only available for a theme generated here. Generate a theme first.', array( 'status' => 409 ) );
		}

		if ( empty( $files ) || ! is_array( $files ) ) {
			return new WP_Error( 'wpab_tw_no_files', 'No changes to write.', array( 'status' => 400 ) );
		}

		if ( count( $files ) > self::MAX_FILES ) {
			return new WP_Error( 'wpab_tw_too_many', 'Too many files in one edit.', array( 'status' => 400 ) );
		}

		$dir = trailingslashit( wp_normalize_path( get_stylesheet_directory() ) );
		$fs  = self::fs();

		if ( ! $fs ) {
			return new WP_Error( 'wpab_tw_fs', 'WordPress could not get filesystem access.', array( 'status' => 500 ) );
		}

		// ---- Validate everything before writing a single byte. ----
		$clean = array();
		$total = 0;

		foreach ( $files as $file ) {
			if ( ! is_array( $file ) || ! isset( $file['path'] ) ) {
				return new WP_Error( 'wpab_tw_bad_file', 'Each change needs a path and contents.', array( 'status' => 400 ) );
			}

			$rel = self::clean_relative_path( (string) $file['path'] );
			if ( is_wp_error( $rel ) ) {
				return $rel;
			}

			$contents = isset( $file['contents'] ) ? (string) $file['contents'] : '';
			$total   += strlen( $contents );

			if ( strlen( $contents ) > self::MAX_FILE_BYTES ) {
				return new WP_Error( 'wpab_tw_file_big', sprintf( '%s is too large.', $rel ), array( 'status' => 400 ) );
			}
			if ( $total > self::MAX_TOTAL_BYTES ) {
				return new WP_Error( 'wpab_tw_total_big', 'The edit is too large in total.', array( 'status' => 400 ) );
			}
			if ( 'php' === self::extension( $rel ) ) {
				$lint = self::validate_php( $contents, $rel );
				if ( is_wp_error( $lint ) ) {
					return $lint;
				}
			}

			$clean[ $rel ] = $contents;
		}

		// ---- Snapshot current state for undo, then write. ----
		$undo = array();

		foreach ( $clean as $rel => $contents ) {
			$abs = $dir . $rel;

			// Path must resolve inside the theme (defence in depth).
			if ( file_exists( $abs ) ) {
				$real = realpath( $abs );
				if ( false === $real || 0 !== strpos( wp_normalize_path( $real ), $dir ) ) {
					return new WP_Error( 'wpab_tw_escaped', 'A path resolves outside the theme.', array( 'status' => 403 ) );
				}
				$undo[] = array( 'path' => $rel, 'contents' => (string) $fs->get_contents( $abs ), 'created' => false );
			} else {
				$undo[] = array( 'path' => $rel, 'contents' => null, 'created' => true );
			}
		}

		foreach ( $clean as $rel => $contents ) {
			$abs     = $dir . $rel;
			$sub_dir = dirname( $abs );

			if ( ! $fs->is_dir( $sub_dir ) && ! wp_mkdir_p( $sub_dir ) ) {
				return new WP_Error( 'wpab_tw_subdir', sprintf( 'Could not create the folder for %s.', $rel ), array( 'status' => 500 ) );
			}
			if ( ! $fs->put_contents( $abs, $contents, FS_CHMOD_FILE ) ) {
				return new WP_Error( 'wpab_tw_write', sprintf( 'Could not write %s.', $rel ), array( 'status' => 500 ) );
			}
		}

		update_option( self::UNDO_OPTION, array( 'slug' => $active, 'files' => $undo ), false );
		wp_clean_themes_cache();

		return array(
			'success'        => true,
			'updated'        => count( $clean ),
			'undo_available' => true,
		);
	}

	/** Restore the files changed by the most recent update(). One level deep. */
	public static function undo() {
		$undo = get_option( self::UNDO_OPTION, array() );

		if ( ! is_array( $undo ) || empty( $undo['files'] ) ) {
			return new WP_Error( 'wpab_tw_no_undo', 'There is nothing to undo.', array( 'status' => 409 ) );
		}

		$active = get_stylesheet();
		if ( ! isset( $undo['slug'] ) || $undo['slug'] !== $active ) {
			delete_option( self::UNDO_OPTION );
			return new WP_Error( 'wpab_tw_undo_stale', 'The last edit belongs to a different theme and cannot be undone.', array( 'status' => 409 ) );
		}

		$dir = trailingslashit( wp_normalize_path( get_stylesheet_directory() ) );
		$fs  = self::fs();

		if ( ! $fs ) {
			return new WP_Error( 'wpab_tw_fs', 'WordPress could not get filesystem access.', array( 'status' => 500 ) );
		}

		$restored = 0;

		foreach ( $undo['files'] as $u ) {
			if ( ! is_array( $u ) || ! isset( $u['path'] ) ) {
				continue;
			}
			$abs = $dir . $u['path'];

			if ( ! empty( $u['created'] ) ) {
				if ( file_exists( $abs ) ) {
					@unlink( $abs ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
				}
				$restored++;
			} elseif ( isset( $u['contents'] ) && null !== $u['contents'] ) {
				if ( $fs->put_contents( $abs, (string) $u['contents'], FS_CHMOD_FILE ) ) {
					$restored++;
				}
			}
		}

		delete_option( self::UNDO_OPTION );
		wp_clean_themes_cache();

		return array( 'success' => true, 'restored' => $restored );
	}

	/* ---------------------------------------------------------------------
	 * Validation helpers
	 * ------------------------------------------------------------------ */

	public static function extension( string $path ): string {
		return strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );
	}

	/**
	 * Shape check: relative, no traversal, no denied dirs/files, allowed ext.
	 *
	 * @return string|WP_Error Clean relative path.
	 */
	public static function clean_relative_path( string $path ) {
		$path = wp_normalize_path( trim( $path ) );

		if ( '' === $path ) {
			return new WP_Error( 'wpab_tw_empty_path', 'A file path is required.', array( 'status' => 400 ) );
		}

		if ( strlen( $path ) > self::MAX_PATH_LENGTH ) {
			return new WP_Error( 'wpab_tw_path_long', 'A file path is too long.', array( 'status' => 400 ) );
		}

		if ( false !== strpos( $path, "\0" ) ) {
			return new WP_Error( 'wpab_tw_path_null', 'A file path contains an illegal character.', array( 'status' => 400 ) );
		}

		if ( '/' === $path[0] || preg_match( '#^[a-zA-Z]:#', $path ) || 0 === strpos( $path, '\\\\' ) ) {
			return new WP_Error( 'wpab_tw_absolute', 'File paths must be relative to the theme.', array( 'status' => 400 ) );
		}

		$segments = explode( '/', $path );
		$clean    = array();

		foreach ( $segments as $segment ) {
			if ( '' === $segment || '.' === $segment ) {
				return new WP_Error( 'wpab_tw_shape', 'File paths must not contain empty or "." segments.', array( 'status' => 400 ) );
			}

			if ( '..' === $segment ) {
				return new WP_Error( 'wpab_tw_traversal', 'File paths must not traverse outside the theme.', array( 'status' => 400 ) );
			}

			if ( in_array( strtolower( $segment ), self::DENIED_SEGMENTS, true ) ) {
				return new WP_Error( 'wpab_tw_denied_dir', sprintf( 'The "%s" directory is not allowed.', $segment ), array( 'status' => 403 ) );
			}

			$clean[] = $segment;
		}

		$basename = strtolower( (string) end( $clean ) );

		if ( in_array( $basename, self::DENIED_BASENAMES, true ) ) {
			return new WP_Error( 'wpab_tw_denied_file', sprintf( '"%s" can never be written.', $basename ), array( 'status' => 403 ) );
		}

		if ( ! in_array( self::extension( $basename ), self::ALLOWED_EXTENSIONS, true ) ) {
			return new WP_Error( 'wpab_tw_ext', sprintf( '"%s" has a file type that is not allowed in a theme.', $basename ), array( 'status' => 403 ) );
		}

		return implode( '/', $clean );
	}

	/**
	 * Syntax-check PHP without executing it, then scan for denied functions.
	 * token_get_all with TOKEN_PARSE throws ParseError on invalid syntax.
	 *
	 * @return true|WP_Error
	 */
	public static function validate_php( string $code, string $rel ) {
		try {
			$tokens = token_get_all( $code, TOKEN_PARSE );
		} catch ( \ParseError $e ) {
			return new WP_Error(
				'wpab_tw_php_syntax',
				sprintf( 'PHP syntax error in %s: %s', $rel, $e->getMessage() ),
				array( 'status' => 422 )
			);
		} catch ( \Throwable $e ) {
			return new WP_Error(
				'wpab_tw_php_parse',
				sprintf( 'Could not parse %s: %s', $rel, $e->getMessage() ),
				array( 'status' => 422 )
			);
		}

		// Scan tokens. `eval` is a language construct (T_EVAL), not a function,
		// and backticks run a shell — both are always rejected. Everything else
		// on the denylist is a normal function call (T_STRING).
		$count = count( $tokens );

		for ( $i = 0; $i < $count; $i++ ) {
			$token = $tokens[ $i ];

			if ( '`' === $token ) {
				return new WP_Error(
					'wpab_tw_backtick',
					sprintf( '%s uses backtick shell execution, which is not allowed.', $rel ),
					array( 'status' => 422 )
				);
			}

			if ( is_array( $token ) && T_EVAL === $token[0] ) {
				return new WP_Error(
					'wpab_tw_denied_fn',
					sprintf( '%s uses eval(), which is not allowed in generated theme code.', $rel ),
					array( 'status' => 422 )
				);
			}

			if ( ! is_array( $token ) || T_STRING !== $token[0] ) {
				continue;
			}

			$name = strtolower( $token[1] );

			if ( ! in_array( $name, self::DENIED_FUNCTIONS, true ) ) {
				continue;
			}

			// Only flag it if it is actually a call: next non-whitespace token is '('.
			$j = $i + 1;

			while ( $j < $count && is_array( $tokens[ $j ] ) && T_WHITESPACE === $tokens[ $j ][0] ) {
				$j++;
			}

			if ( $j < $count && '(' === $tokens[ $j ] ) {
				// Make sure it is not a method/property access ($obj->name() / Class::name()).
				$k = $i - 1;

				while ( $k >= 0 && is_array( $tokens[ $k ] ) && T_WHITESPACE === $tokens[ $k ][0] ) {
					$k--;
				}

				$prev = $k >= 0 ? $tokens[ $k ] : null;

				if ( is_array( $prev ) && ( T_OBJECT_OPERATOR === $prev[0] || T_DOUBLE_COLON === $prev[0] || T_FUNCTION === $prev[0] ) ) {
					continue;
				}

				return new WP_Error(
					'wpab_tw_denied_fn',
					sprintf( '%s uses %s(), which is not allowed in generated theme code.', $rel, $name ),
					array( 'status' => 422 )
				);
			}
		}

		return true;
	}

	/* ---------------------------------------------------------------------
	 * Slug + style.css
	 * ------------------------------------------------------------------ */

	private static function unique_slug( string $brand ): string {
		$base = sanitize_title( $brand );

		if ( '' === $base ) {
			$base = 'site';
		}

		$slug = $base;
		$n    = 2;

		while ( is_dir( get_theme_root() . '/' . $slug ) || wp_get_theme( $slug )->exists() ) {
			$slug = $base . '-' . $n;
			$n++;

			if ( $n > 50 ) {
				$slug = $base . '-' . wp_generate_password( 5, false, false );
				break;
			}
		}

		return $slug;
	}

	private static function default_style_header( string $brand, array $meta ): string {
		$site = home_url( '/' );
		$desc = isset( $meta['description'] ) && '' !== $meta['description']
			? (string) $meta['description']
			: 'A custom theme for ' . $brand . '. Fully editable in WordPress.';

		$header  = "/*\n";
		$header .= 'Theme Name: ' . $brand . "\n";
		$header .= 'Theme URI: ' . $site . "\n";
		$header .= 'Author: ' . $brand . "\n";
		$header .= 'Author URI: ' . $site . "\n";
		$header .= 'Description: ' . $desc . "\n";
		$header .= "Requires at least: 6.2\n";
		$header .= "Tested up to: 6.8\n";
		$header .= "Requires PHP: 7.4\n";
		$header .= "Version: 1.0.0\n";
		$header .= "License: GPL-2.0-or-later\n";
		$header .= "License URI: https://www.gnu.org/licenses/gpl-2.0.html\n";
		$header .= 'Text Domain: ' . sanitize_title( $brand ) . "\n";
		$header .= "Tags: custom-background, custom-menu, featured-images, translation-ready\n";
		$header .= "*/\n";

		return $header;
	}

	/**
	 * Guarantee the style.css starts with a valid theme header. If the caller's
	 * style.css already has one, keep it; otherwise prepend a synthesized header
	 * and keep their CSS below it.
	 */
	private static function ensure_style_header( string $css, string $brand, array $meta ): string {
		if ( preg_match( '/^\s*\/\*.*Theme Name\s*:/is', $css ) ) {
			return $css;
		}

		return self::default_style_header( $brand, $meta ) . "\n" . $css;
	}

	/* ---------------------------------------------------------------------
	 * Filesystem
	 * ------------------------------------------------------------------ */

	private static function fs() {
		global $wp_filesystem;

		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}

		if ( ! $wp_filesystem ) {
			WP_Filesystem();
		}

		return $wp_filesystem;
	}

	/**
	 * Remove a directory tree, without following symlinks. Used to roll back a
	 * half-written theme.
	 */
	private static function delete_dir( string $dir ): void {
		$dir = wp_normalize_path( $dir );

		if ( ! is_dir( $dir ) ) {
			return;
		}

		// Never delete anything outside the themes root.
		$root = trailingslashit( wp_normalize_path( get_theme_root() ) );

		if ( 0 !== strpos( trailingslashit( $dir ), $root ) || $dir === untrailingslashit( $root ) ) {
			return;
		}

		$items = @scandir( $dir );

		if ( is_array( $items ) ) {
			foreach ( $items as $item ) {
				if ( '.' === $item || '..' === $item ) {
					continue;
				}

				$path = $dir . '/' . $item;

				if ( is_dir( $path ) && ! is_link( $path ) ) {
					self::delete_dir( $path );
				} else {
					@unlink( $path );
				}
			}
		}

		@rmdir( $dir );
	}
}
