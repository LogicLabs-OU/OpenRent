CREATE TABLE "price_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"adjustment_bp" integer NOT NULL,
	"booked_bp" integer NOT NULL,
	"last_year_bp" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"price_rule_id" text,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_suggestions_status_check" CHECK (status = ANY (ARRAY['open'::text, 'accepted'::text, 'dismissed'::text])),
	CONSTRAINT "price_suggestions_dates_check" CHECK (ends_on >= starts_on)
);
--> statement-breakpoint
ALTER TABLE "price_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_suggestions" ADD CONSTRAINT "price_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_suggestions" ADD CONSTRAINT "price_suggestions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_suggestions" ADD CONSTRAINT "price_suggestions_price_rule_id_fkey" FOREIGN KEY ("price_rule_id") REFERENCES "public"."price_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_suggestions_tenant_status" ON "price_suggestions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "price_suggestions" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));