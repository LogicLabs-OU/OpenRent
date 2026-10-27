# Themes and the storefront

The storefront is your online shop, where customers find products, pick dates and book. Its look comes from a theme. You choose and change the theme under **Themes** in the admin.

## What customers see

### The catalogue

- The home page, built from the sections of your theme (see below).
- A page for each category, and one for each public product. Hidden products are not shown and cannot be booked online.
- **Search**, with a category filter, sorting, and **Only show what is free on my dates**.

### Dates

Customers choose a **Pickup** and a **Return**, with times, and click **Show what’s free**. Prices and availability then follow those dates. The calendar marks days that are **Closed**, **Fully booked**, **Too soon to book** or **In the past**. Pickups and returns are offered inside your opening hours (**Settings → Locations**).

### The cart

On a product, customers choose the quantity and any options, then click **Add to cart**. In the cart they can change quantities, remove items and enter a **Coupon code**. If fewer units are free than they want, the cart says **Only … available**.

### Checkout

At **Checkout** customers fill in their name, email and phone. In the default theme, the setting **Customer details at checkout** can also ask for a company, VAT number and billing address. They tick **I accept the rental terms**. OpenRent keeps the version of the terms they accepted with the booking.

What happens next depends on **Settings → Payments**:

- **Pay at pickup:** the booking is confirmed at once.
- **Pay online:** the customer pays the amount of your payment terms. While they pay, the stock is held for 30 minutes. The booking is confirmed when the payment arrives.
- **Pay on account:** signed-in business customers with account terms can book on account; see the [business customers guide](business-customers.md).

Customers you have blocked cannot book online. A VAT number that the EU register says is not valid is refused at checkout.

After booking, customers see a page with their booking, a code to show at pickup and **Add to calendar**. The link to it is in their confirmation email.

### Customer accounts

Customers sign in with **Sign in**: they enter their email and get a link that works once and expires in 15 minutes. No password is needed. In their account they see their upcoming and past bookings and documents, and can change their details, their language for emails and documents, and whether they get news and offers. From a booking they can **Request cancellation** or **Ask to extend**; you decide on each request. The booking page also shows what is left to pay and any damage charges.

## Choose and publish a theme

**Themes** shows each installed theme with its version and author. The one customers see has the badge **Live**.

1. Click **Preview** on a theme. A new tab opens your storefront with that theme, for your browser only. A bar at the top says so; click **Exit preview** to leave it.
2. Click **Customise** to change its settings first, if you like.
3. Click **Publish**, and confirm.

Customers see the new theme straight away. Each theme keeps its own settings, so you can switch back at any time.

A theme with problems shows **This theme cannot be published** and the reasons, and its **Publish** button is greyed out.

### Preview links

A preview works for one hour, and only in the browser that opened it. After that, click **Preview** again. The **Home page** tab uses the same kind of preview.

## Theme settings

Click **Customise** on a theme. The **Settings** tab groups the theme's own settings, such as colours, corner radius, images, links and texts. Each theme has different ones. The default theme, for example, has an **Accent colour**, a **Corner radius**, **Show “Powered by OpenRent”**, and the **Customer details at checkout**.

Click **Save**, or **Discard changes** to go back. Settings you leave at the theme's value keep following the theme when it is updated.

### Back up settings

On **Import and export**, **Export settings** downloads the theme's settings and texts as a file. **Import settings** loads such a file, for example from another shop. The settings in the file replace the current ones; its texts are added to yours.

## The home page

If the theme has home page sections, the **Home page** tab shows them from top to bottom, with a preview beside them.

- **Add section** adds a block, such as **Hero**, **Products**, **Category buttons**, **Image with text**, **Text** or **Questions and answers**. Plugins can add sections of their own.
- Use the buttons next to a section to move it up or down, or to remove it.
- Click a section to edit its texts, images and items. Some sections hold items, such as the questions of **Questions and answers**; add them with **Add …**.
- Click **Save**. Sections with a problem are marked in red.

The preview shows saved changes. If the theme is live, customers see them too. **Use theme default** replaces your sections with the theme's own layout.

## Locations, delivery and calendars

- **Several locations:** the storefront shows **Pick up at** next to the dates. Stock, opening hours and the cart follow the location chosen. When nothing is free at that location for the dates, the product page names the locations that have it, with a button to switch.
- **Pickup or delivery:** checkout names the location to pick up from. With a delivery fee chosen and **Delivery times** set on the location (Settings → Locations), customers choose the delivery time on the pickup day and the collection time on the return day; signed-in customers can pick a saved address.
- **Calendars:** the confirmation email carries the pickup and return as a calendar file, and the order page has **Add to calendar** and **Google Calendar**.

## Pages

Admin → **Pages** holds your own storefront pages, such as About us or Opening times. Each one is at `/pages/<address>`.

- **New page** asks for a title. The address is made from it; you can change it later, but links others saved then stop working.
- On the page, write the **Text** in each storefront language. It stays the same when you change themes. Empty fields in another language show your default language.
- **Published** makes the page visible to customers. A draft opens only in a theme preview (**Preview** at the top).
- **Sections on this page** works like the home page: sections of the live theme, shown below the text. Each theme keeps its own sections, so after switching themes, add them again for the new one. **Section texts in other languages** translates them.
- Every theme can show two sections of the storefront itself:
  - **Locations and opening hours** lists each location with its address, phone, email, opening hours and the days it is closed in the next 60 days (from the location's closed days in Settings → Locations).
  - **Contact form** sends the message to staff as a notice and by email, with the sender's address to reply to. With **Consent checkbox text**, customers must tick it to send. Messages are not stored anywhere else.

A new shop starts with two drafts, **Locations** and **Contact**, made of these sections.

### Menus

Below the pages, **Menus** sets the links in the storefront's header and footer. A link opens a category, a page, a product, the home page, search, or an address (`https://…` or a path such as `/pages/about-us`). Leave **Text** empty to use the name of what it opens; translate it per language.

An empty header menu keeps the theme's own (the categories). Footer links go next to the rental terms. A link to a draft page, a hidden product or something deleted is left out.

## Search engines and shared links

Every page tells search engines its title, description and address, and gives link previews (Open Graph) a title, text and picture. The storefront also writes structured data: the shop and its search, each location with its address and opening hours, products with their lowest price for the shortest rental, and the path to each page.

- **Search engines and shared links** on the Themes page sets the home page's title and description per language, and the picture shared when a page has none (empty uses the logo).
- Products have **Search title** and **Search description** on the product page, and per language under translations. Categories have them in the category dialog. Pages have them on the page.
- `/sitemap.xml` lists the home page, published pages, categories and public products in every language. Past 50,000 addresses it becomes an index of numbered files.
- `/robots.txt` keeps carts, checkout, order and signing links, the account and search out of search engines. Those pages also say `noindex`.
- Links use your verified primary domain, else your shop address on the platform. Any other address the shop answers on (previews, the platform's own) tells search engines to stay away, so they list one address only.

## Texts and translations

- **Texts** lists every label of the theme. Type **Your text** next to the **Theme text**, or leave it empty to keep the theme's. With several languages, choose the language at the top. Click **Save**.
- **Translations** appears when your storefront has more than one language. It holds the home page and theme texts you wrote yourself, in each language. Empty fields show the text of your default language.

Built-in texts of the storefront itself, emails and documents are changed under **Settings → Wording**. Product names and descriptions are translated on each product.

## Custom code

Below the themes, **Custom code** adds your own code to every storefront page, whatever theme is live. Click **Edit code**:

- **CSS:** loaded after the theme's styles. Up to 50,000 characters.
- **Header HTML** and **Footer HTML:** a block above and below every page. Up to 20,000 characters each. With several languages, choose the **HTML for language** to give each its own; empty uses the default.

Scripts, event handlers, inline styles and `@import` are removed when you save, so the code cannot break the checkout. Links may use `https`, `mailto` and `tel`.

## Child themes

A child theme builds on an installed theme. It brings its own colours, texts, layout and images, and the parent theme's code shows it.

1. Click **Upload theme** and choose the **Theme package (.zip)**, up to 15 MB.
2. Check what it is based on and, for an update, the **New files**, **Changed files** and **Removed files**, and any saved settings that will be dropped.
3. Click **Install** or **Update**.

A child theme shows **Based on** and its parent. You can **Remove** it when it is not live. Themes with their own code are added by whoever runs your installation. To make a child theme, see [Writing a storefront theme](theme-authors.md#child-themes).

## Your own domain

Under **Settings → Domains** you can serve the storefront at your own address.

1. Type the **Domain**, such as `rent.example.com`, and click **Add domain**.
2. At your DNS provider, publish one of the records shown. The TXT record proves the domain is yours; the CNAME also points it here.
3. Wait, or click **Check now**. OpenRent also checks every 10 minutes.

The status goes from **Waiting for DNS** to **Active**. The secure certificate is set up by itself. With several domains, **Use in emails** picks the one that links in emails use. Removing a domain stops the storefront at that address at once, and links in emails already sent stop working.

## The booking widget

The widget shows your products and booking on another website, such as your own home page.

1. Go to **Settings → General → Booking widget**.
2. List your sites under **Widget sites**, one per line, such as `https://www.example.com`. Click **Save**.
3. Copy the **Embed code** into your website.

The code shows the products of one category. Set `category` to the last part of the category's address on your storefront (after `/c/`), or leave it empty for all products. To show one product, use `<openrent-product product="…">` with the last part of the product's address (after `/p/`).

Customers book in a drawer on your site. Those who pay online go to the payment page and come back to your site, but only to the sites you listed. This keeps the checkout from being used to send people anywhere else.

## Currencies and the currency switcher

Bookings are always charged in your own currency. Under **Settings → General → Prices and currencies** you can also show prices in other currencies (see the [settings guide](settings-and-team.md#prices-and-currencies)).

Customers then get a **Prices in** switcher. Prices in another currency are marked as approximate, and checkout reminds them that they pay in your currency.

## Cookie consent and analytics

The **Analytics (GA4, Meta Pixel, Plausible)** plugin adds Google Analytics 4, the Meta Pixel or Plausible. Turn it on under **Plugins** and fill in the ids of the tools you use.

When a plugin adds such scripts, the storefront asks visitors **Cookies and scripts** with **Only necessary** and **Accept all**. The scripts load only after **Accept all**, and the choice is kept for a year. The tools get these events: a product viewed, added to the cart, checkout started, and a booking made.
