-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"totp_secret" text,
	"totp_pending" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_check" CHECK (status = ANY (ARRAY['active'::text, 'invited'::text, 'disabled'::text]))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tax_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" char(3) NOT NULL,
	"timezone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invoice_numbering" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timezone" text NOT NULL,
	"opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "location_blackouts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_blackouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_tenant_id_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text, 'warehouse'::text, 'read_only'::text]))
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{""}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_kind_check" CHECK (kind = ANY (ARRAY['secret'::text, 'publishable'::text]))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tax_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_structures" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"period_unit" text DEFAULT 'day' NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"rounding" text DEFAULT 'up' NOT NULL,
	"charge_day_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cap" jsonb,
	"price_table" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_per_period" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "price_structures_kind_check" CHECK (kind = ANY (ARRAY['fixed'::text, 'per_period'::text, 'tiered'::text, 'table'::text])),
	CONSTRAINT "price_structures_period_unit_check" CHECK (period_unit = ANY (ARRAY['hour'::text, 'day'::text, 'week'::text, 'month'::text])),
	CONSTRAINT "price_structures_amount_check" CHECK (amount >= 0),
	CONSTRAINT "price_structures_rounding_check" CHECK (rounding = ANY (ARRAY['up'::text, 'nearest'::text, 'down'::text]))
);
--> statement-breakpoint
ALTER TABLE "price_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"tax_profile_id" text,
	"deposit_amount" bigint DEFAULT 0 NOT NULL,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"min_duration_min" integer,
	"max_duration_min" integer,
	"min_notice_min" integer DEFAULT 0 NOT NULL,
	"increment_min" integer,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_type_check" CHECK (type = ANY (ARRAY['rental'::text, 'sale'::text, 'service'::text, 'consumable'::text, 'bundle'::text])),
	CONSTRAINT "products_visibility_check" CHECK (visibility = ANY (ARRAY['public'::text, 'hidden'::text, 'archived'::text])),
	CONSTRAINT "products_deposit_amount_check" CHECK (deposit_amount >= 0),
	CONSTRAINT "products_buffer_before_min_check" CHECK (buffer_before_min >= 0),
	CONSTRAINT "products_buffer_after_min_check" CHECK (buffer_after_min >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "variants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tracking" text NOT NULL,
	"price_structure_id" text,
	"deposit_amount" bigint,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "variants_tracking_check" CHECK (tracking = ANY (ARRAY['serialized'::text, 'bulk'::text, 'none'::text])),
	CONSTRAINT "variants_deposit_amount_check" CHECK (deposit_amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"barcode" text NOT NULL,
	"serial" text,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text DEFAULT 'good' NOT NULL,
	"purchase_date" date,
	"purchase_price" bigint,
	"notes" text DEFAULT '' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_items_status_check" CHECK (status = ANY (ARRAY['available'::text, 'reserved'::text, 'out'::text, 'needs_inspection'::text, 'soft_down'::text, 'hard_down'::text, 'retired'::text, 'lost'::text]))
);
--> statement-breakpoint
ALTER TABLE "stock_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"pricing_mode" text DEFAULT 'sum' NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundles_product_id_key" UNIQUE("product_id"),
	CONSTRAINT "bundles_pricing_mode_check" CHECK (pricing_mode = ANY (ARRAY['sum'::text, 'fixed'::text, 'discount_pct'::text])),
	CONSTRAINT "bundles_discount_bp_check" CHECK ((discount_bp >= 0) AND (discount_bp <= 10000))
);
--> statement-breakpoint
ALTER TABLE "bundles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bundle_components" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"slot_name" text,
	"variant_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bundle_components_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "bundle_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text DEFAULT 'person' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"company_name" text,
	"tax_id" text,
	"addresses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_into_id" text,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_type_check" CHECK (type = ANY (ARRAY['person'::text, 'company'::text]))
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"scope" jsonb DEFAULT '{"type":"order"}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"max_uses" integer,
	"max_uses_per_customer" integer,
	"min_order" bigint DEFAULT 0 NOT NULL,
	"combinable" boolean DEFAULT false NOT NULL,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_kind_check" CHECK (kind = ANY (ARRAY['percent'::text, 'fixed'::text])),
	CONSTRAINT "coupons_value_check" CHECK (value >= 0)
);
--> statement-breakpoint
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_sequences" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"next_value" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" text,
	"location_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"currency" char(3) NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"deposit_policy" jsonb DEFAULT '{"mode":"auto"}'::jsonb NOT NULL,
	"coupon_codes" text[] DEFAULT '{""}' NOT NULL,
	"terms_acceptance" jsonb,
	"source" text DEFAULT 'admin' NOT NULL,
	"public_token" text NOT NULL,
	"quote_expires_at" timestamp with time zone,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{""}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_token_key" UNIQUE("public_token"),
	CONSTRAINT "orders_tenant_id_number_key" UNIQUE("number","tenant_id"),
	CONSTRAINT "orders_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'quote'::text, 'reserved'::text, 'prepared'::text, 'out'::text, 'returned_partial'::text, 'returned'::text, 'inspected'::text, 'closed'::text, 'cancelled'::text, 'expired'::text])),
	CONSTRAINT "orders_payment_status_check" CHECK (payment_status = ANY (ARRAY['unpaid'::text, 'partially_paid'::text, 'paid'::text, 'refunded'::text, 'overdue'::text])),
	CONSTRAINT "orders_source_check" CHECK (source = ANY (ARRAY['storefront'::text, 'admin'::text, 'api'::text])),
	CONSTRAINT "orders_check" CHECK (ends_at > starts_at)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"product_id" text,
	"variant_id" text,
	"bundle_id" text,
	"parent_line_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"deposit" bigint DEFAULT 0 NOT NULL,
	"picked_up_qty" integer DEFAULT 0 NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL,
	"lost_qty" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_type_check" CHECK (type = ANY (ARRAY['rental'::text, 'sale'::text, 'service'::text, 'fee'::text, 'discount'::text])),
	CONSTRAINT "order_lines_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "downtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"stock_item_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "downtimes_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "downtimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"stock_item_id" text,
	"quantity" integer NOT NULL,
	"period" "tstzrange" NOT NULL,
	"kind" text NOT NULL,
	"order_id" text,
	"order_line_id" text,
	"downtime_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "allocations_period_check" CHECK (NOT isempty(period)),
	CONSTRAINT "allocations_kind_check" CHECK (kind = ANY (ARRAY['reservation'::text, 'downtime'::text, 'buffer'::text, 'transfer'::text])),
	CONSTRAINT "allocations_check" CHECK ((stock_item_id IS NULL) OR (quantity = 1))
);
--> statement-breakpoint
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_line_units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"allocation_id" text,
	"checked_out_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"check_in_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_units_order_line_id_stock_item_id_key" UNIQUE("order_line_id","stock_item_id"),
	CONSTRAINT "order_line_units_check_in_outcome_check" CHECK (check_in_outcome = ANY (ARRAY['ok'::text, 'needs_inspection'::text, 'damaged'::text, 'lost'::text]))
);
--> statement-breakpoint
ALTER TABLE "order_line_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"css" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text,
	"customer_id" text,
	"type" text NOT NULL,
	"number" text,
	"issued_at" timestamp with time zone,
	"status" text DEFAULT 'issued' NOT NULL,
	"html" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total" bigint,
	"currency" char(3),
	"template_id" text,
	"template_version" integer,
	"voided_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_type_check" CHECK (type = ANY (ARRAY['quote'::text, 'confirmation'::text, 'contract'::text, 'pick_list'::text, 'delivery_note'::text, 'invoice'::text, 'credit_note'::text, 'receipt'::text, 'deposit_receipt'::text])),
	CONSTRAINT "documents_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'issued'::text, 'sent'::text, 'voided'::text]))
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"config_encrypted" text,
	"mode" text DEFAULT 'test' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_providers_tenant_id_plugin_id_key" UNIQUE("plugin_id","tenant_id"),
	CONSTRAINT "payment_providers_mode_check" CHECK (mode = ANY (ARRAY['test'::text, 'live'::text]))
);
--> statement-breakpoint
ALTER TABLE "payment_providers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"purpose" text DEFAULT 'rental' NOT NULL,
	"method" text DEFAULT 'card' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"provider_ref" text,
	"idempotency_key" text,
	"parent_payment_id" text,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_kind_check" CHECK (kind = ANY (ARRAY['charge'::text, 'authorization'::text, 'refund'::text, 'manual'::text])),
	CONSTRAINT "payments_purpose_check" CHECK (purpose = ANY (ARRAY['rental'::text, 'deposit'::text, 'damage'::text, 'late_fee'::text])),
	CONSTRAINT "payments_amount_check" CHECK (amount >= 0),
	CONSTRAINT "payments_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"purpose" text DEFAULT 'rental' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text DEFAULT 'requires_payment' NOT NULL,
	"provider_ref" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_events_provider_event_id_key" UNIQUE("event_id","provider")
);
--> statement-breakpoint
ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"payment_id" text,
	"authorized_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"captured_amount" bigint DEFAULT 0 NOT NULL,
	"released_at" timestamp with time zone,
	"expiring_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_amount_check" CHECK (amount >= 0),
	CONSTRAINT "deposits_method_check" CHECK (method = ANY (ARRAY['card_auth'::text, 'charge'::text, 'cash'::text, 'waived'::text])),
	CONSTRAINT "deposits_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'held'::text, 'partially_captured'::text, 'captured'::text, 'released'::text, 'expired'::text, 'failed'::text])),
	CONSTRAINT "deposits_check" CHECK (captured_amount <= amount)
);
--> statement-breakpoint
ALTER TABLE "deposits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "damage_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"stock_item_id" text,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"deposit_id" text,
	"document_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_charges_amount_check" CHECK (amount >= 0),
	CONSTRAINT "damage_charges_status_check" CHECK (status = ANY (ARRAY['open'::text, 'captured'::text, 'invoiced'::text, 'waived'::text, 'paid'::text]))
);
--> statement-breakpoint
ALTER TABLE "damage_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_tenant_id_event_channel_locale_key" UNIQUE("channel","event","locale","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"template_key" text NOT NULL,
	"recipient" text NOT NULL,
	"audience" text DEFAULT 'customer' NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"order_id" text,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_audience_check" CHECK (audience = ANY (ARRAY['customer'::text, 'staff'::text])),
	CONSTRAINT "notifications_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'bounced'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"events" text[] DEFAULT '{"*"}' NOT NULL,
	"secret_encrypted" text NOT NULL,
	"previous_secret_encrypted" text,
	"secret_rotated_at" timestamp with time zone,
	"status" text DEFAULT 'enabled' NOT NULL,
	"api_version" text DEFAULT '2026-10-01' NOT NULL,
	"failing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_status_check" CHECK (status = ANY (ARRAY['enabled'::text, 'disabled_by_user'::text, 'disabled_failures'::text]))
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_code" integer,
	"response_body" text,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"location_id" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"coupon_codes" text[] DEFAULT '{""}' NOT NULL,
	"order_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_sessions_status_check" CHECK (status = ANY (ARRAY['open'::text, 'completed'::text, 'expired'::text]))
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_tenant_id_plugin_id_key" UNIQUE("plugin_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "plugins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_categories" (
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "product_categories_pkey" PRIMARY KEY("category_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"year" integer NOT NULL,
	"prefix" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_sequences_pkey" PRIMARY KEY("tenant_id","type","year")
);
--> statement-breakpoint
ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"barcode" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_pkey" PRIMARY KEY("location_id","variant_id"),
	CONSTRAINT "stock_levels_quantity_check" CHECK (quantity >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("key","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_blackouts" ADD CONSTRAINT "location_blackouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_blackouts" ADD CONSTRAINT "location_blackouts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_structures" ADD CONSTRAINT "price_structures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_profile_id_fkey" FOREIGN KEY ("tax_profile_id") REFERENCES "public"."tax_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_price_structure_id_fkey" FOREIGN KEY ("price_structure_id") REFERENCES "public"."price_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_sequences" ADD CONSTRAINT "order_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_parent_line_id_fkey" FOREIGN KEY ("parent_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtimes" ADD CONSTRAINT "downtimes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtimes" ADD CONSTRAINT "downtimes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtimes" ADD CONSTRAINT "downtimes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtimes" ADD CONSTRAINT "downtimes_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_downtime_id_fkey" FOREIGN KEY ("downtime_id") REFERENCES "public"."downtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_units" ADD CONSTRAINT "order_line_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_units" ADD CONSTRAINT "order_line_units_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_units" ADD CONSTRAINT "order_line_units_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_units" ADD CONSTRAINT "order_line_units_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_providers" ADD CONSTRAINT "payment_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_parent_payment_id_fkey" FOREIGN KEY ("parent_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email" ON "users" USING btree (lower(email) text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "locations_one_default" ON "locations" USING btree ("tenant_id" text_ops) WHERE (is_default AND (deleted_at IS NULL));--> statement-breakpoint
CREATE INDEX "location_blackouts_period" ON "location_blackouts" USING gist ("tenant_id" gist_text_ops,"location_id" range_ops,"period" gist_text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug" ON "categories" USING btree ("tenant_id" text_ops,"slug" text_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug" ON "products" USING btree ("tenant_id" text_ops,"slug" text_ops) WHERE (deleted_at IS NULL);--> statement-breakpoint
CREATE INDEX "variants_product" ON "variants" USING btree ("tenant_id" text_ops,"product_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku" ON "variants" USING btree ("tenant_id" text_ops,"sku" text_ops) WHERE ((sku IS NOT NULL) AND (deleted_at IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_barcode" ON "stock_items" USING btree ("tenant_id" text_ops,"barcode" text_ops);--> statement-breakpoint
CREATE INDEX "stock_items_variant" ON "stock_items" USING btree ("tenant_id" text_ops,"variant_id" text_ops,"location_id" text_ops);--> statement-breakpoint
CREATE INDEX "customers_email" ON "customers" USING btree (tenant_id text_ops,lower(email) text_ops);--> statement-breakpoint
CREATE INDEX "customers_name_trgm" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_phone" ON "customers" USING btree ("tenant_id" text_ops,"phone" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code" ON "coupons" USING btree (tenant_id text_ops,lower(code) text_ops);--> statement-breakpoint
CREATE INDEX "orders_customer" ON "orders" USING btree ("tenant_id" text_ops,"customer_id" text_ops);--> statement-breakpoint
CREATE INDEX "orders_period" ON "orders" USING btree ("tenant_id" timestamptz_ops,"starts_at" timestamptz_ops,"ends_at" text_ops);--> statement-breakpoint
CREATE INDEX "orders_status" ON "orders" USING btree ("tenant_id" text_ops,"status" timestamptz_ops,"starts_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "order_lines_order" ON "order_lines" USING btree ("tenant_id" text_ops,"order_id" text_ops);--> statement-breakpoint
CREATE INDEX "order_events_order" ON "order_events" USING btree ("tenant_id" timestamptz_ops,"order_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "allocations_lookup" ON "allocations" USING gist ("tenant_id" gist_text_ops,"variant_id" gist_text_ops,"location_id" gist_text_ops,"period" range_ops);--> statement-breakpoint
CREATE INDEX "allocations_order_line" ON "allocations" USING btree ("order_line_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number" ON "documents" USING btree ("tenant_id" text_ops,"type" text_ops,"number" text_ops) WHERE (number IS NOT NULL);--> statement-breakpoint
CREATE INDEX "documents_order" ON "documents" USING btree ("tenant_id" text_ops,"order_id" text_ops);--> statement-breakpoint
CREATE INDEX "payments_order" ON "payments" USING btree ("tenant_id" text_ops,"order_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref" ON "payments" USING btree ("provider" text_ops,"provider_ref" text_ops) WHERE ((provider_ref IS NOT NULL) AND (kind <> 'refund'::text));--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_ref" ON "payment_intents" USING btree ("provider" text_ops,"provider_ref" text_ops) WHERE (provider_ref IS NOT NULL);--> statement-breakpoint
CREATE INDEX "deposits_order" ON "deposits" USING btree ("tenant_id" text_ops,"order_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" USING btree ("tenant_id" text_ops,"dedupe_key" text_ops) WHERE (dedupe_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "notifications_order" ON "notifications" USING btree ("tenant_id" text_ops,"order_id" text_ops);--> statement-breakpoint
CREATE INDEX "outbox_unpublished" ON "outbox" USING btree ("created_at" timestamptz_ops) WHERE (published_at IS NULL);--> statement-breakpoint
CREATE INDEX "webhook_events_created" ON "webhook_events" USING btree ("tenant_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due" ON "webhook_deliveries" USING btree ("next_attempt_at" timestamptz_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint" ON "webhook_deliveries" USING btree ("tenant_id" text_ops,"endpoint_id" timestamptz_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" USING btree ("tenant_id" timestamptz_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("tenant_id" text_ops,"entity_type" timestamptz_ops,"entity_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "stock_levels_barcode" ON "stock_levels" USING btree ("tenant_id" text_ops,"barcode" text_ops) WHERE (barcode IS NOT NULL);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(id)) WITH CHECK (openrent_tenant_ok(id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "locations" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "location_blackouts" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "api_keys" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_profiles" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "price_structures" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "variants" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_items" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_adjustments" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bundles" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bundle_components" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupons" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_sequences" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_lines" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_events" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "downtimes" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "allocations" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_line_units" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_templates" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_providers" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_intents" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "provider_events" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deposits" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "damage_charges" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_templates" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_endpoints" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_events" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_deliveries" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "checkout_sessions" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "plugins" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_categories" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_sequences" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_levels" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "idempotency_keys" AS PERMISSIVE FOR ALL TO public USING (openrent_tenant_ok(tenant_id)) WITH CHECK (openrent_tenant_ok(tenant_id));
*/