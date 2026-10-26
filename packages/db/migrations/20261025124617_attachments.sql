CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"file_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"kind" text DEFAULT 'attachment' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_owner_type_check" CHECK (owner_type = ANY (ARRAY['order'::text, 'customer'::text, 'stock_item'::text])),
	CONSTRAINT "attachments_visibility_check" CHECK (visibility = ANY (ARRAY['internal'::text, 'customer'::text])),
	CONSTRAINT "attachments_kind_check" CHECK (kind = ANY (ARRAY['attachment'::text, 'insurance'::text, 'id_document'::text])),
	CONSTRAINT "attachments_label_check" CHECK (char_length(label) <= 200)
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_file" ON "attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "attachments_owner" ON "attachments" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachments" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));