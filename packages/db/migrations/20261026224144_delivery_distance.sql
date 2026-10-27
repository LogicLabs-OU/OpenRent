CREATE TABLE "geocode_cache" (
	"tenant_id" text NOT NULL,
	"query" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_pkey" PRIMARY KEY("tenant_id","query")
);
--> statement-breakpoint
ALTER TABLE "geocode_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fee_rules" DROP CONSTRAINT "fee_rules_calculation_check";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD COLUMN "distance_bands" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_calculation_check" CHECK (calculation = ANY (ARRAY['flat'::text, 'per_unit'::text, 'percent'::text, 'per_period'::text, 'zone'::text, 'per_km'::text]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "geocode_cache" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));