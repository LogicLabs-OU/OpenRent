---
"@openrent/core": minor
"@openrent/db": minor
"@openrent/api": minor
"@openrent/admin": minor
---

Reporting views for BI tools: in Settings → Data access a shop makes database logins for Metabase, Power BI or Looker Studio. They read views of the shop's orders, lines, payments, invoices, customers, stock and daily utilisation in the schema `bi`, only the shop's own rows, and cannot change anything. Operators turn it off with `OPENRENT_BI_ACCESS=off`; the owner database role needs `CREATEROLE`. Erasing a shop removes its logins.
