<?php
/**
 * The booking widget on the site: shortcodes and blocks for a product, a category and a book button. They
 * write OpenRent's widget elements; the widget script, from OpenRent, does the rest.
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shortcodes and blocks.
 */
class OpenRent_Embeds {

	/**
	 * Registers the widget script, the shortcodes and the blocks.
	 */
	public static function register() {
		$s = OpenRent_Settings::get();
		if ( '' !== $s['api_url'] ) {
			wp_register_script( 'openrent-widget', $s['api_url'] . '/widget/openrent-widget.js', array(), OPENRENT_VERSION, array( 'in_footer' => true ) );
		}
		add_filter( 'script_loader_tag', array( __CLASS__, 'script_tag' ), 10, 2 );

		add_shortcode( 'openrent_product', array( __CLASS__, 'product' ) );
		add_shortcode( 'openrent_category', array( __CLASS__, 'category' ) );
		add_shortcode( 'openrent_book_button', array( __CLASS__, 'book_button' ) );

		wp_register_script( 'openrent-blocks', plugins_url( 'assets/blocks.js', OPENRENT_FILE ), array( 'wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-i18n', 'wp-api-fetch' ), OPENRENT_VERSION, true );
		wp_set_script_translations( 'openrent-blocks', 'openrent', OPENRENT_DIR . 'languages' );
		$common = array( 'editor_script' => 'openrent-blocks' );
		register_block_type(
			'openrent/product',
			array_merge(
				$common,
				array(
					'attributes'      => array( 'product' => array( 'type' => 'string', 'default' => '' ) ),
					'render_callback' => fn( $a ) => self::product( $a ),
				)
			)
		);
		register_block_type(
			'openrent/category',
			array_merge(
				$common,
				array(
					'attributes'      => array(
						'category' => array( 'type' => 'string', 'default' => '' ),
						'limit'    => array( 'type' => 'number', 'default' => 12 ),
					),
					'render_callback' => fn( $a ) => self::category( $a ),
				)
			)
		);
		register_block_type(
			'openrent/book-button',
			array_merge(
				$common,
				array(
					'attributes'      => array(
						'product' => array( 'type' => 'string', 'default' => '' ),
						'label'   => array( 'type' => 'string', 'default' => '' ),
					),
					'render_callback' => fn( $a ) => self::book_button( $a ),
				)
			)
		);
	}

	/**
	 * The widget script says where OpenRent is.
	 *
	 * @param string $tag    The script tag.
	 * @param string $handle Its handle.
	 */
	public static function script_tag( $tag, $handle ) {
		if ( 'openrent-widget' !== $handle ) {
			return $tag;
		}
		$s = OpenRent_Settings::get();
		return str_replace( ' src=', ' data-openrent-api="' . esc_attr( $s['api_url'] ) . '" src=', $tag );
	}

	/**
	 * Attributes every widget element gets: the shop, OpenRent's address and the page's language.
	 *
	 * @return array<string, string>
	 */
	private static function shop_attributes() {
		$s     = OpenRent_Settings::get();
		$attrs = array(
			'api'        => $s['api_url'],
			'storefront' => $s['storefront_url'],
			'lang'       => strtolower( substr( determine_locale(), 0, 2 ) ),
		);
		if ( 'key' === $s['mode'] ) {
			$attrs['pk'] = $s['publishable'];
		} else {
			$attrs['shop'] = $s['shop_slug'];
		}
		return $attrs;
	}

	/**
	 * Writes one widget element and loads the widget script.
	 *
	 * @param string                $tag   openrent-product, openrent-category or openrent-book-button.
	 * @param array<string, string> $attrs Its attributes.
	 */
	private static function element( $tag, array $attrs ) {
		if ( ! OpenRent_Settings::ready() ) {
			// Visitors see nothing; people who can fix it see why.
			return current_user_can( 'manage_options' ) ? '<p class="openrent-notice">' . esc_html__( 'Connect this site to OpenRent under Settings → OpenRent to show rentals here.', 'openrent' ) . '</p>' : '';
		}
		wp_enqueue_script( 'openrent-widget' );
		$html = '';
		foreach ( $attrs as $name => $value ) {
			if ( '' !== (string) $value ) {
				$html .= ' ' . $name . '="' . esc_attr( (string) $value ) . '"';
			}
		}
		return '<' . $tag . $html . '></' . $tag . '>';
	}

	/**
	 * [openrent_product product="city-bike"]
	 *
	 * @param array<string, mixed>|string $atts Shortcode or block attributes.
	 */
	public static function product( $atts ) {
		$a = shortcode_atts( array( 'product' => '' ), (array) $atts, 'openrent_product' );
		return self::element( 'openrent-product', array_merge( self::shop_attributes(), array( 'product' => sanitize_title( $a['product'] ) ) ) );
	}

	/**
	 * [openrent_category category="bikes" limit="12"]; without a category, every product.
	 *
	 * @param array<string, mixed>|string $atts Shortcode or block attributes.
	 */
	public static function category( $atts ) {
		$a     = shortcode_atts( array( 'category' => '', 'limit' => 12 ), (array) $atts, 'openrent_category' );
		$limit = max( 1, min( 48, (int) $a['limit'] ) );
		return self::element( 'openrent-category', array_merge( self::shop_attributes(), array( 'category' => sanitize_title( $a['category'] ), 'limit' => (string) $limit ) ) );
	}

	/**
	 * [openrent_book_button product="city-bike" label="Book now"]: a button to the product on the storefront.
	 *
	 * @param array<string, mixed>|string $atts Shortcode or block attributes.
	 */
	public static function book_button( $atts ) {
		$a     = shortcode_atts( array( 'product' => '', 'label' => '' ), (array) $atts, 'openrent_book_button' );
		$shop  = self::shop_attributes();
		$attrs = array(
			'storefront' => $shop['storefront'],
			'product'    => sanitize_title( $a['product'] ),
			'label'      => sanitize_text_field( $a['label'] ),
			'lang'       => $shop['lang'],
		);
		return self::element( 'openrent-book-button', $attrs );
	}
}
