# Plugins and integrations

Plugins add payments, email, text messages, calendars and other features to your shop. Integrations are plugins that keep another system, such as a CRM, up to date with your shop. Webhooks tell any other tool what happens in your shop.

## The plugins page

**Plugins** shows a card for each plugin installed on your OpenRent installation, with its version and its state:

- **Enabled** or **Off**: the plugin works, and you choose whether it is on for your shop.
- **Failed to load**, **Incompatible** or **Disabled by the server**: the plugin cannot be used. The card shows why. Ask whoever runs your installation.

The card also lists what the plugin provides, the **Permissions** it has and any **Scheduled jobs**, such as a nightly rebuild.

Owners and admins manage plugins. On managed hosting, plugins you turn on count towards **Plugins turned on** in your plan.

### Turn a plugin on

Use the switch at the top right of its card. Use the same switch to turn it off again.

### Settings

Click **Configure** on the card, fill in the fields and click **Save**. Fields marked `*` are required. Settings apply to your shop only.

### Secret settings

Keys, passwords and tokens are secret settings. They are stored encrypted and never shown again.

- **Saved (type to replace):** your shop has its own value. Type a new one to replace it, or click **Clear** to remove it.
- **Using the server default (type to override):** your installation gives a value. Type your own to use that instead.
- Leave a secret field empty to keep what is there.

### Errors

**Recent plugin errors** lists failures of plugins, with the plugin and what went wrong. A failing plugin never stops the shop.

### Install a plugin

New plugins are usually added by whoever runs your installation. When the installation allows uploads, owners see **Install plugin**: upload a package (.zip) or give its address, click **Check package**, and read what it asks for. Click **Install**. The plugin starts working after OpenRent restarts. Install only plugins you trust: they run inside OpenRent with access to your shop's data. To write one, see [Writing a plugin](plugin-authors.md).

## The bundled plugins

| Plugin | What it does | Where you set it up |
|---|---|---|
| **Stripe payments** | Card payments at checkout, saved cards for deposit holds, and refunds. | **Settings → Payments** |
| **Mollie payments** | Customers pay on Mollie's page with the methods of your Mollie profile (iDEAL, Bancontact, cards, SEPA…). A first payment can later pay deposit holds and long-rental periods. | **Settings → Payments** |
| **PayPal payments** | Customers approve the payment in PayPal and come back to their booking. Deposits can be held on the PayPal account. | **Settings → Payments** |
| **SMTP email** | Sends your email through your own mail server. | **Settings → Email** |
| **Postmark email** | Sends your email through Postmark, with delivery and bounce reports. | **Plugins** |
| **Resend email** | Sends your email through Resend, with delivery and bounce reports. | **Plugins** |
| **Twilio SMS and WhatsApp** | Booking updates by SMS and WhatsApp. | **Plugins**, then **Settings → Email → Text messages** |
| **MessageBird SMS** | Booking updates by SMS. | **Plugins**, then **Settings → Email → Text messages** |
| **S3 file storage** | Keeps photos, documents and uploads in an S3 bucket (AWS, MinIO or similar). | **Plugins** |
| **Xero accounting**, **QuickBooks Online accounting**, **Zoho Books accounting** | Sends invoices, payments and other entries to your accounting system. | **Accounting**; see [Accounting](accounting.md) |
| **HubSpot CRM** | Customers become contacts and bookings become deals. | **Integrations** |
| **Google Calendar**, **Microsoft 365 Calendar** | Each booking's pickup and return become events on your calendar. | **Integrations** |
| **Trustpilot reviews** | Asks Trustpilot to invite customers to review your shop after a return. | **Integrations** |
| **TaxJar US sales tax** | US sales tax rates for each line, by pickup location or delivery address. | **Plugins** |
| **EU VAT numbers (VIES)** | Checks EU VAT numbers and applies the reverse charge. | **Plugins**; see [EU VAT numbers and Slack notices](vat-numbers-and-slack.md) |
| **Slack notices** | Sends staff notices to a Slack channel. | **Plugins**; see [EU VAT numbers and Slack notices](vat-numbers-and-slack.md#slack-notices) |
| **ECB exchange rates** | Daily European Central Bank rates for prices shown in other currencies. | **Plugins**, then **Settings → General → Prices and currencies** |
| **Analytics (GA4, Meta Pixel, Plausible)** | Statistics and marketing tools on the storefront, after visitor consent. | **Plugins**; see [Themes and the storefront](themes-and-storefront.md#cookie-consent-and-analytics) |
| **OpenStreetMap geocoding** | Finds addresses on the map, for delivery fees by distance. | **Plugins**; see [Delivery fees by distance](delivery-fees.md) |
| **Meilisearch search** | Fast storefront search that copes with typos, in every shop language. The catalogue is rebuilt every night. | **Plugins** |
| **Peppol e-invoices**, **Factur-X / ZUGFeRD e-invoices**, **Estonian e-invoices (e-arve)** | Invoices and credit notes as e-invoices, for customers whose billing details ask for them. | **Plugins** (your Peppol ID); see [E-invoices](customers.md#e-invoices) |
| **Documenso e-signatures**, **DocuSign e-signatures** | Documents sent for signing go to Documenso or DocuSign, and the signed PDF comes back. | **Plugins**; see [Orders](orders.md#documents-and-signatures) |
| **Stripe Identity ID checks**, **Veriff ID checks** | Customers who must show ID verify on the service's page before pickup. | **Plugins**; see [Customers](customers.md#flags) |
| **RFID reader formats** | Lets RFID readers post in the Zebra IoT Connector and Impinj Speedway Connect formats. | **Plugins**; see [Scanning](scanning.md#rfid) |
| **Memberships** | Library of Things memberships: plans with a fee each month or year, member prices and a limit on items at a time. Off until you turn it on. | **Plugins**; see [Memberships](#memberships) |

### Notes on some plugins

- **Stripe Identity** and **Veriff**: for results at once, send the service's webhooks to `https://<your OpenRent>/webhooks/identity/identity-stripe/<shop id>` (events `identity.verification_session.*`) or `…/identity-veriff/<shop id>` (decision webhook). Otherwise OpenRent asks every 15 minutes.
- **Documenso**: add a webhook in Documenso for **Document completed** and **Document rejected** with the address `https://<your OpenRent>/webhooks/sign/sign-documenso/<shop id>` and the same secret as in the plugin's settings.
- **DocuSign**: create an integration key with an RSA key pair, grant consent for it once, and enter the user it sends as. For webhooks, add a Connect configuration with HMAC for **Envelope completed** and **Envelope declined** to `https://<your OpenRent>/webhooks/sign/sign-docusign/<shop id>`.
- **Postmark** and **Resend**: with more than one email plugin set up, choose which one sends under **Settings → Email → Email provider**.
- **Twilio**: WhatsApp messages sent outside a chat need approved templates. List them under **WhatsApp templates**, such as `pickup_reminder = HX…; * = HX…`.
- **TaxJar**: under **Tax by**, `origin` uses the pickup location and `customer` the delivery address when there is one. Shops outside the US keep their own tax profiles.
- **Meilisearch**: product changes are sent as they happen. Use **Index prefix** when several installations share one server.

## Memberships

The **Memberships** plugin is for libraries of things and shops that rent to members. It is off until you turn it on under **Plugins**.

1. **Plans:** under **Plugins → Membership plans**, add a plan with its fee before tax, **Month** or **Year**, the member discount (100 % means members borrow for free) and how many items a member may have at once. **Show in the shop's plan list** lists it in the **Membership plans** section you can add to a page.
2. **Members:** on a customer's page, **Membership → Add** and choose the plan. The customer gets the first fee as an invoice by email, with a link to pay it when you take payments online. The membership starts when the fee is paid, online or at the counter under **Invoices without a booking**.
3. **Renewals:** three days before a period ends, the next fee is invoiced and charged to the card the customer saved; without one, the customer gets a payment link. Paid time continues from the end of the last period.
4. **Unpaid fees:** member prices pause when a fee is still unpaid a number of days after the period ended (**Days a fee may stay unpaid**, 7 by default). They come back when it is paid.
5. **Cancel:** the membership ends when its paid time ends. An unpaid one ends at once and its invoice is voided.

Members get the plan's discount on every rental, explained on the quote as **Member price**. A booking that would take a member over the plan's items at a time is refused, at the counter and at checkout. Members see their membership in their storefront account.

## Integrations

**Integrations** connects OpenRent to the other software your shop uses. Records are sent over as they happen. Owners and admins see this page.

### Connect

1. On **Plugins**, turn on the plugin and, where it asks, enter the app's **Client ID** and **Client secret**. The **Integrations** page shows the **Redirect URL for the app at the provider** to enter in the other system (your OpenRent address followed by `/api/v1/integrations/oauth/callback`).
2. On **Integrations**, click **Connect** on the card.
3. Sign in to the other system and allow access, or fill in the keys it asks for.

The card then shows **Connected**, the account, and when something was last sent. **Needs attention** means the last attempt failed; the reason is on the card.

### Manage a connection

Click **Manage** on a connected card:

- **Settings:** the integration's own choices. Click **Save**.
- **Send earlier records:** choose a date under **Since** and send what happened before you connected.
- **Sync log:** each record sent, with its status: **Waiting**, **Running**, **Sent**, **Skipped** or **Failed**. Click **Retry** on a failed one.
- **Disconnect:** nothing more is sent. What was already sent stays there.

### HubSpot

Create an app at developers.hubspot.com and enter its client ID and secret on the **HubSpot CRM** plugin. Once connected:

- each customer becomes a contact, found again by email if it already exists;
- each booking becomes a deal with its amount, dates and items, and moves stage with the booking.

Under **Settings** you can set the **Deal pipeline**, the **Stage for quotes**, the **Stage for confirmed bookings** and the **Stage for cancelled or expired bookings**. Turn on **Also send drafts** to send draft bookings too.

### Trustpilot

**Trustpilot reviews** connects with the **API key**, **API secret** and **Business unit ID** from Trustpilot Business. When a booking is fully returned, Trustpilot is asked to invite the customer to review your shop, once per booking. Trustpilot sends the invitation itself.

Under **Settings** you can set the **Days after the return** (1 unless you set another, at most 30), the **Invitation language**, an **Invitation template ID**, the **Sender name** and a **Reply-to email**.

### Calendars

**Google Calendar** and **Microsoft 365 Calendar** put each booking's pickup and return on your calendar. Events move when the dates change and go when the booking is cancelled. Drafts and quotes get no events. Under **Settings** you can choose the **Calendar**, a **Calendar per location**, the **Event length in minutes**, and the **Pickup title** and **Return title**.

For a calendar link without signing in, see **Settings → Calendar** in [Settings and your team](settings-and-team.md#calendar).

### Accounting

Xero, QuickBooks Online and Zoho Books are set up on their own page, **Accounting**. See [Accounting](accounting.md).

## Webhooks

A webhook sends a message to another tool each time something happens in your shop, such as a new booking or a payment.

### Add an endpoint

1. Open **Settings → Webhooks**.
2. Fill in the **Endpoint URL**. It must start with `https://` and be on the public internet.
3. Under **Events**, list the events you want, separated by commas. `*` sends all of them; `order.*` sends every order event.
4. Click **Add endpoint**, and copy the secret at once: it is shown only once.

### Signatures

Every delivery carries an `OpenRent-Signature` header, signed with HMAC-SHA256 and the endpoint's secret. The receiving tool uses it to check that the message comes from your shop. **Rotate secret** makes a new secret; for 24 hours, deliveries are signed with both the new and the old one, so you have time to change the tool. How to check a signature is in [Automation with Zapier and n8n](automation.md#2-check-the-signature).

### Test and follow deliveries

- **Send test** sends a `ping` event.
- **Deliveries** lists recent deliveries with their event, status, the answer they got and the attempt.
- **Resend** sends a failed delivery again.

### Retries

A delivery counts when the endpoint answers with a 2xx status within 10 seconds. A redirect counts as a failure. Otherwise OpenRent tries again after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours, and twice after 24 hours. After that the delivery is marked failed.

### Turned off after failures

When an endpoint has kept failing for more than three days, OpenRent turns it off. It shows **Disabled after failures**, and your staff get a notice in the admin and by email. Events that happen while it is off are not sent to it, and deliveries that were still waiting are marked failed. Fix the receiving side and click **Enable**. Failed deliveries can then be sent again with **Resend**.

**Delete** removes an endpoint.

## Zapier and n8n

Zapier, Make and n8n can use webhooks and the API to connect OpenRent to almost anything without a plugin. See [Automation with Zapier and n8n](automation.md).
