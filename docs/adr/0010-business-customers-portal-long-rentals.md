# ADR 0010: Business customers, the customer portal, long rentals and more payment providers

Status: accepted

PRD V1 asks for business accounts (FR-CUS-7), a customer portal (FR-CUS-6), periodic billing of long rentals (FR-OR-11), Mollie and PayPal, and abandoned-cart reminders (FR-SF-9). They share one rule from ADR 0009: every money movement is written to `documents` or `payments`, so the accounting triggers book it without extra code.

## Business customers

- **Terms on the customer:** `on_account`, `payment_terms_days`, `credit_limit`, `po_required`, `invoice_schedule` (`per_order` or `monthly`). The API shows them as `b2b`.
- **At reserve, when something is left to pay:**
  - a PO number is needed if the customer requires one;
  - the open balance plus the booking may not pass the credit limit.

  Staff may book over the limit with `override_credit_limit`, which goes to the audit log. A booking paid in full needs neither check, so a business customer who pays by card at checkout is never stopped after paying.
- **Open balance:** the unpaid part of every booked order of the customer. It is shown on the customer, in the customer list and in the portal.
- **Invoices fall due** after the terms (`documents.data.due_at`, also on the remote invoice in accounting). An on-account booking can close while the invoice is still unpaid.
- **Monthly invoice:**
  - One invoice covers several finished bookings (`order_id` null; `data.orders` lists them; `orders.invoice_id` points back).
  - It is issued daily for bookings that ended before the shop's current month, or at once by staff.
  - The accounting draft books it from its lines like any invoice.
  - Payments of each booking count towards it in the accounting sync.
- **Storefront:** booking on account needs a signed-in customer whose email belongs to an on-account customer. The checkout slot (the storefront's own, in every theme) offers it with the PO field.

## Customer portal

- **`/api/v1/portal/*`** finds the shop like the storefront does and the customer by `X-Customer-Session`, the same session as the storefront account. The routes are thin layers over the account code: profile, bookings with what is left to pay, one booking, document PDFs, extension requests, paying the balance online, and uploading insurance certificates (FR-PAY-8).
- **Staff** send a one-time account link that is valid for a week, also before a first booking.
- **The account page** shows the portal's extras through the `account.extra` slot (theme API 1.7), so every theme has them without code of its own. Paying goes through the booking's page, where the payment form already lives.

## Long rentals billed per period

- `orders.billing_cycle` (`weekly` or `monthly`) and `billed_until`. The cycle can change until pickup.
- **Each period is invoiced when it starts:** the first at pickup, later ones by an hourly job that also catches up missed runs. Monthly periods keep the local day and time across daylight saving.
- **Every line's share** is its remaining amount times the period's part of the time left. So extensions and early returns need no special case: the next period, or the last one at check-in, takes the difference. When too much was billed, the difference is one credit note line per tax rate.
- **Collection:** a card saved at an earlier online payment is charged (authorise and capture, no customer present). Otherwise, or when the card is refused (`payment.failed` and a staff notice), the customer gets a payment link. Event `order.billed`.
- Extensions of these bookings issue no invoice of their own, and automatic invoicing skips them.

## Mollie and PayPal

- **Providers that take payment on their own page** return `redirectUrl` (plugin API 1.5). The storefront runtime follows it at checkout and on the order page, so themes need no code for it. Core passes the booking's page as `returnUrl` and the shop's webhook URL in the provider context.
- **Mollie:** webhooks carry only the payment id, so the plugin fetches the payment with the shop's key and a forged call changes nothing. A first payment leaves a mandate, which later holds deposits (manual capture) and pays periods.
- **PayPal:** OpenRent's reference is the PayPal order id. The order is captured when the customer comes back or from the approved-order webhook. Webhooks are checked with `verify-webhook-signature`. A vaulted account holds deposits.
- **Void:** `POST /payments/{id}/actions/void` cancels a payment that has not settled, at the provider too (`payment.voided`).
- **The payments settings** show one card per installed provider from its plugin's settings fields. Checkout uses the first provider that is on and set up.

## Abandoned-cart reminders

- Off unless the shop turns them on (`cart_reminders`). One email per cart left with an email and items, after the set hours, unless that email booked since or asked to stop (`email_optouts`).
- **The link is the cart id sealed with the installation key:** it shows nothing about the customer, cannot be made up, and lasts a week. It brings the cart back as a new cart. Dates that have passed are dropped.

## Consequences

- **Tests:** stateful fakes of Mollie and PayPal (`packages/payment-fakes`), with `pnpm test:payments-live` against the real test APIs.
- **Plugin API 1.5:** `redirectUrl`, `returnUrl`, `webhookUrl`, `documentPdf`, byte bodies in `fetch`. **Theme API 1.7:** the `account.extra` slot.
- **Not yet:** paying a monthly invoice as a whole online. Its bookings are paid one by one or by bank transfer.
