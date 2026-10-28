-- Database invariants, re-applied after every `db:migrate` (idempotent). Generated migrations hold
-- plain DDL; this script makes sure no tenant table can ever ship without row-level security.
DO $$
DECLARE r record;
BEGIN
  -- Every table with a NOT NULL tenant_id is isolated per tenant (FR-TEN-1).
  FOR r IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped AND a.attnotnull
     WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.relname);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.relname AND policyname = 'tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id))', r.relname);
    END IF;
  END LOOP;

  -- updated_at is maintained by trigger. orders, documents and stock_levels manage it themselves.
  FOR r IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at' AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> ALL (ARRAY['orders', 'documents', 'stock_levels'])
       AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = c.relname || '_touch')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION openrent_touch_updated_at()', r.relname || '_touch', r.relname);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_app') THEN
    GRANT USAGE ON SCHEMA public TO openrent_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openrent_app;
    REVOKE UPDATE, DELETE ON audit_log FROM openrent_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO openrent_app;
  END IF;
END $$;

-- Inspections are a record of what was found (FR-MNT-3): never changed or removed afterwards.
CREATE OR REPLACE FUNCTION openrent_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or removed', TG_TABLE_NAME USING HINT = 'append_only';
END $$;
DROP TRIGGER IF EXISTS inspections_append_only ON inspections;
CREATE TRIGGER inspections_append_only BEFORE UPDATE OR DELETE ON inspections FOR EACH ROW EXECUTE FUNCTION openrent_append_only();

-- Meter readings never go down (FR-CAT-10): a reading is at least the one before it and at most the one after it.
CREATE OR REPLACE FUNCTION openrent_meter_in_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_v double precision; after_v double precision;
BEGIN
  SELECT value INTO before_v FROM meter_readings WHERE stock_item_id = NEW.stock_item_id AND id <> NEW.id AND recorded_at <= NEW.recorded_at ORDER BY recorded_at DESC, created_at DESC LIMIT 1;
  SELECT value INTO after_v FROM meter_readings WHERE stock_item_id = NEW.stock_item_id AND id <> NEW.id AND recorded_at > NEW.recorded_at ORDER BY recorded_at ASC, created_at ASC LIMIT 1;
  IF (before_v IS NOT NULL AND NEW.value < before_v) OR (after_v IS NOT NULL AND NEW.value > after_v) THEN
    RAISE EXCEPTION 'A meter reading cannot be lower than an earlier one' USING HINT = 'meter_decreasing';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS meter_readings_in_order ON meter_readings;
CREATE TRIGGER meter_readings_in_order BEFORE INSERT OR UPDATE ON meter_readings FOR EACH ROW EXECUTE FUNCTION openrent_meter_in_order();
-- Cases (FR-CAT-11): a unit is packed in a case at its own location, never in itself or in a case it holds.
-- A unit that moves to another location leaves its case, and a case that moves is emptied first.
CREATE OR REPLACE FUNCTION openrent_container_ok() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cur text; loc text; hops int := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.location_id <> OLD.location_id THEN
    IF NEW.container_id IS NOT DISTINCT FROM OLD.container_id THEN NEW.container_id := NULL; END IF;
    UPDATE stock_items SET container_id = NULL WHERE container_id = NEW.id;
  END IF;
  IF NEW.container_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.container_id = NEW.id THEN RAISE EXCEPTION 'A unit cannot be packed in itself' USING HINT = 'container_cycle'; END IF;
  SELECT location_id INTO loc FROM stock_items WHERE id = NEW.container_id;
  IF loc IS DISTINCT FROM NEW.location_id THEN RAISE EXCEPTION 'A unit can only be packed in a case at its location' USING HINT = 'container_location'; END IF;
  cur := NEW.container_id;
  WHILE cur IS NOT NULL LOOP
    hops := hops + 1;
    IF cur = NEW.id OR hops > 50 THEN RAISE EXCEPTION 'A case cannot be packed in a unit it holds' USING HINT = 'container_cycle'; END IF;
    SELECT container_id INTO cur FROM stock_items WHERE id = cur;
  END LOOP;
  RETURN NEW;
END $$;
-- Only once the column exists: the invariants also run on a database of an earlier release before its upgrade.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stock_items' AND column_name = 'container_id') THEN
    DROP TRIGGER IF EXISTS stock_items_container_ok ON stock_items;
    CREATE TRIGGER stock_items_container_ok BEFORE INSERT OR UPDATE OF container_id, location_id ON stock_items FOR EACH ROW EXECUTE FUNCTION openrent_container_ok();
  END IF;
END $$;
DROP TRIGGER IF EXISTS signatures_append_only ON signatures;
CREATE TRIGGER signatures_append_only BEFORE UPDATE OR DELETE ON signatures FOR EACH ROW EXECUTE FUNCTION openrent_append_only();

-- Accounting (ADR 0009): every invoice, credit note, void and payment that settles is queued for an
-- accounting entry in the same transaction, whichever code path wrote it. Core posts the queue.
-- Movements keep the order they happened in, also inside one transaction or one statement:
-- clock_timestamp() rather than now(), and ids from a sequence for movements in the same instant.
CREATE SEQUENCE IF NOT EXISTS accounting_queue_seq;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_app') THEN GRANT USAGE, SELECT ON SEQUENCE accounting_queue_seq TO openrent_app; END IF;
END $$;
CREATE OR REPLACE FUNCTION openrent_queue_accounting(t text, s text, id text, ev text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO accounting_queue (id, tenant_id, source_type, source_id, event, created_at)
  VALUES ('acq_' || lpad(nextval('accounting_queue_seq')::text, 19, '0'), t, s, id, ev, clock_timestamp())
  ON CONFLICT (tenant_id, source_type, source_id, event) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION openrent_documents_to_books() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type NOT IN ('invoice', 'credit_note') THEN RETURN NEW; END IF;
  IF NEW.issued_at IS NOT NULL AND NEW.status <> 'draft' AND (TG_OP = 'INSERT' OR OLD.issued_at IS NULL OR OLD.status = 'draft') THEN
    PERFORM openrent_queue_accounting(NEW.tenant_id, 'document', NEW.id, 'issued');
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'voided' AND OLD.status <> 'voided' THEN
    PERFORM openrent_queue_accounting(NEW.tenant_id, 'document', NEW.id, 'voided');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS documents_to_books ON documents;
CREATE TRIGGER documents_to_books AFTER INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION openrent_documents_to_books();

CREATE OR REPLACE FUNCTION openrent_payments_to_books() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'authorization' THEN RETURN NEW; END IF;
  IF NEW.status = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.status <> 'succeeded') THEN
    PERFORM openrent_queue_accounting(NEW.tenant_id, 'payment', NEW.id, 'succeeded');
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'succeeded' AND NEW.status <> 'succeeded' THEN
    PERFORM openrent_queue_accounting(NEW.tenant_id, 'payment', NEW.id, 'reversed');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_to_books ON payments;
CREATE TRIGGER payments_to_books AFTER INSERT OR UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION openrent_payments_to_books();

-- Entries are the record of what was booked: never changed or removed, and every entry balances.
DROP TRIGGER IF EXISTS accounting_entries_append_only ON accounting_entries;
CREATE TRIGGER accounting_entries_append_only BEFORE UPDATE OR DELETE ON accounting_entries FOR EACH ROW EXECUTE FUNCTION openrent_append_only();
DROP TRIGGER IF EXISTS accounting_entry_lines_append_only ON accounting_entry_lines;
CREATE TRIGGER accounting_entry_lines_append_only BEFORE UPDATE OR DELETE ON accounting_entry_lines FOR EACH ROW EXECUTE FUNCTION openrent_append_only();

CREATE OR REPLACE FUNCTION openrent_entry_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; tot bigint;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c FROM accounting_entry_lines WHERE entry_id = NEW.entry_id;
  SELECT total INTO tot FROM accounting_entries WHERE id = NEW.entry_id;
  IF d <> c OR d <> tot THEN
    RAISE EXCEPTION 'Accounting entry % does not balance (debit %, credit %, total %)', NEW.entry_id, d, c, tot USING HINT = 'entry_unbalanced';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS accounting_entry_lines_balance ON accounting_entry_lines;
CREATE CONSTRAINT TRIGGER accounting_entry_lines_balance AFTER INSERT ON accounting_entry_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION openrent_entry_balances();

-- Electrical safety tests are a record of what was measured (FR-MNT-5): never changed or removed afterwards.
-- (An older schema on its way through an upgrade has no such table yet.)
DO $$
BEGIN
  IF to_regclass('public.electrical_tests') IS NULL THEN RETURN; END IF;
  DROP TRIGGER IF EXISTS electrical_tests_append_only ON electrical_tests;
  CREATE TRIGGER electrical_tests_append_only BEFORE UPDATE OR DELETE ON electrical_tests FOR EACH ROW EXECUTE FUNCTION openrent_append_only();
END $$;

-- Erasing a shop (managed cloud): only the openrent_maintenance role may remove rows from the
-- append-only tables, and only for the shop named in openrent.erasing_tenant (packages/db/src/erase.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_maintenance') THEN
    CREATE ROLE openrent_maintenance NOLOGIN;
  END IF;
  EXECUTE format('GRANT openrent_maintenance TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'openrent_maintenance could not be created or granted; erasing shops needs it';
END $$;

CREATE OR REPLACE FUNCTION openrent_erasing(t text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('openrent.erasing_tenant', true), '') = t
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_maintenance')
     AND pg_has_role(current_user, 'openrent_maintenance', 'MEMBER')
$$;

CREATE OR REPLACE FUNCTION openrent_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND openrent_erasing(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% rows cannot be changed or removed', TG_TABLE_NAME USING HINT = 'append_only';
END $$;

CREATE OR REPLACE FUNCTION openrent_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND openrent_erasing(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'P0001', HINT = 'audit_append_only';
END $$;

CREATE OR REPLACE FUNCTION openrent_documents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.issued_at IS NOT NULL AND NOT openrent_erasing(OLD.tenant_id) THEN
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

-- Whether a staff account also belongs to another shop. Memberships are row-level secured, so a shop
-- cannot see this itself; it needs it to leave such accounts' password and name alone.
CREATE OR REPLACE FUNCTION openrent_user_in_other_shops(uid text, current_tenant text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = uid AND tenant_id <> current_tenant)
$$;

-- Reporting views for BI tools (FR-REP-5). Each shop may have database logins of its own (members of
-- openrent_bi, made in Settings → Data access); they read the views in schema `bi` and nothing else.
-- The views belong to openrent_bi_reader, which may read the tables, and each view keeps only the rows
-- of the login's shop (`bi_access`). The shop's own filter is in the view itself: a login may set
-- app.tenant_id or app.system in its session, which the tenant policy trusts, but no setting reaches
-- the view's filter. Without the rights to make these roles, the views are left out.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_bi') THEN CREATE ROLE openrent_bi NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_bi_reader') THEN CREATE ROLE openrent_bi_reader NOLOGIN; END IF;
  EXECUTE format('GRANT openrent_bi_reader TO %I', current_user);
  EXECUTE format('GRANT openrent_bi TO %I WITH ADMIN OPTION', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'openrent_bi could not be created or granted; data access for BI tools needs it';
END $$;

-- Whether a staff account belongs to another shop is for the app to ask, not for every database login.
REVOKE ALL ON FUNCTION openrent_user_in_other_shops(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_app') THEN
    GRANT EXECUTE ON FUNCTION openrent_user_in_other_shops(text, text) TO openrent_app;
  END IF;
END $$;

-- Older schemas (an upgrade on its way) have no bi_access yet; the views come with it.
DO $$
DECLARE t text;
BEGIN
  IF to_regclass('public.bi_access') IS NULL THEN RETURN; END IF;
  -- The shop a BI login reads: its row in bi_access, or none. A suspended shop's logins read nothing.
  CREATE OR REPLACE FUNCTION openrent_bi_tenant(login name) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.system = 'on' AS $fn$
    SELECT b.tenant_id FROM bi_access b JOIN tenants t ON t.id = b.tenant_id AND t.status = 'active' WHERE b.role_name = login
  $fn$;
  REVOKE ALL ON FUNCTION openrent_bi_tenant(name) FROM PUBLIC;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_bi_reader') OR NOT pg_has_role(current_user, 'openrent_bi_reader', 'SET') THEN
    DROP SCHEMA IF EXISTS bi CASCADE;
    RETURN;
  END IF;
  GRANT EXECUTE ON FUNCTION openrent_bi_tenant(name) TO openrent_bi, openrent_bi_reader;
  -- The reader may read what the views show, of the login's shop only.
  FOREACH t IN ARRAY ARRAY['tenants', 'locations', 'products', 'variants', 'categories', 'product_categories', 'stock_items', 'stock_levels', 'customers', 'orders', 'order_lines', 'allocations', 'payments', 'documents'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT SELECT ON %I TO openrent_bi_reader', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'bi_read') THEN
      EXECUTE format('CREATE POLICY bi_read ON %I FOR SELECT TO openrent_bi_reader USING (%s = openrent_bi_tenant(current_user))', t, CASE t WHEN 'tenants' THEN 'id' ELSE 'tenant_id' END);
    END IF;
  END LOOP;

  DROP SCHEMA IF EXISTS bi CASCADE;
  CREATE SCHEMA bi;
  GRANT USAGE, CREATE ON SCHEMA bi TO openrent_bi_reader;

  CREATE VIEW bi.shop WITH (security_barrier) AS
    SELECT id, name, currency, timezone, locale FROM tenants WHERE id = openrent_bi_tenant(current_user);
  COMMENT ON VIEW bi.shop IS 'The shop: its currency and time zone. Money everywhere is in minor units (cents).';

  CREATE VIEW bi.locations WITH (security_barrier) AS
    SELECT id, name, timezone, created_at, deleted_at FROM locations WHERE tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.products WITH (security_barrier) AS
    SELECT p.id, p.type, p.name, p.slug, p.visibility, p.tags, p.meter_unit, p.created_at, p.deleted_at,
           (SELECT c.name FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id ORDER BY c.name LIMIT 1) AS category
      FROM products p WHERE p.tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.variants WITH (security_barrier) AS
    SELECT id, product_id, sku, name, tracking, is_default, created_at, deleted_at FROM variants WHERE tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.stock_items WITH (security_barrier) AS
    SELECT s.id, s.variant_id, v.product_id, s.location_id, s.barcode, s.serial, s.status, s.condition, s.purchase_date, s.purchase_price, s.container_id, s.retired_at, s.created_at
      FROM stock_items s JOIN variants v ON v.id = s.variant_id WHERE s.tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.customers WITH (security_barrier) AS
    SELECT id, type, name, email, phone, company_name, tax_id, CASE jsonb_typeof(addresses) WHEN 'array' THEN addresses->0->>'country' ELSE coalesce(addresses->'billing'->>'country', addresses->'shipping'->>'country') END AS country, locale, tags, marketing_consent,
           on_account, payment_terms_days, credit_limit, merged_into_id, anonymized_at, created_at, deleted_at
      FROM customers WHERE tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.orders WITH (security_barrier) AS
    SELECT id, number, status, customer_id, location_id, starts_at, ends_at, currency, payment_status, source, po_number, coupon_codes, tags,
           coalesce((totals->>'subtotal')::bigint, 0) AS subtotal, coalesce((totals->>'discount')::bigint, 0) AS discount, coalesce((totals->>'tax')::bigint, 0) AS tax,
           coalesce((totals->>'total')::bigint, 0) AS total, coalesce((totals->>'deposit')::bigint, 0) AS deposit, coalesce((totals->>'paid')::bigint, 0) AS paid,
           coalesce((totals->>'balance')::bigint, (totals->>'total')::bigint, 0) AS balance, billing_cycle, created_at, closed_at, cancelled_at, cancel_reason
      FROM orders WHERE tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.order_lines WITH (security_barrier) AS
    SELECT id, order_id, type, product_id, variant_id, bundle_id, parent_line_id, quantity, starts_at, ends_at, description,
           unit_price, subtotal, discount, tax, total, deposit, coalesce((price_snapshot->>'tax_rate_bp')::int, 0) AS tax_rate_bp,
           picked_up_qty, returned_qty, lost_qty, created_at
      FROM order_lines WHERE tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.payments WITH (security_barrier) AS
    SELECT id, order_id, customer_id, document_id, provider, kind, purpose, method, amount, currency, status, parent_payment_id, created_at
      FROM payments WHERE tenant_id = openrent_bi_tenant(current_user);

  CREATE VIEW bi.invoices WITH (security_barrier) AS
    SELECT id, type, number, status, order_id, customer_id, issued_at, currency, total,
           coalesce((data->'totals'->>'tax')::bigint, 0) AS tax, coalesce(total, 0) - coalesce((data->'totals'->>'tax')::bigint, 0) AS net, voided_by_id
      FROM documents WHERE tenant_id = openrent_bi_tenant(current_user) AND type IN ('invoice', 'credit_note') AND issued_at IS NOT NULL;

  -- Booked unit-hours per product variant, location and day (the shop's days), from a year back to 90 days ahead.
  -- Capacity is today's: units not retired or lost, or the bulk quantity.
  CREATE VIEW bi.utilisation_daily WITH (security_barrier) AS
    WITH shop AS (SELECT id, timezone FROM tenants WHERE id = openrent_bi_tenant(current_user)),
    days AS (
      SELECT d::date AS day, (d::date::timestamp AT TIME ZONE shop.timezone) AS from_at, ((d::date + 1)::timestamp AT TIME ZONE shop.timezone) AS to_at
        FROM shop, generate_series((now() AT TIME ZONE shop.timezone)::date - 365, (now() AT TIME ZONE shop.timezone)::date + 90, interval '1 day') d
    ),
    cap AS (
      SELECT s.variant_id, s.location_id, count(*)::int AS capacity FROM stock_items s, shop
       WHERE s.tenant_id = shop.id AND s.status NOT IN ('retired', 'lost') GROUP BY 1, 2
      UNION ALL
      SELECT sl.variant_id, sl.location_id, sum(sl.quantity)::int FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id AND v.tracking = 'bulk', shop
       WHERE sl.tenant_id = shop.id GROUP BY 1, 2
    ),
    used AS (
      SELECT a.variant_id, a.location_id, days.day,
             sum(a.quantity * extract(epoch FROM least(coalesce(upper(a.period), days.to_at), days.to_at) - greatest(lower(a.period), days.from_at)) / 3600) AS unit_hours
        FROM allocations a, shop, days
       WHERE a.tenant_id = shop.id AND a.kind = 'reservation' AND a.period && tstzrange(days.from_at, days.to_at)
       GROUP BY 1, 2, 3
    )
    SELECT days.day, cap.variant_id, v.product_id, cap.location_id, cap.capacity,
           round(coalesce(used.unit_hours, 0)::numeric, 2) AS booked_unit_hours,
           CASE WHEN cap.capacity > 0 THEN round((coalesce(used.unit_hours, 0) / (cap.capacity * extract(epoch FROM days.to_at - days.from_at) / 3600))::numeric, 4) ELSE 0 END AS utilisation
      FROM days CROSS JOIN cap JOIN variants v ON v.id = cap.variant_id
      LEFT JOIN used ON used.variant_id = cap.variant_id AND used.location_id = cap.location_id AND used.day = days.day;

  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'bi' AND c.relkind = 'v' LOOP
    EXECUTE format('ALTER VIEW bi.%I OWNER TO openrent_bi_reader', t);
  END LOOP;
  REVOKE CREATE ON SCHEMA bi FROM openrent_bi_reader;
  GRANT USAGE ON SCHEMA bi TO openrent_bi;
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO openrent_bi;
END $$;
