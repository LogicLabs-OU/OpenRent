CREATE TABLE "payment_reconciliation_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"payment_id" text,
	"order_id" text,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text,
	CONSTRAINT "payment_reconciliation_issues_kind_check" CHECK (kind = ANY (ARRAY['status_mismatch'::text, 'amount_mismatch'::text, 'missing_at_provider'::text]))
);
--> statement-breakpoint
ALTER TABLE "payment_reconciliation_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_reconciliation_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reconciliation_issues_open" ON "payment_reconciliation_issues" USING btree ("tenant_id","provider","provider_ref","kind") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_reconciliation_issues" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));