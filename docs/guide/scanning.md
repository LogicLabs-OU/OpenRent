# Scanning

Barcodes make the counter work fast: you scan instead of typing and clicking. OpenRent works with USB and Bluetooth barcode scanners and with the camera of a phone, tablet or laptop.

## What you can scan

- **Units:** the barcode on each serialised unit. Print labels under **Inventory**: tick the units and click **Print labels**.
- **Bulk items:** the label of a bulk product.
- **Orders:** the QR code on the confirmation or the pick list, or the order number, for example `1042` or `#1042`.
- **Customers:** an email address or phone number.

A successful scan gives a short high beep, a failed one a low double tone. The screen flashes too.

## Scanners

Most scanners type the code like a keyboard and press Enter at the end. Plug the scanner in or pair it, and it works on every page of the admin.

While you type in a text field, OpenRent does not treat your typing as a scan. Fields meant for scanning, such as **Type or scan a code** on the **Scan** page, take scans too. You can also type a code there and press Enter.

## Setting up a scanner

Each scanner can add its own characters around the code or end it with another key. Set up each computer or tablet once:

1. Open **Scan** and click **Set up scanner**.
2. Scan any barcode with this device's scanner.
3. Check **Text printed under the barcode**. Correct it if it differs from the label: anything around it is then treated as added text.
4. The dialog shows what the scanner sends: **Added before**, **Added after**, **Ends with** (Enter, Tab or a pause) and the **Time between keys**.
5. Click **Save**.

The settings are kept in this browser on this computer only. Every counter can have its own scanner. **Scan again** repeats the test, and **Use defaults** goes back to nothing before or after the code, ending with Enter.

## The camera

On the **Scan** page, click **Use camera** and allow the browser to use it. On phones and tablets the back camera is used. Hold the barcode in view: the code is read by itself. The same code is not read twice within two seconds. Click **Stop camera** when you are done.

The camera reads QR codes and the usual label barcodes (Code 128, Code 39, EAN-13 and EAN-8).

## Scanning on any page

Outside the **Scan** page and the order page, a scan opens what it belongs to:

- an order opens the order;
- a unit opens the order it is on, or the unit in **Inventory** when it is not on an order;
- a customer opens the customer;
- a bulk label opens the bulk stock in **Inventory**.

## The Scan page

**Scan** has one **Mode** at a time. Pick it at the top left:

- **Look up:** scan anything to see what it is and what to do next, for example "next: Mark picked up".
- **Prepare** and **Pick up:** put units on an order and hand it over.
- **Check in returns:** check returned units in.
- **Swap:** replace a unit that is out.
- **Stock take**, **Inspect** and, with more than one location, **Receive**.

Each scan adds a line to **Results**, with a link to the order or unit and its status. Errors show there in red, for example "Nothing matches 12345". The mode you chose stays while the browser tab is open.

## Assigning units by scanning

On the order page, while the order is reserved or prepared, scan each unit. The field **Scan to assign a unit** takes the scan, and the unit goes on the matching line. You can also click in the field, type the barcode and press Enter.

On the **Scan** page, use **Prepare**:

1. Scan the order's QR code, or type its number. The results say "Order #1042 is open for scanning".
2. The order card lists each line with its shelf (when one is set), the units already assigned and how many are **to scan**.
3. Scan each unit. A line shows **Done** when it is complete.
4. When nothing is left to scan, click **Mark prepared**. The order is ready for pickup.

A unit is refused when it is not on the order, belongs to another location, needs inspection, is hard down or is in transit. The reason shows in the results. Click the **×** on the order card to leave the order without finishing.

## Pickup by scanning

Use **Pick up** on the **Scan** page:

1. Scan the order's QR code.
2. Scan each unit that is not assigned yet.
3. Enter the name next to **Customer accepts the rental agreement as**. The customer can also sign in **Customer signature**.
4. Click **Mark picked up**. The button works once no unit is left to scan.

The same rules apply as on the order page, for example the ID check. See [Orders](orders.md#pickup).

## Returns by scanning

Use **Check in returns** on the **Scan** page and scan each unit that comes back. Each one is checked in as OK on its order, and the results say "… checked in". You do not need to open the order first.

On an order that is out or partly returned, the field **Scan to check a unit in** does the same for that order.

A scan always checks a unit in as OK. For a unit that is damaged, lost or needs inspection, use **Check in** on the order and choose the outcome there. Late fees work as for any return. See [Orders](orders.md#returns).

## Swapping a unit by scanning

Use **Swap** on the **Scan** page:

1. Choose what the unit coming back becomes in **Unit coming back becomes**: **Needs inspection**, **Soft down** or **Hard down**.
2. Scan the unit the customer brings back.
3. Scan the unit that replaces it.

## Stock take, inspection and receiving

- **Stock take:** choose the **Location** if you have several and click **Start counting**. Scan every unit on the shelves. The counts show **Found**, **Not seen yet**, **Belongs elsewhere** and **Unknown codes**. Units out on rental are not expected. **Finish count** lets you mark the units not seen as lost and move the units found here to this location; click **Apply**. **Discard count** changes nothing.
- **Inspect:** scan a unit and its checklist opens. A failure takes the unit out of service with a repair ticket.
- **Receive:** lists the transfers on their way. Scan each unit that arrives; it is booked in on its transfer.

## Offline scans

The **Scan** page keeps working when the connection drops, for example in a store room without signal. In **Prepare**, **Pick up**, **Check in returns**, **Stock take** and **Receive**, scans are saved on this device:

- A bar says "No connection" and how many scans are saved.
- Each scan shows "Saved offline; it is sent when the connection is back".

When the connection is back, the saved scans are sent by themselves, also when you open **Scan** again later. **Send now** sends them at once. A message then says how many were done and how many need checking, and each scan gets its result in **Results**.

Good to know:

- A scan counts at the time you made it. A return scanned offline is late, or not, by that time, not by the time it was sent.
- A scan that no longer fits, for example a unit that was checked in another way meanwhile, is reported. The other scans still go through.
- Scans older than seven days are refused.
- For **Prepare** and **Pick up**, open the order while you still have a connection. **Mark prepared** and **Mark picked up** need the connection.
- **Look up**, **Swap** and **Inspect** need the connection, and so do the other pages of the admin.
