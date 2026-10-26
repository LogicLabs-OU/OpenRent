CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role_check";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "role_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name" ON "roles" USING btree ("tenant_id",lower(name)) WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_custom_role_check" CHECK ((role = 'custom') = (role_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text, 'warehouse'::text, 'read_only'::text, 'custom'::text]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roles" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));