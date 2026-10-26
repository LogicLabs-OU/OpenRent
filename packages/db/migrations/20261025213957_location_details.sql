ALTER TABLE "locations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tax_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tax_profile_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tax_profile_id_fkey" FOREIGN KEY ("tax_profile_id") REFERENCES "public"."tax_profiles"("id") ON DELETE no action ON UPDATE no action;