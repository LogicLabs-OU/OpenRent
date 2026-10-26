ALTER TABLE "variants" ADD COLUMN "buffer_before_min" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "buffer_after_min" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "min_duration_min" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "max_duration_min" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "min_notice_min" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "increment_min" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_buffer_before_min_check" CHECK (buffer_before_min >= 0);--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_buffer_after_min_check" CHECK (buffer_after_min >= 0);--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_min_duration_min_check" CHECK (min_duration_min > 0);--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_max_duration_min_check" CHECK (max_duration_min > 0 AND max_duration_min >= coalesce(min_duration_min, 0));--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_min_notice_min_check" CHECK (min_notice_min >= 0);--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_increment_min_check" CHECK (increment_min > 0);