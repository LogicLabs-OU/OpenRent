# Maintenance and inspections

This page covers repairs, checks and upkeep of your units: repair tickets, inspection checklists, meter readings, service intervals and the value of each unit. Unit statuses are explained in [Inventory and the planner](inventory-and-planner.md#unit-statuses).

## Repair tickets

Go to **Maintenance**. A ticket is one repair, for one or more units. While a ticket is open, its units are out of service and cannot be booked. A ticket opened for an overdue service is the exception: its unit stays in service.

A ticket opens by itself when:

- a unit is set to **Soft down** or **Hard down**;
- a unit comes back **Damaged** at check-in (it becomes **Hard down**);
- a unit fails a checklist item that sends it to soft or hard down;
- a service is overdue and its interval opens tickets (see [The daily job](#the-daily-job)).

### Open a ticket yourself

1. Click **New ticket**.
2. Under **Units**, scan or type each barcode and press Enter.
3. Describe the **Issue**, for example "brakes squeal".
4. Choose **Out of service as**: **Soft down** or **Hard down**.
5. Choose the **Priority**: **Urgent**, **High**, **Normal** or **Low**.
6. If you like, choose who it is **Assigned to**, a **Due** time and **Notes**.
7. Click **Open ticket**.

The units go out of service at once and are taken off upcoming bookings that are not picked up yet. A unit that is out on rental, in transit, retired, lost or already on an open ticket is refused. The person it is assigned to gets a notice in the admin, unless they assigned it to themselves.

### Work on a ticket

Click a ticket to open it.

- **Start repair** marks it **In repair**.
- Change the **Issue**, **Priority**, **Assigned to**, **Due** and **Notes**.
- Under **Parts**, click **Add a part** and fill in the **Part**, the quantity and the **Cost each**.
- Enter the **Labour cost**. **Total cost** is the labour plus the parts.
- Click **Save**.
- Add **Photos** of the damage or the repair.

### Close a ticket

Write **What was done**, for example "replaced the brake cable". Then choose:

- **Back in service:** the units are available again.
- **Retire unit:** the units leave your stock for good. Their history is kept.
- **Cancel ticket:** for a ticket opened by mistake. The units go back into service without a repair.

When a unit is set back to **Available** somewhere else, it leaves its ticket. A ticket with no unit left out of service is closed.

### Find tickets

- **Open**, **Closed** and **Cancelled** choose which tickets to list.
- Filter by priority, or turn on **My tickets** or **Overdue only**. A ticket is overdue when its due time has passed.
- The list follows the location chosen in the top bar.
- The most urgent tickets come first: by priority, then overdue, then due time.

Repair costs count in the **Product return on cost** report. See [Reports](reports.md).

## Inspection checklists

A checklist says what to check on the units of some categories, for example tyres and brakes on bikes. Go to **Maintenance → Checklists**.

### Make a checklist

1. Click **New checklist** and enter a **Name**.
2. Tick the categories it is for. With none ticked, it is for every product.
3. Add the items. For each item:
   - the **Label** in your main language (other languages are optional);
   - the **Answer**: **Pass or fail**, **Number** or **Text**;
   - for a number, **At least** and **At most**;
   - **When it fails**: **Needs inspection**, **Soft down** or **Hard down**;
   - **Required**, if the item must be answered.
4. Keep **In use** on, and click **Save**.

Changing the items makes a new **Version**. Inspections already done keep the copy they used. **Archive** stops offering a checklist.

A unit uses the checklist for its product's categories. When none matches, it uses a checklist for every product.

### Inspect at return

Turn on **Inspect every returned unit that has a checklist** at the top of the **Checklists** page. Units with a checklist that come back OK then wait as **Needs inspection**. They can be rented again once their checklist passes.

After a check-in, the order offers **Complete inspection**. In the **Inspection** window, each returned unit with a checklist has a button to run it. The same window sets what happens to units that came back with a problem (**Back in stock**, **Soft down**, **Hard down** or **Retire**) and records damage.

### Inspect from the scan page or the unit's page

- On **Scan**, choose the mode **Inspect** and scan a unit. Its checklist opens.
- On a unit's page, the **Inspections** card has a button to run its checklist.

### Results

Every required item needs an answer. A pass-or-fail item fails when it is not passed. A number fails when it is outside its limits. A text item never fails. Each item can have a note.

- When an item fails, the unit gets the worst **When it fails** status of the failed items. **Soft down** and **Hard down** open a repair ticket that lists the failed items.
- When everything passes, a unit waiting as **Needs inspection** is available again.

The unit's page lists its inspections with **Pass** or **Fail**, the checklist, the time and who did it.

## Meter readings

Some units have a meter, such as running hours or kilometres. On the product page, fill in **Meter counts** with the unit of the meter, for example "hours". Leave it empty for products without a meter.

Readings are added:

- on the unit's page, in the **Meter** card: type the **New reading** and click **Add reading**;
- at pickup and at return, in the meter fields of the order.

A meter only goes up. A reading below the last one is refused. The **Meter** card shows the current value and the last readings, with where each came from: **Entered**, **At pickup** or **At return**.

## Service intervals

A service interval is regular upkeep, for example an oil change every 100 hours. Go to **Maintenance → Service**.

### Set up an interval

1. Click **New interval** and enter a **Name**.
2. Under **Applies to**, choose **Every product**, **One product** or **A category**.
3. Fill in one or more of **Days**, **Rentals** and **Meter**. The first one reached makes the service due.
4. Leave **Open a repair ticket when overdue** on if the service needs a ticket. Resolving that ticket records the service.
5. Click **Save**.

A meter interval counts only for units with a meter. Each limit counts from the last service of this interval, or else from the unit's purchase date, or else from when the unit was added.

### See what is due

**Due now** lists units with a service **Overdue** or **Due soon**. A service is due soon when it is a week away, one rental away, or at 90% of its meter interval. **Why** says how far along the unit is, and **Ticket open** links to its ticket.

The unit's page also shows its services in the **Service** card.

### Record a service

On the unit's page, under **Service**, choose the interval in **Service done**, add **Notes** if you like, and click **Record**. The card lists the services done, with the meter value at the time.

### The daily job

Each morning, OpenRent checks every unit:

- Staff get one notice for each overdue service.
- When the interval opens tickets, a ticket is opened for a unit that is available or reserved and has no open ticket. The unit stays in service until you decide otherwise.

## Electrical safety tests (PAT)

Electrical gear must be tested for safety at set times: PAT in the UK, DGUV V3 in Germany, NEN 3140 in the Netherlands. OpenRent keeps the tests, says when the next is due, and stops a unit going out once its test has run out.

### Say what needs testing

Under **Maintenance → Service**, add an interval and choose the kind **Electrical safety test (PAT)**. Choose what it applies to (all products, one product or a category) and how many **days** a test lasts, for example 365. A test is due by days only.

Units it applies to show in **What is due** like a service: due soon in the week before, overdue after.

### Record a test

On a unit's page, **Electrical safety tests** says whether the unit may go out and lists its tests. Click **Record test** and fill in:

- the day, the **Result** (pass or fail) and the **Protection class**;
- the readings your tester gives: **Earth continuity** (needed for a passing class I appliance), **Insulation resistance** and **Leakage current**;
- whether the visual check passed and the polarity is correct;
- who tested, and with which instrument.

A pass counts as the interval's service: the next test is due the given number of days later. A fail takes the unit out of service with a repair ticket; once it is repaired, record a new test.

Tests cannot be changed or removed afterwards. The button next to each test opens its **certificate** as a PDF to print or send.

### At pickup

A unit that needs a test and has no passed one in time cannot go out. Scanning it onto a booking says "No valid electrical safety test", and pickup stops for units that were put on the booking before their test ran out. Test the unit, or give the customer another one.

## Depreciation and book value

OpenRent works out what each unit is worth now, by straight-line depreciation.

1. On the product page, fill in **Life (months)** and **Value at the end (%)**, then click **Save**.
2. On each unit, fill in the **Purchase date** and the **Purchase price**.

The purchase price then goes down by the same amount each month until it reaches the value at the end. For example, a unit bought for €1,200 with a life of 24 months and 25% at the end goes down by €37.50 a month. After 12 months its book value is €750, and after 24 months it stays at €300.

The **Value** card on the unit's page shows the **Book value**, how much is **Written off** so far, the amount **Per month**, and the date it is **Fully written off**, with the residual value. Without a price, a date or a life, the card says what to fill in.

The **Depreciation** report lists the value of every unit, by unit or by location. See [Reports](reports.md).
