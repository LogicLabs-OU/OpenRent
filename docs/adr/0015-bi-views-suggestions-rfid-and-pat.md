# ADR 0015: Release 1.3: BI views, price suggestions, RFID and electrical safety tests

Status: accepted

Release 1.3 is about data and the warehouse: PRD FR-REP-5, FR-PR-9, FR-SCAN-7 and FR-MNT-5.

## BI views

- **A database login per tool, not an export.** BI tools want SQL. A shop makes logins in Settings → Data access; each is a PostgreSQL role, a member of `openrent_bi`, made on the migration connection (which needs `CREATEROLE`). Passwords reach the database only as SCRAM verifiers.
- **The views filter by themselves.** The views in schema `bi` belong to `openrent_bi_reader` and keep only rows whose shop is the login's (`bi_access`). The tenant policy trusts `app.tenant_id` and `app.system`, which any session may set, so it cannot be what keeps BI logins apart; the views' own filter, which no session setting reaches, does. The views are `security_barrier`, and logins can read nothing else: no tables, no functions of the app.
- **Columns, not tables.** Each view picks its columns, in plain names, with money in minor units, so password hashes, tokens and HTML never reach a BI tool.
- **Role changes run between transactions.** A request that makes a login opens its own short transactions; the role is made on another connection between them, never while a transaction waits.

## Price suggestions

- **Suggestions, never changes.** A weekly job compares each product's next twelve weeks with how full they are and were a year ago. Accepting one makes an ordinary season price rule; nothing else changes prices.
- **A quiet week needs a past.** Only products booked more than a year ago can have a quiet week: for anything newer, an empty week a year ago means nothing.
- **Decisions stick.** Dismissed or accepted dates are not suggested again; open suggestions keep their id when they come out the same, so a refresh never pulls one away from someone accepting it.

## RFID

- **Readers post, OpenRent listens.** A reader (or its bridge) posts batches to its own address with a token. Formats are plugins (plugin API 1.10, `registerTagReader`); OpenRent's own JSON needs none. LLRP and vendor SDKs stay on the bridge's side.
- **Reads are kept a day**, deduplicated per tag and second, and counted from when they reached OpenRent, so neither the reader's clock nor the browser's matters.
- **One read, many units:** the scan page takes every unit at once, onto an order as far as they fit (`assignUnits` with `partial`) or back from the bookings they are out on. Tags that belong to no unit are listed.

## Electrical safety tests (PAT)

- **An interval kind, not a new schedule.** A service interval of the kind `electrical_test` says which units need a test and how often (days only). A passing test is that interval's service, so due lists and the daily job work as for any service.
- **Tests are records.** They cannot be changed or removed (a trigger, like inspections). A failed test opens a repair ticket and takes the unit out of service.
- **The check is at the scan and at pickup.** A unit without a valid test cannot be put on a booking, and pickup stops for one whose test ran out after it was put on.
- **The certificate is made when it is opened**, as PDF where the installation makes PDFs, from the stored test. It is not a numbered document.

## Test infrastructure

- **The PGlite stand-in keeps a connection's messages together.** pglite-socket gave its one backend to another connection between any two messages outside a transaction; a query's Parse, Bind and Execute could then mix with another's, and a request waited forever. The stand-in now treats a connection's messages up to its Sync as one, with a regression test.
