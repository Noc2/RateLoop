CREATE TABLE "tokenless_passkey_action_proofs" (
	"proof_hash" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE CASCADE,
	"better_auth_user_id" text NOT NULL,
	"action" text NOT NULL,
	"authentication_method" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tokenless_passkey_action_proofs_hash_check"
		CHECK ("proof_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "tokenless_passkey_action_proofs_action_check"
		CHECK ("action" IN ('passkey_add')),
	CONSTRAINT "tokenless_passkey_action_proofs_time_check"
		CHECK ("expires_at" > "created_at" AND ("consumed_at" IS NULL OR "consumed_at" >= "created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_passkey_action_proofs_principal_action_unique"
	ON "tokenless_passkey_action_proofs" USING btree ("principal_id", "action");
