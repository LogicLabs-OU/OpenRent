ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_kind_check";--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_kind_check" CHECK (kind = ANY (ARRAY['upfront'::text, 'balance'::text, 'custom'::text, 'invoice'::text]));