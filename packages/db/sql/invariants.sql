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
