# Live checks against provider sandboxes

The unit and integration tests talk to fakes of Xero, Google Calendar, Mollie and the other providers. The live checks in `scripts/*-live.ts` talk to the real APIs instead, ideally a sandbox or test account. They show whether a plugin still works with the provider as it is now. Maintainers run them before announcing a release (see [releasing.md](releasing.md)).

## How they work

- **Opt-in.** A provider is checked only when all of its variables are set. Otherwise the script prints `skipped (set …)` and moves on. With nothing set it prints `Nothing to check: no credentials set.` and exits with 0.
- **Output.** Each provider ends with `ok` or `FAILED: <message>`. The script exits with 1 when any check failed.
- **Variables come from the shell.** The scripts do not read `.env`. Put the variables in front of the command or export them first.
- **Where.** Run them from a checkout after `pnpm install`. They use the plugin packages of the workspace and need no database or running server.
- **CI never runs them.** CI runs `pnpm test:scripts`, which is `vitest run scripts` and only picks up `*.test.ts` files. No workflow calls a `test:*-live` script.

| Script | Command | Providers |
|---|---|---|
| `scripts/accounting-live.ts` | `pnpm test:accounting-live` | Xero, QuickBooks Online, Zoho Books |
| `scripts/calendar-live.ts` | `pnpm test:calendar-live` | Google Calendar, Microsoft 365 |
| `scripts/imports-live.ts` | `pnpm test:imports-live` | Booqable, Snipe-IT |
| `scripts/messaging-live.ts` | `pnpm test:messaging-live` | Twilio, MessageBird |
| `scripts/payments-live.ts` | `pnpm test:payments-live` | Mollie, PayPal |

## Accounting

For each system the check refreshes the sign-in and reads the organisation's accounts, tax rates, payment accounts and currencies. It builds a throwaway account mapping, sends one draft invoice `OR-LIVE-<stamp>` for 1.00 at 0 % tax, and voids it again. Zoho Books marks the invoice as sent before it voids it. The invoice is in EUR, or in the first currency the organisation lists when EUR is not among them. The check fails with `no 0 % tax rate to use for the check` when the organisation has no 0 % rate.

| Variable | Notes |
|---|---|
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, `XERO_TENANT_ID` | Use the Xero demo company. |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REFRESH_TOKEN`, `QUICKBOOKS_REALM_ID` | The check always uses the QuickBooks sandbox. |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID` | Required for Zoho Books. |
| `ZOHO_DATA_CENTER` | Optional, default `com` (for example `eu`). |

Get a first refresh token by connecting once from the Accounting page of a development install. Xero and QuickBooks issue a new refresh token on every use. The script prints it as `new refresh token for the next run: …`; save it, because the old one no longer works.

```sh
XERO_CLIENT_ID=… XERO_CLIENT_SECRET=… XERO_REFRESH_TOKEN=… XERO_TENANT_ID=… pnpm test:accounting-live
```

**Left behind:** in each system, the voided invoice `OR-LIVE-<stamp>` and a contact (a customer in QuickBooks) named `OpenRent live check <stamp>`. Each run makes a new pair. Delete or archive them in the provider's web app now and then. If a run fails between sending and voiding, the draft invoice stays too; void or delete it by hand.

## Calendar

Each check puts a made-up booking #9999 for "OpenRent live check" on the calendar. It starts two days ahead on the full hour and lasts one day, so it makes a pickup event and a return event. The check then moves the return one hour later and cancels the booking, which deletes both events.

| Variable | Notes |
|---|---|
| `GOOGLE_ACCESS_TOKEN` | An access token with the `calendar.events` scope, for example from the Google OAuth Playground. |
| `GOOGLE_CALENDAR_ID` | Optional. Empty uses `primary`. |
| `MICROSOFT_ACCESS_TOKEN` | An access token with `Calendars.ReadWrite`, for example from Graph Explorer. |
| `MICROSOFT_CALENDAR_ID` | Optional. Empty uses the default calendar. |

```sh
GOOGLE_ACCESS_TOKEN=ya29… GOOGLE_CALENDAR_ID=… pnpm test:calendar-live
```

These are real calendars, not sandboxes. Use a calendar made for testing. Access tokens expire after a short time, so get a fresh one before each run.

**Left behind:** nothing when the check passes. When it fails part way, events named `Pickup #9999 · OpenRent live check` and `Return #9999 · OpenRent live check` may stay on the calendar about two days ahead. Delete them by hand.

## Imports

The check only reads. It fetches what the importer would import and prints, for each kind of record, how many there are and the first row. It changes nothing in either system.

| Variable | Notes |
|---|---|
| `BOOQABLE_COMPANY` | The company's subdomain: `rentals` for `https://rentals.booqable.com`. |
| `BOOQABLE_API_KEY` | A Booqable API key. |
| `SNIPEIT_URL` | The Snipe-IT address, for example `https://assets.example.com`. |
| `SNIPEIT_TOKEN` | A Snipe-IT API token. |

```sh
SNIPEIT_URL=https://assets.example.com SNIPEIT_TOKEN=… pnpm test:imports-live
```

**Left behind:** nothing in the providers. The first row of each kind is printed to your terminal, and it can hold a customer's name or email. Keep that output out of public logs.

## Messaging

Each check sends one text, `OpenRent live check`, to `TEXT_TO`.

| Variable | Notes |
|---|---|
| `TEXT_TO` | The phone number to text, for example `+3725551234`. Needed for both providers. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Use Twilio's test credentials with the test sender `+15005550006`. |
| `MESSAGEBIRD_ACCESS_KEY`, `MESSAGEBIRD_ORIGINATOR` | Use a MessageBird `test_` key. The originator is the sender name, for example `OpenRent`. |

```sh
TEXT_TO=+3725551234 TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… TWILIO_FROM=+15005550006 pnpm test:messaging-live
```

With test credentials, nothing is delivered or charged. With anything else (a Twilio sender other than `+15005550006`, a MessageBird key without `test_`) the script stops, unless you set `LIVE_CHECK_SEND_REAL_TEXTS=1`: then it sends a real text, and the provider charges for it.

**Left behind:** one text per provider, sent to `TEXT_TO` when the credentials are live. There is nothing to clean up.

## Payments

Each check creates one payment of 1.00 EUR for "OpenRent live check", prints the page a customer would pay on, reads the payment back and then cancels it where the API allows. Nobody pays on the page, so nothing is charged.

| Variable | Notes |
|---|---|
| `MOLLIE_API_KEY` | A Mollie test key. A key that does not start with `test_` is refused. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | A PayPal sandbox app. The check always uses the sandbox. |

```sh
MOLLIE_API_KEY=test_… pnpm test:payments-live
```

**Left behind:** a Mollie test payment, cancelled when Mollie allows it, otherwise open until it expires. A PayPal sandbox order that nobody approved; PayPal lets it expire on its own. You do not need to clean them up.
