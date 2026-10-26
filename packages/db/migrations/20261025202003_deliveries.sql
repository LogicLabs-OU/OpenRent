CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"route_date" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"driver_user_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"signed_name" text,
	"signature_file_id" text,
	"failure_reason" text,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_kind_check" CHECK (kind = ANY (ARRAY['delivery'::text, 'collection'::text])),
	CONSTRAINT "deliveries_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'dispatched'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])),
	CONSTRAINT "deliveries_window_check" CHECK (window_end > window_start)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_one_active" ON "deliveries" USING btree ("order_id","kind") WHERE status IN ('scheduled', 'dispatched');--> statement-breakpoint
CREATE INDEX "deliveries_route" ON "deliveries" USING btree ("tenant_id","route_date","position");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deliveries" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));