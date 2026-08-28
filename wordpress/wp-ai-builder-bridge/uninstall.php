<?php
/**
 * Uninstall: remove every trace of the bridge.
 *
 * Deleting the plugin revokes access, so the token hash goes. Any leftover
 * options from older versions (write policy, snapshots, module cache) are
 * cleaned up too, alongside the current ones.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$wpab_options = array(
	// Current options.
	'wpab_bridge_token_hash',
	'wpab_bridge_token_created',
	'wpab_bridge_token_last_used',
	'wpab_bridge_token_hint',
	'wpab_apply_lock',
	'wpab_activity_log',
	'wpab_installed_at',
	'wpab_version',
	'wpab_cloud_key',
	'wpab_cloud_key_set_at',
	'wpab_cloud_project',
	'wpab_generated_theme',
	'wpab_ai_log',
	// Legacy options from removed features (write policy, scopes, modules,
	// visual CSS) — deleting a missing option is a harmless no-op.
	'wpab_project_plugin',
	'wpab_write_enabled',
	'wpab_create_enabled',
	'wpab_block_risky_code',
	'wpab_snapshot_limit',
	'wpab_visual_css',
	'wpab_modules',
	'wpab_plan',
);

/**
 * Removes a directory tree without following symlinks.
 */
function wpab_uninstall_delete_dir( $dir ) {
	if ( ! is_dir( $dir ) ) {
		return;
	}

	$handle = @opendir( $dir );

	if ( false === $handle ) {
		return;
	}

	while ( false !== ( $entry = readdir( $handle ) ) ) {
		if ( '.' === $entry || '..' === $entry ) {
			continue;
		}

		$path = rtrim( $dir, '/' ) . '/' . $entry;

		if ( is_dir( $path ) && ! is_link( $path ) ) {
			wpab_uninstall_delete_dir( $path );
			continue;
		}

		@unlink( $path );
	}

	closedir( $handle );
	@rmdir( $dir );
}

$wpab_storage_key = get_option( 'wpab_storage_key', '' );

if ( is_string( $wpab_storage_key ) && '' !== $wpab_storage_key ) {
	$wpab_uploads = wp_get_upload_dir();

	wpab_uninstall_delete_dir(
		trailingslashit( $wpab_uploads['basedir'] ) . 'wp-ai-builder-' . $wpab_storage_key
	);
}

$wpab_options[] = 'wpab_storage_key';

foreach ( $wpab_options as $wpab_option ) {
	delete_option( $wpab_option );

	if ( is_multisite() ) {
		delete_site_option( $wpab_option );
	}
}

global $wpdb;

// Auth throttle transients are the only ones the plugin sets with a dynamic key.
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
		$wpdb->esc_like( '_transient_wpab_' ) . '%',
		$wpdb->esc_like( '_transient_timeout_wpab_' ) . '%'
	)
);
