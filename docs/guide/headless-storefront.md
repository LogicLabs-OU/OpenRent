# A headless storefront

The storefront OpenRent ships with uses themes. To build the shop's website yourself instead, use the storefront API through `@openrent/sdk`, or start from the starter.

## Start from the starter

```sh
npm create openrent-storefront my-shop -- --api https://rent.example.com --key pk_live_…
cd my-shop
npm install
npm run dev
```

The starter is a small SvelteKit site with the catalogue, a product page with pickup and return times, the cart, checkout and the booking confirmation. It renders on the server and works without JavaScript. Its README explains each part.

Use the shop's **publishable key** (Admin → Settings → API keys). It can only do what a shop visitor can. Never use a secret key on a website.

## The SDK

```ts
import { createStorefront } from '@openrent/sdk/storefront';

const shop = createStorefront({ baseUrl: 'https://rent.example.com', publishableKey: 'pk_live_…', locale: 'de' });

const { terms } = await shop.settings();
const { data: products } = await shop.products({ from, to });
const cart = await shop.cart.create({ starts_at: from, ends_at: to });
await shop.cart.add(cart.id, products[0].variants[0].id, 2);
const done = await shop.cart.complete(cart.id, { customer: { name, email }, terms_accepted: true, terms_hash: terms.hash });
const order = await shop.order(done.order.token, done.order.token);
```

Requests are typed from the API's OpenAPI document; answers have the same shapes themes get. A refused request throws `OpenRentError` with the status and the API's problem, whose `errors` name the fields. `shop.client` reaches every other storefront endpoint, for example coupons, optional extras or the customer account.

## Taking payment

When the shop takes payment online, `cart.complete` returns a `payment`:

- `payment_redirect`: send the customer to its `url`. Pass `return_url` (a page on your site) to come back with `openrent_token` in the query. Your site's address must be in Admin → Settings → Widget → Allowed sites.
- `payment_intent`: confirm the card payment on your page with the provider's browser library.
