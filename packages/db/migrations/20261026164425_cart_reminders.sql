CREATE TABLE "email_optouts" (
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_optouts_pkey" PRIMARY KEY("tenant_id","email","kind")
);
--> statement-breakpoint
ALTER TABLE "email_optouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_optouts" ADD CONSTRAINT "email_optouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "email_optouts" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));