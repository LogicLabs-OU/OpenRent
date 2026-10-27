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
