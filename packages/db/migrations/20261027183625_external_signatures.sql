ALTER TABLE "signature_requests" DROP CONSTRAINT "signature_requests_status_check";--> statement-breakpoint
ALTER TABLE "signatures" DROP CONSTRAINT "signatures_method_check";--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'signed'::text, 'cancelled'::text, 'expired'::text, 'declined'::text]));--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_method_check" CHECK (method = ANY (ARRAY['typed'::text, 'drawn'::text, 'external'::text]));