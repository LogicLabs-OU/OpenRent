# Inventory and the planner

This page covers where your stock is and what it is doing: locations and their hours, units and stock levels, the inventory page, the planner, downtime and transfers between locations. How a product counts its stock (serialised, bulk or not tracked) is explained in [Products and the catalogue](products-and-catalogue.md#tracking).

## Locations

A location is a place where customers pick up and return. Go to **Settings → Locations**.

1. Click **New location**.
2. Fill in the **Name**, the address, the **Phone** and the **Email**.
3. Choose the **Time zone**. Opening hours, pickups and returns use it.
4. If you like, fill in a **Tax ID** and a **Tax profile** for this location. See [Pricing and fees](pricing-and-fees.md#taxes).
5. Turn on **Default location for new orders and the storefront** for your main location.
6. Click **Create location**.

Fill in the address: delivery fees by distance are measured from it. See [Delivery fees by distance](delivery-fees.md).

**Make default** changes the default location. **Archive** removes a location you no longer use. Past orders keep it, but open orders and stock must move to another location first. Archived locations are listed below the others, with **Restore**.

### Opening hours

Click a location in the list to see its **Opening hours**. Turn each day on or off and set the time it opens and closes, then click **Save**. Pickups and returns are offered inside these hours. Turn every day off to allow any time.

### Closed days

Below the hours, **Closed days** lists holidays and other closures. Fill in **From**, **Until** and a **Reason**, then click **Add**.

A rental can span a closed day, but its pickup and return cannot fall on one. The reason is shown when a customer picks such a time.

Opening hours and closed days are checked for storefront bookings. Staff can book any time in the admin.

## Choose the location you see

With several locations, the top bar has a **Location shown** menu. The inventory page, the planner and the repair tickets follow it. **All locations** shows everything; the planner then shows the default location.

## Units

Units belong to serialised products. Each unit has its own barcode.

- **Add units** on the product page: enter how many (up to 100) and click **Add units**. They are made at the location chosen on the page, each with a new barcode.
- Tick units and click **Print labels** to print their barcode labels.
- Click the pencil next to a unit to edit it: **Photos**, **Serial**, **Shelf or bin**, **Condition** (**New**, **Good**, **Fair**, **Worn** or **Poor**), **Location**, **Purchase date**, **Purchase price**, **Notes** and your custom fields for units. Pick lists are sorted by shelf, so staff walk the shelves in order.

A unit cannot move to another location while it is booked for an upcoming rental.

To bring in many units at once, use **Import / export** on the inventory page. See [Moving to OpenRent](moving-to-openrent.md).

## Stock levels

Bulk products have a quantity per location. On the product page, type the new count in **Quantity in stock**. It is saved at once as a stock count. With several locations, choose the location first in the **Location** field.

Bulk items returned lost are taken off the stock. Bulk items returned damaged go into downtime. See [Downtime](#downtime).

## The inventory page

Go to **Inventory**. It has three tabs.

- **Units:** every unit, with its barcode, product, serial, condition, location and status. Filter by status, or search by **Barcode, serial or product**. Click a barcode to open the unit's page.
- **Bulk stock:** the quantity of each bulk product at each location.
- **Downtime:** stock that is out of service now.

### Unit statuses

| Status | Meaning |
|---|---|
| **Available** | Can be booked. |
| **Out** | Out on a rental. Set by pickups and returns. |
| **In transit** | On its way to another location. Set by transfers. |
| **Needs inspection** | Waits for a check before it can be rented again. |
| **Soft down**, **Hard down** | Out of service for a repair. Both work the same way. |
| **Retired** | Left your stock for good. Its history is kept. |
| **Lost** | Gone. Its history is kept. |

To change a status, use **Set status…** on the unit's row. **Out** and **In transit** cannot be set by hand.

When a unit goes out of service, is retired or is lost, it is taken off its upcoming bookings that are not picked up yet. A message names those orders. The bookings stay, and wait for another unit (see [Waiting for a unit](#waiting-for-a-unit)). **Soft down** and **Hard down** also open a repair ticket. See [Maintenance and inspections](maintenance-and-inspections.md).

Setting the unit back to **Available** ends its downtime.

## Downtime

Downtime is time when stock cannot be booked. It starts when:

- a unit is set to **Needs inspection**, **Soft down** or **Hard down**, or returned in that state;
- bulk items come back damaged.

The **Downtime** tab lists what is out of service now: the unit or product, the quantity, from when, until when (**Open-ended** when there is no end) and the reason. **End now** ends a downtime. For a unit, set its status back to **Available** instead.

## A unit's page

Click a barcode on the inventory page or the planner. The unit's page shows:

- **Details:** serial, condition, shelf and purchase.
- **Value:** its book value. See [Maintenance and inspections](maintenance-and-inspections.md#depreciation-and-book-value).
- **Meter**, for products with a meter, and **Service**.
- **Inspections:** the checklists it went through, with **Pass** or **Fail**.
- **Rentals:** each order it was on, with the dates and how it came back.

## Cases

A unit can hold other units, like a flight case with four microphones. Scanning the case at pickup or return then scans what is packed in it.

- **Pack:** open the case's page and type or scan each unit's barcode under **Case contents**, then **Pack**. A unit can be in one case at a time; packing it in another case moves it.
- **Take out:** **Take out** next to a unit, or **Empty the case**.
- **Rules:** a unit and its case are at the same location. A case cannot go inside a unit it holds. A unit that moves to another location (by a transfer or by changing its location) leaves its case, and a case that moves is emptied.
- **A unit's page** shows **Packed in** with a link to its case.

A case is packaging, not a set for sale. Booking the case's product does not book what is in it. To rent a kit as one product, make a [bundle](products-and-catalogue.md#bundles); the case then makes picking it faster.

## The planner

Go to **Planner**. Every unit of the location is a row, and its bookings are bars across the days.

- **From** sets the first day. **Earlier** and **Later** move by the number of days shown.
- **Days shown** is 7, 14 or 31 days. **Today** goes back to the current day.
- **Products** shows the units of one product.
- A pale bar is a booking not picked up yet. A solid bar is picked up. Bars also show downtime (**Out of service**) and transfers (**Transfer**).
- Hover over a bar to see its dates. Click a barcode to open the unit's page.

The planner shows at most 200 units. Choose a product to see the rest. Retired and lost units are not shown.

### Move a booking to another unit

Drag a booking's bar onto another row of the same product. Or click the bar and choose a barcode under **Move to unit**. The same menu has **Open order**.

You can move a booking while its order is reserved or prepared and the unit is not picked up. When the other unit is not free, or is out of service or in transit, the bar goes back and a message says why.

### Waiting for a unit

**Waiting for a unit** lists booked quantities that have no unit yet, for example after a unit went out of service. Choose a barcode in **Assign a unit to #…** to give the booking a unit.

### Rented in

**Rented in** lists stock rented from suppliers in the days shown. See [Products and the catalogue](products-and-catalogue.md#stock-rented-in-sub-rental).

## Transfers between locations

With more than one location, **Inventory** has a **Transfers** button.

### Plan a transfer

1. Click **New transfer**.
2. Choose **From** and **To**.
3. Set **Ships** and, if you know it, **Arrives**.
4. In **Add a unit**, scan or type a barcode and press Enter. In **Add a bulk product**, search for the product and set the quantity.
5. Add **Notes** if you like, and click **Plan transfer**.

The stock is held at the source from the ship time, so it cannot be booked there. Until **Arrives**, it is not offered at the destination. Leave **Arrives** empty to wait until it is received. Only units that are available or reserved can travel.

### Send, receive or cancel

Click a transfer in the list to open it.

- **Send now:** the stock is on its way. Units show **In transit**.
- **Book in arrived:** enter how many of each line arrived. The transfer is received when nothing is missing.
- **Receive by scanning** opens **Scan**. In **Receive** mode, each unit you scan is booked in on its transfer.
- **Close and write off the rest:** books in what arrived and marks the rest lost.
- **Cancel transfer:** for a planned transfer. The stock stays where it is and can be booked there again.

The tabs **Open**, **Received** and **Cancelled** sort the transfers.

### Transfer for a booking

On **New order**, when a product is short at the order's location, **Other locations** shows how many are free elsewhere. **Transfer here** opens a new transfer with the locations and the arrival filled in. For a bulk product, the quantity is filled in too.
