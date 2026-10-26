CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"account_name" text,
	"account" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oauth_state_hash" text,
	"oauth_verifier_encrypted" text,
	"sync_from" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"connected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'connected'::text, 'error'::text, 'disconnected'::text]))
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_links" (
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"local_type" text NOT NULL,
	"local_id" text NOT NULL,
	"remote_id" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_links_pkey" PRIMARY KEY("connection_id","local_type","local_id")
);
--> statement-breakpoint
ALTER TABLE "integration_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"source_key" text NOT NULL,
	"event" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_tasks_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'skipped'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "integration_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_tasks" ADD CONSTRAINT "integration_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_tasks" ADD CONSTRAINT "integration_tasks_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_live" ON "integration_connections" USING btree ("tenant_id","provider_id") WHERE status <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_state" ON "integration_connections" USING btree ("oauth_state_hash") WHERE oauth_state_hash IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_tasks_source" ON "integration_tasks" USING btree ("connection_id","source_key");--> statement-breakpoint
CREATE INDEX "integration_tasks_due" ON "integration_tasks" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "integration_connections" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "integration_links" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "integration_tasks" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));