CREATE TABLE "price_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"adjustment_bp" integer NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"weekdays" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"customer_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_quantity" integer,
	"min_lead_days" integer,
	"max_lead_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "price_rules_kind_check" CHECK (kind = ANY (ARRAY['season'::text, 'weekday'::text, 'holiday'::text, 'customer_group'::text, 'volume'::text, 'lead_time'::text])),
	CONSTRAINT "price_rules_adjustment_check" CHECK (adjustment_bp >= '-10000'::integer AND adjustment_bp <= 100000),
	CONSTRAINT "price_rules_dates_check" CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
--> statement-breakpoint
ALTER TABLE "price_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_rules_tenant_active" ON "price_rules" USING btree ("tenant_id") WHERE deleted_at IS NULL AND active;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "price_rules" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));