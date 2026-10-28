---
"@openrent/core": minor
"@openrent/db": minor
"@openrent/api": minor
"@openrent/worker": minor
"@openrent/admin": minor
"@openrent/plugin-sdk": minor
"@openrent/plugin-host": minor
"@openrent/plugin-rfid-bridge": minor
---

RFID: units carry EPC tags, readers post their reads to their own address with a token, and the Scan page takes every unit read at once onto an order or back from their bookings, listing tags no unit has. Plugin API 1.10 adds reader formats (`registerTagReader`); the new RFID reader formats plugin reads Zebra IoT Connector and Impinj Speedway Connect messages.
