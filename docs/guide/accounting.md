# Accounting

OpenRent books every invoice, credit note, payment, refund and deposit as an accounting entry. You can send the entries to Xero, QuickBooks Online or Zoho Books, or download them as a journal for any other accounting software. Everything is under **Accounting** in the admin.

## Before you start

- **Settings → Issue the invoice:** choose when OpenRent issues invoices by itself, for example when a booking is confirmed. Without invoices, the books show payments but no revenue.
- **Settings → Books closed up to:** set a lock date once a period is closed. Anything dated on or before it is booked on the next day.

## Xero

1. At developer.xero.com, create a **Web app**.
   - Redirect URI: the one shown on Accounting → Setup, for example `https://shop.example.com/api/v1/integrations/oauth/callback`.
   - Copy the client ID and secret.
2. On Accounting → Setup, choose Xero, enter the client ID and secret, save, and click **Sign in with Xero**. Share the organisation (or several) on Xero's screen.
3. If you shared several organisations, choose this shop's.
4. Map the accounts.
   - Revenue accounts, deposits held (a current liability) and the bank accounts payments go to. Xero needs bank accounts here: card payments usually go to a "Stripe" or card clearing bank account.
   - Then a Xero tax rate for each tax rate you charge.
5. Choose the first day Xero does not have yet, and click **Start sending**.

## QuickBooks Online

1. At developer.intuit.com, create an app with the **Accounting** scope, and add the redirect URI from Accounting → Setup.
   - Use the **Development** keys with a sandbox company first.
   - Set "Companies" to `sandbox` in the app details while you do.
2. Sign in with QuickBooks and choose the company.
3. Map the products/services for each kind of line (QuickBooks books revenue through items), Accounts Receivable, the deposits liability, damage income, the bank or Undeposited Funds accounts, and a tax code per rate.
4. Start sending.

## Zoho Books

1. At api-console.zoho.com, create a **Server-based application** with the redirect URI from Accounting → Setup.
2. Enter the client ID and secret and your **data centre**: `com` (US), `eu`, `in`, `com.au`, `jp`, `ca`, `sa` or `com.cn`. It must match where your Zoho account lives.
3. Sign in, choose the organisation, map the accounts and taxes, and start sending.

## Day to day

- **Overview:** what is waiting, what failed and what changed in the accounting system, plus the month's booked totals.
- **Records:** every entry with its status and the record it became, with a link into the accounting system.
  - **Send again** after fixing a mapping.
  - **Mark as handled by hand** when you booked something yourself.
- **Sync log:** every attempt with the accounting system's own message.
- **The invoice PDF** goes onto the invoice in the accounting system (and onto credit notes in Xero and QuickBooks). Turn off **Attach the invoice PDF** in Settings if you do not want this. If an upload fails, the record says so, and **Send again** tries the PDF once more.
- **Payments recorded in the accounting system** (Settings) come back to their orders every 15 minutes, for example from a bank feed.
- **If the accounting system asks you to connect again**, use **Sign in again** on Setup. Nothing is lost: the work waits.

## Checking with real accounts

Before relying on a system, run the live check against a sandbox or demo company:

```sh
XERO_CLIENT_ID=… XERO_CLIENT_SECRET=… XERO_REFRESH_TOKEN=… XERO_TENANT_ID=… pnpm test:accounting-live
```

It reads the organisation's lists, sends one draft test invoice at 0 % tax and voids it. The variables for QuickBooks and Zoho Books are listed at the top of `scripts/accounting-live.ts`.
