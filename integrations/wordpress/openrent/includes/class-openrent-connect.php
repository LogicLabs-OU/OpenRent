<?php
/**
 * Connecting the site to an OpenRent shop: with OpenRent sign-in (OAuth 2.1 with PKCE; the site registers
 * itself as an app), or with a publishable key pasted in.
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

/**
 * The connection steps.
 */
class OpenRent_Connect {

	/**
	 * What the site asks for: the shop's details, adding itself to the widget sites, and the catalogue for the
	 * block editor's pickers.
	 */
	const SCOPES = 'tenant:read tenant:write catalog:read';

	/**
	 * Where OpenRent sends the person back: the plugin's settings page.
	 */
	public static function callback_url() {
		return admin_url( 'options-general.php?page=openrent' );
	}

	/**
	 * A PKCE pair: the verifier kept here, the S256 challenge sent along.
	 *
	 * @return array{verifier: string, challenge: string}
	 */
	public static function pkce() {
		$verifier  = rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
		$challenge = rtrim( strtr( base64_encode( hash( 'sha256', $verifier, true ) ), '+/', '-_' ), '=' );
		return array(
			'verifier'  => $verifier,
			'challenge' => $challenge,
		);
	}

	/**
	 * Starts OpenRent sign-in: registers the site with OpenRent once, then gives the address to send the person to.
	 *
	 * @param string $api_url The OpenRent address.
	 * @return string|WP_Error Where to go.
	 */
	public static function start( $api_url ) {
		$url = OpenRent_Settings::clean_url( $api_url );
		if ( null === $url ) {
			return new WP_Error( 'openrent_bad_url', __( 'Enter the OpenRent address, starting with https://.', 'openrent' ) );
		}
		$s = OpenRent_Settings::get();
		if ( $url !== $s['api_url'] ) {
			OpenRent_Settings::update( array( 'api_url' => $url, 'client_id' => '' ) );
			$s = OpenRent_Settings::get();
		}
		if ( '' === $s['client_id'] ) {
			$client = OpenRent_Client::oauth(
				'/oauth/register',
				array(
					/* translators: %s: the site's name. */
					'client_name'   => sprintf( __( '%s (WordPress)', 'openrent' ), get_bloginfo( 'name' ) ),
					'redirect_uris' => array( self::callback_url() ),
					'client_uri'    => home_url( '/' ),
				),
				true
			);
			if ( is_wp_error( $client ) ) {
				return $client;
			}
			OpenRent_Settings::update( array( 'client_id' => $client['client_id'] ) );
			$s = OpenRent_Settings::get();
		}
		$pkce  = self::pkce();
		$state = wp_generate_password( 24, false );
		set_transient( 'openrent_oauth_' . get_current_user_id(), array( 'state' => $state, 'verifier' => $pkce['verifier'] ), 10 * MINUTE_IN_SECONDS );
		// add_query_arg() leaves values as they are; the return address has its own query, so encode them.
		return add_query_arg(
			array_map(
				'rawurlencode',
				array(
					'response_type'         => 'code',
					'client_id'             => $s['client_id'],
					'redirect_uri'          => self::callback_url(),
					'scope'                 => self::SCOPES,
					'state'                 => $state,
					'code_challenge'        => $pkce['challenge'],
					'code_challenge_method' => 'S256',
				)
			),
			$s['api_url'] . '/oauth/authorize'
		);
	}

	/**
	 * Back from OpenRent with a code: trades it for tokens, reads the shop and adds this site to its widget sites.
	 *
	 * @param string $code  The code.
	 * @param string $state The state sent along.
	 * @return true|WP_Error
	 */
	public static function finish( $code, $state ) {
		$key  = 'openrent_oauth_' . get_current_user_id();
		$sent = get_transient( $key );
		delete_transient( $key );
		if ( ! is_array( $sent ) || ! hash_equals( $sent['state'], (string) $state ) ) {
			return new WP_Error( 'openrent_state', __( 'This sign-in was not started here, or took too long. Try again.', 'openrent' ) );
		}
		$s      = OpenRent_Settings::get();
		$tokens = OpenRent_Client::oauth(
			'/oauth/token',
			array(
				'grant_type'    => 'authorization_code',
				'code'          => (string) $code,
				'code_verifier' => $sent['verifier'],
				'redirect_uri'  => self::callback_url(),
				'client_id'     => $s['client_id'],
			)
		);
		if ( is_wp_error( $tokens ) ) {
			return $tokens;
		}
		OpenRent_Settings::update( array( 'mode' => 'oauth' ) );
		OpenRent_Client::store_tokens( $tokens );
		$shop = OpenRent_Client::request( 'GET', '/api/v1/tenant' );
		if ( is_wp_error( $shop ) ) {
			return $shop;
		}
		OpenRent_Settings::update(
			array(
				'shop_name'      => (string) $shop['name'],
				'shop_slug'      => (string) $shop['slug'],
				'storefront_url' => (string) ( $shop['storefront_url'] ?? '' ),
			)
		);
		return self::allow_site();
	}

	/**
	 * Adds this site to the shop's widget sites, so customers who pay online come back here.
	 *
	 * @return true|WP_Error
	 */
	public static function allow_site() {
		$parts  = wp_parse_url( home_url() );
		$origin = $parts['scheme'] . '://' . $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
		$set    = OpenRent_Client::request( 'GET', '/api/v1/tenant/settings' );
		if ( is_wp_error( $set ) ) {
			return $set;
		}
		$origins = is_array( $set['widget_origins'] ?? null ) ? $set['widget_origins'] : array();
		if ( in_array( $origin, $origins, true ) ) {
			return true;
		}
		$origins[] = $origin;
		$done      = OpenRent_Client::request( 'PATCH', '/api/v1/tenant/settings', array( 'widget_origins' => $origins ) );
		return is_wp_error( $done ) ? $done : true;
	}

	/**
	 * Uses a publishable key instead (no sign-in): the key names the shop.
	 *
	 * @param string $api_url        The OpenRent address.
	 * @param string $key            The publishable key, pk_….
	 * @param string $storefront_url The storefront's address, for book buttons.
	 * @return true|WP_Error
	 */
	public static function use_key( $api_url, $key, $storefront_url ) {
		$url = OpenRent_Settings::clean_url( $api_url );
		if ( null === $url ) {
			return new WP_Error( 'openrent_bad_url', __( 'Enter the OpenRent address, starting with https://.', 'openrent' ) );
		}
		$key = trim( (string) $key );
		if ( ! preg_match( '/^pk_(live|test)_[A-Za-z0-9_-]{16,}$/', $key ) ) {
			return new WP_Error( 'openrent_bad_key', __( 'A publishable key starts with pk_. Find it in OpenRent under Settings → API keys.', 'openrent' ) );
		}
		OpenRent_Settings::update( array( 'api_url' => $url, 'mode' => 'key', 'publishable' => $key ) );
		$shop = OpenRent_Client::request( 'GET', '/api/v1/storefront/settings' );
		if ( is_wp_error( $shop ) ) {
			OpenRent_Settings::update( array( 'mode' => '', 'publishable' => '' ) );
			return $shop;
		}
		$storefront = '' !== trim( (string) $storefront_url ) ? OpenRent_Settings::clean_url( $storefront_url ) : '';
		OpenRent_Settings::update(
			array(
				'shop_name'      => (string) ( $shop['tenant']['name'] ?? '' ),
				'shop_slug'      => (string) ( $shop['tenant']['slug'] ?? '' ),
				'storefront_url' => (string) $storefront,
			)
		);
		return true;
	}

	/**
	 * Disconnects: OpenRent forgets the site's tokens, and so does the site.
	 */
	public static function disconnect() {
		$s = OpenRent_Settings::get();
		if ( 'oauth' === $s['mode'] && '' !== $s['refresh_token'] ) {
			OpenRent_Client::oauth( '/oauth/revoke', array( 'token' => $s['refresh_token'], 'client_id' => $s['client_id'] ) );
		}
		OpenRent_Settings::disconnect();
	}
}
