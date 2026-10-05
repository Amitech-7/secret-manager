CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" "bytea" NOT NULL,
	"prev_refresh_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_refresh_hash_unique" UNIQUE("refresh_hash"),
	CONSTRAINT "sessions_refresh_hash_len" CHECK (octet_length("sessions"."refresh_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"auth_hash" "bytea" NOT NULL,
	"kdf_salt" "bytea" NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"wrapped_vk_pw" "bytea" NOT NULL,
	"wrapped_vk_rec" "bytea" NOT NULL,
	"recovery_auth_hash" "bytea" NOT NULL,
	"profile_enc" "bytea",
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_secret_enc" "bytea",
	"totp_pending_enc" "bytea",
	"totp_last_step" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[a-z0-9._-]{3,32}$'),
	CONSTRAINT "users_auth_hash_len" CHECK (octet_length("users"."auth_hash") = 32),
	CONSTRAINT "users_recovery_hash_len" CHECK (octet_length("users"."recovery_auth_hash") = 32),
	CONSTRAINT "users_kdf_salt_len" CHECK (octet_length("users"."kdf_salt") = 16),
	CONSTRAINT "users_item_count_nonneg" CHECK ("users"."item_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vault_items_type_valid" CHECK ("vault_items"."type" in ('credential', 'card', 'note', 'member', 'bank', 'account_type', 'account')),
	CONSTRAINT "vault_items_ciphertext_size" CHECK (octet_length("vault_items"."ciphertext") between 29 and 8192),
	CONSTRAINT "vault_items_version_positive" CHECK ("vault_items"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vault_items_user_updated_idx" ON "vault_items" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "vault_items_user_type_idx" ON "vault_items" USING btree ("user_id","type") WHERE "vault_items"."deleted_at" is null;