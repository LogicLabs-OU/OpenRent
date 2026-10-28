# ADR 0014: Release 1.2: cases, meter billing, customer payments, memberships, e-invoices, e-signatures and ID checks

Status: accepted

Release 1.2 adds what equipment rental segments asked for: AV cases, construction machines charged by use, Library of Things memberships, and the documents and identity services of PRD FR-DOC-6 and FR-PAY-9. This records the choices.

## Cases

- **A case is packaging, not a product set.** Any unit can hold others (`stock_items.container_id`). Scanning the case at pickup or return scans what it holds. Booking the case's product books nothing more; a kit rented as one product is a bundle, and the case only makes picking it faster.
- **What fits is taken; the rest is listed.** At pickup a case's units go on the order lines that need them. Units the order does not need are reported as skipped, and the case itself is assigned only when the order rents it. A unit scanned on its own must fit, as before.
- **At return,** the case brings back everything of it that is out on the order. A missing unit is taken out of the case, or marked lost on the return.
- **The database keeps cases sound:** a case holds units of its own location only and never a case that holds it. A unit that moves to another location leaves its case, and a case that moves is emptied.

## Meter billing

- **A price per meter unit on the product** (`meter_rate`: an amount per unit and an amount included in each rental). It needs the product's meter.
- **Readings are required** for such units at pickup and at return, so use is never left uncharged by accident.
- **The use beyond the included amount becomes a fee line** at return, with the rental's tax rate. An order already invoiced gets it on an invoice of its own, as extensions do; issued documents never change.

## Customer payments

- **Invoices and payments may belong to a customer instead of a booking** (`payments.order_id` and `payment_requests.order_id` may be empty; `document_id` and `customer_id` then say what is paid). Membership fees and counter sales need this. A fee as a pretend booking would have shown on the planner, day board and reports.
- **Everything else stays the same:** numbering, the accounting triggers, refunds from the payment, the reconciliation and the customer's account. A monthly invoice of bookings is still paid through its bookings (ADR 0012).
- **Online:** a payment link where the provider makes them (Stripe), else the provider's own page (Mollie, PayPal). The provider gets `orderId: null` and the invoice as `reference` (plugin API 1.9). Without online payment, staff record the payment.
- **`document.paid`** is emitted when such an invoice is paid in full, with the key it was issued under.

## Memberships as a plugin

- **Memberships are a plugin, not core** (the user's decision). They stay out of the way of shops that rent, and the plugin shows what third parties can build.
- **Plugin API 1.9 gives plugins what this needed,** in forms any plugin can use:
  - `billing` in the plugin scope, for plugins that ask for it;
  - price rules from plugins, applied by the price engine like the shop's own;
  - admin pages that the admin draws with its own components, so plugin screens look like the rest of OpenRent;
  - account panels in the storefront;
  - `enabledByDefault: false` for plugins each shop turns on itself.
- **A membership is active while its fee is paid.** The first fee starts it; each renewal is invoiced three days ahead and charged to the saved card, else sent as a payment link. Member prices pause when a fee stays unpaid past the shop's grace days.
- **The borrowing limit** is checked when a booking is reserved or held as a quote: items out, plus items booked for an overlapping time, plus this booking.

## E-invoices

- **Formats are plugins** (plugin API 1.9, `registerEInvoiceFormat`): Peppol BIS Billing 3.0 (UBL), Factur-X / ZUGFeRD (EN 16931 CII inside the invoice PDF) and the Estonian e-arve.
- **A company's billing details name the format** (with the buyer's Peppol ID for Peppol). The order's copy of the billing details carries it, and an order without one (made by staff) uses the customer's default billing details, which also print on its documents now.
- **The file is made from the issued document's frozen data, once, and kept with it.** It goes with the invoice email and can be downloaded. When something the format needs is missing, the shop is told what to fill in instead of getting a file a receiver would refuse.
- **The shop's registry code and bank account** are new settings, printed on invoices too.
- **Checked against the official schemas in tests:** UBL 2.1 and CII D16B (EUPL, from the EN 16931 validation artefacts) are kept with the tests. The e-arve schema states no licence, so its test downloads it. The Peppol Schematron rules need an XSLT 2 processor that is not open source; the main rules are tested directly instead. Factur-X PDFs carry the Factur-X metadata, but full PDF/A-3 conformance is not checked.
- **Sending over the Peppol network or to an operator** is left to the shop's access point, operator or accounting system.

## E-signatures through a service

- **Documenso and DocuSign are signature plugins** that sign their own copy: they get the issued PDF, report by webhook (Documenso's shared secret, DocuSign's HMAC) or when asked every 15 minutes, and hand over the signed PDF, which is kept like a signature made here. A refusal marks the request **declined**.
- **Several signature and identity plugins may be installed**; a shop uses the first it has on and set up.

## ID checks through a service

- **Stripe Identity and Veriff** check the customer's ID document on their own page (plugin API 1.9: `start`, `status`, `handleWebhook`).
- **The check starts when a booking of a customer who must show ID is reserved,** and the link is emailed then, so the customer verifies before coming. A refused pickup cannot start it, because a refused request keeps nothing. Pickup goes through once the service approves; staff can send the link again.
- **The check is kept on the customer** (`flags.id_check`), with the reason when it failed.

