ALTER TABLE "stock_items" ADD COLUMN "container_id" text;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_items_container" ON "stock_items" USING btree ("container_id" text_ops);