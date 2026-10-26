CREATE TABLE "accounting_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"original_date" date,
	"currency" char(3) NOT NULL,
	"total" bigint NOT NULL,
	"reference" text NOT NULL,
	"order_id" text,
	"customer_id" text,
	"reversal_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_entries_kind_check" CHECK (kind = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'invoice_void'::text, 'payment'::text, 'refund'::text, 'deposit_received'::text, 'deposit_returned'::text, 'deposit_applied'::text, 'damage_revenue'::text]))
);
--> statement-breakpoint
ALTER TABLE "accounting_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_entry_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"position" integer NOT NULL,
	"account_key" text NOT NULL,
	"account_code" text NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bp" integer,
	"description" text NOT NULL,
	CONSTRAINT "accounting_entry_lines_amounts_check" CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
);
--> statement-breakpoint
ALTER TABLE "accounting_entry_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_queue_source_type_check" CHECK (source_type = ANY (ARRAY['document'::text, 'payment'::text]))
);
--> statement-breakpoint
ALTER TABLE "accounting_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."accounting_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_queue" ADD CONSTRAINT "accounting_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_entries_number" ON "accounting_entries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_entries_source" ON "accounting_entries" USING btree ("tenant_id","kind","source_type","source_id");--> statement-breakpoint
CREATE INDEX "accounting_entries_date" ON "accounting_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "accounting_entry_lines_entry" ON "accounting_entry_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_queue_source" ON "accounting_queue" USING btree ("tenant_id","source_type","source_id","event");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_entries" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_entry_lines" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_queue" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));