CREATE TABLE "maintenance_ticket_units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_ticket_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" DROP CONSTRAINT "maintenance_tickets_status_check";--> statement-breakpoint
DROP INDEX "maintenance_tickets_one_open";--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "cost" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "resolution" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_ticket_units" ADD CONSTRAINT "maintenance_ticket_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_ticket_units" ADD CONSTRAINT "maintenance_ticket_units_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."maintenance_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_ticket_units" ADD CONSTRAINT "maintenance_ticket_units_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_ticket_units_ticket" ON "maintenance_ticket_units" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_ticket_units_one_open" ON "maintenance_ticket_units" USING btree ("stock_item_id") WHERE released_at IS NULL;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_tickets_assignee" ON "maintenance_tickets" USING btree ("tenant_id","assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_tickets_one_open" ON "maintenance_tickets" USING btree ("stock_item_id") WHERE status NOT IN ('done', 'cancelled');--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]));--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_cost_check" CHECK (cost >= 0);--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_status_check" CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_ticket_units" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));