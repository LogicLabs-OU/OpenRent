# Pricing and fees

This page covers how OpenRent prices a booking: the price of each product, price rules, coupons, deposits, taxes and fees. OpenRent works out a booking's price in this order:

1. the price of each product for the rental period;
2. price rules, which raise or lower rental prices;
3. coupons;
4. fees, such as delivery or a damage waiver;
5. tax on each line.

The deposit is worked out apart from the total.

## Price structures

You set a product's price when you create it. To change it later, click the price button in the **Stock and price** card of the product page (it says **Set price** when there is none). The **Change price** dialog opens. Existing orders keep the price they were booked at.

- **Per period:** an amount per hour, day, week or month. The rental is counted in whole periods, rounded up: 26 hours at a day price are 2 days. A month counts as 30 days. Every rental costs at least one period.
- **Fixed per rental:** one amount, however long the rental.
- **Tiered (cheaper from period 2):** the full price for the first period, then a share of it for each further period. Set the share in **From period 2 (% of base)**.
- **Price table:** set prices for set lengths, plus an extra amount for each period beyond a length.

Sale items, consumables and services have one price per item.

### Tiered prices

A tiered price can have a cap: **Cap every N periods** and **…at most M × base**. For example, €20 a day, 50% from day 2, and a cap of at most 3 × base every 7 days:

- 3 days cost €20 + €10 + €10 = €40;
- a week costs €60 instead of €80.

You set tiers and the cap when you create the product. After that they can be changed through the API, and the **Change price** dialog offers **Per period** and **Fixed per rental**.

### Price tables

Price tables are set up through the API. A table charges the nearest shorter length plus the extra amount for each period beyond it, but never more than the next longer length. For example, with 1 day €35, 2 days €60, 7 days €150 and €15 for each extra day, 4 days cost €60 + 2 × €15 = €90.

With tiered prices and tables, a customer never pays more than a longer rental would cost.

## Days not charged

For a day price, the **Change price** dialog has **Charging days**:

- **Days not charged:** tick the weekdays that are free, for example Sunday.
- **Pickup day is free:** the first day is free. With **Only when picked up at or after**, only when the pickup is at or after that time.
- **Return day is free:** the last day is free. With **Only when returned at or before**, only when the return is at or before that time.

Times are in the location's time zone. The free pickup and return days only count for rentals longer than one day, and at least one day is always charged. For example, with Sundays free, Friday 10:00 to Monday 10:00 costs 2 days instead of 3.

## Price rules

Price rules raise or lower rental prices on their own when a condition is met. Go to **Pricing → Price rules** and click **New price rule**.

1. Enter a **Name**, for example "High season".
2. Choose the **Type**:
   - **Season:** for the part of a rental between the **First day** and the **Last day**.
   - **Holiday:** the same, for public holidays or event days.
   - **Weekdays:** for the part of a rental on the chosen **Days**, such as weekends.
   - **Customer group:** for customers with one of the **Customer tags**. Tag customers on their page, for example `vip`.
   - **Quantity:** when a line has at least the number in **From quantity**.
   - **Booking ahead:** by how many days ahead the rental is booked. **At least … days ahead** is an early-bird rule, **At most … days ahead** a last-minute rule.
3. Choose whether the **Price goes** **Down (discount)** or **Up (surcharge)**, and by what **Percent**.
4. Under **Applies to**, choose categories or add products. Leave it empty for every product.
5. Set the **Priority** and **Can combine with other stackable rules**, then click **Save**.

Season, holiday and weekday rules count only for the share of the rental on their days. A 20% high-season rule on a rental with half its time in the season adds 10%.

### How rules combine

- The matching rule with the lowest **Priority** number always applies.
- Other matching rules join it only when all of them are stackable.
- The percentages of the rules that apply are added up, on the product's price. A 10% and a 5% discount make 15% off.

Rules change rental lines only, and not a line where staff typed a price. The **Active** switch turns a rule off without deleting it. Deleting a rule does not change orders already priced.

## Coupons

Go to **Pricing → Coupons** and click **New coupon**.

- **Code:** what customers type. Upper and lower case do not matter.
- **Kind:** **Percent off** or **Amount off**, and its **Value**.
- **Valid from** and **Valid until**.
- **Uses in total** and **Uses per customer**. A use counts when the booking is reserved.
- **Minimum order:** the items' total after price rules, before coupons and fees.
- **Applies to:** chosen products, or else chosen categories, or else the whole order.
- **Can be used together with other coupons.**

Customers enter codes in the cart. Staff use the **Coupon** field on **New order**. A coupon comes after price rules and never reduces fees. An amount off is at most the total of the items it covers. When several codes are entered and one of them cannot be combined, only the first code applies.

A code that cannot be used shows why: **not found**, **expired**, **not valid yet**, **usage limit reached**, **minimum order not met** and so on.

## Deposits

A deposit is a refundable amount on top of the price. It is not part of the total and has no tax.

- Give each product a **Security deposit**. A booking's deposit is that amount times the quantity.
- A bundle without its own deposit takes the sum of its components' deposits.
- **Settings → Payments → Storefront checkout → Deposit policy** chooses **Sum of product deposits** or **No deposits**.
- On a customer's page, the **No deposit** switch waives the deposit for that customer.

How deposits are held and returned is in [Settings and your team](settings-and-team.md#payments).

## Taxes

Prices are entered without tax. Tax is added to each line, and the total tax is rounded once for each rate.

Taxes come from tax profiles. A tax profile has a name and one or more rates, which are added together.

- Your first profile is made in setup, from the **Tax rate (%)**. It is the shop's default and applies to every product.
- A location can use another **Tax profile** in **Settings → Locations**. It replaces the shop's default for orders there. Products with their own tax profile keep it.
- Each fee has a **Tax** setting. **The shop's default tax** is used when you choose nothing.

The admin has no page for adding tax profiles or giving a product its own one. Use the API for that. See [The REST API](api.md).

Whether the storefront shows prices with or without tax is set in **Settings → General → Prices and currencies**. A tax plugin, such as **EU VAT numbers (VIES)**, can change the rate for a customer. See [EU VAT numbers](vat-numbers-and-slack.md).

## Fees

Go to **Pricing → Fees** and click **New fee**.

1. Enter the **Name**. Customers see it at checkout and on documents.
2. Choose the **Type**: **Delivery**, **Cleaning**, **Damage waiver**, **Extension** or **Late return**.
3. Choose when it is **Added**: **Always**, or **When the customer chooses it**. Extension and late fees have no such choice.
4. Choose how it is **Calculated as**:
   - **Fixed amount:** once per booking.
   - **Amount per item:** times the number of rental items it covers.
   - **Percent of the rental:** of the rental lines it covers, after price rules.
   - **Amount per period:** times the number of hours, days, weeks or months (**Per**) of the rental.
   - **By postcode zone** or **By distance:** for deliveries, see below.
5. Under **Applies to**, choose categories or products, or leave it empty for all.
6. Choose the **Tax** and click **Save**.

A fee is added only to bookings with a rental item it covers. Coupons do not reduce fees. Staff can add optional fees to a draft or quote order under **Extras**.

### Delivery

With **By postcode zone**, add **Zones**. Each zone has postcodes, or their beginnings, separated by commas, and an amount. The longest match wins. A postcode outside every zone cannot book the delivery.

With **By distance**, the fee depends on the kilometres to the customer's address. See [Delivery fees by distance](delivery-fees.md).

### Cleaning

A cleaning fee is usually a fixed amount per item or per booking.

### Damage waiver

A damage waiver is usually a percent of the rental that customers can choose. With a waiver on the order, a customer pays damage only up to the **Excess with a waiver**, across all damage charges of the booking. The waiver covers the rest. Set the excess in **Settings → Policies**; 0 means the waiver covers everything.

With **Require a damage waiver or insurance before pickup** turned on, a booking can only be picked up with a waiver on the order or an insurance certificate from the customer.

### Extension fees

When staff **Extend** an order, OpenRent normally charges the difference between the new and the old rental price. With an active **Extension** fee, that fee is charged instead, priced for the extra time. OpenRent uses one extension fee, so keep one active.

### Late fees

Turn on **Charge late returns** in **Settings → Policies** and set the **Late grace (minutes)**. When a booking is checked in after its return time plus the grace, a **Late return** line is added once.

- With an active **Late return** fee, the fee is priced for the late time.
- Without one, the rental is priced again for the time it was really out, and the difference is charged.

## Price explanations

On **New order**, each line shows how its price was worked out, step by step. For example:

- "2 × €20.00 per day" and "1 day not charged";
- "High season: 20% more for 50% of the rental (+€4.00)";
- "Coupon SPRING: −€5.00";
- "Set: components €90.00 less 10%".

The same steps come with every price quote from the API.
