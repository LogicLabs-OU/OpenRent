ALTER TABLE "payment_intents" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "document_id" text;--> statement-breakpoint
CREATE INDEX "payments_document" ON "payments" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_owner_check" CHECK (order_id IS NOT NULL OR invoice_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_check" CHECK (order_id IS NOT NULL OR (document_id IS NOT NULL AND customer_id IS NOT NULL));