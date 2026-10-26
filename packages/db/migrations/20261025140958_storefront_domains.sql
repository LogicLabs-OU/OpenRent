CREATE TABLE "storefront_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"hostname" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_token" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_domains_status_check" CHECK (status IN ('pending', 'verified', 'failed')),
	CONSTRAINT "storefront_domains_hostname_check" CHECK (hostname = lower(hostname) AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')
);
--> statement-breakpoint
ALTER TABLE "storefront_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "storefront_domains" ADD CONSTRAINT "storefront_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storefront_domains_hostname" ON "storefront_domains" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "storefront_domains_primary" ON "storefront_domains" USING btree ("tenant_id") WHERE is_primary;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "storefront_domains" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));