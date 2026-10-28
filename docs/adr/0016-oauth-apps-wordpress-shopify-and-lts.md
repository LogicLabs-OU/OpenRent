# ADR 0016: Release 1.4: OAuth for apps, WordPress, Shopify and long-term support

Status: accepted

Release 1.4 reaches past OpenRent's own pages (PRD §5.2, FR-SF-7) and is the first long-term support release (§12.2).

## OAuth 2.1

- **Authorization code with PKCE (S256) only.** No implicit flow, no plain challenges, no passwords. Public clients (a WordPress site, a Shopify app server per OpenRent) register themselves (RFC 7591); the operator can register confidential clients with a secret.
- **The person decides on OpenRent's own admin page.** Only people who may manage API keys can approve, for the shop they are in, and the app gets at most the scopes they have. Scopes are the API key scopes.
- **Short access tokens, rotating refresh tokens.** Access tokens last an hour; each refresh token works once. A refresh token or code used twice means it leaked: the whole grant ends. The refusal still commits that ending.
- **An app is an actor of its own** (`app`), limited like an API key, and shown as such in the audit log. Shops see and disconnect their apps in Settings → Apps.
- **Discovery** at `/.well-known/oauth-authorization-server` (RFC 8414) and revocation (RFC 7009).

## WordPress and Shopify

- **Both wrap the widget.** The WordPress plugin's blocks and shortcodes, and the Shopify theme app blocks, write OpenRent's widget elements; the widget does the rest. Nothing about bookings is copied.
- **Both connect with OpenRent sign-in** and add their storefront to the shop's widget sites, so customers who pay online come back. WordPress can use a publishable key instead.
- **The WordPress plugin is tested in a real WordPress** (WordPress Playground, PHP in WebAssembly), so no PHP or Docker is needed; an end-to-end test connects it to a running OpenRent.
- **The Shopify app keeps no customer data.** Its server keeps each shop's tokens; the blocks read their settings from an app-data metafield, which needs no access scope. It is tested against a stand-in for Shopify; a real development store is checked by hand.

## Long-term support

- **Every fourth minor release, from 1.4, gets 18 months** of security fixes and fixes for lost or wrong data, on `lts/x.y`. Fixes land on `main` first.
- **APIs stay as they were** on an LTS branch; a migration there only when a fix needs one, also on `main`, named to sort before `main`'s newer ones.
- **The compatibility matrix** (`docs/compatibility.md`) is made from the SDKs' constants when a release is cut, so it cannot drift.
- **Changes others build on need an RFC** with at least 14 days for comments (GOVERNANCE.md).
