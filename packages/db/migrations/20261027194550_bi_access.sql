CREATE TABLE "bi_access" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"role_name" text NOT NULL,
	"created_by" text,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bi_access_role_name_key" UNIQUE("role_name")
);
--> statement-breakpoint
ALTER TABLE "bi_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bi_access" ADD CONSTRAINT "bi_access_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bi_access" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));