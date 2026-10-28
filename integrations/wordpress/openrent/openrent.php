<?php
/**
 * Plugin Name:       OpenRent
 * Plugin URI:        https://openrent.dev/docs/guide/wordpress-and-shopify
 * Description:       Shows your OpenRent rental products and booking on your WordPress site: blocks and shortcodes for a product, a category and a book button.
 * Version:           1.0.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            OpenRent
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       openrent
 * Domain Path:       /languages
 *
 * @package OpenRent
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENRENT_VERSION', '1.0.0' );
define( 'OPENRENT_FILE', __FILE__ );
define( 'OPENRENT_DIR', plugin_dir_path( __FILE__ ) );

require_once OPENRENT_DIR . 'includes/class-openrent-settings.php';
require_once OPENRENT_DIR . 'includes/class-openrent-client.php';
require_once OPENRENT_DIR . 'includes/class-openrent-connect.php';
require_once OPENRENT_DIR . 'includes/class-openrent-embeds.php';
require_once OPENRENT_DIR . 'includes/class-openrent-rest.php';
require_once OPENRENT_DIR . 'includes/class-openrent-admin.php';

// The plugin's own translations (languages/*.l10n.php), before anything is registered.
add_action( 'init', fn() => load_plugin_textdomain( 'openrent', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' ), 0 );
add_action( 'init', array( 'OpenRent_Embeds', 'register' ) );
add_action( 'rest_api_init', array( 'OpenRent_Rest', 'register' ) );
add_action( 'admin_menu', array( 'OpenRent_Admin', 'menu' ) );
add_action( 'admin_init', array( 'OpenRent_Admin', 'handle' ) );
