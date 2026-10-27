# OpenRent headless storefront

A small SvelteKit shop on the OpenRent storefront API: the catalogue, a product page with a rental period, the cart and checkout, and the booking confirmation. Pages are rendered on the server and work without JavaScript. Change anything you like.

## Run it

```sh
cp .env.example .env   # create-openrent-storefront has already written one
npm install
npm run dev
```

`.env` names your installation and shop:

- `OPENRENT_API_URL`: the OpenRent installation, e.g. `https://rent.example.com`.
- `OPENRENT_PUBLISHABLE_KEY`: the shop's publishable key (Admin → Settings → API keys), or
- `OPENRENT_TENANT_SLUG`: the shop's slug, when the installation serves shops by slug.

Never put a secret key (`sk_…`) here: the publishable key can only do what a shop visitor can.

## Where things are

- `src/lib/server/openrent.ts`: the API client (`@openrent/sdk/storefront`) and the cart and period cookies.
- `src/lib/text.ts`: the starter's own texts in the shop's languages. Product names, prices and messages from the server come translated already.
- `src/lib/dates.ts`: pickup and return times are picked in the shop's time zone.
- `src/routes/`: one folder per page.
- `src/lib/Head.svelte`: each page's title, description, canonical link and share tags. The home page uses the search engine texts from Admin → Settings → Storefront, product pages the product's own. `/sitemap.xml` and `/robots.txt` are built from the API's sitemap (`sitemap()`).

## Online payment

When the shop takes payment online, checkout sends the customer to the payment page and back to `/order`. Add your site's address (for example `https://shop.example.com`) to Admin → Settings → Widget → Allowed sites, or checkout refuses the return address. To take card payments on your own page instead, use the `payment` from `cart.complete` with your provider's browser library.

## Not in the starter

Optional extras (damage waiver, delivery), coupons, categories and content pages (`page(slug)`), choice bundles and accessories, the customer account and plugins' checkout fields are all in the API (`createStorefront(...).client` reaches every storefront endpoint). The API reference is at `/docs` on your installation.
