DROP INDEX "users_email";--> statement-breakpoint
DROP INDEX "customers_email";--> statement-breakpoint
DROP INDEX "coupons_code";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email" ON "users" USING btree (lower(email));--> statement-breakpoint
CREATE INDEX "customers_email" ON "customers" USING btree (tenant_id,lower(email));--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code" ON "coupons" USING btree (tenant_id,lower(code));