# WordPress and Shopify

Show your rental products and booking on a WordPress site or in a Shopify shop. Both use the [booking widget](themes-and-storefront.md#the-booking-widget): customers see live prices and availability, book in a drawer on the page and pay on OpenRent's payment page, which brings them back.

Both connect with OpenRent sign-in: you approve the site or shop once, for your shop, and can disconnect it under **Settings → Apps**. See the [API guide](api.md#oauth-for-apps) for how that works.

## WordPress

The plugin needs WordPress 6.5 or newer and PHP 8.1 or newer.

### Install and connect

1. Install the plugin: **Plugins → Add New → Upload Plugin**, and choose `openrent.zip`. Activate it.
2. Go to **Settings → OpenRent**.
3. Enter your **OpenRent address**, such as `https://rent.example.com`, and click **Connect to OpenRent**.
4. Sign in to OpenRent if you are not signed in. Check what the site asks for and click **Connect**.
5. You are back in WordPress, which says which shop it is connected to.

The site may read your shop's details and catalogue, and adds itself to your **Widget sites**, so customers who pay online come back to it. Only owners and admins can approve it.

Your site must use `https` for OpenRent sign-in (or run on `localhost` while you try it out). Otherwise, use a publishable key: under **Or use a publishable key**, enter the address, a publishable key from **Settings → API keys**, and your storefront's address, and click **Save**. Then add your site under **Settings → General → Booking widget** in OpenRent yourself.

### Add rentals to a page

In the block editor, add one of the OpenRent blocks:

- **OpenRent product**: one product, with its prices and booking. Choose the product.
- **OpenRent category**: the products of a category, or all of them, and how many.
- **OpenRent book button**: a button to a product, or to your storefront. Choose the product and, if you like, the button's text.

The editor shows a placeholder; the page shows the widget.

With the classic editor or in widgets, use the shortcodes:

```
[openrent_product product="city-bike"]
[openrent_category category="bikes" limit="12"]
[openrent_book_button product="city-bike" label="Book now"]
```

`product` and `category` are the last part of the address on your storefront, after `/p/` and `/c/`. The widget speaks the language of the WordPress page when your shop offers it.

### Disconnect

**Settings → OpenRent → Disconnect** ends the site's access in OpenRent too. Removing the plugin deletes its settings.

## Shopify

### Set up the app

The Shopify app is a small server and a theme app extension, in `integrations/shopify`. Whoever runs your OpenRent sets it up once; then any Shopify shop can install it.

1. In the [Shopify Partner Dashboard](https://partners.shopify.com), create an app. Put its client ID in `shopify.app.toml`, and the address your server will have in `application_url`, `redirect_urls` and the webhook addresses.
2. Run the server with `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and `APP_URL` (its https address): `node server/main.ts`. It keeps each shop's tokens in `DATA_DIR` (default `./data`): keep that folder private.
3. Deploy the theme app extension: `shopify app deploy` in `integrations/shopify`.

### Connect a shop

1. Install the app in the shop and open it from the Shopify admin.
2. Enter your **OpenRent address** and click **Connect to OpenRent**.
3. Approve the shop in OpenRent. You are back in Shopify, which says which OpenRent shop it is connected to.

The app adds the shop's storefront addresses (its `myshopify.com` address and its own domain) to your **Widget sites**.

### Add rentals to the theme

In the theme editor, add a block from **Apps**:

- **OpenRent product**: enter the product's address part (after `/p/` on your storefront).
- **OpenRent category**: the category's address part (after `/c/`), or nothing for all products, and how many to show.
- **OpenRent book button**: a product, or nothing for your storefront, and the button's text.

Until the shop is connected, visitors see nothing in these blocks, and the theme editor says what to do.

### Disconnect and remove

**Disconnect** on the app's page ends its access in OpenRent and removes its settings from the theme blocks. Uninstalling the app does the same, and the app forgets the shop. The app keeps no customer data, so Shopify's privacy requests have nothing to find or delete.
