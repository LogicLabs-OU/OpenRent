# Customers

A customer is a person or a company who rents from you. Customers are made when you add them, when you create an order for someone new, or when someone books on the storefront. Everything is under **Customers** in the admin.

## The customer list

The list shows each customer's name, email, phone and **Flags**, what is **Owed** and **Customer since**. Search by name, email or phone. Click a customer to open them.

- **Export** downloads the list as Excel or CSV.
- **Import from file…** brings customers in from another system. See [Moving to OpenRent](moving-to-openrent.md).

## Adding a customer

1. Click **New customer**.
2. Enter the **Name**, and the **Company**, **Email** and **Phone** if you have them. With a company name, the customer is a company.
3. When the email or phone is already used, **Possible duplicates** lists those customers. Open one of them instead, or go on.
4. Click **Create**.

You can also add a customer while you create an order: click **New customer** under **Customer**.

At storefront checkout, a customer who books with an email you already have is reused, and the details they did not have yet are filled in.

## The customer page

At the top you see the number of **Orders**, the **Lifetime value** and the **Damage incidents**. Below are the customer's orders. **New order** starts an order.

Under **Details**:

- **Type:** **Person** or **Company**;
- **Name**, **Email**, **Phone**, **Company** and **Tax ID**;
- **Language:** emails and documents go out in this language, or in the shop's language with **Shop default**;
- **Tags**, custom fields and **Notes**.

Click **Save** under the details. **Addresses** has its own **Save**: the **Billing address** is printed on quotes and invoices, and there is also a **Delivery address**.

**Files** holds contracts, ID scans, certificates and other files. Only staff see them. **History** shows who changed what.

## Flags

The switches under **Details** are saved as soon as you flip them:

- **No deposit:** the customer's bookings have no deposit.
- **Check ID at pickup:** pickup is refused until the ID is checked. Turning it on shows **ID checked**: turn that on once you have seen the ID. If an identity plugin is on, it can check the customer and tick **ID checked** for you.
- **Agreed to marketing emails**, **Booking updates by SMS** and **Booking updates on WhatsApp:** what the customer agreed to.

**Block online booking** at the top marks the customer **Blocked**. An order for a blocked customer cannot be reserved, and **New order** warns you when you choose one. **Unblock** lifts it.

## Tags and custom fields

Tags are short words such as `vip` or `club`. Type them in **Tags (comma separated)**. A **Customer group** price rule under **Pricing** can give tagged customers their own prices.

Custom fields are extra fields you set up under **Settings → Custom fields → Customers**:

1. Click **New field**.
2. Enter the **Label** and choose the **Type**, for example **Short text**, **Date** or **One choice**.
3. Choose **Who sees it**: **Staff only**, **Storefront** or **Customer account**.
4. Tick **Staff must fill it in** if it is required.

The fields then show under **Details** on every customer.

## Contacts

A company can have several people who book, pick up or pay. The **Contacts** card shows for companies.

1. Click **Add contact**.
2. Enter the **Name**, and the **Email**, **Phone** and **Role** if you like.
3. Tick **Main contact for this company** for the main one. There is only one main contact: ticking it on another contact moves it.
4. Click **Save**.

Use the pencil to edit a contact and the bin to remove one.

## Duplicates and merging

When one person has two customer records, merge them into the one you keep:

1. Open the duplicate and copy its ID from the address bar: the part that starts with `cus_`.
2. Open the customer you keep.
3. Under **Data and privacy**, paste the ID next to **Merge** and click **Merge**. Confirm.

The duplicate's orders move to the customer you keep. Tags are combined and notes are joined. The email and phone of the duplicate are only used when the customer you keep has none. The duplicate is removed. Documents that were already issued are not changed.

## The customer's account

Customers have an account on the storefront, at `/account`. They sign in with a link sent to their email; there is no password. An account shows every booking made with that email.

In their account, customers can:

- see their bookings and documents;
- pay what is left online;
- ask to cancel a booking that is not picked up yet, or ask to keep it longer (see [Orders](orders.md#extending-and-returning-early));
- sign documents that wait for a signature;
- change their name, phone, language and what they agreed to;
- keep billing details and delivery addresses for checkout (see below);
- cancel or move a booking themselves, when the shop allows it (Settings → Policies);
- book an earlier booking again: its items go into a new cart, and they choose new dates;
- pay a monthly invoice of their business account as a whole; the payment is shared out over its bookings;
- see their business terms and upload an insurance certificate.

Customers can ask for a sign-in link themselves once they have a booking. To invite one, use **Send account link** under **Storefront account** on the customer. The link is valid for a week, also before the first booking. The customer needs an email address.

**Storefront account** also shows when the customer signed in and was last seen. **Sign out everywhere** ends those sessions.

## Saved billing details and addresses

Each customer keeps their own billing details for the storefront, like in any web shop:

- **Private**, or **a company** with its name, VAT number and invoice address. With the VIES plugin on, a VAT number is checked when it is saved; a number the register calls invalid is refused.
- **Delivery addresses**, each with a name for the place, a recipient and a phone number.

At checkout a signed-in customer picks one of their billing details, or types others and ticks **Save these billing details to my account**. The booking keeps a copy of the details chosen: the tax (no VAT for a valid business in another EU country) and every document follow that copy, and a later change to the saved details changes no booking.

**Saved billing details and addresses** on the customer page shows what the customer saved. Staff can add, change and delete them there too. The customer's own **Company**, **Tax ID** and addresses above stay as they are; they are used when a booking has no billing details of its own, for example one made in the admin.

## VAT numbers

Enter a business customer's VAT number in **Tax ID**. With the VIES plugin on, the number is checked when you save, and the result shows under the field. See [EU VAT numbers and Slack notices](vat-numbers-and-slack.md).

## Business terms

**Account terms** on the customer page sets booking on account, a credit limit, purchase order numbers and monthly invoices. See [Business customers](business-customers.md).

## Exporting a customer's data

Under **Data and privacy**, click **Export all data**. You get a JSON file with everything held about the customer: details, contacts, saved billing details and addresses, files, orders, payments, deposits, documents, messages and damage charges. Use it to answer a GDPR request.

## Anonymising a customer

When a customer asks to be forgotten:

1. Open the customer.
2. Under **Data and privacy**, click **Anonymise** and confirm.

Personal data is erased: the name becomes "Anonymised customer", and the email, phone, company, tax ID, addresses, notes, tags, custom fields and consents are emptied. Contacts and the customer's files are removed. Invoices and payments stay for your records. The customer then shows **Anonymised** and can no longer be changed. This cannot be undone.

A customer with an order that is reserved, prepared, out or partly returned cannot be anonymised. Finish or cancel those orders first.
