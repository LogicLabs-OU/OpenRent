# Getting started

This guide takes you from an empty installation to your first booking. Everything here can be changed later.

## First run

While no shop exists yet, every admin page sends you to `/admin/setup`, the **Welcome to OpenRent** page. Fill it in once:

- **Owner:** your name, email and password (at least 8 characters). This account can do everything in the shop.
- **Business:**
  - **Shop name**.
  - **Currency** and **Timezone**. The timezone of your computer is filled in.
  - **First location:** the name of your shop or depot. Left empty, it is called "Main shop".
  - **Tax rate (%):** the tax you charge on rentals, 20 unless you change it.
- **Add demo products, stock and orders (you can remove them later):** ticked at first. Untick it to start with an empty shop.

Click **Create my shop**. You are signed in and see **Your shop is ready**, with:

- the **Storefront key**, which is safe to publish in your website widget;
- three next steps: connect Stripe and email in **Settings**, add products and stock, take a first booking.

Click **Open the dashboard**. Setup runs only once: after that, the admin asks you to sign in.

## The admin

The sidebar has two groups.

**Operations**, for the daily work:

- **Dashboard:** the **Today** page (see below).
- **Orders:** every quote, booking and rental. See [Orders](orders.md).
- **Products**, **Categories** and **Pricing:** what you rent out, how it is grouped and what it costs.
- **Inventory:** the units with their barcodes, and the stock of bulk items.
- **Planner:** bookings per unit over time.
- **Customers:** people and companies who rent from you. See [Customers](customers.md).
- **Scan:** barcode work at the counter and in the store room. See [Scanning](scanning.md).
- **Deliveries**, **Maintenance**, **Reports** and **Accounting**. See [Accounting](accounting.md).

**Configure**, for setting up the shop: **Themes**, **Plugins**, **Integrations**, **Audit log** and **Settings**.

Some items only show for team members who are allowed to use them.

The header at the top of every page has:

- a location switcher, when you have more than one location: lists and the dashboard show the location you pick;
- **Search…**: orders, customers and barcodes. Press `/` or Ctrl+K (⌘K on a Mac) to open it;
- **Notifications:** new online bookings, payment problems, overdue returns and more. **Notification settings** lets you choose what you get here and by email;
- **New order**. Pressing `N` outside a text field opens it too.

A barcode scanner works on every page: a scan opens the order, unit or customer it belongs to.

## Today

The dashboard is called **Today** and shows the date. It counts:

- **Pickups today** and **Returns today**;
- **Overdue:** rentals that are out after their return time;
- **Open quotes**;
- **Units out:** units out now, of all units, with the utilisation;
- **Revenue this month:** payments collected, net of refunds;
- **Booked this month:** confirmed orders starting this month.

Below are three lists: **Pickups today**, **Returns today** and **Needs attention**. **Needs attention** holds overdue rentals and pickups from earlier days that did not happen yet. Click an order to open it.

When customers ask to cancel or to extend a booking, a line at the top says how many requests are waiting.

## Your first product

1. Go to **Products** and click **New product**.
2. Under **Basics**, choose the **Type**: **Rental**, **Bundle (kit of rentals)**, **Sale item**, **Consumable** or **Service (delivery, setup…)**. Enter the **Name**. **Description** and **Category** are optional.
3. Set **Visibility**: **Public (on the storefront)** or **Hidden (staff only)**.
4. Under **Price**, choose the **Price structure**:
   - **Per period:** a price per hour, day, week or month;
   - **Tiered (cheaper from period 2):** later periods cost a percentage of the first, with an optional cap;
   - **Fixed per rental**.
   Then enter the **Price**.
5. Under **Rental rules**, choose the **Tracking**:
   - **Serialised: each unit has a barcode.** Enter how many units to make in **Create units now**.
   - **Bulk: quantity only.** Enter the **Quantity in stock**.
   You can also set a **Security deposit**, a **Turnaround after return (minutes)** and a **Minimum rental (hours)**.
6. Click **Create product**.

The units or the quantity are added to your first location. Each new unit gets a barcode. To print the labels, open **Inventory**, tick the units and click **Print labels**.

## Your first booking

1. Click **New order**.
2. Under **Customer**, search by name, email or phone, or click **New customer** and enter a name, email and phone.
3. Under **Rental period**, set the **Pickup** and **Return** times. Times are in the shop's timezone.
4. Under **Items**, find the product and add it. The **Available** column shows how many are free for those times; when there are too few, it says **short by** and the number.
5. The **Summary** shows the subtotal, tax, total and the refundable deposit. You can enter a **Coupon** here.
6. Click **Create and reserve** (or press Ctrl+Enter, ⌘↵ on a Mac). To keep it open for later, click **Save as draft**.

The order opens. A reserved order holds the stock, and a customer with an email address gets a confirmation. See [Orders](orders.md) for pickup and return.

## Opening the storefront

The storefront runs at your shop's address without `/admin`. When the admin is at `https://shop.example.com/admin`, the storefront is `https://shop.example.com`.

- Products with **Public (on the storefront)** visibility are shown there.
- **Themes** sets how the storefront looks. You can preview a theme before you publish it.
- Customers who book online need to accept your **Rental terms** (**Settings → Policies**).
- Online bookings appear under **Orders** with the **online** label, and the team gets a notification.

To take payment online, set up a payment provider first. See [Business customers, long rentals and online payments](business-customers.md#online-payments).

To build your own website on top of OpenRent, see [A headless storefront](headless-storefront.md).
