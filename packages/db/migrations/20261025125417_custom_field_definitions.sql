CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"help" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"plugin_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "custom_field_definitions_entity_check" CHECK (entity = ANY (ARRAY['product'::text, 'stock_item'::text, 'customer'::text, 'order'::text])),
	CONSTRAINT "custom_field_definitions_type_check" CHECK (type = ANY (ARRAY['text'::text, 'textarea'::text, 'number'::text, 'boolean'::text, 'date'::text, 'select'::text, 'multiselect'::text, 'url'::text])),
	CONSTRAINT "custom_field_definitions_visibility_check" CHECK (visibility = ANY (ARRAY['internal'::text, 'storefront'::text, 'portal'::text])),
	CONSTRAINT "custom_field_definitions_key_check" CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_key" ON "custom_field_definitions" USING btree ("tenant_id","entity","key") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_definitions" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));