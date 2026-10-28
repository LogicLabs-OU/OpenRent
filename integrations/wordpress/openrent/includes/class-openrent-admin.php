<?php
/**
 * Settings → OpenRent: connect the site (OpenRent sign-in or a publishable key), see the shop, disconnect.
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

/**
 * The settings page and its form handling.
 */
class OpenRent_Admin {

	/**
	 * Adds the page under Settings.
	 */
	public static function menu() {
		add_options_page( __( 'OpenRent', 'openrent' ), __( 'OpenRent', 'openrent' ), 'manage_options', 'openrent', array( __CLASS__, 'render' ) );
	}

	/**
	 * Handles the page's forms and OpenRent's return; each ends with a redirect and a notice.
	 */
	public static function handle() {
		if ( ! isset( $_GET['page'] ) || 'openrent' !== $_GET['page'] || ! current_user_can( 'manage_options' ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		// Back from OpenRent: the state checks it belongs to the sign-in started here.
		if ( isset( $_GET['code'], $_GET['state'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$done = OpenRent_Connect::finish( sanitize_text_field( wp_unslash( $_GET['code'] ) ), sanitize_text_field( wp_unslash( $_GET['state'] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification
			self::back( is_wp_error( $done ) ? $done->get_error_message() : '', is_wp_error( $done ) ? '' : __( 'Connected to OpenRent.', 'openrent' ) );
		}
		if ( isset( $_GET['error'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			self::back( 'access_denied' === $_GET['error'] ? __( 'The connection was declined in OpenRent.', 'openrent' ) : sanitize_text_field( wp_unslash( $_GET['error_description'] ?? $_GET['error'] ) ), '' ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) || ! isset( $_POST['openrent_action'] ) ) {
			return;
		}
		check_admin_referer( 'openrent_settings' );
		$action = sanitize_key( wp_unslash( $_POST['openrent_action'] ) );
		$url    = isset( $_POST['api_url'] ) ? sanitize_text_field( wp_unslash( $_POST['api_url'] ) ) : '';
		if ( 'connect' === $action ) {
			$to = OpenRent_Connect::start( $url );
			if ( is_wp_error( $to ) ) {
				self::back( $to->get_error_message(), '' );
			}
			wp_redirect( $to ); // phpcs:ignore WordPress.Security.SafeRedirect -- OpenRent's address, chosen by the admin.
			exit;
		}
		if ( 'use_key' === $action ) {
			$done = OpenRent_Connect::use_key( $url, sanitize_text_field( wp_unslash( $_POST['publishable'] ?? '' ) ), sanitize_text_field( wp_unslash( $_POST['storefront_url'] ?? '' ) ) );
			self::back( is_wp_error( $done ) ? $done->get_error_message() : '', is_wp_error( $done ) ? '' : __( 'Saved. Add this site under Widget sites in OpenRent, so online payments come back here.', 'openrent' ) );
		}
		if ( 'disconnect' === $action ) {
			OpenRent_Connect::disconnect();
			self::back( '', __( 'Disconnected from OpenRent.', 'openrent' ) );
		}
	}

	/**
	 * Back to the page with a notice.
	 *
	 * @param string $error What went wrong, if anything.
	 * @param string $ok    What went well, if anything.
	 */
	private static function back( $error, $ok ) {
		set_transient( 'openrent_notice_' . get_current_user_id(), array( 'error' => $error, 'ok' => $ok ), 60 );
		wp_safe_redirect( admin_url( 'options-general.php?page=openrent' ) );
		exit;
	}

	/**
	 * The page.
	 */
	public static function render() {
		$s      = OpenRent_Settings::get();
		$notice = get_transient( 'openrent_notice_' . get_current_user_id() );
		delete_transient( 'openrent_notice_' . get_current_user_id() );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'OpenRent', 'openrent' ); ?></h1>
			<?php if ( is_array( $notice ) && '' !== $notice['error'] ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html( $notice['error'] ); ?></p></div>
			<?php elseif ( is_array( $notice ) && '' !== $notice['ok'] ) : ?>
				<div class="notice notice-success"><p><?php echo esc_html( $notice['ok'] ); ?></p></div>
			<?php endif; ?>

			<?php if ( OpenRent_Settings::ready() ) : ?>
				<p id="openrent-status">
					<?php
					/* translators: 1: the shop's name, 2: the OpenRent address. */
					printf( esc_html__( 'Connected to %1$s at %2$s.', 'openrent' ), '<strong>' . esc_html( $s['shop_name'] ) . '</strong>', '<code>' . esc_html( $s['api_url'] ) . '</code>' );
					?>
				</p>
				<p><?php esc_html_e( 'Add the OpenRent blocks in the editor, or use the shortcodes:', 'openrent' ); ?></p>
				<ul>
					<li><code>[openrent_product product="city-bike"]</code></li>
					<li><code>[openrent_category category="bikes" limit="12"]</code></li>
					<li><code>[openrent_book_button product="city-bike" label="Book now"]</code></li>
				</ul>
				<form method="post">
					<?php wp_nonce_field( 'openrent_settings' ); ?>
					<input type="hidden" name="openrent_action" value="disconnect" />
					<?php submit_button( __( 'Disconnect', 'openrent' ), 'secondary' ); ?>
				</form>
			<?php else : ?>
				<form method="post">
					<?php wp_nonce_field( 'openrent_settings' ); ?>
					<input type="hidden" name="openrent_action" value="connect" />
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="openrent-api-url"><?php esc_html_e( 'OpenRent address', 'openrent' ); ?></label></th>
							<td>
								<input name="api_url" id="openrent-api-url" type="url" class="regular-text" value="<?php echo esc_attr( $s['api_url'] ); ?>" placeholder="https://rent.example.com" required />
								<p class="description"><?php esc_html_e( 'Where your OpenRent runs. You sign in there and approve this site.', 'openrent' ); ?></p>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Connect to OpenRent', 'openrent' ) ); ?>
				</form>

				<h2><?php esc_html_e( 'Or use a publishable key', 'openrent' ); ?></h2>
				<p><?php esc_html_e( 'Without signing in: copy a publishable key from OpenRent under Settings → API keys.', 'openrent' ); ?></p>
				<form method="post">
					<?php wp_nonce_field( 'openrent_settings' ); ?>
					<input type="hidden" name="openrent_action" value="use_key" />
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="openrent-key-url"><?php esc_html_e( 'OpenRent address', 'openrent' ); ?></label></th>
							<td><input name="api_url" id="openrent-key-url" type="url" class="regular-text" value="<?php echo esc_attr( $s['api_url'] ); ?>" placeholder="https://rent.example.com" required /></td>
						</tr>
						<tr>
							<th scope="row"><label for="openrent-publishable"><?php esc_html_e( 'Publishable key', 'openrent' ); ?></label></th>
							<td><input name="publishable" id="openrent-publishable" type="text" class="regular-text code" placeholder="pk_live_…" required /></td>
						</tr>
						<tr>
							<th scope="row"><label for="openrent-storefront"><?php esc_html_e( 'Storefront address', 'openrent' ); ?></label></th>
							<td>
								<input name="storefront_url" id="openrent-storefront" type="url" class="regular-text" placeholder="https://shop.example.com" />
								<p class="description"><?php esc_html_e( 'Where book buttons lead.', 'openrent' ); ?></p>
							</td>
						</tr>
					</table>
					<?php submit_button( __( 'Save', 'openrent' ), 'secondary' ); ?>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}
}
