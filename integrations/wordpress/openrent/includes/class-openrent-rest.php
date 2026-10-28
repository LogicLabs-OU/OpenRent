<?php
/**
 * The block editor's pickers: the shop's products and categories, read on the server (no CORS, no key in
 * the browser) for people who may edit posts.
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

/**
 * GET /wp-json/openrent/v1/products and /categories.
 */
class OpenRent_Rest {

	/**
	 * Registers the routes.
	 */
	public static function register() {
		$can = fn() => current_user_can( 'edit_posts' );
		register_rest_route(
			'openrent/v1',
			'/products',
			array(
				'methods'             => 'GET',
				'permission_callback' => $can,
				'callback'            => array( __CLASS__, 'products' ),
			)
		);
		register_rest_route(
			'openrent/v1',
			'/categories',
			array(
				'methods'             => 'GET',
				'permission_callback' => $can,
				'callback'            => array( __CLASS__, 'categories' ),
			)
		);
	}

	/**
	 * Products as { slug, name }, by name.
	 */
	public static function products() {
		$r = OpenRent_Client::storefront( '/api/v1/storefront/catalog/products?limit=100' );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
		$out = array_map( fn( $p ) => array( 'slug' => $p['slug'], 'name' => $p['name'] ), $r['data'] ?? array() );
		usort( $out, fn( $a, $b ) => strcasecmp( $a['name'], $b['name'] ) );
		return rest_ensure_response( $out );
	}

	/**
	 * Categories as { slug, name }.
	 */
	public static function categories() {
		$r = OpenRent_Client::storefront( '/api/v1/storefront/settings' );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
		return rest_ensure_response( array_map( fn( $c ) => array( 'slug' => $c['slug'], 'name' => $c['name'] ), $r['categories'] ?? array() ) );
	}
}
