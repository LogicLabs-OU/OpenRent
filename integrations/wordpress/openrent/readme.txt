=== OpenRent ===
Contributors: openrent
Tags: rental, booking, equipment rental, widget
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 1.0.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Shows your OpenRent rental products and booking on your WordPress site.

== Description ==

OpenRent is open-source rental software. This plugin puts your rental products on your WordPress pages, with live availability, prices and booking:

* **OpenRent product** block, or `[openrent_product product="city-bike"]`
* **OpenRent category** block, or `[openrent_category category="bikes" limit="12"]`
* **OpenRent book button** block, or `[openrent_book_button product="city-bike" label="Book now"]`

Customers book in a drawer on your site and pay on OpenRent's payment page, which brings them back.

== Installation ==

1. Install and activate the plugin.
2. Go to **Settings → OpenRent**, enter your OpenRent address and click **Connect to OpenRent**.
3. Sign in to OpenRent and approve the site. It adds itself to your widget sites.
4. Add the OpenRent blocks to your pages.

Without signing in, paste a publishable key instead, and add your site under **Settings → General → Booking widget** in OpenRent.

== Frequently Asked Questions ==

= What does the site get to do in OpenRent? =

Read your shop's details and catalogue, and add itself to your widget sites. Disconnect it in OpenRent under **Settings → Apps**, or here under **Settings → OpenRent**.

== Changelog ==

= 1.0.0 =
* First release: product, category and book button blocks and shortcodes; OpenRent sign-in.
