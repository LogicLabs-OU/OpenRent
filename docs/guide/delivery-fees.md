# Delivery fees by distance

A delivery fee can be priced by postcode zone or by the distance from your location to the customer's address. This page covers distance.

## Turn on a map

Distances need addresses on a map. Go to **Plugins**, open **OpenStreetMap geocoding** and turn it on:

- **Contact email:** the public Nominatim server asks every application for one. It is sent with each lookup.
- **Nominatim server:** leave it empty for the public server, which allows at most one lookup a second. With your own server, set its address and how many **lookups a second** it allows.
- **Countries:** only find addresses in these countries, for example `ee,lv,fi`. This helps when customers leave out the country.
- **OSRM server:** for distances by road. Without one, OpenRent takes the straight line and multiplies it by the **road factor** (1.3 unless you set another).

Each address is looked up once and kept, so the same address never costs a second lookup.

## Set up the fee

In **Pricing → Fees**, choose **New fee**, type **Delivery**, and **Calculated as: By distance**. Add **distance bands**:

| Up to | Amount |
|---|---|
| 10 km | €15 |
| 40 km | €30 |
| *(empty)* | €60 |

The first band the distance fits is charged. Leave **up to** empty on the last band for any distance beyond the others. Without such a band, addresses beyond the last one cannot book the delivery.

The distance is measured from the booking's location (or the default location) to the address, so make sure each location has its address filled in.

## What customers see

At checkout the delivery says **Price by distance** until the customer enters the address. Then the price shows in the summary, or a message under the address field: the address is missing, cannot be found, or is too far away.

Staff can enter the delivery address on a draft or quote order under **Extras** in the same way.

## Route exports

Deliveries and collections are put on the map when they are booked or re-addressed. On **Deliveries**, **Route (GPX)** downloads the day's stops with their coordinates for a navigation app. The map link on each stop opens the exact point.
