# Equipment Rental Management Software: Market Landscape, Open-Source Gap Analysis, and a PRD for an Open-Source Booqable Alternative

The commercial equipment-rental software market is crowded and mature: Booqable leads SMB "rent online" use cases, Rentman and Current RMS lead AV/event production, and Point of Rental and Quipli lead construction and tool hire. The open-source side is thin and fragmented. Only a few projects target rental directly, and none yet has the maturity, community or feature depth of Booqable. A modern, well-governed open-source rental platform is a real and defensible gap. To win, it has to beat Booqable on the availability engine, pricing flexibility and openness (API, self-hosting, data ownership), not on website-builder polish.

## TL;DR

- **Booqable** (from $29/mo billed yearly, $35 monthly; Grow $69/$87; Scale $149/$187; Custom from $349) is the reference SMB product. It combines unlimited inventory and orders with no booking commission, an embeddable storefront, quotes/contracts/invoices, deposits, bundles, and a JSON:API v4 with signed webhooks. Users mainly complain that key features (API, e-signatures, downtime, barcodes, multi-location) are gated behind higher tiers or per-user add-ons.
- **Competitors split into clear segments.** AV/event production (Rentman, Current RMS, Flex, HireHop, RentalWorks) wins on crew, projects and warehouse workflows. Event/party rental (Goodshuffle Pro, TapGoods, RW Elephant) wins on proposals and dispatch. Construction/tool hire (Point of Rental, Quipli, Texada, Wynne RentalMan) wins on fleet, maintenance and B2B accounts. Consumer and leisure rental (Booqable, Twice, Sharefox) wins on e-commerce checkout and self-service.
- **Open-source options exist but are immature or adjacent.** Louez (AGPL, Next.js, 23 GitHub stars) and AdamRMS (AGPL, PHP, 61 stars) are the only dedicated rental projects with real activity. Snipe-IT (15.1k GitHub stars) and Shelf.nu (3.0k GitHub stars) are asset trackers, not rental businesses. Odoo's official Rental app is Enterprise-only. The recommendation is an AGPLv3, PostgreSQL-centred, API-first platform with a database-enforced availability engine, a headless storefront/widget, and a plugin system.

---

## 1. Booqable Deep Dive

### 1.1 Pricing tiers (fetched from booqable.com/pricing, October 2026)

Booqable advertises "From 29/month", "20% off yearly plans", a 14-day free trial with no credit card, and "All plans include unlimited inventory and orders. No commission on bookings." The page shows no currency symbol (it is localised). The figures below match USD listings on review sites.

| Plan | Yearly billing (per month) | Monthly billing | Users | Plan highlights (vendor's own list) |
|---|---|---|---|---|
| **Start** | $29 | $35 | Account owner only | Order & inventory management; quotes, contracts, invoices; real-time availability; Bo AI assistant; website integration with live availability; ready-made booking page; product bundles; product performance reports; cross-selling; payments & integrations ("50+ features") |
| **Grow** | $69 | $87 | +5 extra users with permissions | Everything in Start, plus e-signatures, downtime scheduling, advanced revenue reports, **API access**, one-on-one onboarding ("60+ features") |
| **Scale** | $149 | $187 | +10 extra users with permissions | Everything in Grow, plus activity logs, extra locations (from $29/location/mo), **allow overbooking**, enforced 2FA |
| **Custom** | from $349 | — | 20 extra users (more available) | SSO, IP restrictions, custom account setup, custom development inquiries |

**Paid add-ons:** rental website builder +$19/mo (80+ industry templates); Mobile Point of Sale +$9/user/mo; barcode scanning +$9/user/mo; Deliveries +$9/mo; multi-location +$29/location/mo (Scale). **Terms:** 20% off for universities, accredited institutions and nonprofits; no setup fees; no refunds for unused time.

**Pricing interpretation:** The headline $29 is a single-user, no-API, no-e-signature plan. A realistic three-person shop that wants barcodes, the mobile app and a website lands on Grow: $69 + $19 + (3 × $9 barcodes) + (3 × $9 mobile) ≈ $142/mo billed yearly. That is the price point an open-source product undercuts.

### 1.2 Core features (from the pricing comparison table and product pages)

| Area | What Booqable provides |
|---|---|
| **Inventory & availability** | Rental products, variations, services and sales items; "unique item tracking" (serialised) and bulk quantities; buffer time between rentals (API fields `lead_time`/`lag_time`); product history; availability calendar and reports; temporary stock for sub-rentals; downtime scheduling (Grow+); optional overbooking (Scale) |
| **Bundles & cross-sell** | Product bundles (optionally discounted); collections; cross-selling of accessories (launched July 2026) |
| **Pricing & discounts** | Flat fees, fixed prices and "flexible structures"; rules for seasonal pricing, weekend rates and non-billable pickup/return days; recurring-customer discounts; tax profiles; coupon codes with advanced rules |
| **Security deposits** | Per-order deposits (fixed or % of order); per-product deposits; option to waive deposits for regular customers |
| **Orders & customers** | Orders with automatic pricing and overbooking prevention; order and payment statuses including late returns; notes, tags, custom fields; packing slips; customer database with history and optional login accounts |
| **Documents** | Auto-generated quotes, contracts and invoices; e-signatures (released July 2026); email templates; confirmation emails with a pickup QR code |
| **Payments** | Stripe, PayPal; Square, Adyen, Mercado Pago, Teya, Mollie (beta); payment links; Tap to Pay; card storage and refunds; **pre-authorizations and down payments**; cash/bank/cheque recording |
| **Online booking** | Hosted booking page ("taking bookings in 20 minutes"); embeddable integration (WordPress, Shopify, Squarespace, Webflow, WooCommerce, Lovable); optional website builder; custom domain; minimum notice; blackout periods; checkout customisation |
| **Barcode, mobile, locations** | Barcode/QR generation and mobile scanning (add-on); iOS/Android POS with signatures and Tap to Pay; multi-location (Scale) |
| **Reporting** | Availability, fulfilment, product performance (frequency, revenue, ROI), company KPIs, customer and coupon reports |
| **Integrations** | Zapier (9,000+ apps), Xero, Mailchimp, GA4, Google Ads, Meta Pixel, Weglot, delivery routing (OptimoRoute, Shipday, Spoke Dispatch) |
| **API** | REST API v4 ("Boomerang") following JSON:API at `https://{company}.booqable.com/api/4`; webhooks for orders, customers, products and more; v4 webhooks signed with HMAC-SHA256 over timestamp + raw body; legacy v1 still documented; official Ruby client |
| **Security, i18n, AI** | Permissions; activity logs and enforced 2FA (Scale); SSO and IP restrictions (Custom); 10+ back-office languages; "Bo" AI assistant (July 2026) on all plans |

### 1.3 Target market

Booqable says it is "Trusted by 8,500+ rental businesses across dozens of industries". Its marketing and review sites position it for SMBs in event & party, equipment & construction, camera & AV, outdoor/sports and vehicle/trailer rental. Its centre of gravity is small operators who want to **take bookings online** without building a web shop.

### 1.4 Strengths

- **Time-to-value and UX.** Reviews consistently praise easy setup, an intuitive UI and responsive support. Booqable shows 4.8 from 1,000+ reviews, and GetApp analysed 1,195 verified reviews.
- **E-commerce-first.** The embeddable storefront works on most website builders, and the hosted booking page means even operators without a website can take payments online.
- **Transparent, commission-free pricing** with a public feature matrix. This is unusual compared with Point of Rental or Texada.
- **Broad payment-provider coverage**, including pre-authorisations, which is the right primitive for deposits.
- **Developer surface.** A JSON:API v4 with signed webhooks is more modern than most competitors' APIs.

### 1.5 Weaknesses (from user reviews and the pricing structure)

- **Tier gating.** Reviewers say "Some features like the app and other preferences aren't offered with the base plan" and that "features crucial for a fully digital shop are missing or locked behind a more expensive plan". One reviewer called Booqable "Great for start ups and small businesses, but lacks some features".
- **Checkout lives on Booqable's domain, not the merchant's site.** One reviewer notes this "can be tricky, especially with a multilingual site".
- **Limited depth for complex operations.** There is no crew/labour planning, no project/job hierarchy, and only light maintenance (downtime blocks rather than work orders). SelectHub reviewers mention the absence of "inventory sales and depreciation tracking".
- **Per-user add-ons** (barcodes, mobile POS) make costs scale with staff, not value, and advanced pricing structures have a learning curve.

### 1.6 What makes Booqable stand out

Booqable is the most polished **"Shopify for rentals"**: a self-serve SaaS that turns a product catalogue into a bookable online store with live availability in under an hour. It also has transparent pricing, no booking commission and a modern API. Its moat is distribution and UX, not unusual operational depth.

---

## 2. Competitor Landscape

### 2.1 Segment map

| Segment | Typical buyer | Leaders | What matters most |
|---|---|---|---|
| **SMB / online-first rental** (bikes, cameras, outdoor, party basics) | 1–10 staff, B2C | Booqable, Twice Commerce, Sharefox, EZRentOut | Storefront, checkout, payments, simple availability |
| **AV / event / film production** | Rental houses, production companies | Rentman, Current RMS, Flex, HireHop, RentalWorks, AdamRMS (OSS) | Projects/jobs, sub-rentals, containers/cases, crew, transport, warehouse pick/pack |
| **Party / event décor rental** | Event rental companies | Goodshuffle Pro, TapGoods, RW Elephant, Party Rental Studio, InflatableOffice | Visual proposals, packages, dispatch/routing, damage waivers |
| **Construction / tool / heavy equipment** | Independent yards to national chains | Point of Rental, Quipli, Texada, Wynne RentalMan, InTempo, Alert | Fleet, meter readings, maintenance/inspections, B2B accounts/PO billing, telematics, ERP accounting |
| **Lending libraries / Library of Things** | Nonprofits, councils, schools | Lend Engine, myTurn | Memberships, low/zero fees, volunteer-friendly UX |

### 2.2 Product profiles

**Rentman (Netherlands): AV and event production**
- Pricing: modular. A mandatory **€39/month platform fee**, then per "Power User" modules: Inventory Standard €14 / Pro €19; Crew Essential €14 / Standard €19 / Pro €24; Organize €14; Quoting & Invoicing add-on €9; History Logs €12; "Rental" bundle €23 Standard / €28 Pro. Basic users are free. Yearly billing saves 8%. There is a 30-day trial.
- Standout: equipment, crew scheduling, quoting and project information in one platform. Rentman says it has 50,000+ users and cites its own 2025 survey finding that 53% of AV professionals lacked a single source of information. Free basic users suit freelancer-heavy crews.
- Note: older USD figures on Capterra and GetApp ($19/$25 Inventory) do not match the current official EUR page.

**Current RMS (UK, Kerridge Commercial Systems): AV, production, events**
- Pricing: per user, $79 for the first user and $49 for each additional user per month. All features sit on one tier, with a 30-day self-serve trial and no card.
- Features: barcode/QR labels, temporary and permanent containers, job planner, labour and transport scheduling, testing and maintenance, and a public wishlist/roadmap.
- Standout: a "universal" all-features-included model for production rental houses.

**HireHop (UK): equipment, AV and event hire**
- Pricing: a free single-user plan with limited functionality. Paid plans are £46/month for the first user and £23 for each extra user (plus VAT). Enterprise is custom (sandbox accounts, CDC data replication, multi-currency, ERP integration).
- Features: stock control, multi-depot, job ledgers with recurring invoices, partial returns and off-hires, multi-terminal checkout, open API, custom fields, and accounting posting (Xero, QuickBooks, Sage).
- Standout: it combines depth with price. HireHop is rated 4.9 on Software Advice and pitches itself as "the most powerful and versatile equipment rental software".

**Flex Rental Solutions: Pro AV and live events (enterprise)**
- Pricing: quote-based. One listing shows ~$435/month with unlimited users.
- Standout: warehouse management (pull sheets, load lists, truck packing, barcode returns) and phase-based projects (advance, load-in, show, strike). It is inventory-first, and LASSO notes that Flex has no crew scheduling.

**RentalWorks (Database Works): entertainment, film and AV rental houses**
- Pricing: quote-based. Standout: multi-warehouse operations, a customer storefront/portal, and integrated accounting and purchasing. Capterra scores (ease of use 3.6, features 3.8 across 138 reviews) suggest it is powerful but dated.

**EZRentOut (EZO): general equipment rental, mid-market**
- Pricing: current listings vary a lot. They show Essential at roughly $59–$89/month, Growth at $179–$399, Premium at $349–$499, and custom Enterprise. Older plans were Standard $49.98 / Plus $134.97 / Premium $224.95.
- Features: online store, POS, e-signatures, invoice designer, equipment depreciation, bundles and promotions, B2B customer management, API, and a mobile app.
- Standout: an asset-management heritage (sister products EZOfficeInventory and AssetSonar), so it is strong on depreciation and asset lifecycle.

**Point of Rental (US): general rental through enterprise**
- Products: **Essentials** (cloud, for small businesses; pricing by quote; ITQlick's 2026 review, a third-party source not confirmed by the vendor, lists "Inventory Only at $50 per user per month and Essentials Plus at $125 per user per month") and **Elite** (a light ERP, multilingual and multi-currency, cloud or self-hosted).
- Features: inspections with checklists and condition photos, GPS/telematics, multi-branch asset balancing, automated locker-based 24/7 rentals, and the "Rental Intelligence Suite".
- Standout: the breadth and maturity of a long-established vendor. Point of Rental's own blog says it was "founded on April 5, 1982" (as Overland Rentals in Grand Prairie, Texas, with the software written in 1983), which makes it 44 years old in 2026. Some reviewers report onboarding and refund problems, and pricing is opaque.

**Quipli (US): independent construction and general-tool rental**
- Pricing: **$6,000 per location per year**, flat, with unlimited users and unlimited inventory. Onboarding and support are included.
- Features: white-label SEO rental website; e-commerce checkout with e-signature and proof-of-insurance upload; equipment statuses (available, rented, past due, soft down, hard down); QR bulk check-in/out; damage invoicing; on-account/PO billing; damage waiver insurance; pricing calendar; v3.0 AI features (alias search, "Quipli Mate" support bot).
- Standout: modern e-commerce for a segment served by legacy systems. It explicitly says it is not a fit for event, boat or golf-cart rental.

**Twice Commerce (formerly Rentle, Finland): retail chains and leisure rental**
- Pricing: Discover $29, Build $69, Advance $285 per month.
- Features: rent, sell and subscriptions in one catalogue; channel-specific pricing and visibility; packages and variants; WordPress plugin.
- Standout: built for retailers adding "rental as a service". The vendor says a department store chain onboarded 40 stores and 1,000+ employees in six weeks. Some reviewers call it a short-term solution because of limited pricing flexibility and payment-provider limits.

**Sharefox (Norway): sports, vehicles, boats, construction (Nordics/EU)**
- Pricing: from €99/month billed yearly, up to €299+, depending on assortment size, locations and modules.
- Features: a strong pricing engine (dynamic, seasonal, promotional, customer-specific); ID and driver-licence verification; digital waivers; self-service pickup via smart locks and key lockers; B2B module; Nordic accounting (Tripletex, Fortnox, e-conomic) and Vipps payments.
- Standout: unattended, 24/7 self-service rental and identity verification.

**Goodshuffle Pro (US): event and party rental**
- Pricing: Lite $39/month; Standard $99/month billed yearly ($139 monthly). Extra full users cost $49 and limited users $19. The website integration is a paid add-on ($59/month).
- Features: unlimited projects, quotes and contracts; conflict detection; digital pull sheets; "Dispatch with AI Auto Route"; subrentals; QuickBooks Online and Google Calendar integrations.
- Standout: event-styled proposals and wishlist-driven quoting. It is rated 4.8 across 157 Capterra reviews.

**Texada and Wynne RentalMan: enterprise construction**
- Texada (SRM) is quote-based and was not verified in this research; it is generally positioned for rental plus service/parts operations at dealers. Wynne says RentalMan is "used by 7 out of the top 10 equipment rental companies in North America" and has been developed since 1991. Neither competes with an SMB open-source product.

**Other named products (not independently verified):** Alert Rental (EasyPro) and InTempo serve traditional event/equipment rental houses. TapGoods (from $69/mo), RW Elephant ($80–$185/mo, with item/order/user caps), Party Rental Studio ($29.95–$69.95) and InflatableOffice ($39–$264 by item count) serve party rental. Rentrax, Yo!Rent and Rent Centric are vehicle/bike/marketplace tools. Checkfront and Peek suit time-slot tours and activities more than inventory-heavy equipment. Rentopian, Integrated Rental and Rigsheet are event/AV niche tools. Gearbooker is a peer-to-peer camera marketplace. Rentals United (vacation-rental channel manager) and Wherefour (manufacturing ERP) are **out of scope**.

### 2.3 Feature comparison matrix

Legend: ✓ = documented in sources reviewed; ~ = partial, add-on or higher tier only; ✗ = not offered or explicitly absent; ? = not verified.

| Capability | Booqable | Rentman | Current RMS | HireHop | Flex | EZRentOut | Point of Rental | Quipli | Twice | Sharefox | Goodshuffle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Serialised + bulk inventory | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bundles/kits/containers | ✓ | ✓ | ✓ (containers) | ✓ | ✓ | ✓ | ✓ | ? | ✓ | ✓ | ✓ (packages) |
| Buffer/turnaround time | ✓ | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Seasonal/advanced pricing | ~ (rules) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (pricing calendar) | ✓ (channel pricing) | ✓ (strongest) | ✓ |
| Online storefront/widget | ✓ | ~ | ~ | ✓ | ✗/? | ✓ | ✓ | ✓ | ✓ | ✓ | ~ (paid add-on) |
| Quotes → contracts → invoices | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| E-signature | ~ (Grow+) | ? | ? | ? | ? | ✓ | ✓ | ✓ | ? | ✓ (waivers) | ✓ |
| Security deposits / pre-auth | ✓ | ? | ? | ? | ? | ? | ? | ✓ (damage waiver) | ? | ✓ | ? |
| Barcode/QR check-in/out | ~ (add-on) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Maintenance/inspections | ~ (downtime) | ? | ✓ | ✓ | ✓ | ✓ | ✓ (checklists, photos) | ✓ | ? | ✓ (condition) | ? |
| Crew/labour scheduling | ✗ | ✓ (strongest) | ✓ | ✓ | ✗ | ✗ | ? | ✗ | ✗ | ✗ | ✗ |
| Delivery/dispatch/routing | ~ (add-on) | ✓ (transport) | ✓ | ? | ✓ | ? | ✓ | ✓ | ? | ? | ✓ (AI route) |
| Multi-location | ~ (Scale) | ✓ (warehouses) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? |
| Self-service lockers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ? | ? | ✓ | ✗ |
| Public API | ~ (Grow+) | ✓ | ✓ | ✓ | ? | ✓ | ✗/? (Essentials) | ? | ? | ✓ | ? |
| Free tier | ✗ | ✗ | ✗ | ✓ (1 user) | ✗ | ✗ | ✗ | ✗ | ✗ | ? | ✗ |
| Self-hostable | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (Elite) | ✗ | ✗ | ✗ | ✗ |

**Takeaway:** No commercial SMB product is self-hostable or open. Advanced segment features (crew, lockers, fleet telematics) are spread across vendors, so the open-source opportunity is a strong **core** plus **plugins**, not one monolith that tries to match all of them.

---

## 3. Existing Open-Source Solutions

### 3.1 Inventory of OSS options

| Project | Type | License | Stack | Maturity signals (Oct 2026) | Rental fit | Key gaps |
|---|---|---|---|---|---|---|
| **Louez** (Synapsr) | Dedicated equipment rental platform | AGPL-3.0 | Next.js 16, TypeScript, Drizzle + MySQL, better-auth, React PDF; Docker Compose with MinIO | 23 stars, 8 forks, 1,013 commits, Docker image, hosted cloud (louez.io) | **High.** Storefront with real-time availability, cart and checkout, reservations, calendar, customers, PDF contracts, emails, team roles, 8 languages, optional Stripe, multi-tenant "platform" mode, AI storefront advisor and voice receptionist | Very young community; no barcode/check-in workflows; no documented bundles/serialised-unit engine; MySQL; proprietary Nucleo icons complicate pure-FOSS redistribution |
| **AdamRMS** | Rental management for theatre/AV/broadcast | AGPL-3.0 | PHP 8.3 + Twig, Docker (amd64/arm64), Expo mobile app | 61 stars, 42 forks, ~91 open issues, updated Oct 10, 2026; hosted paid option | **High for AV.** Assets, projects, clients, billing, multi-tenant "instances", API v1 | Niche (AV/theatre), dated UI, no e-commerce storefront focus |
| **OpenRental** (qx04222) | Equipment rental for North American yards | Apache-2.0 | TypeScript, tRPC, Postgres (63 tables), React, offline PWA | 1 star, brand new, extracted from a production system | **Medium–high for construction.** Fleet ledger, order lifecycle, tiered pricing, deposits tiered by rental length, damage claims → credit notes, receivables, offline inspection PWA, Canadian GST/PST/HST | No community, no storefront, North America-specific |
| **RentalCore** (nbt4) | Event rental (German) | MIT per AlternativeTo (unverified on GitHub) | Go 1.24, Gin, GORM, PostgreSQL 16, React, Docker | ~47 stars per a third-party list; 670 commits; release 5.3.122 on Oct 7, 2026 | Medium. Jobs, devices, packages, bulk scanning, DIN-5008 invoicing, M365 sync | German-centric, small community |
| **Shelf.nu** | Asset management with bookings | AGPL-3.0 | TypeScript, React Router + Hono | ~3,042 stars, 382 forks, updated Oct 23, 2026; v2.1.0 added iCal feed and quantity-tracked availability | **Low–medium.** Bookings, kits, custody, QR tags, audits, hierarchical locations | Internal lending, not a rental *business*: no pricing, quotes, invoices, deposits or storefront |
| **Snipe-IT** | IT asset management | AGPL-3.0 | Laravel/PHP 8.2+ | ~15,052 stars, 4,022 forks, releases Oct 20–22, 2026 | **Low.** Check-out/in with expected return date, "requestable" assets | **No future-dated reservations** (feature request #5081 long open; third-party "SnipeScheduler" add-on). No billing |
| **Odoo Rental (official)** | ERP module | Proprietary (Enterprise) | Python/Odoo | Mature | High | **Enterprise-only.** The Odoo forum confirms "Rental app available only in enterprise edition" |
| **OCA sale_rental / vertical-rental** | Odoo Community modules | AGPL-3 | Python/Odoo | sale_rental supports 10.0–17.0; vertical-rental repo ~24 stars | Medium | "rental per hour / per week / per month is not supported"; day only. Needs Odoo expertise |
| **Third-party Odoo and ERPNext/Frappe apps** (Acespritech, BrowseInfo, Vraja; Solufy, Baril27/rentals) | Paid or small modules | Mixed (LGPL/GPL/MIT) | Python | Commercial ($57–$355) or small, scattered | Low–medium | Vendor-dependent or contract/lease-oriented; weak availability engine and storefront |
| **Dolibarr: DoliRent (Altairis), Booking (KSIDol)** | Dolibarr modules | Commercial (DoliRent €1,200) | PHP | DoliRent v2026.06, Dolibarr 18+; Booking supports Dolibarr 19–23 with iCal/WooCommerce bridge | Medium (French SMB) | Paid, ERP-bound. The DoliStore "Location" module is geography, not rental |
| **WooCommerce plugins** (RnB $29, YITH Booking $249.99/yr, WooCommerce Bookings $249/yr, Tyche, Sales Igniter) | WordPress plugins | GPL code, paid licences | PHP/WordPress | Mature, commercial | Low–medium | Booking-centric. One comparison notes YITH "does not manage any stock" and RnB "stops at the reservation" with no deposit release step |
| **Lend Engine** | Library of Things SaaS | Code published as-is | PHP (Symfony) | Hosted; "no plans to extend Lend Engine to be available to host on your own servers" | Medium (nonprofit lending) | Not a supported self-host product |
| **myTurn** | Library of Things SaaS | Proprietary | — | Nonprofit plans from $25/mo (200 users/550 items) to $100/mo (2,500/7,250) | n/a | Not open-source |
| **pretix** (reference only) | Ticketing | AGPL + plugins | Django | Very mature | Low | **Governance and business model reference:** hosted SaaS plus plugin ecosystem |

### 3.2 Assessment: is there a gap?

**Yes, and it is a clear one.**

1. **No dedicated OSS rental platform has meaningful adoption.** The dedicated projects (Louez 23 stars, AdamRMS 61, OpenRental 1, RentalCore ~47) are two orders of magnitude smaller than adjacent asset trackers (Snipe-IT 15.1k and Shelf 3.0k GitHub stars). Market demand plainly exists, because Booqable alone claims 8,500+ paying businesses.
2. **The popular OSS tools solve the wrong problem.** Snipe-IT and Shelf track *owned assets lent internally*. They have no pricing, quotes, invoices, deposits or public storefront, and Snipe-IT cannot even hold a future reservation.
3. **ERP routes are gated or heavyweight.** Odoo's real Rental app is Enterprise-only. OCA modules only bill by the day. ERPNext and Dolibarr options are small, paid or contract-oriented.
4. **WordPress plugins stop at the booking.** They lack serialised-unit availability, check-in/out, deposit release and real operations.
5. **The newest entrants confirm demand but not dominance.** Louez (storefront-first, AGPL, Next.js) is the closest analogue to "open-source Booqable" and is moving fast (1,000+ commits, hosted cloud, AI features), but its community and operational depth are still minimal.

**Strategic implication:** A new project should either (a) **collaborate with or fork Louez or AdamRMS**, or (b) build a differentiated core aimed at the problems none of them solve well: a rigorous availability engine (serialised + bulk + bundles + buffers, enforced in the database), a powerful pricing engine, a deposit/damage lifecycle, barcode-driven warehouse workflows, and an API/plugin platform. Section 5 assumes (b) but recommends talking to the Louez and AdamRMS maintainers before writing code.

---

## 4. Feature Requirements

Priority key: **MVP** = needed to run a real single-location rental shop end to end; **V1** = needed to compete with Booqable Grow/Scale; **Later** = differentiators and segment plugins.

| Area | MVP (must-have) | V1 (should-have) | Later (nice-to-have) |
|---|---|---|---|
| **Catalogue & inventory** | Product types (rental, sale, service, consumable); **serialised** units (ID/serial/barcode) and **bulk** quantity pools; variants with independent stock; fixed bundles/kits (availability = scarcest component); categories, tags, custom fields, images; per-unit cost and condition; CSV/Excel import/export | Optional/choice bundle components; accessories and cross-sell; meter readings; depreciation and ROI per unit; sub-rentals / temporary stock | Containers/cases (nested AV kits) |
| **Availability engine & calendar** | Real-time availability over date-time ranges for serialised and bulk stock; **buffer/turnaround times** before/after (per product, overridable per order); DB-enforced no-double-booking; blackout periods, opening hours, minimum notice, min/max duration; maintenance downtime blocks; basic calendar; late binding of units; batch availability API | Unit timeline/Gantt view with drag-to-reassign; shortage warnings and controlled overbooking with a reason; assignment rules; cross-location availability and transfers | — |
| **Pricing** | Fixed and flat fees; hourly/daily/weekly/monthly periods plus "price structures" (e.g., day 1 = 100%, day 2 = +50%, week = 4× day); tiered/regressive tables; basic coupons | Seasonal, weekend, holiday rules and non-billable days; customer-specific and B2B price lists, volume discounts; coupon rules; late fees and extension pricing; damage waiver/insurance lines; delivery fees (flat, zone, distance) | Dynamic/utilisation-based pricing suggestions |
| **Order lifecycle** | State machine: Draft → Quote → Reserved → Prepared → Out → Returned (partial/full) → Inspected → Closed, plus Cancelled; partial returns; pull sheets/packing lists | Unit swaps mid-rental; extensions and early returns with automatic repricing; recurring/long-term rentals with periodic billing; delivery/collection scheduling and route export | Projects/jobs grouping orders (AV); routing optimisation plugin |
| **Documents & e-signature** | Templated PDF quotes, contracts, invoices, credit notes, receipts; template editor with localisation; click-to-accept T&Cs with audit trail; legally compliant invoice numbering | Built-in simple e-signature (drawn/typed + hash + timestamp + IP) | DocuSign/Documenso integrations; e-invoicing (Peppol, Factur-X/ZUGFeRD) |
| **Payments, deposits & damage** | Payment-provider abstraction with **Stripe** first; down payments and payment links; offline payments; **security deposits** per order (fixed/%) or per product via card pre-authorisation or charge-then-refund; basic hold/release | Mollie, PayPal, Adyen, Square, Vipps, MercadoPago as plugins; full deposit lifecycle (partial capture against damage, authorisation-expiry handling); damage reports with photos linked to charges/credit notes; deposit waivers for trusted customers | ID/driver's licence verification (e.g., Stripe Identity) |
| **Customers / CRM** | Individuals and companies with contacts, addresses, tax IDs; history, notes, tags, custom fields, blacklisting; GDPR export/anonymise/retention | Customer portal (passwordless; view orders, pay, extend); B2B on-account billing, PO numbers, credit limits | Marketing consent and Mailchimp/Brevo sync |
| **Storefront & widget** | Hosted, themeable booking page with live availability, cart, checkout and payments; **embeddable JS widget/web components** with checkout on the merchant's domain; WCAG 2.2 AA | Headless storefront API + Next.js/Astro starter; WordPress plugin and Shopify app; SEO; analytics hooks (GA4, Meta, Plausible); multi-language and multi-currency storefront | — |
| **Barcode/QR & warehouse** | Generate/print labels; import serials; scan to check out/in via phone camera (PWA) and USB/Bluetooth HID scanners | Bulk scanning for pull sheets; scan-to-verify packing | RFID (UHF); self-service lockers/smart locks |
| **Maintenance & condition** | Unit status (OK, needs inspection, soft down, hard down, retired) | Inspection checklists with photos; work orders; service intervals by date, rental count or meter hours | PAT electrical testing records (UK/EU AV); telematics/GPS plugin |
| **Multi-location, roles, security** | Location in the data model; fixed roles (owner, admin, staff, warehouse, read-only); audit log; TOTP 2FA | Multi-location UI and transfers; custom roles; OIDC SSO | SAML |
| **Notifications & reporting** | Transactional SMTP email with templates and reminders (pickup tomorrow, return due, overdue); revenue, utilisation, availability, fulfilment and overdue reports | SMS/WhatsApp via plugins; custom reports, exports, ROI and customer value | BI connector |
| **API & integrations** | REST API (OpenAPI 3.1) and signed webhooks; iCal feeds; CSV exports | Xero/QuickBooks; Exact/DATEV export; Google/Outlook calendar; Zapier/n8n | Accounting e-invoicing networks |
| **Tax, currency, i18n** | Tax profiles, inclusive/exclusive, multiple rates; one base currency per tenant; i18n of UI, documents and emails | US sales tax via plugin | Storefront display currencies |
| **Deployment, tenancy, mobile** | Single Docker Compose; `tenant_id` on every table for hosted multi-tenant mode; responsive PWA | Helm chart; plugin/extension system; offline scanning queue | Native wrapper app; AI assistants |

