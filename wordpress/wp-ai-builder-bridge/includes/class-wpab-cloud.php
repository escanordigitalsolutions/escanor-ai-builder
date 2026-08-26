<?php
/**
 * ESCANOR AI Builder — Cloud client (v3A).
 *
 * This is the WordPress half of the auth flip.
 *
 * Until now WordPress was purely a server: the SaaS held a bridge token and
 * called in. The wp-admin builder needs the opposite direction, so this class
 * turns WordPress into a *client* of the SaaS.
 *
 * Request chain:
 *
 *   wp-admin browser  --(cookie + X-WP-Nonce, manage_options)-->  WordPress
 *   WordPress         --(Bearer site key + actor headers)------->  SaaS
 *
 * The site key never reaches the browser. The `manage_options` check happens
 * here, before any request leaves the site, so the SaaS only ever sees calls
 * that a WordPress administrator already authorised.
 *
 * Drop-in: place in includes/ and add to wp-ai-builder-bridge.php:
 *
 *   require_once WPAB_DIR . 'includes/class-wpab-cloud.php';
 *   WPAB_Cloud::init();   // inside the existing plugins_loaded callback
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Cloud {

	private const KEY_OPTION       = 'wpab_cloud_key';
	private const KEY_SET_OPTION   = 'wpab_cloud_key_set_at';
	private const PROJECT_OPTION   = 'wpab_cloud_project';

	private const NAMESPACE = 'wp-ai-builder/v1';

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'register_page' ), 20 );
		add_action( 'admin_post_wpab_save_cloud_key', array( __CLASS__, 'handle_save' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/* ---------------------------------------------------------------------
	 * Key storage
	 * ------------------------------------------------------------------ */

	public static function get_key(): string {
		return (string) get_option( self::KEY_OPTION, '' );
	}

	public static function has_key(): bool {
		return '' !== self::get_key();
	}

	public static function set_key( string $key ): void {
		// autoload = false: this is a secret, keep it out of alloptions.
		update_option( self::KEY_OPTION, $key, false );
		update_option( self::KEY_SET_OPTION, time(), false );
	}

	public static function delete_key(): void {
		delete_option( self::KEY_OPTION );
		delete_option( self::KEY_SET_OPTION );
		delete_option( self::PROJECT_OPTION );
	}

	/**
	 * Never render the full key back into the page.
	 */
	public static function masked_key(): string {
		$key = self::get_key();

		if ( '' === $key ) {
			return '';
		}

		$parts = explode( '_', $key );

		if ( count( $parts ) !== 4 ) {
			return '****';
		}

		return $parts[0] . '_' . $parts[1] . '_' . substr( $parts[2], 0, 8 ) . '...';
	}

	private static function is_valid_key_format( string $key ): bool {
		return (bool) preg_match( '/^esk_(live|test)_[a-f0-9]{16}_[a-f0-9]{64}$/', $key );
	}

	/* ---------------------------------------------------------------------
	 * Builder endpoint
	 * ------------------------------------------------------------------ */

	public static function builder_url(): string {
		$base = (string) apply_filters( 'wpab_builder_url', 'https://builder.escanor.lt' );

		return untrailingslashit( $base );
	}

	/**
	 * Strips anything that could smuggle a second header.
	 */
	private static function header_value( string $value ): string {
		return trim( str_replace( array( "\r", "\n", "\0" ), '', $value ) );
	}

	/**
	 * Authenticated call to the SaaS, as this site, on behalf of the current user.
	 *
	 * @return array|WP_Error Decoded JSON body on success.
	 */
	public static function request( string $endpoint, array $body = array(), int $timeout = 20, bool $blocking = true ) {
		$key = self::get_key();

		if ( '' === $key ) {
			return new WP_Error(
				'wpab_cloud_not_connected',
				'This site is not connected to the AI Builder cloud yet.',
				array( 'status' => 409 )
			);
		}

		$url = self::builder_url() . '/api/' . ltrim( $endpoint, '/' );

		if ( 0 !== strpos( $url, 'https://' ) ) {
			return new WP_Error(
				'wpab_cloud_insecure',
				'The AI Builder endpoint must use HTTPS.',
				array( 'status' => 400 )
			);
		}

		$user = wp_get_current_user();

		$response = wp_remote_post(
			$url,
			array(
				'timeout'     => $timeout,
				'blocking'    => $blocking,
				'redirection' => 0,
				'sslverify'   => true,
				'headers'     => array(
					'Authorization'         => 'Bearer ' . self::header_value( $key ),
					'Content-Type'          => 'application/json',
					'Accept'                => 'application/json',

					// Attribution only. The SaaS never authorises on these.
					'X-WPAB-Actor-Id'       => self::header_value( (string) $user->ID ),
					'X-WPAB-Actor-Login'    => self::header_value( (string) $user->user_login ),
					'X-WPAB-Actor-Email'    => self::header_value( (string) $user->user_email ),
					'X-WPAB-Actor-Name'     => self::header_value( (string) $user->display_name ),

					'X-WPAB-Site-Url'       => self::header_value( home_url( '/' ) ),
					'X-WPAB-Bridge-Version' => self::header_value( WPAB_VERSION ),
				),
				'body'        => wp_json_encode( $body ),
			)
		);

		if ( ! $blocking ) {
			// Fire-and-forget: the SaaS keeps running to completion and saves its
			// result, which the editor recovers by polling. No response body here.
			return array( 'started' => true );
		}

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$raw  = (string) wp_remote_retrieve_body( $response );
		$data = json_decode( $raw, true );

		if ( ! is_array( $data ) ) {
			$msg = ( 404 === $code )
				? 'That AI Builder endpoint was not found (HTTP 404). Deploy the latest app version to Vercel, then try again.'
				: 'The AI Builder did not return JSON (HTTP ' . $code . ').';
			return new WP_Error(
				'wpab_cloud_bad_response',
				$msg,
				array( 'status' => $code > 0 ? $code : 502 )
			);
		}

		if ( $code < 200 || $code >= 300 ) {
			return new WP_Error(
				'wpab_cloud_error',
				isset( $data['error'] ) ? (string) $data['error'] : 'AI Builder request failed.',
				array( 'status' => $code )
			);
		}

		return $data;
	}

	/**
	 * Authenticated GET to the SaaS (for polling lists). Same key + actor headers.
	 *
	 * @return array|WP_Error Decoded JSON body on success.
	 */
	public static function get( string $endpoint, array $query = array(), int $timeout = 20 ) {
		$key = self::get_key();

		if ( '' === $key ) {
			return new WP_Error(
				'wpab_cloud_not_connected',
				'This site is not connected to the AI Builder cloud yet.',
				array( 'status' => 409 )
			);
		}

		$url = self::builder_url() . '/api/' . ltrim( $endpoint, '/' );

		if ( ! empty( $query ) ) {
			$url = add_query_arg( $query, $url );
		}

		if ( 0 !== strpos( $url, 'https://' ) ) {
			return new WP_Error(
				'wpab_cloud_insecure',
				'The AI Builder endpoint must use HTTPS.',
				array( 'status' => 400 )
			);
		}

		$user = wp_get_current_user();

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => $timeout,
				'redirection' => 0,
				'sslverify'   => true,
				'headers'     => array(
					'Authorization'         => 'Bearer ' . self::header_value( $key ),
					'Accept'                => 'application/json',
					'X-WPAB-Actor-Id'       => self::header_value( (string) $user->ID ),
					'X-WPAB-Actor-Login'    => self::header_value( (string) $user->user_login ),
					'X-WPAB-Actor-Email'    => self::header_value( (string) $user->user_email ),
					'X-WPAB-Actor-Name'     => self::header_value( (string) $user->display_name ),
					'X-WPAB-Site-Url'       => self::header_value( home_url( '/' ) ),
					'X-WPAB-Bridge-Version' => self::header_value( WPAB_VERSION ),
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$raw  = (string) wp_remote_retrieve_body( $response );
		$data = json_decode( $raw, true );

		if ( ! is_array( $data ) ) {
			$msg = ( 404 === $code )
				? 'That AI Builder endpoint was not found (HTTP 404). Deploy the latest app version to Vercel, then try again.'
				: 'The AI Builder did not return JSON (HTTP ' . $code . ').';
			return new WP_Error(
				'wpab_cloud_bad_response',
				$msg,
				array( 'status' => $code > 0 ? $code : 502 )
			);
		}

		if ( $code < 200 || $code >= 300 ) {
			return new WP_Error(
				'wpab_cloud_error',
				isset( $data['error'] ) ? (string) $data['error'] : 'AI Builder request failed.',
				array( 'status' => $code )
			);
		}

		return $data;
	}

	/**
	 * Handshake. Resolves which project this key belongs to.
	 */
	public static function session() {
		$result = self::request( 'agent/session' );

		if ( ! is_wp_error( $result ) && isset( $result['project'] ) ) {
			update_option( self::PROJECT_OPTION, $result['project'], false );
		}

		return $result;
	}

	public static function cached_project(): array {
		$project = get_option( self::PROJECT_OPTION, array() );

		return is_array( $project ) ? $project : array();
	}

	/* ---------------------------------------------------------------------
	 * REST proxy — browser to WordPress to SaaS
	 * ------------------------------------------------------------------ */

	public static function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/cloud/session',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_session' ),

				// Deliberately NOT the bridge bearer token. This route is for a
				// logged-in administrator in wp-admin, authenticated by cookie
				// plus the standard wp_rest nonce.
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}

	public static function rest_session( WP_REST_Request $request ) {
		$result = self::session();

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result, 200 );
	}

	/* ---------------------------------------------------------------------
	 * Settings screen
	 * ------------------------------------------------------------------ */

	public static function register_page(): void {
		add_submenu_page(
			'wp-ai-builder',
			'Cloud connection',
			'Cloud connection',
			'manage_options',
			'wp-ai-builder-cloud',
			array( __CLASS__, 'render_page' )
		);
	}

	public static function handle_save(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You are not allowed to do this.', '', array( 'response' => 403 ) );
		}

		check_admin_referer( 'wpab_save_cloud_key' );

		$action = isset( $_POST['wpab_action'] )
			? sanitize_key( wp_unslash( $_POST['wpab_action'] ) )
			: 'save';

		$notice = 'saved';

		if ( 'disconnect' === $action ) {
			self::delete_key();
			$notice = 'disconnected';
		} else {
			$key = isset( $_POST['wpab_cloud_key'] )
				? trim( sanitize_text_field( wp_unslash( $_POST['wpab_cloud_key'] ) ) )
				: '';

			if ( ! self::is_valid_key_format( $key ) ) {
				$notice = 'invalid';
			} else {
				self::set_key( $key );

				$session = self::session();

				$notice = is_wp_error( $session ) ? 'unverified' : 'connected';
			}
		}

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'        => 'wp-ai-builder-cloud',
					'wpab_notice' => $notice,
				),
				admin_url( 'admin.php' )
			)
		);

		exit;
	}

	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$notice = isset( $_GET['wpab_notice'] )
			? sanitize_key( wp_unslash( $_GET['wpab_notice'] ) )
			: '';

		// Live-verify against the builder on render, so this page reflects the
		// real state instead of just "a key is stored". An orphaned or revoked
		// key shows the actual reason here rather than a false "Connected".
		$verify_error = '';
		$verified     = false;

		if ( self::has_key() ) {
			$session = self::session();

			if ( is_wp_error( $session ) ) {
				$verify_error = $session->get_error_message();
			} else {
				$verified = true;
			}
		}

		$project = self::cached_project();
		?>
		<div class="wrap">
			<h1>AI Builder — Cloud connection</h1>

			<?php if ( 'connected' === $notice ) : ?>
				<div class="notice notice-success"><p>Connected to the AI Builder cloud.</p></div>
			<?php elseif ( 'invalid' === $notice ) : ?>
				<div class="notice notice-error"><p>That does not look like a valid site key. Copy it again from the builder dashboard.</p></div>
			<?php elseif ( 'unverified' === $notice ) : ?>
				<div class="notice notice-warning"><p>The key was saved but the builder rejected it. Check that it has not been revoked.</p></div>
			<?php elseif ( 'disconnected' === $notice ) : ?>
				<div class="notice notice-success"><p>Site key removed.</p></div>
			<?php endif; ?>

			<p>
				Paste the site key generated in your project dashboard. It lets this
				site call the builder directly, so editors never leave wp-admin.
			</p>

			<?php if ( self::has_key() ) : ?>
				<?php if ( ! $verified ) : ?>
					<div class="notice notice-error inline">
						<p>
							<strong>The site key is not verified.</strong>
							<?php echo esc_html( $verify_error ); ?>
						</p>
						<p class="description">
							Generate a fresh site key in your project dashboard
							(project → Site keys → New key), then disconnect below and
							paste the new one.
						</p>
					</div>
				<?php endif; ?>

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Status</th>
						<td>
							<?php if ( $verified ) : ?>
								<strong style="color:#00a32a">Connected &amp; verified</strong>
							<?php else : ?>
								<strong style="color:#d63638">Key stored, not verified</strong>
							<?php endif; ?>
							<code><?php echo esc_html( self::masked_key() ); ?></code>
						</td>
					</tr>
					<?php if ( ! empty( $project['name'] ) ) : ?>
						<tr>
							<th scope="row">Project</th>
							<td><?php echo esc_html( (string) $project['name'] ); ?></td>
						</tr>
					<?php endif; ?>
				</table>

				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<?php wp_nonce_field( 'wpab_save_cloud_key' ); ?>
					<input type="hidden" name="action" value="wpab_save_cloud_key" />
					<input type="hidden" name="wpab_action" value="disconnect" />
					<?php submit_button( 'Disconnect', 'delete', 'submit', false ); ?>
				</form>
			<?php else : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<?php wp_nonce_field( 'wpab_save_cloud_key' ); ?>
					<input type="hidden" name="action" value="wpab_save_cloud_key" />
					<input type="hidden" name="wpab_action" value="save" />

					<table class="form-table" role="presentation">
						<tr>
							<th scope="row">
								<label for="wpab_cloud_key">Site key</label>
							</th>
							<td>
								<input
									type="password"
									class="regular-text"
									id="wpab_cloud_key"
									name="wpab_cloud_key"
									autocomplete="off"
									placeholder="esk_live_..."
								/>
								<p class="description">Stored on this site only. Never shown again after saving.</p>
							</td>
						</tr>
					</table>

					<?php submit_button( 'Connect' ); ?>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}
}
