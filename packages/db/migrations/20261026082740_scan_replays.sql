CREATE TABLE "scan_replays" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"mode" text NOT NULL,
	"code" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_replays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scan_replays" ADD CONSTRAINT "scan_replays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_replays_client" ON "scan_replays" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "scan_replays" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));