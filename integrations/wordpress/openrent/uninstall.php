<?php
/**
 * Removing the plugin removes its settings, tokens included.
 *
 * @package OpenRent
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'openrent_settings' );
