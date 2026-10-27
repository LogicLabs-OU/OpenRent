# Products and the catalogue

Everything customers can rent or buy is a product. This page covers products, how their stock is counted, their photos and texts, bundles, and the rules for booking them. Prices are on [Pricing and fees](pricing-and-fees.md). Units and stock levels are on [Inventory and the planner](inventory-and-planner.md).

## Create a product

Go to **Products** and click **New product**.

1. Choose the **Type**:
   - **Rental:** something customers rent and bring back.
   - **Bundle (kit of rentals):** several rental products booked as one. See [Bundles](#bundles).
   - **Sale item** and **Consumable:** sold, counted as a quantity, with one price per item.
   - **Service (delivery, setup…):** no stock, one price per item.
2. Fill in the **Name**, the **Description**, the **Category** and the **Visibility**.
3. Under **Price**, choose the **Price structure** and the **Period**, and enter the price.
4. Under **Rental rules**, choose the **Tracking**. Fill in the **Security deposit**, the **Turnaround after return (minutes)** and the **Minimum rental (hours)** if you need them.
5. For serialised stock, **Create units now** makes that many units with barcodes (up to 100). For bulk stock, enter the **Quantity in stock**. Both go to the first location in your list.
6. Click **Create product**.

The product page opens. In the **More actions** menu, **Duplicate** makes a hidden copy called "… (copy)" with the same variants, prices and bundle contents, but without units.

## Tracking

Tracking decides how OpenRent counts the stock of a product.

- **Serialised: each unit has a barcode.** Each unit is a separate item with its own barcode, serial number, condition and rental history. A booking gets specific units.
- **Bulk: quantity only.** OpenRent counts how many there are at each location, for example chairs or cones. **Print label** prints one barcode label for the stock.
- **Not tracked.** No stock is counted, so the product is never short. Services and bundles are not tracked. A bundle's availability comes from its components.

On the form, a rental is serialised or bulk, and sale items and consumables are bulk. The tracking of a variant cannot change while it has bookings.

## Variants

A product can have variants, for example sizes. Each variant has its own SKU, price and stock. With more than one variant, the product page has a tab for each.

The product page has no button to add a variant. Add variants with a product import: rows for the same product become its variants, and the **variant** column names each one. See [Moving to OpenRent](moving-to-openrent.md). The API can add them too.

## Categories

Categories group products on the storefront. Go to **Categories**. The order on this page is the order of the storefront menu.

- **New category** asks for a **Name** and a **URL name**. The URL name is used in the storefront address, for example `/c/bikes`. Leave it empty to make it from the name.
- With more storefront languages, the dialog has a name field for each language.
- The arrows move a category up or down.
- Deleting a category keeps its products. They are no longer listed under it.

You choose a product's category when you create it. The product page has no category field. To change categories later, import the products again with a **category** column, or use the API. A category in the file that does not exist yet is created.

## Photos

The **Photos** card is at the top of the product page.

- Click **Add photos**, or drop files on the card. Use JPEG, PNG or WebP up to 15 MB.
- The first photo is the **Cover** on the storefront. **Move earlier** and **Move later** change the order.
- Type a short text in **Describe the photo** under each photo.
- Removing a photo deletes it from the product and the storefront.

## Descriptions and details

The **Details** card holds the product's texts and settings:

- **Name** and **Description**. The description editor has formatting.
- **Tags**, for your own grouping.
- Your custom fields for products. See [Custom fields](#custom-fields).
- **Visibility**, **Security deposit** and the booking rules. See [Booking rules](#booking-rules).
- **Meter counts**, **Life (months)** and **Value at the end (%)**. See [Maintenance and inspections](maintenance-and-inspections.md).
- **Search title** and **Search description** (up to 160 characters). Search engines show them for the product page.

Click **Save** at the bottom of the card.

## Translations

When your storefront has more than one language, the **Translations** card has a tab for each other language. Fill in the **Name**, the **Description**, the **Option names** of the variants and the **Photo descriptions**, then click **Save**. Empty fields show the text in your main language.

With one language, the card says **Your storefront has one language.** and links to **Settings**, where you add languages.

## Custom fields

Go to **Settings → Custom fields**. There is a tab for **Products**, **Units**, **Customers** and **Orders**.

1. Click **New field**.
2. Fill in the **Label** and, if you like, a **Help text**.
3. The **Key** is used in the API and in exports. It cannot change later.
4. Choose the **Type**: **Short text**, **Long text**, **Number**, **Yes / no**, **Date**, **One choice**, **Several choices** or **Web address**. The two choice types need **Options**.
5. Choose **Who sees it**: **Staff only**, **Storefront** or **Customer account**. Storefront fields show on product pages.
6. Turn on **Staff must fill it in** for a required field.

Product fields are filled in on the **Details** card, unit fields in the panel where you edit a unit. Removing a field takes it off the forms. Values already saved stay on the records and in exports.

## Visibility

- **Public (on the storefront):** customers can see and book it.
- **Hidden (staff only):** it is not on the storefront.
- **Archived:** it disappears from the storefront and from new orders. Its history is kept.

**Archive** is in the **More actions** menu. On **Products**, the **Archived only** switch lists archived products.

## Bundles

A bundle is a kit of rental products booked as one, for example a camera with a lens and a bag.

1. Create a product with the type **Bundle (kit of rentals)**.
2. Under **Components**, search for each product and set its quantity.
3. Enter a **Bundle discount (%)**. With 0 the bundle costs the sum of its components. Otherwise it costs the sum less this percentage.
4. Click **Create product**.

The bundle's availability is that of its scarcest component. Booking the bundle reserves every component. A bundle cannot contain another bundle. The bundle's deposit is the sum of its components' deposits, unless you give the bundle its own **Security deposit**.

### Fixed and choice components

Each component has a choice group field. Leave it empty (**Always included**) and the component always comes along.

Give components the same choice group, for example "Lens", to make them alternatives. The customer picks one of them. For availability, the option with the most free units counts. When nobody picks, the first option of the group is used. On a draft or quote order, staff can pick another option on the bundle's line.

To change the components later, edit them on the bundle's page and click **Save**. The discount is set when you create the bundle. The API can also set a fixed price for a bundle.

## Accessories and related products

The **Goes with** card on the product page has three lists:

- **Accessories:** offered with this product when customers book online. Customers tick them to add them.
- **Related products:** shown as links on this product's page.
- **Often rented with:** OpenRent works this out from bookings each week. You cannot edit it.

Search for a product to add it, then click **Save**.

## Booking rules

The **Details** card has these rules. All values are in minutes.

- **Before** and **After:** buffers. The stock is blocked this long before the pickup and after the return, for example for cleaning.
- **Notice:** how long before the pickup a booking must be made.
- **Shortest** and **Longest:** the shortest and longest rental.
- **Steps:** the rental length must be a multiple of this. For example, 1440 allows whole days only.

Buffers count for every booking. Notice, rental lengths, steps, opening hours and closed days are checked for storefront bookings. Staff can book outside them in the admin.

### Rules for one variant

Under **Booking rules for this variant**, click **Override** and fill in the rules that differ for this variant. Leave a field blank to use the product's value, which is shown in grey.

The same card has the **Low availability alert**. Staff are told when fewer than this many are free in the coming days. Leave it blank to turn it off.

## Availability

The **Availability** card shows the free units per day, in the location's time zone, with buffers counted. With several locations, choose one in the **Location** field above the variants.

## Stock rented in (sub-rental)

When you rent extra stock from a supplier, add it on the product page in the **Rented in** card. It can be booked for those dates only.

1. Click **Rent in**.
2. Choose the variant and the location if you have several.
3. Fill in **Rented from**, **Quantity**, **Cost per unit**, **From**, **Until** and, if you like, the **Supplier reference**.
4. Click **Save**.

Overbooked bookings on those dates that now fit are covered at once, and the message says how many. **Cancel** takes the stock away again. While bookings need it, OpenRent asks first, and **Cancel anyway** cancels it all the same.

Rented-in stock is listed under the units on the **Planner**. The **Product return on cost** report takes its cost off the product's revenue. See [Reports](reports.md).
