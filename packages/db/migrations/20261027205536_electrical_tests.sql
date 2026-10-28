CREATE TABLE "electrical_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"interval_id" text,
	"tested_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"appliance_class" text,
	"readings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tester" text NOT NULL,
	"instrument" text,
	"notes" text DEFAULT '' NOT NULL,
	"next_due" date,
	"ticket_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electrical_tests_result_check" CHECK (result = ANY (ARRAY['pass'::text, 'fail'::text])),
	CONSTRAINT "electrical_tests_class_check" CHECK (appliance_class IS NULL OR appliance_class = ANY (ARRAY['I'::text, 'II'::text, 'III'::text]))
);
--> statement-breakpoint
ALTER TABLE "electrical_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_intervals" ADD COLUMN "kind" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "electrical_tests" ADD CONSTRAINT "electrical_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electrical_tests" ADD CONSTRAINT "electrical_tests_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electrical_tests" ADD CONSTRAINT "electrical_tests_interval_id_fkey" FOREIGN KEY ("interval_id") REFERENCES "public"."service_intervals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "electrical_tests_unit" ON "electrical_tests" USING btree ("stock_item_id","tested_at");--> statement-breakpoint
ALTER TABLE "service_intervals" ADD CONSTRAINT "service_intervals_kind_check" CHECK (kind = ANY (ARRAY['service'::text, 'electrical_test'::text]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "electrical_tests" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));