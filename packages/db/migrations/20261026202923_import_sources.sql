CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'fetching' NOT NULL,
	"error" text,
	"job_id" text,
	"created_by" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_source_check" CHECK (source = ANY (ARRAY['shelf'::text, 'booqable'::text, 'snipeit'::text])),
	CONSTRAINT "import_batches_status_check" CHECK (status = ANY (ARRAY['fetching'::text, 'validated'::text, 'applying'::text, 'applied'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"tenant_id" text NOT NULL,
	"entity" text NOT NULL,
	"signature" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mappings_pkey" PRIMARY KEY("tenant_id","entity","signature")
);
--> statement-breakpoint
ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_entity_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_source_check";--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "source" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "mapping" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imports_batch" ON "imports" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_external_ref" ON "orders" USING btree ("tenant_id","external_ref") WHERE external_ref IS NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_entity_check" CHECK (entity = ANY (ARRAY['products'::text, 'stock_items'::text, 'prices'::text, 'customers'::text, 'orders'::text]));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_check" CHECK (source = ANY (ARRAY['storefront'::text, 'admin'::text, 'api'::text, 'import'::text]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_batches" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_mappings" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));