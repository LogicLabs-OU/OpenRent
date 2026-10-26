CREATE TABLE "overbookings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overbookings_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "overbookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "overbooking_id" text;--> statement-breakpoint
ALTER TABLE "overbookings" ADD CONSTRAINT "overbookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overbookings" ADD CONSTRAINT "overbookings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overbookings_pool" ON "overbookings" USING btree ("tenant_id","variant_id","location_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "overbookings" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));