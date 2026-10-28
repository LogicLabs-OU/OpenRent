# Settings and your team

**Settings** holds your business details, payments, email, documents and team. Each part is a tab at the top. Some fields are saved as soon as you change them; cards with a **Save** button are saved when you click it.

## General

### Shop details

The **Business** card holds the **Shop name**, the **Legal name (on documents)**, the address, your **Tax ID**, your **Brand colour** and the **Logo URL**, the web address of your logo image. Click **Save** when you are done.

The line under the title shows your currency, time zone and shop address. They are set when the shop is created and cannot be changed here.

### Invoice details

**Invoice details** holds your **Registry code**, **IBAN** and **BIC**. Invoices print them under your address and with the due date, and e-invoices need them (see [E-invoices](customers.md#e-invoices)). An IBAN is checked when you save it.

### Languages

Under **Languages**, turn on each of the **Storefront languages** your customers may choose, pick the **Default language** and click **Save**. New visitors whose browser prefers none of your languages see the default. Your base texts are written in it, and emails to staff use it. With more than one language, you can translate product names, categories, rental terms, emails, documents and storefront texts for each one.

### Prices and currencies

**Prices and currencies** sets how the storefront shows prices. Bookings are always charged in your own currency. Click **Save** after a change.

- **Show prices with tax:** turn it off to show prices without tax.
- **Tax display per language:** choose **With tax** or **Without tax** for one language, or keep **As above**.
- **Also show prices in:** the other currencies customers can switch to.
- **Exchange rates:** **Typed in here**, or a rates plugin such as the European Central Bank plugin. With a plugin the rates are **Updated each morning**, and **Update rates now** fetches them at once.

### Plan and usage

On managed hosting, **Plan and usage** shows what your shop uses this month against its plan: **Orders this month**, **Files (MB)** and **Plugins turned on**. The card is hidden when your plan has no limits.

### Data export

**Export all data** builds a ZIP file with every table as CSV and JSON, all issued documents and uploaded files. Passwords and keys are left out. Click **Start export**, wait while it shows **Exporting…**, then click **Download**. You need permission to change shop settings to see this card.

## Payments

### Payment providers

**Settings → Payments** has a card for each payment plugin: Stripe, Mollie and PayPal.

1. Fill in the keys and click **Save keys**. A saved secret shows **Set; type to replace**.
2. Copy the **Webhook URL** and give it to the provider.
3. Click **Enable**.

The badge shows **Not set up**, **Off** or **On**, with test or live mode. If several providers are on, checkout uses the first one; turn the others off to choose another.

### Storefront checkout

- **Payment at checkout:** **Pay at pickup (no online payment)** or **Pay online with Stripe**. The second uses the provider that is on, whichever it is.
- **Deposit policy:** **Sum of product deposits** or **No deposits**.
- **Authorise card deposits this many days before pickup:** card holds last about 7 days, so they are placed close to pickup.
- **When a card hold is about to expire:** **Tell staff**, **Place a fresh hold**, or **Charge it (refunded on return)**.
- **Cart reminders:** see the [business customers guide](business-customers.md#cart-reminders).

### Payment terms

Under **Payment terms**, choose what customers pay when they book online with **Pay at booking**:

- **The full amount**;
- **A percentage (down payment)**, with the **Down payment (%)**;
- **A fixed amount (down payment)**, with the **Down payment** amount.

With a down payment, set **Request the balance this many days before pickup**. The customer then gets an email with a payment link.

### Payment check

Each night OpenRent compares recent online payments with the payment provider. **Payment check** lists the differences, such as **Amount differs** or **Unknown to the provider**. Open the order, put it right, and click **Mark as handled**.

## Email

### Sending email

- **Email provider:** with more than one email plugin, choose which one sends your email under **Send email with**. **Automatic (first one that is set up)** is the default.
- **Email server:** fill in your **SMTP server**, **Port**, **Security**, **Username**, **Password**, **From address** and **Reply-to address**, then **Save**. Use STARTTLS for ports 25, 587 and 2525, and TLS for port 465. Messages that were waiting are sent with the new settings.
Type an address next to **Send test** to check it. If the card says it uses the server's default email settings, your installation sends for you. Fill in your own server to send from your own domain.

### Delivery

**Delivery** lists the emails of the last 30 days and what happened to each. Filter by status, open a message, **Send again**, or retry the ones that failed.

### Messages

**Messages** lists every email OpenRent sends, such as **Booking confirmed** or **Pickup reminder**. With several languages, pick the language at the top right; each language has its own subject and text.

1. Click **Edit** next to a message.
2. Change the **Subject** and the **Body (HTML)**. Variables such as `{{order.number}}`, `{{customer.name}}` and `{{money totals.total}}` are filled in for each order.
3. Check the **Preview** on the right. It uses your latest order. Click **Refresh** after a change.
4. Turn off **Send this message** if you do not want it sent at all.
5. Click **Send test** to get a copy, then **Save**. The list marks changed messages **Customised** and turned-off ones **Off**.

### Text messages

When an SMS or WhatsApp plugin is set up, **Text messages** appears. Choose a plugin under **Send SMS with** and **Send WhatsApp messages with**, or **Do not send**. Customers get texts only when they asked for them. WhatsApp is used when a customer wants both. Use **Test number** and **Send test** to check.

Each message has a **Text message (SMS and WhatsApp)** field of up to 640 characters. Leave it empty to send no text for that message. **Use the standard text** brings back the original.

### Staff notifications

**Staff notifications go to** is the address for new online bookings, failed payments and overdue returns. Empty sends them to owners and admins.

## Policies

- **Rental terms:** customers accept this exact text at checkout. Each save makes a new version. With several languages, there is a tab for each.
- **Quote valid for (hours)**, **Late grace (minutes)** and **Charge late returns**.
- **Cancellations and changes by customers:**
  - **Refund on cancellation** is a list of steps: cancelling at least so many hours before pickup refunds that share of the rental. The first step that fits applies.
  - **Cancelling a booking:** customers ask and staff decide (the default), or customers cancel themselves up to so many hours before pickup. Later, they can still ask.
  - **Moving a booking to other dates:** not in the account (the default), customers ask, or customers move it themselves up to so many hours before pickup. A move is priced again: a dearer one leaves a balance to pay in the account, a cheaper one refunds what was paid beyond the new total.
  - Staff get a notice for each cancellation, move or request; turn the kinds on or off in your notification settings.
- **Damage waiver:** the **Excess with a waiver** and **Require a damage waiver or insurance before pickup**. The waiver itself is a fee under **Pricing → Fees**.

## Documents

### Templates

**Document templates** lists the quotes, invoices, rental agreements and other documents your shop issues, for each language.

1. Click **Edit** on a document.
2. Change the **Template** (Handlebars) and the **Extra CSS**. **Available data** lists what you can use.
3. Type an order number under **Preview with order**, or leave it empty for the latest order. The preview updates as you type.
4. Click **Save**.

A changed template shows **Customised**. **Use built-in** removes your changes. Documents already issued never change.

### Numbering

Invoices, credit notes and receipts get numbers without gaps, starting again each year: `INV-2026-00001`, `CN-2026-00001`, `RC-2026-00001`. Other documents take the order number, such as `Q-1042` for a quote; a second one for the same order becomes `Q-1042-2`.

## Calendar

**Calendar** makes private links that show pickups and returns in Google Calendar, Apple Calendar or Outlook.

1. Click **New calendar feed**, give it a **Name**, and choose a **Location** or **All locations**.
2. Copy the **Feed link** now. It is not shown again.
3. In your calendar app, add it as a subscription ("From URL").

Anyone with the link sees customer names and bookings. **Revoke** a link you no longer trust; it stops working at once. A single unit also has a calendar link on its own page.

## Wording

**Wording** changes any built-in text of the storefront, your themes and plugins, emails and documents, in each language.

1. Choose **Texts of** and the language.
2. Find a text with **Search texts**, or tick **Changed only**.
3. Type **Your wording** next to the **Original**.

Leave a text empty to use the original. Placeholders such as `{number}` must stay in the text.

## Other tabs

- **Booking widget** (on **General**): see the [themes and storefront guide](themes-and-storefront.md#the-booking-widget).
- **Locations:** where customers pick up and return, with opening hours and **Closed days**. Pickups and returns cannot fall on a closed day, but a rental can span one. **Delivery times** lists, per weekday, the times customers choose for a delivery and its collection at checkout, like `08:00-12:00, 13:00-17:00`. Without any, there is no choice and the delivery is planned two hours before pickup.
- **Domains:** see the [themes and storefront guide](themes-and-storefront.md#your-own-domain).
- **Custom fields:** extra fields on products, units, customers and orders.
- **Move to OpenRent:** see [Moving to OpenRent](moving-to-openrent.md).
- **Webhooks:** see [Plugins and integrations](plugins-and-integrations.md#webhooks).
- **Apps:** the apps connected to your shop with OpenRent sign-in (OAuth), such as a WordPress site or a Shopify shop, with what each may do, who connected it and when it last called. **Disconnect** stops an app at once. See the [API guide](api.md#oauth-for-apps).
- **Data access:** database logins for BI tools; see [Reports](reports.md#read-your-data-in-a-bi-tool).
- **RFID readers:** see [Scanning](scanning.md#rfid).

Delivery fees are set under **Pricing → Fees**; see [Delivery fees by distance](delivery-fees.md).

## Your team

### Add a member

On **Settings → Team**, fill in the **Email**, the **Name**, an **Initial password** if you like, and the **Role**. Click **Add member**.

No email is sent by itself. A member without a password signs in with an emailed link: open the **…** menu next to them and choose **Email a sign-in link**. The link is valid for three days. After signing in, they set a password under **Settings → Security**.

### Roles

| Role | Can |
|---|---|
| **Owner** | Everything, including changing owners and roles. |
| **Admin** | Everything except changing owners and roles. |
| **Staff** | See everything; change products, stock, prices, customers, orders, documents, payments, deliveries and saved reports. |
| **Warehouse** | Stock, pickups and returns, and deliveries; see products, orders and customers. |
| **Read-only** | See everything, change nothing. |

Change a member's role with the list next to their name. A shop always keeps at least one owner.

### Custom roles

Only owners make roles. Under **Roles**, click **New role**, give it a **Name** and a **Description**, and tick its **Permissions**. Members with the role get exactly these permissions from their next click on. A built-in role cannot be changed. Only a role nobody has can be removed.

### Reset a password

In the **…** menu, choose **Reset password**. The current password stops working, the member is signed out everywhere and gets a sign-in link to set a new one. If the member also works for another shop on the same installation, only their sessions in your shop end.

### Turn off a member

**Turn off access** keeps the member on the list, shows **No access** and ends their sessions in this shop at once. **Turn on access** lets them back in. **Remove** takes them off the team. You cannot turn off yourself, and only owners can turn off, reset or remove an owner.

## Single sign-on

On **Settings → Single sign-on**, staff can sign in with your company's identity provider over OpenID Connect, such as Google Workspace, Microsoft Entra or Okta.

1. Click **Add provider**.
2. Fill in the **Button name**, the **Issuer URL**, the **Client ID** and the **Client secret** (leave it empty for providers that use PKCE without a secret).
3. Under **Email domains**, list the domains that may sign in this way, such as `example.com`.
4. Choose the **Role for newcomers**. Someone signing in for the first time joins with this role. It cannot be **Owner**.
5. Click **Save**. Copy the **Redirect URI** that now appears and add it to the provider's allowed redirect URIs.

The sign-in page then shows **Sign in with** and the button name. The provider must have confirmed the person's email address.

Turn on **Only allow single sign-on for these domains** to stop passwords and emailed sign-in links for those domains. Turn off **In use** to pause a provider.

## Two-factor sign-in

Each member turns this on for their own account under **Settings → Security**.

1. Click **Set up two-factor sign-in**.
2. Add the **Secret for your authenticator app** to your app, or click **Open in authenticator**.
3. Type the 6-digit code and click **Verify**.

From then on, signing in asks for the **Authenticator code**. To turn it off, type a current code and click **Disable**.

The **Password** card on the same tab changes your own password. Your other sessions end.

## API keys

**Settings → API keys** makes keys for other software.

- **Secret** keys are for servers. A key can do at most what you can do yourself.
- **Publishable** keys only reach the storefront API, and are safe to put in a website.

Type a **Name**, choose the **Type** and click **Create**. Copy the key at once: it is shown only once. The list shows when each key was last used. **Revoke** stops a key for good.
