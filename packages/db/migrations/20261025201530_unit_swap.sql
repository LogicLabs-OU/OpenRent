ALTER TABLE "order_line_units" DROP CONSTRAINT "order_line_units_check_in_outcome_check";--> statement-breakpoint
ALTER TABLE "order_line_units" ADD COLUMN "replaced_by_id" text;--> statement-breakpoint
ALTER TABLE "order_line_units" ADD COLUMN "swapped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_line_units" ADD CONSTRAINT "order_line_units_check_in_outcome_check" CHECK (check_in_outcome = ANY (ARRAY['ok'::text, 'needs_inspection'::text, 'damaged'::text, 'lost'::text, 'swapped'::text]));