CREATE TABLE "plugin_migrations" (
	"plugin_id" text NOT NULL,
	"name" text NOT NULL,
	"checksum" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_migrations_pkey" PRIMARY KEY("plugin_id","name")
);
