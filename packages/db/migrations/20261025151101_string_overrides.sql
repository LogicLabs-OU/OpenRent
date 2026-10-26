CREATE TABLE "string_overrides" (
	"tenant_id" text NOT NULL,
	"namespace" text NOT NULL,
	"locale" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "string_overrides_pkey" PRIMARY KEY("tenant_id","namespace","locale","key")
);
--> statement-breakpoint
ALTER TABLE "string_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "string_overrides" ADD CONSTRAINT "string_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "string_overrides" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));