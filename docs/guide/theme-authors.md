# Writing a storefront theme

A theme decides how the storefront looks. It never calls the API: the storefront runtime fetches the data, hands each template what it needs, and performs actions such as adding to the cart. Themes are written against `@openrent/theme-sdk`, which is Apache-2.0.

There are two kinds of theme:

- A **code theme** is a Svelte package with its own templates. The operator installs it, and the storefront is rebuilt to include it.
- A **child theme** is data on top of an installed code theme: default settings, home layout, texts, CSS and images. A shop uploads it in the admin, and it works at once.

Change colours, texts and pictures with a child theme. Write a code theme when you need different markup.

## Files of a code theme

`packages/themes/default` is the reference. It uses only the theme SDK, like any third-party theme.

```
theme.json                  manifest
index.ts                    the theme module
layouts/theme.svelte        the page frame (header, footer)
templates/*.svelte          one component per page
sections/<type>.json        home page section schemas
sections/*.svelte           their components
snippets/*.svelte           your own shared components
config/settings_schema.json settings the shop can change
config/settings_data.json   default values
config/sections_data.json   default home layout
locales/<language>.json     texts
widget/widget.css           look of the embeddable widget
assets/                     images and fonts
```

## theme.json

```json
{
  "id": "harbour",
  "name": "Harbour",
  "version": "1.0.0",
  "author": "You",
  "license": "MIT",
  "compat": "^1.8.0",
  "locales": ["en", "de"],
  "sections": ["hero", "product-grid", "faq"],
  "preview_images": ["assets/preview.jpg"],
  "extension_points": ["section.register", "checkout.extra_fields"]
}
```

- `id`: lowercase letters, digits and dashes.
- `compat`: the theme API range you support, as `^`, `~`, `>=` or an exact version.
- `locales`: the languages you ship. The first is the theme's default language.
- `sections`: your home page section types.
- `preview_images`: `.png`, `.jpg` or `.webp` files in the theme, shown in Admin → Themes.
- `extension_points` (1.8): places plugins may fill. `section.register` offers plugins' section types in the section editor. `checkout.extra_fields` shows plugins' checkout fields.
- `extends` (1.4): only in child themes; see [Child themes](#child-themes).

## The theme module

`index.ts` exports a `ThemeModule`. The default theme's, shortened:

```ts
import { themeCatalogs, type SectionInstance, type SectionSchema, type ThemeModule } from '@openrent/theme-sdk';
import manifest from './theme.json';
import settingsSchema from './config/settings_schema.json';
import settingsData from './config/settings_data.json';
import sectionsData from './config/sections_data.json';
import en from './locales/en.json';
import de from './locales/de.json';
import hero from './sections/hero.json';
import layout from './layouts/theme.svelte';
import index from './templates/index.svelte';
// … one import per template

const theme: ThemeModule = {
  manifest,
  settingsSchema: settingsSchema as ThemeModule['settingsSchema'],
  settingsData,
  layout,
  templates: { index, collection, product, cart, checkout, 'order-confirmation': orderConfirmation, page, '404': notFound },
  locales: themeCatalogs({ en, de }),
  // The file name is the section type.
  sectionSchemas: Object.entries({ hero }).map(([type, s]) => ({ ...s, type }) as SectionSchema),
  sectionsData: sectionsData as SectionInstance[],
};

export default theme;
```

## Templates and their data

Each template receives one `data` prop. The layout receives `children` (the page) and `path`.

| Template | Data type | What it holds |
| --- | --- | --- |
| `index` | `IndexData` | `products`, `sections` (the home layout, defaults filled in) |
| `collection` | `CollectionData` | `category`, `products` |
| `product` | `ProductData` | `product` with variants, prices, images, bundle, accessories |
| `cart` | `CartData` | `cart` with lines, quote and availability |
| `checkout` | `CheckoutData` | `cart` |
| `order-confirmation` | `OrderConfirmationData` | `order` (`PublicOrder`), `payment_result` |
| `page` | `PageData` | `title`, `body` (plain text) or `body_html`, and `sections` with `products` (theme API 1.9) |
| `404` | `NotFoundData` | `path` |
| `account` | `AccountData` | `account` with profile and orders |
| `account-login` | `AccountLoginData` | `state` (`form`, `sent`, `verify`), `token`, `email` |
| `search` | `SearchData` | `query`, `category`, `available`, `sort`, `products` |
| `sign` | `SignData` | The document to sign and its status |

The first eight are required. You may leave out `account`, `account-login`, `search` and `sign`; the storefront then uses the default theme's.

```svelte
<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<h1>{rt.t('404.title')}</h1>
<p>{rt.t('404.description', { path: data.path })}</p>
<a href={rt.url.home()}>{rt.t('nav.all')}</a>
```

## The runtime

`getRuntime()` returns the `Runtime`. Call it while a component initialises.

- `rt.shop`: the shop (`tenant`, `locations`, `categories`, `terms`, `settings`, `dates`, `cartCount`, `locale`, `locales`, `customer`, `features`, `displayCurrency`).
- `rt.t(key, params)`: a text in the visitor's language.
- `rt.format.money(m)`, `rt.format.date(iso)`, `rt.format.datetime(iso)`, `rt.format.time(iso)`.
- `rt.url.home()`, `category(slug)`, `product(slug)`, `cart()`, `checkout()`, `order(token)`, `page(slug)`, and the optional `account()`, `accountLogin()`, `search(params)`, `document(id, token)`, `attachment(id, token)`, `damagePhoto(id, token)`, `switchLocale(locale)`.
- `rt.zone`: wall-clock helpers in the shop's time zone (`toInstant(date, time)`, `localDate(iso)`, `localTime(iso)`, `timeOptions(date)`).
- Actions: `setDates(from, to)`, `addToCart(variantId, quantity)`, `setQuantity(variantId, quantity)`, `applyCoupon(code)`, `setOptions({ fees, postcode, address })`, `calendar(variantId, month)`, `quote(lines, from, to)`, `checkout(input)`, `payOrder(token)`, `account.*` and `signature.*`.

Members marked optional in the type (`setOptions`, `payOrder`, `account`, `signature`, `asset` and some URLs) came in later theme API versions. Check before you call them: `await rt.setOptions?.({ fees })`.

```ts
async function add() {
  if (from && to) await rt.setDates(from, to);
  await rt.addToCart(variantId, qty);
  toast.success(rt.t('product.added'));
}
```

Actions throw `RuntimeError` with `status`, `code` and `fields`. On a `422`, `fields` maps a field path such as `customer.email` to its message, so you can show it next to the input:

```ts
try {
  const r = await rt.checkout({ customer: { name, email }, terms_accepted: terms, notes });
  const returnUrl = new URL(rt.url.order(r.order.token), location.href).href;
  if (r.payment?.client_secret && r.payment.public_config.publishable_key) {
    payment = { clientSecret: r.payment.client_secret, publishableKey: r.payment.public_config.publishable_key, returnUrl };
  } else location.href = returnUrl;
} catch (err) {
  if (err instanceof RuntimeError && err.status === 422) errors = err.fields;
  else toast.error((err as Error).message);
}
```

## Components: Payment and Slot

`rt.components.Payment` shows the payment provider's own card fields:

```svelte
<rt.components.Payment clientSecret={payment.clientSecret} publishableKey={payment.publishableKey} returnUrl={payment.returnUrl} onerror={(m) => (paymentError = m)} />
```

`rt.components.Slot` is where the storefront and plugins add their parts. Place these slots so that features keep working in your theme:

| Slot | Where | What appears |
| --- | --- | --- |
| `header.after` | Below the header | The shop's own header HTML, the currency menu |
| `footer.before` | Above the footer | The shop's own footer HTML |
| `dates.after` | After the date form (theme API 1.9) | The location picker, when the shop has several |
| `product.before_add` | Above the add button, `context={{ product }}` | Plugin badges, bundle picker, accessories, tax hint, other locations that have it free, the price per meter unit (theme API 1.10) |
| `checkout.extra_fields` | In the checkout form | Plugin checkout fields, business customer options, saved billing details, pickup place or delivery times |
| `section.plugin` | Home page and pages, `context={{ section }}` | A plugin's section, the storefront's locations and contact form |
| `account.extra` | Customer account | What is left to pay, invoices, changing bookings, booking again, billing details and addresses, business account terms, insurance documents |
| `order.actions` | Order page, `context={{ order }}` (theme API 1.9) | Calendar links |

## Settings

`config/settings_schema.json` is a list of groups. Each group has a `name` and `settings`:

```json
[{ "name": "Style", "settings": [
  { "id": "accent", "type": "color", "label": "Accent colour", "info": "Defaults to the shop brand colour" },
  { "id": "radius", "type": "range", "label": "Corner radius", "min": 0, "max": 20, "step": 2, "default": 10 }
] }]
```

Types are `color`, `font`, `image`, `text`, `textarea`, `select`, `range`, `checkbox`, `link`, `product` and `collection`. A `select` needs `options`. Ids must be unique. `config/settings_data.json` overrides the defaults, and the shop's own values override both. Read the result in `rt.shop.settings`. Shops translate `text`, `textarea` and `link` values per language; the runtime gives you the visitor's.

## Sections

A section is one block of the home page that the shop adds, moves and edits in Admin → Themes → Sections. Each type has `sections/<type>.json`:

```json
{
  "name": "Questions and answers",
  "settings": [{ "id": "heading", "type": "text", "label": "Heading", "default": "Questions" }],
  "blocks": [{ "type": "item", "name": "Question", "settings": [
    { "id": "question", "type": "text", "label": "Question" },
    { "id": "answer", "type": "textarea", "label": "Answer" }
  ] }],
  "max_blocks": 20
}
```

The component receives a `SectionInstance` (`id`, `type`, `settings`, `blocks`). Settings use the same types as theme settings. `config/sections_data.json` is the layout a new shop starts with, for example `[{ "id": "hero", "type": "hero", "settings": {}, "blocks": [] }]`. A layout holds at most 30 sections.

Your `index` template maps types to components. With `section.register` in `extension_points`, render plugin sections through the slot. The storefront's own **Locations and opening hours** and **Contact form** sections (`plugin:openrent:locations`, `plugin:openrent:contact`) come through the same slot, so every theme that takes plugin sections offers them.

Since theme API 1.9 the shop's own pages have sections too. Keep the loop in a snippet, say `snippets/Sections.svelte` with `sections` and `products` props, and use it from both `templates/index.svelte` and `templates/page.svelte`:

```svelte
{#each data.sections ?? [] as section (section.id)}
  {@const S = SECTIONS[section.type]}
  {#if S}<S {section} products={data.products} />
  {:else if isPluginSection(section.type)}<rt.components.Slot name="section.plugin" context={{ section }} />{/if}
{/each}
```

### Pages and menus (theme API 1.9)

- **`page`:** render `data.body_html` with `{@html}` in a `rich-text` block when it is there, else `data.body` as plain text (the rental terms). Then render `data.sections`.
- **`shop.location`:** the location the visitor rents from (picked, else the default). Show its address and hours where you showed `shop.locations[0]`.
- **`shop.navigation`:** `{ header, footer }`, each a list of `{ label, href, external }`. `href` is ready to use, with the language prefix. When `header` has links, show them in place of your category menu; put `footer` links next to the rental terms. Addresses are unique within a menu, so you can key lists by `href`.

Page titles, descriptions, Open Graph tags and structured data are written by the storefront itself. Do not add `<title>` or meta tags in a theme.

## Translations

`locales/<language>.json` maps keys to texts. `locales/en.json` is required. Placeholders are `{name}`, and plurals use ICU: `"{count, plural, one {# product} other {# products}}"`. Keys starting with `_` (such as `_meta`) are ignored.

`rt.t` looks in the shop's own wording first, then the visitor's language, then the theme's default language, then English, and finally returns the key. `openrent theme check` warns about texts missing compared with English.

## The widget look

`widget/widget.css` (1.8) styles the widget that shops embed in other sites. Placeholders take the first value that is set and safe for CSS:

```css
:host {
  --primary: {{ settings.accent | branding.primary_color }};
  --primary-foreground: {{ contrast: settings.accent | branding.primary_color }};
  --radius: {{ settings.radius | 10 }}px;
}
```

`contrast:` gives black or white, whichever reads better on the colour. A declaration whose placeholder has no usable value is removed.

## Assets

Put images and fonts in `assets/` and link them with `rt.asset?.('hero.webp')` (1.4). Code theme assets get hashed URLs under `/themes/{id}/assets/`, cached for a year.

## Rules for theme code

A theme may import `svelte`, `@openrent/theme-sdk`, `@openrent/ui`, `@lucide/svelte`, `svelte-sonner`, `bits-ui`, `@internationalized/date` and its own files. It must not import Node, server or SvelteKit modules, and must not call `fetch`, `XMLHttpRequest` or `WebSocket`. Use the runtime for everything that needs the network.

## Child themes

```sh
npx create-openrent-theme harbour-blue --extends default --name "Harbour blue"
```

A child theme's `theme.json` names its parent in `extends`. It may contain only:

- `theme.json` and `theme.css` (loaded after the parent's styles, at most 200 KB)
- `config/settings_data.json` (defaults for the parent's settings) and `config/sections_data.json`
- `locales/<language>.json` (texts that replace the parent's)
- `assets/` images, fonts and CSS (at most 3 MB each), plus `README.md` and `LICENSE`

It cannot add templates, settings or section types: it uses the parent's. In `theme.css`, `url(assets/grain.svg)` is rewritten to the uploaded file. `openrent theme pack` makes the ZIP (at most 15 MB). The shop uploads it in Admin → Themes → Upload theme. Before confirming, the owner sees which files change and which saved settings would be dropped.

## Checking, packaging and installing

```sh
openrent theme check ./harbour   # manifest, templates, imports, settings, sections, texts
openrent theme pack ./harbour    # check, then write harbour-1.0.0.zip
openrent theme install harbour-1.0.0.zip
```

`theme install` puts a code theme into `THEMES_DIR`; rebuild the storefront to include it. A theme in the repository can instead be listed as a package in `themes.json`. In this repository, `pnpm check:themes` runs `openrent theme check` on every bundled theme, and CI runs it too. Add your theme there when you add it to `packages/themes`.

## Theme API versions

The storefront provides theme API `1.9.0` (`THEME_API_VERSION`). A theme whose `compat` does not include it is refused with a message. Ask for the lowest version that has what you use:

| Version | Added |
| --- | --- |
| 1.1 | `payOrder`, `payment_result` |
| 1.2 | `url_sm` card images, `amount_due` |
| 1.3 | Sections, customer accounts, search, several languages, optional templates |
| 1.4 | Child themes, `rt.asset`, `description_html`, shown custom fields, badges, attachments |
| 1.5 | `setOptions` and optional fees, extension requests |
| 1.6 | `signature` and the `sign` template |
| 1.7 | Bundle slots, accessories, related products |
| 1.8 | `extension_points`, `widget/widget.css`, display currencies, fees priced by distance |
| 1.9 | Page sections and `body_html`, `shop.navigation`, `shop.location` and `setLocation`, slots `dates.after` and `order.actions`, `seo` on products and categories, `price.from`, `elsewhere` on variants, location contact details, delivery times and closed days |
| 1.10 | `meter` on products: the price per meter unit charged at return, shown by the `product.before_add` slot |
