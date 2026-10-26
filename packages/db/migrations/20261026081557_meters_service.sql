CREATE TABLE "meter_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"value" double precision NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"order_id" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_readings_value_check" CHECK (value >= 0),
	CONSTRAINT "meter_readings_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'check_out'::text, 'check_in'::text, 'service'::text]))
);
--> statement-breakpoint
ALTER TABLE "meter_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"interval_id" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meter_value" double precision,
	"ticket_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"performed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_intervals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"product_id" text,
	"category_id" text,
	"every_days" integer,
	"every_rentals" integer,
	"every_meter" double precision,
	"opens_ticket" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "service_intervals_some_check" CHECK (every_days > 0 OR every_rentals > 0 OR every_meter > 0)
);
--> statement-breakpoint
ALTER TABLE "service_intervals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "service_interval_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "meter_unit" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "depreciation_months" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "residual_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "meter_value" double precision;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_interval_id_fkey" FOREIGN KEY ("interval_id") REFERENCES "public"."service_intervals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_intervals" ADD CONSTRAINT "service_intervals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_intervals" ADD CONSTRAINT "service_intervals_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_intervals" ADD CONSTRAINT "service_intervals_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meter_readings_unit" ON "meter_readings" USING btree ("stock_item_id","recorded_at");--> statement-breakpoint
CREATE INDEX "service_events_unit" ON "service_events" USING btree ("stock_item_id","interval_id","performed_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meter_readings" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_events" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_intervals" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));