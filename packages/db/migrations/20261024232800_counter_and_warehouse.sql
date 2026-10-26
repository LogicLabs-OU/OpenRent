CREATE TABLE "maintenance_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'soft_down' NOT NULL,
	"created_from_order_id" text,
	"created_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_tickets_status_check" CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text])),
	CONSTRAINT "maintenance_tickets_severity_check" CHECK (severity = ANY (ARRAY['soft_down'::text, 'hard_down'::text]))
);
--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_take_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_take_id" text NOT NULL,
	"stock_item_id" text,
	"code" text NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_take_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_takes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_by" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_takes_status_check" CHECK (status = ANY (ARRAY['open'::text, 'applied'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "stock_takes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "bin" text;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_scans" ADD CONSTRAINT "stock_take_scans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_scans" ADD CONSTRAINT "stock_take_scans_stock_take_id_fkey" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_tickets_open" ON "maintenance_tickets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_tickets_one_open" ON "maintenance_tickets" USING btree ("stock_item_id") WHERE status <> 'done';--> statement-breakpoint
CREATE UNIQUE INDEX "stock_take_scans_code" ON "stock_take_scans" USING btree ("stock_take_id","code");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_tickets" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_take_scans" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_takes" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));