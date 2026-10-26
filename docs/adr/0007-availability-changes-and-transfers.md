# ADR 0007: Changing bookings, and transfers between locations

Status: accepted

ADR 0002 decided how a new booking is checked: one advisory lock per pool (variant and location), a peak-concurrency check against the pool's capacity, and an exclusion constraint on unit bookings. This record covers the cases Phase 2 added, where existing bookings change and stock moves between pools.

## Every change goes through the availability module

- `packages/core/src/availability/index.ts` is the only code that writes `allocations`. A script test (`scripts/allocation-writes.test.ts`) fails on an `INSERT`, `UPDATE` or `DELETE` of allocations anywhere else.
- The primitives:
  - `reserve` places new bookings;
  - `resizeAllocations` moves a start or end (extend, early pickup, early return, delivery windows);
  - `endAllocationsAt` only shortens;
  - `moveUnitAllocation` hands a unit's booking to another unit (swap, reassign);
  - `allocateDowntime` takes stock out of service;
  - `holdForTransfer`, `startTransit`, `endTransit` and `releaseTransferHolds` handle transfers.
- Only the time an allocation grows by is checked. Shrinking frees stock and needs no check.
- A unit conflict (PostgreSQL 23P01) is caught inside a savepoint and becomes a 409 `unit_unavailable`, so the surrounding transaction stays usable.

## Capacity follows where the stock is

- A pool's capacity is the units kept at the location (not retired or lost), or its bulk stock level. Allocations of every kind (reservation, downtime, buffer, transfer) are subtracted from it.
- Stock that moves therefore changes two capacities at once. A transfer allocation makes up for this on each side, so no booking at either location is promised stock that is not there.

## Transfers (FR-LOC-2)

Tables `transfers` and `transfer_lines`. A line is one unit, or a quantity of a bulk variant. Allocations point to their line through `allocations.transfer_line_id`.

| Step | Source | Destination |
| --- | --- | --- |
| Planned | Transfer allocation from the ship date, open-ended. Checked like a booking: stock booked after the ship date cannot be planned. | Nothing yet. |
| Dispatched | If it leaves early, the hold first grows to start now (checked). Then the unit's location changes, or the bulk levels move, and the hold is deleted. Capacity and holds drop together. | In-transit allocation from now until the ETA (open-ended without one). Capacity rises by the same amount, so nothing is free before arrival. |
| Received | — | The in-transit allocation ends at the moment of receipt; quantity still on the way keeps its own allocation. |
| Written off | — | Units not received become `lost`, missing bulk quantity is taken off the stock level. |
| Cancelled (planned only) | Holds deleted. | — |

- A unit on the way has the status `in_transit`. It cannot be assigned to an order or have its status changed by hand until it is received.
- Units out of service cannot travel: their downtime allocation would overlap the hold. They are repaired, or their downtime ended, first.
- A location with planned or in-transit transfers cannot be archived.

## Not covered

- Changing the ship date or the ETA after dispatch. The ETA may change while the transfer is planned.
- Moving stock that is out on rental; it is transferred once returned.
