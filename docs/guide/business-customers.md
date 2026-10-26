# Business customers, long rentals and online payments

## Customers on account

Open a customer and fill in **Account terms**:

- **Books on account:** bookings are confirmed without payment, and the invoice is due after the payment terms (14 days unless you set others).
- **Credit limit:** what the customer may owe at once. A booking that would go over it cannot be reserved; staff can still choose **Book anyway**.
- **Needs a purchase order number:** a booking with something left to pay asks for it before it is confirmed. The PO number is printed on the invoice.
- **Invoices:** one per booking, or **one a month** for all finished bookings. The monthly invoice is issued in the first days of the next month, or at once with **Invoice finished bookings now**.

What a customer owes is shown on the customer and in the customer list. Signed-in business customers can choose **Pay on account** at checkout.

## The customer's account

Customers sign in with an email link. Use **Send account link** on the customer to invite one (the link is valid for a week). In their account they see:

- their bookings and documents;
- what is left to pay, with a button to pay online;
- their business terms;
- documents waiting for a signature.

They can also upload an insurance certificate there, which counts at pickup when you require a damage waiver or insurance.

## Long rentals

On a booking, set **Billing** to every week or every month before pickup:

- each period is invoiced when it starts, the first at pickup;
- a card the customer saved when paying online is charged; otherwise they get a payment link;
- an extension or an early return is settled in the next period, or at the return with a credit note.

## Online payments

**Settings → Payments** has a card for each payment plugin: Stripe, Mollie and PayPal.

1. Enter the keys.
2. Give the provider the webhook URL shown on the card.
3. Turn it on.

Checkout uses the first provider that is on. With Mollie and PayPal the customer pays on the provider's page and comes back to their booking.

To check your keys against the real test APIs, run `pnpm test:payments-live` with `MOLLIE_API_KEY` (test key) or `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (sandbox).

## Cart reminders

Under **Settings → Payments → Checkout**, turn on **Cart reminders**. People who typed their email and left items in the cart get one email after the hours you choose. It has a link back to the cart and one to stop the reminders.
