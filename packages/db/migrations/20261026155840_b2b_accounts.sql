ALTER TABLE "customers" ADD COLUMN "on_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit" bigint;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "po_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "invoice_schedule" text DEFAULT 'per_order' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_id" text;