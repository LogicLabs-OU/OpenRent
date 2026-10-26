-- OpenRent initial schema.
-- Invariants live here, not only in application code (PRD §2 principle 2, §8.3).

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Row-level security predicate. A request runs with app.tenant_id set to its tenant.
-- app.system = 'on' is set only by explicit system code paths (auth resolution,
-- worker fan-out) through withSystem() in packages/db.
CREATE OR REPLACE FUNCTION openrent_tenant_ok(t text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT t = current_setting('app.tenant_id', true)
      OR coalesce(current_setting('app.system', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION openrent_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Tenancy, users, auth
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id                text PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  legal_name        text,
  address           jsonb NOT NULL DEFAULT '{}',
  tax_ids           jsonb NOT NULL DEFAULT '[]',
  currency          char(3) NOT NULL,
  timezone          text NOT NULL,
  locale            text NOT NULL DEFAULT 'en',
  settings          jsonb NOT NULL DEFAULT '{}',
  branding          jsonb NOT NULL DEFAULT '{}',
  invoice_numbering jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id),
  name          text NOT NULL,
  address       jsonb NOT NULL DEFAULT '{}',
  timezone      text NOT NULL,
  opening_hours jsonb NOT NULL DEFAULT '{}',
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX locations_one_default ON locations (tenant_id) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE location_blackouts (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  period      tstzrange NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX location_blackouts_period ON location_blackouts USING gist (tenant_id, location_id, period);

-- Users are installation-wide (email unique per installation); tenant access is via memberships.
CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  password_hash text,
  name          text NOT NULL DEFAULT '',
  locale        text NOT NULL DEFAULT 'en',
  totp_secret   text,
  totp_pending  text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON users (lower(email));

CREATE TABLE memberships (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'warehouse', 'read_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  text REFERENCES tenants(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip         text,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('secret', 'publishable')),
  key_hash     text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  actor_type  text NOT NULL,
  actor_id    text,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  diff        jsonb NOT NULL DEFAULT '{}',
  ip          text,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_created ON audit_log (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION openrent_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'P0001', HINT = 'audit_append_only';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION openrent_audit_append_only();

-- ---------------------------------------------------------------------------
-- Catalogue and inventory
-- ---------------------------------------------------------------------------

CREATE TABLE tax_profiles (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  rates      jsonb NOT NULL DEFAULT '[]',   -- [{ "name": "VAT", "rate_bp": 2400 }]
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE price_structures (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('fixed', 'per_period', 'tiered', 'table')),
  period_unit      text NOT NULL DEFAULT 'day' CHECK (period_unit IN ('hour', 'day', 'week', 'month')),
  amount           bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  rounding         text NOT NULL DEFAULT 'up' CHECK (rounding IN ('up', 'nearest', 'down')),
  charge_day_rules jsonb NOT NULL DEFAULT '{}', -- { "non_billable_weekdays": [0] }
  tiers            jsonb NOT NULL DEFAULT '[]', -- [{ "from": 1, "pct_bp": 10000 }, { "from": 2, "pct_bp": 5000 }]
  cap              jsonb,                       -- { "every": 7, "charge": 4 }
  price_table      jsonb NOT NULL DEFAULT '[]', -- [{ "periods": 1, "amount": 2500 }]
  extra_per_period bigint NOT NULL DEFAULT 0,
  currency         char(3) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE TABLE categories (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,
  slug         text NOT NULL,
  parent_id    text REFERENCES categories(id),
  position     int NOT NULL DEFAULT 0,
  translations jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX categories_slug ON categories (tenant_id, slug) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id),
  type              text NOT NULL CHECK (type IN ('rental', 'sale', 'service', 'consumable', 'bundle')),
  name              text NOT NULL,
  slug              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  translations      jsonb NOT NULL DEFAULT '{}',
  visibility        text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden', 'archived')),
  seo               jsonb NOT NULL DEFAULT '{}',
  tags              text[] NOT NULL DEFAULT '{}',
  tax_profile_id    text REFERENCES tax_profiles(id),
  deposit_amount    bigint NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  buffer_before_min int NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min  int NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  min_duration_min  int,
  max_duration_min  int,
  min_notice_min    int NOT NULL DEFAULT 0,
  increment_min     int,
  custom_fields     jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX products_slug ON products (tenant_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);

CREATE TABLE product_categories (
  tenant_id   text NOT NULL REFERENCES tenants(id),
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE TABLE variants (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id),
  product_id         text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                text,
  name               text NOT NULL,
  options            jsonb NOT NULL DEFAULT '{}',
  tracking           text NOT NULL CHECK (tracking IN ('serialized', 'bulk', 'none')),
  price_structure_id text REFERENCES price_structures(id),
  deposit_amount     bigint CHECK (deposit_amount >= 0),
  is_default         boolean NOT NULL DEFAULT false,
  position           int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX variants_product ON variants (tenant_id, product_id);
CREATE UNIQUE INDEX variants_sku ON variants (tenant_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE stock_items (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id),
  variant_id     text NOT NULL REFERENCES variants(id),
  location_id    text NOT NULL REFERENCES locations(id),
  barcode        text NOT NULL,
  serial         text,
  status         text NOT NULL DEFAULT 'available' CHECK (status IN
                   ('available', 'reserved', 'out', 'needs_inspection', 'soft_down', 'hard_down', 'retired', 'lost')),
  condition      text NOT NULL DEFAULT 'good',
  purchase_date  date,
  purchase_price bigint,
  notes          text NOT NULL DEFAULT '',
  custom_fields  jsonb NOT NULL DEFAULT '{}',
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_items_barcode ON stock_items (tenant_id, barcode);
CREATE INDEX stock_items_variant ON stock_items (tenant_id, variant_id, location_id);

CREATE TABLE stock_levels (
  tenant_id   text NOT NULL REFERENCES tenants(id),
  variant_id  text NOT NULL REFERENCES variants(id),
  location_id text NOT NULL REFERENCES locations(id),
  quantity    int NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  barcode     text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, location_id)
);
CREATE UNIQUE INDEX stock_levels_barcode ON stock_levels (tenant_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE stock_adjustments (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  variant_id  text NOT NULL REFERENCES variants(id),
  location_id text NOT NULL REFERENCES locations(id),
  delta       int NOT NULL,
  reason      text NOT NULL,
  reference   text,
  actor_id    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bundles (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  product_id   text NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  pricing_mode text NOT NULL DEFAULT 'sum' CHECK (pricing_mode IN ('sum', 'fixed', 'discount_pct')),
  discount_bp  int NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bundle_components (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  bundle_id  text NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  slot_name  text,
  variant_id text NOT NULL REFERENCES variants(id),
  quantity   int NOT NULL CHECK (quantity > 0),
  position   int NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id),
  type              text NOT NULL DEFAULT 'person' CHECK (type IN ('person', 'company')),
  name              text NOT NULL,
  email             text,
  phone             text,
  company_name      text,
  tax_id            text,
  addresses         jsonb NOT NULL DEFAULT '{}',
  locale            text,
  tags              text[] NOT NULL DEFAULT '{}',
  flags             jsonb NOT NULL DEFAULT '{}',   -- { blocked, deposit_waived, requires_id_check }
  marketing_consent boolean NOT NULL DEFAULT false,
  notes             text NOT NULL DEFAULT '',
  custom_fields     jsonb NOT NULL DEFAULT '{}',
  provider_refs     jsonb NOT NULL DEFAULT '{}',   -- { "stripe": "cus_..." }
  merged_into_id    text REFERENCES customers(id),
  anonymized_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX customers_email ON customers (tenant_id, lower(email));
CREATE INDEX customers_phone ON customers (tenant_id, phone);

-- ---------------------------------------------------------------------------
-- Pricing extras
-- ---------------------------------------------------------------------------

CREATE TABLE coupons (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenants(id),
  code                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value                 bigint NOT NULL CHECK (value >= 0),  -- percent in basis points, fixed in minor units
  scope                 jsonb NOT NULL DEFAULT '{"type": "order"}',
  valid_from            timestamptz,
  valid_until           timestamptz,
  max_uses              int,
  max_uses_per_customer int,
  min_order             bigint NOT NULL DEFAULT 0,
  combinable            boolean NOT NULL DEFAULT false,
  uses_count            int NOT NULL DEFAULT 0,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coupons_code ON coupons (tenant_id, lower(code));

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE TABLE order_sequences (
  tenant_id  text PRIMARY KEY REFERENCES tenants(id),
  next_value int NOT NULL
);

CREATE TABLE orders (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  number           int NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN
                     ('draft', 'quote', 'reserved', 'prepared', 'out', 'returned_partial', 'returned',
                      'inspected', 'closed', 'cancelled', 'expired')),
  customer_id      text REFERENCES customers(id),
  location_id      text NOT NULL REFERENCES locations(id),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  timezone         text NOT NULL,
  currency         char(3) NOT NULL,
  totals           jsonb NOT NULL DEFAULT '{}',
  payment_status   text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN
                     ('unpaid', 'partially_paid', 'paid', 'refunded', 'overdue')),
  deposit_policy   jsonb NOT NULL DEFAULT '{"mode": "auto"}',
  coupon_codes     text[] NOT NULL DEFAULT '{}',
  terms_acceptance jsonb,
  source           text NOT NULL DEFAULT 'admin' CHECK (source IN ('storefront', 'admin', 'api')),
  public_token     text NOT NULL UNIQUE,
  quote_expires_at timestamptz,
  notes            jsonb NOT NULL DEFAULT '{}',
  tags             text[] NOT NULL DEFAULT '{}',
  custom_fields    jsonb NOT NULL DEFAULT '{}',
  version          int NOT NULL DEFAULT 1,
  closed_at        timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (tenant_id, number)
);
CREATE INDEX orders_status ON orders (tenant_id, status, starts_at);
CREATE INDEX orders_customer ON orders (tenant_id, customer_id);
CREATE INDEX orders_period ON orders (tenant_id, starts_at, ends_at);

CREATE OR REPLACE FUNCTION openrent_orders_bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER orders_bump_version BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION openrent_orders_bump_version();

CREATE TABLE order_lines (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id),
  order_id          text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('rental', 'sale', 'service', 'fee', 'discount')),
  product_id        text REFERENCES products(id),
  variant_id        text REFERENCES variants(id),
  bundle_id         text REFERENCES bundles(id),
  parent_line_id    text REFERENCES order_lines(id) ON DELETE CASCADE,
  quantity          int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  starts_at         timestamptz,
  ends_at           timestamptz,
  buffer_before_min int NOT NULL DEFAULT 0,
  buffer_after_min  int NOT NULL DEFAULT 0,
  description       text NOT NULL DEFAULT '',
  price_snapshot    jsonb NOT NULL DEFAULT '{}',
  unit_price        bigint NOT NULL DEFAULT 0,
  subtotal          bigint NOT NULL DEFAULT 0,
  discount          bigint NOT NULL DEFAULT 0,
  tax               bigint NOT NULL DEFAULT 0,
  total             bigint NOT NULL DEFAULT 0,
  deposit           bigint NOT NULL DEFAULT 0,
  picked_up_qty     int NOT NULL DEFAULT 0,
  returned_qty      int NOT NULL DEFAULT 0,
  lost_qty          int NOT NULL DEFAULT 0,
  position          int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_lines_order ON order_lines (tenant_id, order_id);

-- Price snapshots are frozen once an order leaves draft/quote (PRD §8.3).
CREATE OR REPLACE FUNCTION openrent_price_snapshot_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.total IS DISTINCT FROM OLD.total THEN
    SELECT status INTO s FROM orders WHERE id = NEW.order_id;
    IF s NOT IN ('draft', 'quote') THEN
      RAISE EXCEPTION 'price snapshot is frozen for order in status %', s
        USING ERRCODE = 'P0001', HINT = 'price_snapshot_frozen';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_lines_snapshot_frozen BEFORE UPDATE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION openrent_price_snapshot_frozen();

CREATE TABLE order_events (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  order_id    text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        text NOT NULL,
  from_status text,
  to_status   text,
  payload     jsonb NOT NULL DEFAULT '{}',
  actor       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order ON order_events (tenant_id, order_id, created_at);

-- ---------------------------------------------------------------------------
-- Allocations: the availability ledger (PRD §7.4)
-- ---------------------------------------------------------------------------

CREATE TABLE downtimes (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id),
  location_id   text NOT NULL REFERENCES locations(id),
  variant_id    text NOT NULL REFERENCES variants(id),
  stock_item_id text REFERENCES stock_items(id),
  quantity      int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  period        tstzrange NOT NULL,
  reason        text NOT NULL DEFAULT '',
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE allocations (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id),
  variant_id    text NOT NULL REFERENCES variants(id),
  location_id   text NOT NULL REFERENCES locations(id),
  stock_item_id text REFERENCES stock_items(id),
  quantity      int NOT NULL CHECK (quantity > 0),
  period        tstzrange NOT NULL CHECK (NOT isempty(period)),
  kind          text NOT NULL CHECK (kind IN ('reservation', 'downtime', 'buffer', 'transfer')),
  order_id      text REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id text REFERENCES order_lines(id) ON DELETE CASCADE,
  downtime_id   text REFERENCES downtimes(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (stock_item_id IS NULL OR quantity = 1),
  -- A serialised unit can never hold two overlapping allocations (FR-AV-2).
  CONSTRAINT allocations_no_double_booking
    EXCLUDE USING gist (stock_item_id WITH =, period WITH &&) WHERE (stock_item_id IS NOT NULL)
);
CREATE INDEX allocations_lookup ON allocations USING gist (tenant_id, variant_id, location_id, period);
CREATE INDEX allocations_order_line ON allocations (order_line_id);

-- The tracking mode can only change while no current or future allocations exist (FR-CAT-3).
CREATE OR REPLACE FUNCTION openrent_variant_tracking_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tracking IS DISTINCT FROM OLD.tracking AND EXISTS (
       SELECT 1 FROM allocations a
        WHERE a.variant_id = NEW.id
          AND (upper(a.period) IS NULL OR upper(a.period) > now())) THEN
    RAISE EXCEPTION 'tracking mode cannot change while open allocations exist'
      USING ERRCODE = 'P0001', HINT = 'tracking_change_blocked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER variants_tracking_guard BEFORE UPDATE OF tracking ON variants
  FOR EACH ROW EXECUTE FUNCTION openrent_variant_tracking_guard();

CREATE TABLE order_line_units (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  order_line_id    text NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  stock_item_id    text NOT NULL REFERENCES stock_items(id),
  allocation_id    text REFERENCES allocations(id) ON DELETE SET NULL,
  checked_out_at   timestamptz,
  checked_in_at    timestamptz,
  check_in_outcome text CHECK (check_in_outcome IN ('ok', 'needs_inspection', 'damaged', 'lost')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_line_id, stock_item_id)
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

CREATE TABLE document_sequences (
  tenant_id  text NOT NULL REFERENCES tenants(id),
  type       text NOT NULL,
  year       int NOT NULL,
  prefix     text NOT NULL,
  next_value int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, type, year)
);

CREATE TABLE document_templates (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  type       text NOT NULL,
  name       text NOT NULL,
  locale     text NOT NULL DEFAULT 'en',
  body       text NOT NULL,
  css        text NOT NULL DEFAULT '',
  version    int NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  order_id         text REFERENCES orders(id),
  customer_id      text REFERENCES customers(id),
  type             text NOT NULL CHECK (type IN ('quote', 'confirmation', 'contract', 'pick_list',
                     'delivery_note', 'invoice', 'credit_note', 'receipt', 'deposit_receipt')),
  number           text,
  issued_at        timestamptz,
  status           text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'sent', 'voided')),
  html             text NOT NULL,
  data             jsonb NOT NULL DEFAULT '{}',
  total            bigint,
  currency         char(3),
  template_id      text,
  template_version int,
  voided_by_id     text REFERENCES documents(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_order ON documents (tenant_id, order_id);
CREATE UNIQUE INDEX documents_number ON documents (tenant_id, type, number) WHERE number IS NOT NULL;

-- Issued documents are immutable except status and voided_by_id (FR-DOC-3).
CREATE OR REPLACE FUNCTION openrent_documents_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.issued_at IS NOT NULL THEN
      RAISE EXCEPTION 'issued documents cannot be deleted' USING ERRCODE = 'P0001', HINT = 'document_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.issued_at IS NOT NULL AND
     (to_jsonb(NEW) - 'status' - 'voided_by_id' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'voided_by_id' - 'updated_at') THEN
    RAISE EXCEPTION 'issued documents are immutable' USING ERRCODE = 'P0001', HINT = 'document_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER documents_immutable BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION openrent_documents_immutable();

-- ---------------------------------------------------------------------------
-- Payments, deposits, damage
-- ---------------------------------------------------------------------------

CREATE TABLE payment_providers (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  plugin_id        text NOT NULL,
  config_encrypted text,
  mode             text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plugin_id)
);

CREATE TABLE payments (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id),
  order_id          text NOT NULL REFERENCES orders(id),
  provider          text NOT NULL,   -- 'manual' or a provider plugin id
  kind              text NOT NULL CHECK (kind IN ('charge', 'authorization', 'refund', 'manual')),
  purpose           text NOT NULL DEFAULT 'rental' CHECK (purpose IN ('rental', 'deposit', 'damage', 'late_fee')),
  method            text NOT NULL DEFAULT 'card',
  amount            bigint NOT NULL CHECK (amount >= 0),
  currency          char(3) NOT NULL,
  status            text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  provider_ref      text,
  idempotency_key   text,
  parent_payment_id text REFERENCES payments(id),
  note              text,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order ON payments (tenant_id, order_id);
CREATE UNIQUE INDEX payments_provider_ref ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL AND kind <> 'refund';

CREATE TABLE payment_intents (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  order_id     text NOT NULL REFERENCES orders(id),
  provider     text NOT NULL,
  purpose      text NOT NULL DEFAULT 'rental',
  amount       bigint NOT NULL,
  currency     char(3) NOT NULL,
  status       text NOT NULL DEFAULT 'requires_payment',
  provider_ref text,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_intents_ref ON payment_intents (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- Inbound provider webhooks are deduplicated by provider event id (FR-PAY-7).
CREATE TABLE provider_events (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  provider     text NOT NULL,
  event_id     text NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  processed_at timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE deposits (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id),
  order_id        text NOT NULL REFERENCES orders(id),
  amount          bigint NOT NULL CHECK (amount >= 0),
  currency        char(3) NOT NULL,
  method          text NOT NULL CHECK (method IN ('card_auth', 'charge', 'cash', 'waived')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
                    ('pending', 'held', 'partially_captured', 'captured', 'released', 'expired', 'failed')),
  provider        text,
  provider_ref    text,
  payment_id      text REFERENCES payments(id),
  authorized_at   timestamptz,
  expires_at      timestamptz,
  captured_amount bigint NOT NULL DEFAULT 0,
  released_at     timestamptz,
  expiring_notified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (captured_amount <= amount)
);
CREATE INDEX deposits_order ON deposits (tenant_id, order_id);

CREATE TABLE damage_charges (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id),
  order_id      text NOT NULL REFERENCES orders(id),
  stock_item_id text REFERENCES stock_items(id),
  description   text NOT NULL,
  amount        bigint NOT NULL CHECK (amount >= 0),
  tax           bigint NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'captured', 'invoiced', 'waived', 'paid')),
  deposit_id    text REFERENCES deposits(id),
  document_id   text REFERENCES documents(id),
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Notifications, webhooks, outbox
-- ---------------------------------------------------------------------------

CREATE TABLE notification_templates (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  event      text NOT NULL,
  channel    text NOT NULL DEFAULT 'email',
  locale     text NOT NULL DEFAULT 'en',
  subject    text NOT NULL,
  body       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event, channel, locale)
);

CREATE TABLE notifications (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  channel      text NOT NULL DEFAULT 'email',
  template_key text NOT NULL,
  recipient    text NOT NULL,
  audience     text NOT NULL DEFAULT 'customer' CHECK (audience IN ('customer', 'staff')),
  subject      text NOT NULL,
  body_html    text NOT NULL,
  order_id     text REFERENCES orders(id),
  dedupe_key   text,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  provider_ref text,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_order ON notifications (tenant_id, order_id);
CREATE UNIQUE INDEX notifications_dedupe ON notifications (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE webhook_endpoints (
  id                        text PRIMARY KEY,
  tenant_id                 text NOT NULL REFERENCES tenants(id),
  url                       text NOT NULL,
  description               text NOT NULL DEFAULT '',
  events                    text[] NOT NULL DEFAULT '{*}',
  secret_encrypted          text NOT NULL,
  previous_secret_encrypted text,
  secret_rotated_at         timestamptz,
  status                    text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled_by_user', 'disabled_failures')),
  api_version               text NOT NULL DEFAULT '2026-10-01',
  failing_since             timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox: written in the same transaction as the domain change (PRD §6, §7.3).
CREATE TABLE outbox (
  id             text PRIMARY KEY,          -- evt_... (also the public event id)
  tenant_id      text NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE webhook_events (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  type       text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_created ON webhook_events (tenant_id, created_at DESC);

CREATE TABLE webhook_deliveries (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id),
  endpoint_id     text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id        text NOT NULL REFERENCES webhook_events(id),
  attempt         int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  response_code   int,
  response_body   text,
  error           text,
  next_attempt_at timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_endpoint ON webhook_deliveries (tenant_id, endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- API plumbing, storefront, plugins
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
  tenant_id       text NOT NULL REFERENCES tenants(id),
  key             text NOT NULL,
  method          text NOT NULL,
  path            text NOT NULL,
  request_hash    text NOT NULL,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE checkout_sessions (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired')),
  location_id  text NOT NULL REFERENCES locations(id),
  starts_at    timestamptz,
  ends_at      timestamptz,
  lines        jsonb NOT NULL DEFAULT '[]',
  customer     jsonb NOT NULL DEFAULT '{}',
  coupon_codes text[] NOT NULL DEFAULT '{}',
  order_id     text REFERENCES orders(id),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugins (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  plugin_id  text NOT NULL,
  version    text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  config     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plugin_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'locations', 'users', 'memberships', 'tax_profiles', 'price_structures',
    'categories', 'products', 'variants', 'stock_items', 'bundles', 'customers', 'coupons', 'order_lines',
    'document_templates', 'payment_providers', 'payments', 'payment_intents', 'deposits', 'damage_charges',
    'notification_templates', 'notifications', 'webhook_endpoints', 'webhook_deliveries', 'checkout_sessions',
    'plugins']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION openrent_touch_updated_at()',
                   t || '_touch', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security on every tenant-scoped table (FR-TEN-1)
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants USING (openrent_tenant_ok(id)) WITH CHECK (openrent_tenant_ok(id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations', 'location_blackouts', 'memberships', 'api_keys', 'audit_log',
    'tax_profiles', 'price_structures', 'categories', 'products', 'product_categories', 'variants', 'stock_items',
    'stock_levels', 'stock_adjustments', 'bundles', 'bundle_components', 'customers', 'coupons', 'order_sequences',
    'orders', 'order_lines', 'order_events', 'downtimes', 'allocations', 'order_line_units', 'document_sequences',
    'document_templates', 'documents', 'payment_providers', 'payments', 'payment_intents', 'provider_events',
    'deposits', 'damage_charges', 'notification_templates', 'notifications', 'webhook_endpoints', 'outbox',
    'webhook_events', 'webhook_deliveries', 'idempotency_keys', 'checkout_sessions', 'plugins']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Application role. Requests run as openrent_app (NOBYPASSRLS) through
-- SET LOCAL ROLE, so isolation holds even when DATABASE_URL is a superuser.
-- If the migrating role cannot create roles, this block only emits a notice.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_app') THEN
    BEGIN
      CREATE ROLE openrent_app NOLOGIN NOBYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'openrent: cannot create role openrent_app; RLS then depends on DATABASE_URL not being a superuser';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_app') THEN
    BEGIN
      EXECUTE format('GRANT openrent_app TO %I', current_user);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'openrent: cannot grant openrent_app to %', current_user;
    END;
    GRANT USAGE ON SCHEMA public TO openrent_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openrent_app;
    REVOKE UPDATE, DELETE ON audit_log FROM openrent_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO openrent_app;
  END IF;
END $$;
