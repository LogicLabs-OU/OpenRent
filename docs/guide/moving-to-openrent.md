# Moving to OpenRent

You can bring what you already have into OpenRent in two ways:

- **from a spreadsheet:** customers, products, stock, prices or bookings from a CSV or Excel file;
- **from another system:** **Settings → Move to OpenRent** reads Booqable, Snipe-IT or a Shelf.nu export.

Either way, nothing changes until you have seen what would happen. Running an import again later only adds and updates what changed, so you can keep the old system running for a while and import again before you switch.

## From a spreadsheet

**Import from file…** is on the Customers and Bookings lists. On Products and Stock it is in the **Import / export** menu.

1. Choose the file. OpenRent recognises common column names in several languages, e.g. *E-Mail*, *Phone*, *SKU* or *Start*.
2. Under **Map columns**, say what each other column holds, or choose **Leave out**. The next file with the same columns is mapped the same way by itself.
3. Read the check: what would be created, updated or left as it is, and every row with a problem, named by its row number.
4. **Apply import** brings the whole file in, or nothing if a row has a problem.

To get a file in the right shape, download a template from the import dialog, or export what you have. An export can be edited and imported back.

### Customers

A customer is found again by **Reference** (their number in your old system) or by email. Without either, each row is a new customer. Addresses, VAT number, tags and marketing consent are kept.

### Bookings

Each row is one line of a booking. Rows with the same **Reference** are one booking.

- **Customer:** found by **Customer reference** (the reference of a customer you imported) or by email. A name alone makes a new customer.
- **Start** and **End:** times without a time zone are taken in the location's time zone. `2026-11-02 10:00` and `02.11.2026 10:00` both work.
- **Status:**
  - bookings still to come are **reserved** and hold their stock;
  - bookings that are over are kept as **closed** history, so the reports include them;
  - you can also give the status yourself: *quote*, *reserved*, *closed* or *cancelled*.
- **Overbookings:** a booking needing more stock than OpenRent has comes in anyway, and shows as an overbooking to settle.
- **Prices:** bookings are priced with OpenRent's prices. A booking imported once is not imported again.

## From another system

Open **Settings → Move to OpenRent** and choose where you come from.

**Booqable:**

- enter your account name (the `rentals` in `rentals.booqable.com`) and an API key from **Settings → API keys** in Booqable;
- OpenRent reads customers, products with their price, and bookings;
- archived products stay out;
- set up stock afterwards on the Inventory page, or import it from a spreadsheet.

**Snipe-IT:**

- enter your Snipe-IT address and an API token (your account → **Manage API keys**);
- each asset model becomes a product counted by unit, and each asset a unit;
- a unit keeps its asset tag (as barcode), serial number, purchase date, price and notes;
- archived assets stay out.

**Shelf.nu:**

- export your assets as CSV in Shelf.nu and choose the file;
- assets with the same name become one product, with each asset as a unit;
- the QR code id becomes the barcode and the valuation the purchase price.

OpenRent reads everything in the background, then shows one check per kind of record. **Bring it all in** applies all of them together, in the background too: customers and products first, then stock and bookings. If something fails, nothing is changed and the reason is shown.

Locations are matched by name. Units at a location OpenRent does not have go to your main location. Create your locations first if you want them kept apart.

The API key is used to read your data and is kept encrypted with the background task. It is never shown again.

### Self-hosted Snipe-IT on your own network

By default, OpenRent only connects to public `https` addresses. If your Snipe-IT runs on your own network, set `IMPORTS_ALLOW_PRIVATE_NETWORK=true` for the OpenRent API and worker.

## For developers

The same is available through the API:

- `POST /imports` with an uploaded file;
- `PATCH /imports/{id}` with a column mapping;
- `POST /imports/{id}/actions/apply`;
- `POST /import_batches` for another system, then `POST /import_batches/{id}/actions/apply`.

When an import or a batch has been applied, an `import.completed` webhook event is sent.
