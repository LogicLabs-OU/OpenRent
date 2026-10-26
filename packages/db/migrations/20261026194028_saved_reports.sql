CREATE TABLE "saved_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"report" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"schedule" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_reports_format_check" CHECK (format = ANY (ARRAY['csv'::text, 'xlsx'::text])),
	CONSTRAINT "saved_reports_schedule_check" CHECK (schedule IS NULL OR schedule = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))
);
--> statement-breakpoint
ALTER TABLE "saved_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_reports_tenant" ON "saved_reports" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "saved_reports_due" ON "saved_reports" USING btree ("next_run_at") WHERE schedule IS NOT NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_reports" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));