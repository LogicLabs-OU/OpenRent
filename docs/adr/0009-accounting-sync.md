# ADR 0009: Accounting entries and the accounting sync

Status: accepted

ADR 0008 built a general framework for integrations, with accounting as the first category. Shops found the first version too thin. Account codes and tax ids were typed into free-text settings, the journal was worked out on the fly, deposits, refunds and voids did not reach the books, and nothing showed what arrived. This record describes the accounting that replaced it.

OpenRent still keeps no ledger of its own (PRD §1.3). The books live in Xero, QuickBooks Online or Zoho Books, or in whatever software imports the journal.

## Every money movement becomes an entry

- **Capture by triggers.** Database triggers queue every:
  - issued invoice and credit note;
  - void without a credit note;
  - payment that settles;
  - payment that stops being settled (`accounting_queue`).

  They fire in the same transaction as the write, so no code path can skip the books. Before this, payments confirmed by a webhook and most deposit movements emitted no event and never reached the accounting system.
- **Ordering.** Queue rows use `clock_timestamp()` and ids from a sequence, so movements written in one statement keep their order.
- **Posting.** `accounting.postPending` turns the queue into `accounting_entries` with `accounting_entry_lines`. Entries are balanced and numbered without gaps, under one advisory lock per shop. It runs:
  - in the worker job `accounting.post` every minute;
  - before the Records and Journal views are read;
  - in the backfill that books history once at API and worker start.
- **Never changed.** Entries and lines are append-only (trigger), and a deferred constraint trigger refuses any entry whose debits, credits and total differ. A correction is a new entry that reverses an earlier one (`reversal_of`).
- **Posting rules:**

  | Movement | Entry kind | Debit | Credit |
  | --- | --- | --- | --- |
  | Invoice | `invoice` | receivable (total) | revenue per line type, discounts, tax per rate |
  | Credit note | `credit_note` | the invoice's credit lines | receivable |
  | Payment | `payment` | money account | receivable |
  | Refund | `refund` | receivable | money account |
  | Deposit received | `deposit_received` | money account | deposits held |
  | Deposit paid back | `deposit_returned` | deposits held | money account |
  | Deposit kept for damage | `deposit_applied` | deposits held | damage revenue (or receivable when the damage was invoiced) |
  | Damage captured from a card hold | `damage_revenue` | money account | damage revenue |

  - The money account is the till (cash), card clearing (card or any online provider) or the bank (transfers).
  - Moving a kept deposit inside OpenRent writes two payment rows; the deposits-to-deposits leg books nothing.
  - A voided invoice is undone by its credit note. Only a void without one gets an `invoice_void` reversal.
- **Dates and locking.** Entries carry the shop's local date and the account code in force when they were posted. A lock date moves anything dated on or before it to the day after, keeping the real date in `original_date`.
- **Invoicing.** OpenRent can issue invoices by itself when a booking is confirmed, picked up or closed (`settings.accounting.invoice_when`). Without invoices, the books show payments but no revenue.

## The sync sends entries

- **Plugin API 1.4.** Accounting integrations subscribe to `accounting.entry_posted`, and each task is one entry. The provider sends:
  - an entry from an invoice or credit note as that document;
  - a payment or refund as one (receivables against money);
  - deposits and other entries as a bank transaction or journal;
  - a reversal by voiding or deleting what the reversed entry created.
- **Mapping instead of typed ids:**
  - `lookups` returns the organisation's accounts, tax rates, items, payment accounts and currencies.
  - `mapping` names the choices the shop makes, with fitting account types; `mapsTaxes` maps each tax rate the shop uses.
  - Core checks the mapping against the live lists before syncing starts: complete, still existing, the right type, the same rate, and an enabled currency. It answers with field errors.
- **Payments before their invoice** are sent as unapplied credit: a Xero overpayment, an unapplied QuickBooks payment, or a Zoho Books excess payment. They are applied when the invoice arrives, using the order's payment list on the neutral invoice.
- **Exact totals.**
  - Xero and QuickBooks receive OpenRent's tax amounts.
  - Zoho Books, which works out tax itself, gets the rounding difference as the invoice adjustment.
  - Remote totals are stored with each link and compared.
- **Organisation.** One accounting system per shop, and one organisation per connection. Several organisations of one sign-in can be switched (`organisations`, `useOrganisation`), which restarts the mapping. Signing in again keeps the chosen organisation, the mapping and the start date.
- **Waits and reconnecting:**
  - A provider that answers 429 makes the task wait for its `Retry-After` (`RetryLater`) without counting a failure.
  - A refused token sets the connection to `error` with "connect again". Its tasks wait instead of failing.
  - A daily job refreshes idle OAuth tokens (Xero's lapse after 60 days unused).
- **Two-way, opt-in.** Every 15 minutes `pullPayments` brings back payments recorded in the accounting system against invoices OpenRent sent. Each is linked to its remote id before it is booked, so it is never sent back.
- **Reconciliation.**
  - Every day, `check` compares what was sent in the last 90 days with what the system holds. Changed, voided or deleted records are flagged, and staff with notices on get one.
  - The Records view lists every entry with its sync status, the remote record, a link into the system's web app and the mismatch flag, with "send again" and "mark as handled by hand".

## Consequences

- The Accounting section of the admin holds everything accounting, and the Integrations page keeps the other categories. Permissions are `accounting:read` and `accounting:manage`.
- The journal export and the sync read the same entries, so they always agree. Changing account codes or the mapping affects new entries only.
- **Testing.** Tests run against stateful fakes of the three APIs (`packages/accounting-fakes`) that enforce each system's documented rules. `pnpm test:accounting-live` checks the real APIs when sandbox credentials are set. Real-account behaviour that the documentation does not describe can still differ, so the live check comes before relying on a system.
- **PDFs (plugin API 1.5).** The issued PDF goes onto the remote invoice (and credit note where the system takes one) through `ctx.data.accounting.documentPdf`. The PDF is rendered once and stored, by whichever process has the renderer. A failed upload never undoes the invoice: the link records it, and sending again retries only the PDF.
- **Not yet:** Stripe fees as expenses.
