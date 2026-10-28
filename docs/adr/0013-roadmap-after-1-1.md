# ADR 0013: Roadmap after 1.1, with the plugin and theme directory deferred

Status: accepted

After 1.1, the PRD still has its M3 Ecosystem milestone, the "Later" requirements and OAuth 2.1 for apps open. This records what comes next, in which order, and what waits.

## Deferred: the directory and the marketplace

- **Not planned for now:** the public plugin and theme directories (`plugins.openrent.dev`, `themes.openrent.dev`) with review, signed packages and one-click install (FR-PLG-10, FR-THM-11), and paid listings (FR-PLG-11). The PRD tags them **Deferred**.
- **How packages are shared instead:** as npm packages and ZIPs. Shops install them by upload (off by default for code plugins) or from `PLUGINS_DIR` and `THEMES_DIR`, as now. `plugins.json` and `themes.json` list the first-party packages an installation loads.
- **Packages stay unsigned.** Signing only pays off with a directory that holds the keys of reviewed authors, so it waits with it. The threat model keeps "plugins are trusted code".
- **The hosted service is funded without a revenue share:** managed cloud, support contracts and onboarding.
- **Coming back to it** needs a new decision (PRD §12.4, decision 8), at the earliest after the first LTS.

## Order of the next releases

Rental operators come first:

1. **1.2:** cases that hold other units (FR-CAT-11), meter billing for construction rentals, Library of Things memberships, e-invoicing, external e-sign (FR-DOC-6) and ID verification (FR-PAY-9).
2. **1.3:** read-only BI views (FR-REP-5), dynamic pricing suggestions (FR-PR-9), RFID (FR-SCAN-7) and PAT records (FR-MNT-5).
3. **1.4:** OAuth 2.1 for third-party apps (§5.2), the WordPress plugin and the Shopify app (FR-SF-7), then the first LTS branch.

After 1.4, every PRD requirement is built except the deferred ones.
