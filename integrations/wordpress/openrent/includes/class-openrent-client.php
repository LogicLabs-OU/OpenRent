<?php
/**
 * Calls to OpenRent's API, with the site's OAuth token (renewed when it runs out) or its publishable key.
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

/**
 * A small API client on wp_remote_request.
 */
class OpenRent_Client {

	/**
	 * Calls the API.
	 *
	 * @param string               $method GET, POST, PATCH or DELETE.
	 * @param string               $path   Such as /api/v1/tenant.
	 * @param array<string, mixed> $body   JSON body, if any.
	 * @return array<string, mixed>|WP_Error The answer, or what went wrong.
	 */
	public static function request( $method, $path, $body = null ) {
		$s = OpenRent_Settings::get();
		if ( '' === $s['api_url'] ) {
			return new WP_Error( 'openrent_not_set_up', __( 'Enter your OpenRent address first.', 'openrent' ) );
		}
		$headers = array( 'Accept' => 'application/json' );
		if ( 'oauth' === $s['mode'] ) {
			$token = self::access_token();
			if ( is_wp_error( $token ) ) {
				return $token;
			}
			$headers['Authorization'] = 'Bearer ' . $token;
		} elseif ( 'key' === $s['mode'] ) {
			$headers['Authorization'] = 'Bearer ' . $s['publishable'];
		}
		if ( null !== $body ) {
			$headers['Content-Type'] = 'application/json';
		}
		$response = wp_remote_request(
			$s['api_url'] . $path,
			array(
				'method'  => $method,
				'headers' => $headers,
				'body'    => null !== $body ? wp_json_encode( $body ) : null,
				'timeout' => 15,
			)
		);
		return self::decode( $response );
	}

	/**
	 * Reads the shop's public storefront API (the catalogue): with the publishable key, else by the shop's name.
	 *
	 * @param string $path Such as /api/v1/storefront/catalog/products?limit=100.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function storefront( $path ) {
		$s = OpenRent_Settings::get();
		if ( ! OpenRent_Settings::ready() ) {
			return new WP_Error( 'openrent_not_connected', __( 'This site is not connected to OpenRent.', 'openrent' ) );
		}
		$headers = 'key' === $s['mode'] ? array( 'Authorization' => 'Bearer ' . $s['publishable'] ) : array( 'X-Tenant-Slug' => $s['shop_slug'] );
		$response = wp_remote_get(
			$s['api_url'] . $path,
			array(
				'headers' => array_merge( $headers, array( 'Accept' => 'application/json' ) ),
				'timeout' => 15,
			)
		);
		return self::decode( $response );
	}

	/**
	 * Calls a public OAuth endpoint (form posts, as OAuth expects).
	 *
	 * @param string               $path Such as /oauth/token.
	 * @param array<string, mixed> $form The form.
	 * @param bool                 $json Send JSON instead (registration).
	 * @return array<string, mixed>|WP_Error
	 */
	public static function oauth( $path, $form, $json = false ) {
		$s        = OpenRent_Settings::get();
		$response = wp_remote_post(
			$s['api_url'] . $path,
			array(
				'headers' => array( 'Content-Type' => $json ? 'application/json' : 'application/x-www-form-urlencoded' ),
				'body'    => $json ? wp_json_encode( $form ) : $form,
				'timeout' => 15,
			)
		);
		return self::decode( $response );
	}

	/**
	 * The answer's JSON, or an error with OpenRent's message.
	 *
	 * @param array|WP_Error $response From wp_remote_*.
	 * @return array<string, mixed>|WP_Error
	 */
	private static function decode( $response ) {
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'openrent_unreachable', __( 'OpenRent could not be reached. Check the address.', 'openrent' ) );
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $code >= 400 || ! is_array( $data ) ) {
			$message = is_array( $data ) ? ( $data['detail'] ?? $data['error_description'] ?? $data['message'] ?? '' ) : '';
			return new WP_Error( 'openrent_error', '' !== $message ? $message : __( 'OpenRent answered with an error.', 'openrent' ), array( 'status' => $code ) );
		}
		return $data;
	}

	/**
	 * A valid access token: the stored one, or a new one from the refresh token (each works once).
	 *
	 * @return string|WP_Error
	 */
	public static function access_token() {
		$s = OpenRent_Settings::get();
		if ( '' !== $s['access_token'] && (int) $s['expires_at'] > time() + 60 ) {
			return $s['access_token'];
		}
		if ( '' === $s['refresh_token'] ) {
			return new WP_Error( 'openrent_not_connected', __( 'This site is not connected to OpenRent.', 'openrent' ) );
		}
		$tokens = self::oauth(
			'/oauth/token',
			array(
				'grant_type'    => 'refresh_token',
				'refresh_token' => $s['refresh_token'],
				'client_id'     => $s['client_id'],
			)
		);
		if ( is_wp_error( $tokens ) ) {
			// The shop disconnected this site, or the token was used elsewhere: connect again.
			OpenRent_Settings::update( array( 'access_token' => '', 'refresh_token' => '' ) );
			return new WP_Error( 'openrent_not_connected', __( 'The connection to OpenRent ended. Connect again.', 'openrent' ) );
		}
		self::store_tokens( $tokens );
		return $tokens['access_token'];
	}

	/**
	 * Keeps the tokens OpenRent gave.
	 *
	 * @param array<string, mixed> $tokens The token answer.
	 */
	public static function store_tokens( $tokens ) {
		OpenRent_Settings::update(
			array(
				'access_token'  => (string) $tokens['access_token'],
				'refresh_token' => (string) $tokens['refresh_token'],
				'expires_at'    => time() + (int) $tokens['expires_in'],
			)
		);
	}
}
