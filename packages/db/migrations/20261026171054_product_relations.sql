CREATE TABLE "product_relations" (
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"related_product_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_relations_pkey" PRIMARY KEY("product_id","related_product_id","kind"),
	CONSTRAINT "product_relations_kind_check" CHECK (kind = ANY (ARRAY['accessory'::text, 'related'::text, 'often_rented_with'::text])),
	CONSTRAINT "product_relations_not_self" CHECK (product_id <> related_product_id)
);
--> statement-breakpoint
ALTER TABLE "product_relations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_related_product_id_fkey" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_relations_tenant" ON "product_relations" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_relations" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));