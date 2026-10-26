# ADR 0002: Serialising reservations

Date: 2026-10-24 · Status: accepted

## Context

FR-AV-2 and FR-AV-10 require that a serialised unit is never double-booked and a bulk pool is never oversold, with
100 parallel checkouts for the last unit producing exactly one winner. The PRD suggests SERIALIZABLE transactions plus
an advisory lock per (variant, location).

## Decision

- Serialised units: every assigned unit is an `allocations` row with `stock_item_id`, guarded by
  `EXCLUDE USING gist (stock_item_id WITH =, period WITH &&)`. PostgreSQL rejects overlaps with SQLSTATE 23P01,
  mapped to `409 exceeds_availability` or `unit_unavailable`.
- Pools (bulk stock and unassigned serialised quantity): a reservation takes
  `pg_advisory_xact_lock(hashtext(tenant|variant|location))` for every pool it touches, in sorted order to avoid deadlocks,
  then reads current allocations and inserts its own. This runs under READ COMMITTED: each statement after the lock sees
  rows committed by the previous lock holder, so the check-then-insert is serialised per pool without retry storms.
  Transactions are still retried on 40001 and 40P01.
- Availability maths runs in TypeScript over the overlapping allocation rows (a boundary sweep), so the reservation check,
  the availability API and the calendar share one implementation, which property tests compare to a brute-force reference.

## Consequences

SERIALIZABLE is not needed for correctness and is not used by default. A nightly job reports any pool whose allocations
exceed capacity (for example after a unit is marked lost), which surfaces shortages instead of hiding them.
