<?php
/**
 * The plugin's stored settings: where OpenRent is, how this site signs in to it, and the shop.
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

/**
 * Settings in one option (not autoloaded: it holds tokens).
 */
class OpenRent_Settings {

	const OPTION = 'openrent_settings';

	/**
	 * Every setting with its default.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults() {
		return array(
			// The OpenRent address (its API), such as https://rent.example.com.
			'api_url'        => '',
			// "oauth" (connected with OpenRent sign-in) or "key" (a publishable key pasted in).
			'mode'           => '',
			'publishable'    => '',
			'storefront_url' => '',
			'shop_name'      => '',
			'shop_slug'      => '',
			'client_id'      => '',
			'access_token'   => '',
			'refresh_token'  => '',
			'expires_at'     => 0,
		);
	}

	/**
	 * The settings as stored, with defaults for anything missing.
	 *
	 * @return array<string, mixed>
	 */
	public static function get() {
		$stored = get_option( self::OPTION, array() );
		return array_merge( self::defaults(), is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Changes some settings.
	 *
	 * @param array<string, mixed> $changes What changes.
	 */
	public static function update( array $changes ) {
		$next = array_merge( self::get(), array_intersect_key( $changes, self::defaults() ) );
		update_option( self::OPTION, $next, false );
		return $next;
	}

	/**
	 * Forgets the connection; the address stays, to connect again.
	 */
	public static function disconnect() {
		$keep = array( 'api_url' => self::get()['api_url'] );
		update_option( self::OPTION, array_merge( self::defaults(), $keep ), false );
	}

	/**
	 * Whether embeds have what they need: an OpenRent address and a shop.
	 */
	public static function ready() {
		$s = self::get();
		return '' !== $s['api_url'] && ( ( 'oauth' === $s['mode'] && '' !== $s['shop_slug'] ) || ( 'key' === $s['mode'] && '' !== $s['publishable'] ) );
	}

	/**
	 * An OpenRent address as typed: https (http only on this machine), without a trailing slash.
	 *
	 * @param string $url What was typed.
	 * @return string|null The address, or null when it cannot be one.
	 */
	public static function clean_url( $url ) {
		$url   = esc_url_raw( trim( (string) $url ), array( 'https', 'http' ) );
		$parts = wp_parse_url( $url );
		if ( empty( $parts['host'] ) ) {
			return null;
		}
		$local = in_array( $parts['host'], array( 'localhost', '127.0.0.1' ), true );
		if ( 'https' !== $parts['scheme'] && ! $local ) {
			return null;
		}
		return untrailingslashit( $url );
	}
}
