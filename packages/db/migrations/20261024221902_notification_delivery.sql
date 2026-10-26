ALTER TABLE "notifications" DROP CONSTRAINT "notifications_status_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_due" ON "notifications" USING btree ("next_attempt_at") WHERE status = 'queued';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'bounced'::text, 'failed'::text, 'cancelled'::text]));