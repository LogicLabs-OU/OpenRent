# ADR 0012: Storefront pages and search engines, billing profiles, and self-service changes

Status: accepted

Release 1.1 makes the storefront findable and lets shops write their own pages. It also lets customers keep their billing details like in any web shop, and change bookings themselves when the shop allows it. This records the choices.

## Search engines and shared links

- **The storefront writes the head, not themes.** Loaders return `meta` (title, description, picture, structured data, `noindex`), and the storefront layout turns it into the title, canonical link, hreflang, Open Graph tags and JSON-LD. A theme needs no code, and every theme gets the same result.
- **One address per page.** Canonical links, hreflang and the sitemap use the shop's verified primary domain. Without one, a multi-shop installation uses `{slug}.` its storefront domain, and a single-shop installation uses `STOREFRONT_URL`. `robots.txt` closes every other host the shop answers on.
- **Private pages stay out.** Carts, checkout, order and signing links, the account and search send `noindex` in the page and in `X-Robots-Tag`, and `robots.txt` names them.
- **Prices in structured data** are the lowest price for the shortest rental (a price table's first row), marked as leasing (`LeaseOut`) with its unit, so search engines do not show a rental as a sale.
- **No product feed.** Google's Shopping rules ask that listed products can be bought on the landing page; rentals are not named and have been refused before. A feed waits until that changes.

## Pages and menus

- **A page's text belongs to the shop; its sections belong to a theme.** The title, rich text and search texts (in every language) stay when the shop changes themes. Sections are stored per theme, like the home page, because section types differ between themes. Another theme starts with none.
- **Drafts are seen only in a theme preview,** so a shop can build a page before customers see it.
- **The storefront's own sections** (locations, contact form) use the `plugin:openrent:` names. They are offered to every theme that takes plugin sections and are drawn by storefront components, so a contact form can be a real form, which cleaned plugin HTML cannot hold.
- **Contact messages are not stored.** They reach staff as a notice and by email (with the sender's address to reply to), once per sender and text. A hidden field catches bots, and a rate limit catches the rest.
- **Menus are flat lists** for the header and the footer, of categories, pages and products by id, the home page, search, or an address. Links are resolved on the server and come to themes ready to use. A link to something deleted, hidden or a draft is left out. One level is enough for rental shops, and every theme can show it without new menu components.

## Billing profiles

- **Each customer is a person.** There is no company management and no colleagues signing in. A customer keeps their own billing profiles (private, or a company with a tax number and invoice address) and delivery addresses, and picks one at checkout.
- **The order keeps a copy** of the billing details chosen (`orders.billing`). Tax (reverse charge) and documents read that copy, so a later change to a profile changes no order and no issued document. Staff can change the copy until an invoice is issued; a draft or quote is priced again.
- **The customer record stays as it was.** Its company, tax number and addresses are what staff keep about the customer, and what an order without a copy uses (orders made in the admin, older orders). Checkout fills them only where they are empty. Profiles start empty: copying the record into a profile would bring back a profile the customer deleted, and the record already serves orders without a copy.
- **Saved profiles are checked strictly** (a company needs its name and an address; a VAT number the register calls invalid is refused). Details typed by a guest are checked as before: only the VAT number, since themes do not ask for every address field.

## Locations and delivery

- **The visitor's location travels as one header** (`X-Storefront-Location`) from the storefront server; the API uses it wherever a request names no location, so catalogue, availability, quotes and carts follow it without changes to each call.
- **The existing delivery fee stays the choice between pickup and delivery.** Delivery times are per location and weekday; at checkout they are storefront values beside the theme's own fields (`delivery.window`, `collection.window`), checked against the location's times on the pickup and return days. Themes needed one slot each, not a new cart component.

## Self-service changes

- **The shop decides.** Customers ask to cancel unless the shop lets them cancel themselves, up to a number of hours before pickup; after that, they can still ask. Date changes are off unless the shop allows asking for them or making them directly.
- **A move is a staff move done by the customer.** `rescheduleOrder` moves every booking of the order through `resizeAllocations` by the change in start and end (so delivery cover stays), checks the shop's rules for the new dates, and prices the rental again like an extension: a fee line or a credit line, an invoice or credit note when invoiced, and a refund of what was paid beyond the new total.
- **A request for other dates reuses extension requests** with `requested_starts_at`; approving one moves the booking.

## Paying a monthly invoice

- **One payment for the invoice, many payments in the books.** The customer pays what the invoice's bookings still owe in one go. When the provider confirms it, the payment is shared out over the bookings by what each owes, oldest first; the first keeps the provider's payment, the others get parts named `<ref>:part<n>`. Each part is an ordinary payment, so balances, payment status and the accounting triggers work as for any payment.
- **The provider sees one payment.** Refunds of a part go to the provider's payment it came from, and the reconciliation compares the provider's amount with the sum of the parts.
