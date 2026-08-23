<?php
/**
 * wp-admin screens.
 *
 * Three pages under one menu:
 *
 *   AI Builder            the bridge token, the project scopes, write policy
 *   Snapshots             every deployment this site has taken, with rollback
 *   Activity log          what the bridge did and when
 *
 * WPAB_Cloud adds a fourth ("Cloud connection") for the reverse direction.
 *
 * Every form posts to admin-post.php with a nonce and is gated on
 * manage_options in the handler, not merely by hiding the menu.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Admin {

	private const MENU_SLUG      = 'wp-ai-builder';
	private const SNAPSHOTS_SLUG = 'wp-ai-builder-snapshots';
	private const LOG_SLUG       = 'wp-ai-builder-log';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
		add_action( 'admin_post_wpab_generate_token', array( __CLASS__, 'handle_generate_token' ) );
		add_action( 'admin_post_wpab_revoke_token', array( __CLASS__, 'handle_revoke_token' ) );
		add_action( 'admin_post_wpab_save_settings', array( __CLASS__, 'handle_save_settings' ) );
		add_action( 'admin_post_wpab_rollback_snapshot', array( __CLASS__, 'handle_rollback' ) );
		add_action( 'admin_post_wpab_delete_snapshot', array( __CLASS__, 'handle_delete_snapshot' ) );
		add_action( 'admin_post_wpab_clear_log', array( __CLASS__, 'handle_clear_log' ) );
		add_filter( 'plugin_action_links_' . WPAB_BASENAME, array( __CLASS__, 'action_links' ) );
	}

	public static function action_links( $links ) {
		$url = admin_url( 'admin.php?page=' . self::MENU_SLUG );

		array_unshift( $links, '<a href="' . esc_url( $url ) . '">Settings</a>' );

		return $links;
	}

	public static function register_menu(): void {
		add_menu_page(
			'AI Builder',
			'AI Builder',
			'manage_options',
			self::MENU_SLUG,
			array( __CLASS__, 'render_main' ),
			'dashicons-superhero',
			58
		);

		add_submenu_page(
			self::MENU_SLUG,
			'AI Builder — Bridge',
			'Bridge',
			'manage_options',
			self::MENU_SLUG,
			array( __CLASS__, 'render_main' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'AI Builder — Snapshots',
			'Snapshots',
			'manage_options',
			self::SNAPSHOTS_SLUG,
			array( __CLASS__, 'render_snapshots' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			'AI Builder — Activity log',
			'Activity log',
			'manage_options',
			self::LOG_SLUG,
			array( __CLASS__, 'render_log' )
		);
	}

	/* ---------------------------------------------------------------------
	 * Handlers
	 * ------------------------------------------------------------------ */

	private static function guard( string $nonce_action ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You are not allowed to do this.', '', array( 'response' => 403 ) );
		}

		check_admin_referer( $nonce_action );
	}

	private static function back( string $page, string $notice, array $extra = array() ): void {
		wp_safe_redirect(
			add_query_arg(
				array_merge(
					array(
						'page'        => $page,
						'wpab_notice' => $notice,
					),
					$extra
				),
				admin_url( 'admin.php' )
			)
		);

		exit;
	}

	/**
	 * The plaintext token exists for exactly one page render, held in a short
	 * transient scoped to the administrator who pressed the button.
	 */
	private static function stash_token( string $token ): void {
		set_transient( 'wpab_new_token_' . get_current_user_id(), $token, 300 );
	}

	private static function take_token(): string {
		$key   = 'wpab_new_token_' . get_current_user_id();
		$token = (string) get_transient( $key );

		if ( '' !== $token ) {
			delete_transient( $key );
		}

		return $token;
	}

	public static function handle_generate_token(): void {
		self::guard( 'wpab_generate_token' );

		$existing = WPAB_Auth::has_token();
		$token    = WPAB_Auth::generate_token();

		WPAB_Writer::prepare_storage();
		self::stash_token( $token );

		WPAB_Log::add( $existing ? 'token_regenerated' : 'token_generated' );

		self::back( self::MENU_SLUG, $existing ? 'token_regenerated' : 'token_generated' );
	}

	public static function handle_revoke_token(): void {
		self::guard( 'wpab_revoke_token' );

		WPAB_Auth::revoke_token();
		WPAB_Log::add( 'token_revoked' );

		self::back( self::MENU_SLUG, 'token_revoked' );
	}

	public static function handle_save_settings(): void {
		self::guard( 'wpab_save_settings' );

		$plugin = isset( $_POST['wpab_project_plugin'] )
			? sanitize_text_field( wp_unslash( $_POST['wpab_project_plugin'] ) )
			: '';

		// Only ever accept a plugin file that really is installed.
		if ( '' !== $plugin && ! array_key_exists( $plugin, self::installed_plugins() ) ) {
			$plugin = '';
		}

		update_option( WPAB_Scopes::PLUGIN_OPTION, $plugin, false );
		update_option( WPAB_Writer::WRITE_OPTION, empty( $_POST['wpab_write_enabled'] ) ? '0' : '1', false );
		update_option( WPAB_Writer::CREATE_OPTION, empty( $_POST['wpab_create_enabled'] ) ? '0' : '1', false );
		update_option( WPAB_Writer::GUARD_OPTION, empty( $_POST['wpab_block_risky_code'] ) ? '0' : '1', false );

		$keep = isset( $_POST['wpab_snapshot_limit'] ) ? (int) $_POST['wpab_snapshot_limit'] : 20;

		update_option( WPAB_Writer::SNAPSHOT_LIMIT_OPT, max( 3, min( 100, $keep ) ), false );

		WPAB_Log::add(
			'settings_saved',
			array(
				'plugin' => '' === $plugin ? 'none' : $plugin,
				'write'  => WPAB_Writer::write_enabled() ? 'on' : 'off',
				'create' => WPAB_Writer::create_enabled() ? 'on' : 'off',
			)
		);

		self::back( self::MENU_SLUG, 'settings_saved' );
	}

	public static function handle_rollback(): void {
		self::guard( 'wpab_rollback_snapshot' );

		$id = isset( $_POST['snapshot_id'] ) ? sanitize_text_field( wp_unslash( $_POST['snapshot_id'] ) ) : '';

		$result = WPAB_Writer::rollback( $id, ! empty( $_POST['wpab_force'] ) );

		if ( is_wp_error( $result ) ) {
			self::back( self::SNAPSHOTS_SLUG, 'rollback_failed', array( 'wpab_detail' => rawurlencode( $result->get_error_message() ) ) );
		}

		self::back( self::SNAPSHOTS_SLUG, 'rolled_back' );
	}

	public static function handle_delete_snapshot(): void {
		self::guard( 'wpab_delete_snapshot' );

		$id = isset( $_POST['snapshot_id'] ) ? sanitize_text_field( wp_unslash( $_POST['snapshot_id'] ) ) : '';

		WPAB_Writer::delete_snapshot( $id );
		WPAB_Log::add( 'snapshot_deleted', array( 'snapshot_id' => $id ) );

		self::back( self::SNAPSHOTS_SLUG, 'snapshot_deleted' );
	}

	public static function handle_clear_log(): void {
		self::guard( 'wpab_clear_log' );

		WPAB_Log::clear();

		self::back( self::LOG_SLUG, 'log_cleared' );
	}

	/* ---------------------------------------------------------------------
	 * Shared rendering helpers
	 * ------------------------------------------------------------------ */

	private static function notice(): string {
		return isset( $_GET['wpab_notice'] ) ? sanitize_key( wp_unslash( $_GET['wpab_notice'] ) ) : '';
	}

	private static function detail(): string {
		return isset( $_GET['wpab_detail'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['wpab_detail'] ) ) ) : '';
	}

	private static function installed_plugins(): array {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$plugins = get_plugins();
		$self    = WPAB_BASENAME;
		$list    = array();

		foreach ( $plugins as $file => $data ) {
			if ( $file === $self || false === strpos( $file, '/' ) ) {
				continue;
			}

			$list[ $file ] = isset( $data['Name'] ) ? (string) $data['Name'] : $file;
		}

		asort( $list );

		return $list;
	}

	private static function pill( bool $on, string $on_label = 'Yes', string $off_label = 'No' ): string {
		$color = $on ? '#00a32a' : '#8c8f94';

		return '<span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:11px;color:#fff;background:' . $color . '">'
			. esc_html( $on ? $on_label : $off_label )
			. '</span>';
	}

	private static function local_time( string $iso ): string {
		if ( '' === $iso ) {
			return '—';
		}

		$timestamp = strtotime( $iso );

		if ( ! $timestamp ) {
			return '—';
		}

		return wp_date( 'Y-m-d H:i', $timestamp );
	}

	/* ---------------------------------------------------------------------
	 * Main page
	 * ------------------------------------------------------------------ */

	public static function render_main(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$notice    = self::notice();
		$new_token = self::take_token();
		$theme     = WPAB_Scopes::theme();
		$plugin    = WPAB_Scopes::plugin();
		$snapshots = WPAB_Writer::snapshots();
		?>
		<div class="wrap">
			<h1>AI Builder — Bridge</h1>
			<p class="description">
				Bridge <?php echo esc_html( WPAB_VERSION ); ?> connects this site to the ESCANOR AI Builder.
				The builder can read the active theme and one approved companion plugin, and can deploy
				reviewed changes with an automatic snapshot and rollback.
			</p>

			<?php if ( 'settings_saved' === $notice ) : ?>
				<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
			<?php elseif ( 'token_revoked' === $notice ) : ?>
				<div class="notice notice-success is-dismissible"><p>Bridge token revoked. The builder can no longer reach this site.</p></div>
			<?php elseif ( 'token_regenerated' === $notice ) : ?>
				<div class="notice notice-warning is-dismissible"><p>A new bridge token was generated. The previous token stopped working immediately — paste the new one into the builder.</p></div>
			<?php endif; ?>

			<?php if ( '' !== $new_token ) : ?>
				<div class="notice notice-success">
					<p><strong>Copy this bridge token now. It is shown once and never again.</strong></p>
					<p>
						<input
							type="text"
							readonly
							onfocus="this.select()"
							value="<?php echo esc_attr( $new_token ); ?>"
							style="width:100%;max-width:640px;font-family:monospace;padding:6px"
						/>
					</p>
					<p class="description">Paste it into the builder dashboard under your project's WordPress connection.</p>
				</div>
			<?php endif; ?>

			<h2>Connection</h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Bridge token</th>
					<td>
						<?php if ( WPAB_Auth::has_token() ) : ?>
							<?php echo self::pill( true, 'Active' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
							<code><?php echo esc_html( WPAB_Auth::token_hint() ); ?></code>
							<p class="description">
								Created <?php echo esc_html( self::local_time( WPAB_Auth::created_at() ) ); ?> ·
								Last used <?php echo esc_html( self::local_time( WPAB_Auth::last_used_at() ) ); ?>
							</p>
						<?php else : ?>
							<?php echo self::pill( false, '', 'Not generated' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
							<p class="description">The bridge refuses every request until a token exists.</p>
						<?php endif; ?>

						<p>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
								<?php wp_nonce_field( 'wpab_generate_token' ); ?>
								<input type="hidden" name="action" value="wpab_generate_token" />
								<?php
								submit_button(
									WPAB_Auth::has_token() ? 'Regenerate token' : 'Generate token',
									'primary',
									'submit',
									false,
									WPAB_Auth::has_token()
										? array( 'onclick' => "return confirm('Regenerating invalidates the current token immediately. Continue?')" )
										: array()
								);
								?>
							</form>

							<?php if ( WPAB_Auth::has_token() ) : ?>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;margin-left:8px">
									<?php wp_nonce_field( 'wpab_revoke_token' ); ?>
									<input type="hidden" name="action" value="wpab_revoke_token" />
									<?php submit_button( 'Revoke', 'delete', 'submit', false, array( 'onclick' => "return confirm('Revoke the bridge token? The builder will lose access to this site.')" ) ); ?>
								</form>
							<?php endif; ?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Site URL</th>
					<td><code><?php echo esc_html( home_url( '/' ) ); ?></code></td>
				</tr>
				<tr>
					<th scope="row">Bridge endpoint</th>
					<td><code><?php echo esc_html( rest_url( WPAB_REST_NAMESPACE ) ); ?></code></td>
				</tr>
			</table>

			<h2>Project scopes</h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Theme</th>
					<td>
						<?php if ( ! empty( $theme['available'] ) ) : ?>
							<strong><?php echo esc_html( (string) $theme['label'] ); ?></strong>
							<code><?php echo esc_html( (string) $theme['slug'] ); ?></code>
							<?php if ( ! empty( $theme['is_child'] ) ) : ?>
								<span class="description">child of <?php echo esc_html( (string) $theme['parent'] ); ?></span>
							<?php endif; ?>
						<?php else : ?>
							<em><?php echo esc_html( isset( $theme['reason'] ) ? $theme['reason'] : 'Unavailable.' ); ?></em>
						<?php endif; ?>
					</td>
				</tr>
			</table>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'wpab_save_settings' ); ?>
				<input type="hidden" name="action" value="wpab_save_settings" />

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="wpab_project_plugin">Companion plugin</label></th>
						<td>
							<select name="wpab_project_plugin" id="wpab_project_plugin">
								<option value="">— none —</option>
								<?php
								$selected = (string) get_option( WPAB_Scopes::PLUGIN_OPTION, '' );

								foreach ( self::installed_plugins() as $file => $name ) :
									?>
									<option value="<?php echo esc_attr( $file ); ?>" <?php selected( $selected, $file ); ?>>
										<?php echo esc_html( $name ); ?>
									</option>
								<?php endforeach; ?>
							</select>
							<p class="description">
								The one plugin the builder may read and write. Business logic belongs here;
								presentation belongs in the theme. Leave as "none" to keep the builder theme-only.
								<?php if ( ! empty( $plugin['available'] ) && empty( $plugin['active'] ) ) : ?>
									<br /><strong>Note:</strong> the selected plugin is installed but not active.
								<?php elseif ( ! empty( $plugin['reason'] ) && '' !== $selected ) : ?>
									<br /><strong>Note:</strong> <?php echo esc_html( (string) $plugin['reason'] ); ?>
								<?php endif; ?>
							</p>
						</td>
					</tr>
				</table>

				<h2>Write policy</h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Deployments</th>
						<td>
							<label>
								<input type="checkbox" name="wpab_write_enabled" value="1" <?php checked( WPAB_Writer::write_enabled() ); ?> />
								Allow the builder to modify approved project files
							</label>
							<p class="description">Turn this off to put the site in read-only mode without revoking the token.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">New files</th>
						<td>
							<label>
								<input type="checkbox" name="wpab_create_enabled" value="1" <?php checked( WPAB_Writer::create_enabled() ); ?> />
								Allow the builder to create new files inside the approved scopes
							</label>
							<p class="description">Creation never overwrites: a create against an existing path is always refused.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Risky PHP</th>
						<td>
							<label>
								<input type="checkbox" name="wpab_block_risky_code" value="1" <?php checked( WPAB_Writer::guard_enabled() ); ?> />
								Refuse deployments containing eval(), shell_exec(), base64_decode() and similar
							</label>
							<p class="description">Recommended. Generated theme and plugin code has no legitimate need for these.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpab_snapshot_limit">Snapshots kept</label></th>
						<td>
							<input type="number" min="3" max="100" id="wpab_snapshot_limit" name="wpab_snapshot_limit"
								value="<?php echo esc_attr( (string) WPAB_Writer::snapshot_keep() ); ?>" class="small-text" />
							<p class="description">Older snapshots are pruned automatically after a successful deployment.</p>
						</td>
					</tr>
				</table>

				<?php submit_button( 'Save settings' ); ?>
			</form>

			<h2>Capability summary</h2>
			<table class="widefat striped" style="max-width:720px">
				<tbody>
					<tr>
						<td>Read project files</td>
						<td><?php echo self::pill( true ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
					</tr>
					<tr>
						<td>Preflight and SHA-256 verification</td>
						<td><?php echo self::pill( true ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
					</tr>
					<tr>
						<td>Modify existing files</td>
						<td><?php echo self::pill( WPAB_Writer::write_enabled() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
					</tr>
					<tr>
						<td>Create new files</td>
						<td><?php echo self::pill( WPAB_Writer::write_enabled() && WPAB_Writer::create_enabled() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
					</tr>
					<tr>
						<td>PHP syntax check before writing</td>
						<td><?php echo self::pill( 'unavailable' !== WPAB_Writer::syntax_check( "<?php\n", 'probe.php' )['status'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
					</tr>
					<tr>
						<td>Snapshots stored</td>
						<td><?php echo esc_html( (string) $snapshots['count'] ); ?></td>
					</tr>
					<tr>
						<td>Delete or rename files</td>
						<td><?php echo self::pill( false, '', 'Never' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
					</tr>
				</tbody>
			</table>
		</div>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * Snapshots page
	 * ------------------------------------------------------------------ */

	public static function render_snapshots(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$notice    = self::notice();
		$snapshots = WPAB_Writer::snapshots();
		?>
		<div class="wrap">
			<h1>AI Builder — Snapshots</h1>
			<p class="description">
				Every deployment copies the previous bytes of each file it touches before writing.
				Rolling back restores those bytes and removes files the deployment created.
			</p>

			<?php if ( 'rolled_back' === $notice ) : ?>
				<div class="notice notice-success is-dismissible"><p>Snapshot restored.</p></div>
			<?php elseif ( 'rollback_failed' === $notice ) : ?>
				<div class="notice notice-error is-dismissible"><p>Rollback failed: <?php echo esc_html( self::detail() ); ?></p></div>
			<?php elseif ( 'snapshot_deleted' === $notice ) : ?>
				<div class="notice notice-success is-dismissible"><p>Snapshot deleted.</p></div>
			<?php endif; ?>

			<table class="widefat striped">
				<thead>
					<tr>
						<th>Snapshot</th>
						<th>Taken</th>
						<th>Files</th>
						<th>State</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					<?php if ( 0 === $snapshots['count'] ) : ?>
						<tr><td colspan="5"><em>No deployments have been made on this site yet.</em></td></tr>
					<?php endif; ?>

					<?php foreach ( $snapshots['snapshots'] as $snapshot ) : ?>
						<tr>
							<td>
								<code><?php echo esc_html( (string) $snapshot['id'] ); ?></code>
								<?php if ( ! empty( $snapshot['proposal_id'] ) ) : ?>
									<br /><span class="description">proposal <?php echo esc_html( substr( (string) $snapshot['proposal_id'], 0, 12 ) ); ?></span>
								<?php endif; ?>
							</td>
							<td><?php echo esc_html( self::local_time( (string) $snapshot['created_at'] ) ); ?></td>
							<td>
								<?php foreach ( $snapshot['files'] as $file ) : ?>
									<div>
										<span class="description"><?php echo esc_html( (string) $file['operation'] ); ?></span>
										<code><?php echo esc_html( $file['scope'] . '/' . $file['path'] ); ?></code>
									</div>
								<?php endforeach; ?>
							</td>
							<td>
								<?php if ( ! empty( $snapshot['rolled_back_at'] ) ) : ?>
									Rolled back<br />
									<span class="description"><?php echo esc_html( self::local_time( (string) $snapshot['rolled_back_at'] ) ); ?></span>
								<?php else : ?>
									Applied
								<?php endif; ?>
							</td>
							<td>
								<?php if ( empty( $snapshot['rolled_back_at'] ) ) : ?>
									<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
										<?php wp_nonce_field( 'wpab_rollback_snapshot' ); ?>
										<input type="hidden" name="action" value="wpab_rollback_snapshot" />
										<input type="hidden" name="snapshot_id" value="<?php echo esc_attr( (string) $snapshot['id'] ); ?>" />
										<label style="display:block;margin-bottom:4px">
											<input type="checkbox" name="wpab_force" value="1" />
											<span class="description">force (ignore later edits)</span>
										</label>
										<?php submit_button( 'Roll back', 'secondary', 'submit', false, array( 'onclick' => "return confirm('Restore this snapshot?')" ) ); ?>
									</form>
								<?php else : ?>
									<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
										<?php wp_nonce_field( 'wpab_delete_snapshot' ); ?>
										<input type="hidden" name="action" value="wpab_delete_snapshot" />
										<input type="hidden" name="snapshot_id" value="<?php echo esc_attr( (string) $snapshot['id'] ); ?>" />
										<?php submit_button( 'Delete', 'delete', 'submit', false, array( 'onclick' => "return confirm('Delete this snapshot permanently?')" ) ); ?>
									</form>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * Activity log page
	 * ------------------------------------------------------------------ */

	public static function render_log(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$entries = WPAB_Log::all();
		?>
		<div class="wrap">
			<h1>AI Builder — Activity log</h1>
			<p class="description">The last <?php echo esc_html( (string) count( $entries ) ); ?> bridge events on this site. File contents and secrets are never logged.</p>

			<?php if ( 'log_cleared' === self::notice() ) : ?>
				<div class="notice notice-success is-dismissible"><p>Activity log cleared.</p></div>
			<?php endif; ?>

			<table class="widefat striped">
				<thead>
					<tr>
						<th style="width:170px">When</th>
						<th style="width:180px">Event</th>
						<th style="width:140px">Actor</th>
						<th>Detail</th>
					</tr>
				</thead>
				<tbody>
					<?php if ( empty( $entries ) ) : ?>
						<tr><td colspan="4"><em>Nothing logged yet.</em></td></tr>
					<?php endif; ?>

					<?php foreach ( $entries as $entry ) : ?>
						<tr>
							<td><?php echo esc_html( self::local_time( (string) $entry['time'] ) ); ?></td>
							<td><code><?php echo esc_html( (string) $entry['event'] ); ?></code></td>
							<td><?php echo esc_html( (string) $entry['actor'] ); ?></td>
							<td>
								<?php
								$context = isset( $entry['context'] ) && is_array( $entry['context'] ) ? $entry['context'] : array();

								foreach ( $context as $key => $value ) {
									$printable = is_array( $value ) ? implode( ', ', $value ) : (string) $value;

									echo '<div><span class="description">' . esc_html( (string) $key ) . ':</span> ' . esc_html( $printable ) . '</div>';
								}
								?>
							</td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:16px">
				<?php wp_nonce_field( 'wpab_clear_log' ); ?>
				<input type="hidden" name="action" value="wpab_clear_log" />
				<?php submit_button( 'Clear log', 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}
}
