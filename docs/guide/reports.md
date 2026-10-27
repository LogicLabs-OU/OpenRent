# Reports

**Reports** shows your bookings, stock and money as tables. You can download each table, save it with its filters and have it emailed on a schedule. Who changed what is in the **Audit log**.

## Run a report

1. Open **Reports**.
2. Choose a **Report**.
3. Choose how to **Group by**, if the report offers it.
4. If you have more than one location, choose a **Location** or keep **All locations**.
5. Choose a **Period**, or keep **Custom dates** and fill in **From** and **Until**.

The table updates as soon as you change a filter. **No data for this period.** means nothing matched.

Amounts are shown in your shop's currency. Rows that need attention (an overbooked day, or a day with nothing free) have a red background.

## The reports

Most reports about bookings leave out drafts, quotes, and cancelled or expired bookings, and count a booking in the period in which its pickup falls.

| Report | What it shows | Group by |
|---|---|---|
| **Revenue** | **Orders**, **Net** (after discounts), **Tax** and **Total**. | **Day**, **Month**, **Product**, **Category** or **Location** |
| **Utilisation per variant** | For each product variant: its **Stock**, the **Booked unit hours** and the **Utilisation**, which is the booked hours divided by all the hours the stock could have been out. | **Product** or **Location** |
| **Availability forecast** | For each day, location and variant: **Stock**, **Booked**, **Free** and **Overbooked**. See below. | – |
| **Overdue returns** | Bookings that are out after their return time, with the **Customer**, **Phone**, **Hours overdue**, **Payment** status and **Location**. | – |
| **Deposits held** | Deposits that are held or pending, with **Amount**, **Method**, **Held since** and **Expires**, the soonest to expire first. | – |
| **Tax summary** | **Net** and **Tax** for each tax rate. | **Tax rate** or **Location** |
| **Coupon usage** | Each coupon with its **Code**, **Kind**, **Value**, all its **Uses** so far, and the **Orders in period**. | – |
| **Fulfilment** | Each booking's planned **Pickup** and **Return** against when it was **Picked up** and **Returned**, with **Pickup on time** and **Return on time**. | – |
| **Depreciation** | For each unit: **Purchase price**, **Written off** and **Book value** at the end of the period, and when it is **Fully written off**. | **Unit** or **Location** |
| **Customer value** | For each customer: **Orders**, **Total**, **Paid**, **Average booking**, **First booking** and **Last booking**, the highest total first. | – |
| **Product return on cost** | For each product: **Revenue**, what its units cost and have **Written off**, **Rented-in cost**, **Repair cost**, **Net return** and **Return on cost**, the best first. | – |
| **Damage frequency** | Returns checked in during the period, how many came back **Damaged** or **Lost**, the **Damage charges** and what was **Charged**, and the **Damage rate**. | **Product** or **Unit** |
| **Staff activity** | What each team member did, from the audit log. | **Team member** or **Action** |

### Notes on single reports

- **Overdue returns** and **Deposits held** show the situation now. The period does not change them.
- **Tax summary** shows the rate in basis points under **Rate (bp)**: 2000 is 20 %.
- **Coupon usage** counts bookings by the day they were made, not by pickup. It always covers all locations.
- **Fulfilment** counts a pickup as on time when it happened less than an hour after the planned pickup, and a return as on time when it happened no later than an hour after the planned return. The cells stay empty until the pickup or return has happened.
- **Depreciation** lists only units that have a **Purchase price** and **Purchase date**, of products with a **Life (months)**. Each unit loses value evenly from its purchase price down to the product's **Value at the end (%)**. Retired and lost units are left out. With **All time**, the values are the ones of now.
- **Product return on cost**: **Net return** is the revenue minus the rented-in cost and the repair cost. **Return on cost** is the net return divided by the purchase price of all the product's units. Products with nothing in the period and no units with a price are left out.
- **Damage frequency**: the damage rate is damaged plus lost, divided by returns. Waived damage charges are not counted.
- **Staff activity** grouped by **Team member** shows **Actions**, **Bookings created**, **Pickups**, **Returns checked in**, **Payments recorded** and **Last active**. Grouped by **Action**, it counts each kind of change on each kind of **Record**. It covers all locations. You need permission to read the audit log to run it.

## Periods

| Period | Covers |
|---|---|
| **Today** | Today. |
| **Last 7 days** | The 7 days before today. Today is not included. |
| **Last 30 days** | The 30 days before today. Today is not included. |
| **This month** | From the 1st of this month up to and including today. |
| **Last month** | The whole of last month. |
| **Year to date** | From 1 January up to and including today. |
| **Last year** | The whole of last year. |
| **All time** | Everything, including bookings still ahead. |
| **Next 7 days** | Today and the 6 days after it. |
| **Next 14 days** | Today and the 13 days after it. |
| **Custom dates** | From the start of the **From** day up to the start of the **Until** day. To include a day, set **Until** to the day after it. |

The periods use whole days in your shop's time zone. When you choose a location, its time zone is used.

Use a named period, not custom dates, for a report you save with a schedule: **Last month** sent on the 1st always covers the month that just ended.

## Download a report

Click **Export Excel (.xlsx)** or **Export CSV** above the table. The file has the rows you see, with the same filters, and is named after the report and the date, for example `revenue-2026-10-01.csv`.

In the file:

- the column headings are the short names of the fields, such as `net` or `rate_bp`;
- amounts are in the smallest unit of the currency (cents), so 1250 is 12.50;
- percentages are fractions, so 0.25 is 25 %;
- times are in UTC.

## Save a report

1. Set up the report and its filters.
2. Click **Save report**.
3. Give it a **Name**.
4. Leave **Email schedule** on **Not emailed**, or see the next section.
5. Click **Save**.

Saved reports are listed under **Saved reports**, with their schedule and the **Next email**. Click **Open** to load one with its filters. You can also open a saved report from the link in its email.

To change a saved report, open it, change the filters, click **Update saved report** and save. To keep the old one and make a copy, click **Save as new** instead.

**Delete** removes the saved report and stops its emails. The report itself stays on the page.

Saving, sending and deleting need permission to change reports. Owners, admins and staff have it.

## Email a report on a schedule

In the **Save report** window:

1. Choose an **Email schedule**: **Daily**, **Weekly** or **Monthly**.
2. Choose the **File format**: CSV or XLSX.
3. Fill in the **Recipients**, separated by commas. Up to 20 addresses.
4. Click **Save**.

The report is emailed at 07:00 in your shop's time zone: every day, every Monday, or on the 1st of the month. Each recipient gets one email with the file attached and a link to the report in the admin.

A scheduled report needs a named **Period**, such as **Last 7 days**. With custom dates it cannot be saved, because it would send the same days every time.

Click **Send now** to email a saved report at once to its recipients. If building the report fails, the error is shown in red under its schedule. It goes away after the next email that works.

## The availability forecast

**Availability forecast** looks ahead instead of back. When you choose it, the dates change to the next 14 days, starting today.

For each day, location and product variant it shows:

- **Stock:** the units you have there;
- **Booked:** the most units held at the same time that day, by bookings and by anything else that blocks stock, such as downtime;
- **Free:** stock minus booked;
- **Overbooked:** yes when more is booked than you have.

Stock you rent in from another company counts as extra stock while you have it.

The forecast covers 1 to 62 days. Bundles are not listed, because their parts are. A variant with no stock and no bookings at a location is left out for that location.

Use it to see where you are short in good time: move stock with a transfer, rent stock in, or contact the customer.

## The audit log

**Audit log** lists every change in your shop: who made it, when and what changed. Each entry shows **When**, **By**, the **Record** and the **Action**.

**By** is the team member's name, or **API key**, **Customer**, **Storefront** or **OpenRent** for changes made by the system.

To find changes:

1. Choose a **Record** type, or keep **All records**.
2. Paste a **Record id** to see one record's changes, for example `ord_…`.
3. Type an **Action**, such as `update`.
4. Set **From** and **Until** if you need to.
5. Click **Show**.

Click an entry, or **View**, to see each changed **Field** with its value **Before** and **After**. **No field changes were recorded for this action.** means the action changed no fields.

Passwords, keys and secrets are never shown: they appear as `[redacted]`.

Products and customers have a **History** card with their latest changes. **View all** opens the audit log filtered to that record.

Click **Export** to download the entries you filtered, as Excel or CSV. One export holds up to 10 000 entries.

Entries cannot be changed or deleted. Owners, admins, staff and read-only members can read the audit log; warehouse members cannot.
