ALTER TABLE "orders" ADD COLUMN "billing_cycle" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "billed_until" timestamp with time zone;