<?php
/**
 * Plugin Name:       WP AI Builder Bridge
 * Plugin URI:        https://builder.escanor.lt
 * Description:       Secure bridge between this WordPress site and the ESCANOR AI Builder. Project inspection, controlled writes with SHA-256 verification, snapshots, health checks and one-click rollback.
 * Version:           0.20.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            ESCANOR Digital Solutions
 * Author URI:        https://escanor.lt
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-ai-builder-bridge
 *
 * ---------------------------------------------------------------------------
 *
 * Two independent directions of traffic live in this plugin:
 *
 *   SaaS  --(Bearer bridge token)------------------------->  WordPress
 *       read the project, preflight, apply, roll back.
 *       Handled by WPAB_Auth + WPAB_REST.
 *
 *   WordPress --(Bearer site key + actor headers)--------->  SaaS
 *       the wp-admin editor acting for a logged-in administrator.
 *       Handled by WPAB_Cloud.
 *
 * Nothing in here ever executes code it received over the wire. Writes are
 * restricted to an allowlisted set of paths inside the active theme and one
 * explicitly approved companion plugin, every write is snapshotted first, and
 * a failed health check rolls the whole deployment back.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'WPAB_VERSION', '0.20.0' );
define( 'WPAB_FILE', __FILE__ );
define( 'WPAB_DIR', plugin_dir_path( __FILE__ ) );
define( 'WPAB_URL', plugin_dir_url( __FILE__ ) );
define( 'WPAB_BASENAME', plugin_basename( __FILE__ ) );
define( 'WPAB_REST_NAMESPACE', 'wp-ai-builder/v1' );

require_once WPAB_DIR . 'includes/class-wpab-log.php';
require_once WPAB_DIR . 'includes/class-wpab-auth.php';
require_once WPAB_DIR . 'includes/class-wpab-scopes.php';
require_once WPAB_DIR . 'includes/class-wpab-content.php';
require_once WPAB_DIR . 'includes/class-wpab-analysis.php';
require_once WPAB_DIR . 'includes/class-wpab-files.php';
require_once WPAB_DIR . 'includes/class-wpab-writer.php';
require_once WPAB_DIR . 'includes/class-wpab-rest.php';
require_once WPAB_DIR . 'includes/class-wpab-admin.php';
require_once WPAB_DIR . 'includes/class-wpab-cloud.php';
require_once WPAB_DIR . 'includes/class-wpab-editor.php';

/**
 * Everything registers on plugins_loaded so the theme and companion plugin are
 * already known by the time any scope is resolved.
 */
function wpab_bootstrap() {
	WPAB_REST::init();
	WPAB_Admin::init();
	WPAB_Cloud::init();
	WPAB_Editor::init();
}
add_action( 'plugins_loaded', 'wpab_bootstrap' );

/**
 * Activation: prepare protected storage, never auto-generate a token.
 *
 * A token is only ever created by an administrator pressing the button, so an
 * unattended install is inert until someone deliberately connects it.
 */
function wpab_activate() {
	WPAB_Writer::prepare_storage();

	if ( '' === (string) get_option( 'wpab_installed_at', '' ) ) {
		update_option( 'wpab_installed_at', gmdate( 'c' ), false );
	}

	update_option( 'wpab_version', WPAB_VERSION, false );

	WPAB_Log::add( 'plugin_activated', array( 'version' => WPAB_VERSION ) );
}
register_activation_hook( __FILE__, 'wpab_activate' );

/**
 * Deactivation drops the write lock so a crashed apply cannot leave the site
 * permanently locked, but keeps tokens and snapshots intact.
 */
function wpab_deactivate() {
	delete_option( 'wpab_apply_lock' );

	WPAB_Log::add( 'plugin_deactivated', array( 'version' => WPAB_VERSION ) );
}
register_deactivation_hook( __FILE__, 'wpab_deactivate' );

/**
 * Runs after an in-place update so new storage layout lands without a manual
 * deactivate/reactivate cycle.
 */
function wpab_maybe_upgrade() {
	$stored = (string) get_option( 'wpab_version', '' );

	if ( WPAB_VERSION === $stored ) {
		return;
	}

	WPAB_Writer::prepare_storage();

	update_option( 'wpab_version', WPAB_VERSION, false );

	WPAB_Log::add(
		'plugin_upgraded',
		array(
			'from' => '' === $stored ? 'unknown' : $stored,
			'to'   => WPAB_VERSION,
		)
	);
}
add_action( 'admin_init', 'wpab_maybe_upgrade' );
