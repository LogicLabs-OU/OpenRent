CREATE TABLE "staff_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "low_availability_threshold" integer;--> statement-breakpoint
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_notifications_inbox" ON "staff_notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_notifications_dedupe" ON "staff_notifications" USING btree ("tenant_id","user_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_provider_ref" ON "notifications" USING btree ("provider","provider_ref") WHERE provider_ref IS NOT NULL;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_low_availability_threshold_check" CHECK (low_availability_threshold >= 0);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_notifications" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));