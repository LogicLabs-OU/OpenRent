CREATE TABLE "sso_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_role" text DEFAULT 'read_only' NOT NULL,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sso_providers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sso_providers" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));