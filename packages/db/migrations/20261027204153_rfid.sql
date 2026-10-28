CREATE TABLE "rfid_readers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"location_id" text,
	"format" text DEFAULT 'openrent' NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"last_read_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfid_readers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rfid_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"epc" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"antenna" integer,
	"rssi" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfid_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rfid_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"epc" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfid_tags_tenant_epc_key" UNIQUE("tenant_id","epc")
);
--> statement-breakpoint
ALTER TABLE "rfid_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rfid_readers" ADD CONSTRAINT "rfid_readers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_readers" ADD CONSTRAINT "rfid_readers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_reads" ADD CONSTRAINT "rfid_reads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_reads" ADD CONSTRAINT "rfid_reads_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "public"."rfid_readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_tags" ADD CONSTRAINT "rfid_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_tags" ADD CONSTRAINT "rfid_tags_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rfid_reads_reader_time" ON "rfid_reads" USING btree ("reader_id","read_at");--> statement-breakpoint
CREATE INDEX "rfid_tags_stock_item" ON "rfid_tags" USING btree ("stock_item_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rfid_readers" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rfid_reads" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rfid_tags" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));