CREATE TABLE "external_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"supplier" text NOT NULL,
	"quantity" integer NOT NULL,
	"period" "tstzrange" NOT NULL,
	"unit_cost" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"reference" text,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_stock_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "external_stock_status_check" CHECK (status = ANY (ARRAY['booked'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "external_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_stock" ADD CONSTRAINT "external_stock_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_stock" ADD CONSTRAINT "external_stock_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_stock" ADD CONSTRAINT "external_stock_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_stock_pool" ON "external_stock" USING btree ("tenant_id","variant_id","location_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "external_stock" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));