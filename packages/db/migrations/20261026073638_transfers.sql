CREATE TABLE "transfer_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"transfer_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"stock_item_id" text,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"lost_quantity" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_lines_quantity_check" CHECK (quantity > 0 AND (stock_item_id IS NULL OR quantity = 1)),
	CONSTRAINT "transfer_lines_received_check" CHECK (received_quantity >= 0 AND lost_quantity >= 0 AND received_quantity + lost_quantity <= quantity)
);
--> statement-breakpoint
ALTER TABLE "transfer_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"from_location_id" text NOT NULL,
	"to_location_id" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"ships_at" timestamp with time zone NOT NULL,
	"eta" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_status_check" CHECK (status = ANY (ARRAY['planned'::text, 'in_transit'::text, 'received'::text, 'cancelled'::text])),
	CONSTRAINT "transfers_locations_check" CHECK (from_location_id <> to_location_id)
);
--> statement-breakpoint
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_items" DROP CONSTRAINT "stock_items_status_check";--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "transfer_line_id" text;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_lines_transfer" ON "transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_number" ON "transfers" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "transfers_status" ON "transfers" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_transfer_line_id_fkey" FOREIGN KEY ("transfer_line_id") REFERENCES "public"."transfer_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_status_check" CHECK (status = ANY (ARRAY['available'::text, 'reserved'::text, 'out'::text, 'needs_inspection'::text, 'soft_down'::text, 'hard_down'::text, 'retired'::text, 'lost'::text, 'in_transit'::text]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transfer_lines" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transfers" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));