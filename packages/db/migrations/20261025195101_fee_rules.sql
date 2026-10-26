CREATE TABLE "fee_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"calculation" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"period_unit" text,
	"zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mode" text DEFAULT 'auto' NOT NULL,
	"product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"tax_profile_id" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "fee_rules_kind_check" CHECK (kind = ANY (ARRAY['delivery'::text, 'cleaning'::text, 'damage_waiver'::text, 'extension'::text, 'late'::text])),
	CONSTRAINT "fee_rules_calculation_check" CHECK (calculation = ANY (ARRAY['flat'::text, 'per_unit'::text, 'percent'::text, 'per_period'::text, 'zone'::text])),
	CONSTRAINT "fee_rules_mode_check" CHECK (mode = ANY (ARRAY['auto'::text, 'optional'::text])),
	CONSTRAINT "fee_rules_amount_check" CHECK (amount >= 0),
	CONSTRAINT "fee_rules_period_unit_check" CHECK (period_unit IS NULL OR period_unit = ANY (ARRAY['hour'::text, 'day'::text, 'week'::text, 'month'::text]))
);
--> statement-breakpoint
ALTER TABLE "fee_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "damage_charges" ADD COLUMN "covered_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fee_rules" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));