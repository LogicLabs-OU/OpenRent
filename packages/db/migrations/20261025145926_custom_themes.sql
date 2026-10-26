CREATE TABLE "custom_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"theme_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sections_data" jsonb,
	"locales" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"css" text DEFAULT '' NOT NULL,
	"assets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_themes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_themes" ADD CONSTRAINT "custom_themes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_themes_theme" ON "custom_themes" USING btree ("tenant_id","theme_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_themes" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));