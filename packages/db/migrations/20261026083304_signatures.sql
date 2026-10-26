CREATE TABLE "signature_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"order_id" text,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_sends" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'builtin' NOT NULL,
	"provider_ref" text,
	"provider_url" text,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'signed'::text, 'cancelled'::text, 'expired'::text]))
);
--> statement-breakpoint
ALTER TABLE "signature_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"document_id" text NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"method" text NOT NULL,
	"image_file_id" text,
	"ip" text,
	"user_agent" text,
	"html_sha256" text NOT NULL,
	"pdf_sha256" text,
	"pdf_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signatures_method_check" CHECK (method = ANY (ARRAY['typed'::text, 'drawn'::text]))
);
--> statement-breakpoint
ALTER TABLE "signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signature_requests_token" ON "signature_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_requests_one_pending" ON "signature_requests" USING btree ("document_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "signatures_document" ON "signatures" USING btree ("document_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "signature_requests" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "signatures" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));