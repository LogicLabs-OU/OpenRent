# Orders

An order is one booking: a customer, a rental period and the items. It goes from draft to closed, and the order page always shows the next step. Everything is under **Orders** in the admin.

## The life of an order

| Status | What it means |
| --- | --- |
| **Draft** | Being put together. Nothing is held. |
| **Quote** | Sent to the customer. It holds the stock until it expires. |
| **Reserved** | Confirmed. The stock is held for the customer. |
| **Prepared** | Every unit is picked and ready. |
| **Out** | Picked up. |
| **Partly returned** | Some units are back, others are still out. |
| **Returned** | Everything is back. |
| **Inspected** | The returned units were checked. |
| **Closed** | Done: paid, deposit settled, no open damage. |
| **Cancelled** | Cancelled before pickup. |
| **Expired** | A quote nobody confirmed in time. |

The main button at the top right of the order is the usual next step, for example **Reserve**, **Mark picked up** or **Check in**. Other steps are in the **More actions** menu (**…**). When a step is not possible yet, a box says why, for example "Add a customer" or "Balance due".

The order list has tabs: **All**, **Drafts & quotes**, **Upcoming**, **Out**, **To close** and **Archive**. Search by number, customer or tag. On the list, `j` and `k` move the selection and Enter opens the order.

## Creating an order

Click **New order**, choose the customer, the **Pickup** and **Return** times and the items. Prices and availability update as you go. Then:

- **Create and reserve** confirms it at once;
- **Save as draft** keeps it open.

While an order is a draft or a quote, you can change it on the order page:

- the quantity of a line, or remove a line;
- the dates, with the pencil on **Rental period**;
- **Add discount**: an amount or a percentage, with a description;
- **Extras**: optional fees such as delivery, with the **Delivery postcode** and **Delivery address** when the fee depends on them.

After that, lines and dates are fixed. Use **Extend** or **Return early** to move the return (see below).

## Quotes

Choose **Send quote** in the **…** menu of a draft. The order needs a customer and at least one line. The customer gets an email with the quote attached, and the stock is held.

The quote expires after the hours set in **Settings → Policies → Quotes, late returns and cancellations → Quote valid for (hours)** (48 unless you change it). **Quote expires** on the order shows when. An expired quote releases its stock.

Online bookings that are paid at checkout wait as a quote while the customer pays, and become **Reserved** when the payment succeeds. Without online payment, they are reserved at once.

## Reserving

Click **Reserve**. The order needs a customer, at least one line and enough free stock, and the customer must not be blocked. Reserving:

- holds the stock;
- creates the deposit, if the order has one;
- emails the customer a confirmation.

For business customers, a missing purchase order number or a booking over the credit limit stops the reservation. See [Business customers](business-customers.md).

## Booking past stock

When there is not enough stock, **Reserve** is refused. Team members allowed to overbook (owners and admins, or a role with **Overbook**) see **Book past stock?** instead:

1. Enter a **Reason**, for example "stock coming from a partner".
2. Click **Book anyway**.

The order then shows a red line such as "1 item is booked past stock", with the reason. Everyone sees the shortage until it is solved. When **Create and reserve** on a new order is refused, the order is saved as a draft and opens: click **Reserve** there.

## Assigning units

A booking holds a quantity. Before pickup you choose which units go out:

- In **Items**, scan or type a unit's barcode in the field **Scan to assign a unit** and press Enter.
- Lines without a unit show "Unit · not assigned".
- To take a unit off again before pickup, click the **×** on its barcode.

A unit is refused when it is not on this order, belongs to another location, needs inspection, is hard down or is in transit. **Pick list** opens a printable list of what to pick. See [Scanning](scanning.md) to do this with a scanner.

## Pickup

1. Optionally choose **Mark prepared** in the **…** menu when everything is picked. It needs every unit assigned.
2. Enter the name next to **Customer accepts the rental agreement as**, and let the customer sign in **Customer signature** if you like. Both are printed on the rental agreement.
3. If an item has a meter, enter its reading.
4. Click **Mark picked up**.

Pickup is refused while units are not assigned. It is also refused when the customer is marked **Check ID at pickup** and the ID is not checked yet (see [Customers](customers.md#flags)), or when **Require a damage waiver or insurance before pickup** is on and the order has neither.

The order becomes **Out** and the rental agreement is issued.

## Returns

Click **Check in**. For each unit that is out, choose the outcome:

- **OK:** back in stock;
- **Needs inspection:** waits for a check;
- **Damaged:** goes hard down;
- **Lost**;
- **Not returned yet:** stays out.

For bulk items, enter how many came back. Click **Check in** in the dialog. When everything is back, the order is **Returned**; otherwise it is **Partly returned**, and you check in the rest later the same way.

### Inspection and damage

From **Returned**, click **Complete inspection**. For each unit that did not come back OK, choose **Back in stock**, **Soft down**, **Hard down** or **Retire**. Add damage charges with a description and an amount. When there are charges, the customer gets an email about what they owe.

Damage charges are on the **Damage** tab. There you can also **Add damage charge**, add photos, **Invoice** a charge or **Waive** it. When the customer has a damage waiver, the charge shows what the waiver covers.

## Late returns

Under **Settings → Policies → Quotes, late returns and cancellations**:

- **Charge late returns** (on unless you turn it off);
- **Late grace (minutes)** (60 unless you change it).

A rental checked in after its return time plus the grace gets one **Late return** line. The amount comes from a **Late return** fee under **Pricing → Fees** if you have one; otherwise it is the rental price for the real time minus the booked price. The check-in dialog warns you when the return is late.

Customers get a reminder a day before pickup and before the return, and a notice when they are overdue. The team gets a notification too.

## Extending and returning early

On a reserved, prepared or picked-up order:

1. Click **Extend**, or choose **Return early** in the **…** menu.
2. Enter the **New return**. OpenRent checks the stock and the price at once: **Available** with what it **Adds** or **Credits**, or **Not available for that time**.
3. For an early return, **Credit the unused time** decides whether the customer gets money back.
4. Confirm.

The difference becomes its own line, such as "Extension until …". An **Extension** fee under **Pricing → Fees** replaces the price difference. If the order was already invoiced, the difference gets its own invoice or credit note. The customer gets an email about an extension.

Customers can also ask from their account. The order then shows **The customer asked to extend**, with what it would cost: click **Approve and extend** or **Decline** (your note is emailed). A request to cancel shows **The customer asked to cancel**: **Approve and cancel** refunds by your cancellation policy, and you can change the **Refund (%)**.

## Moving to other dates

A reserved order that is not picked up yet can move to other dates (`POST /orders/{id}/actions/reschedule`, also used when you approve a customer's request for other dates):

- The new dates must follow the shop's rules and be free. Every booking of the order moves along, and so do its deliveries.
- The rental is priced again: a dearer move adds a fee line, a cheaper one a credit line. An invoiced order gets an invoice or credit note for the difference, and what was paid beyond the new total is refunded.
- **Extension requests** from customers can ask for other dates altogether; the alert on the order then says so, with the price of the move.

## Swapping a unit

When a unit that is out breaks, give the customer another one of the same item:

1. On the order, click the arrows on the unit's barcode.
2. Scan or type the **Barcode of the replacement**.
3. Choose what the returned unit becomes: **Needs inspection**, **Soft down** or **Hard down**. Add a reason if you like.
4. Click **Swap unit**.

The returned unit is checked or taken out of service with a repair ticket. The new unit is out from now on.

## Payments

The **Payments** tab lists payments and refunds. **Totals** shows the total, what is **Paid** and the **Balance**.

- **Record payment:** money taken outside OpenRent. Enter the amount, the **Method** (**Cash**, **Card terminal**, **Bank transfer** or **Other**) and what it is **For** (**Rental**, **Damage** or **Late fee**).
- **Request payment:** asks the customer to pay on their booking page, the balance unless you change it. Leave **Email the payment link to …** ticked to send the link, or untick it and use **Create and copy link**. A new request replaces the open one. An open request shows **Copy payment link** and **Withdraw**.
- **Refund:** on a payment, for team members allowed to refund.

## Deposits

The deposit comes from the products' **Security deposit** and is created when the order is reserved. Customers marked **No deposit** pay none. The **Deposit** card shows its status:

- **Take cash**, **Hold on card** (for card deposits) or **Charge saved card** take it.
- **Capture** keeps part or all of a held deposit, for example for damage. Capturing less than the full amount releases the rest. This cannot be undone.
- **Release** gives it all back.

A card hold shows when it expires.

## Billing details

**Billing details** under the customer shows what the order's documents print as the billed party: the details the customer chose at checkout, or the customer's own when the order has none.

- Click the pencil to set other billing details: a private person, or a company with its VAT number and address. On a draft or a quote the tax is worked out again, so a valid VAT number of a business in another EU country takes the VAT off.
- **Use the customer's details** goes back to the customer's own.
- Once an invoice is issued for the order, the billing details cannot change. Void the invoice (which issues a credit note) to correct them.

## Documents and signatures

The **Documents** card lists what was issued. Some documents are made for you: the quote when you send it, the confirmation when you reserve, the rental agreement at pickup, and the invoice when **Settings → Issue the invoice** says so (see [Accounting](accounting.md)).

- **Issue:** **Quote**, **Confirmation**, **Rental agreement**, **Invoice**, **Receipt** or **Delivery note**.
- Click a document to open it. **Open PDF** downloads it, and **Email to customer** sends it.
- **Void** on an invoice keeps it on record and issues a credit note.
- **Files** holds other files for the booking. Turn on **Customer can see** to share one in the customer's account and on the order page.
- **Ask the customer to sign** (on a quote, confirmation or rental agreement) emails a signing link. The document shows **Awaiting signature**, then **Signed**, with the **Signed PDF**. **Withdraw signature request** stops the link.

## Messages and activity

- **Messages:** every email, SMS or WhatsApp message about the order, with the recipient, the time and whether it was sent, delivered or bounced.
- **Activity:** status changes, documents, payments and messages, newest first.

## Cancelling, expiring and reopening

Choose **Cancel order** in the **…** menu of a draft, quote, reserved or prepared order. Enter a **Reason**. With **Refund payments according to the cancellation policy** ticked, payments are refunded by the tiers under **Settings → Policies → Refund on cancellation**. Cancelling releases the stock and held deposits, gives issued invoices a credit note and emails the customer (not for drafts). Click **Keep order** to leave it as it is.

A cancelled order or an expired quote can be brought back with **Reopen as draft**. Its prices are worked out again, and you reserve it like a new order.

## Closing

From **Inspected**, click **Close order**. From **Returned**, it is in the **…** menu if you skip the inspection. Closing needs:

- no balance due (except for customers on account);
- the deposit captured or released;
- no open damage charges.
