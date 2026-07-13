ALTER TABLE "tokenless_provider_subject_bindings" ADD COLUMN "subject_reference_key_version" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assertions" ADD COLUMN "provider_assertion_key_version" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assertions" ADD COLUMN "assurance_validity_model" text NOT NULL DEFAULT 'expiring';--> statement-breakpoint
CREATE TABLE "tokenless_world_id_action_registry" (
  "provider_id" text NOT NULL,
  "rp_id" text NOT NULL,
  "app_id" text NOT NULL,
  "action_version" text NOT NULL,
  "action" text NOT NULL,
  "environment" text NOT NULL,
  "hmac_key_fingerprints_json" text NOT NULL,
  "registered_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_world_id_action_registry_pk" PRIMARY KEY("provider_id", "rp_id"),
  CONSTRAINT "tokenless_world_id_action_provider_check" CHECK ("provider_id" = 'world:poh'),
  CONSTRAINT "tokenless_world_id_action_environment_check" CHECK ("environment" IN ('production', 'staging'))
);--> statement-breakpoint
CREATE TABLE "tokenless_world_id_context_limits" (
  "rater_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "window_started_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_world_id_context_limits_count_check" CHECK ("request_count" >= 1 AND "request_count" <= 5)
);--> statement-breakpoint
CREATE TABLE "tokenless_world_id_requests" (
  "request_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "account_address" text NOT NULL,
  "provider_id" text NOT NULL,
  "rp_id" text NOT NULL,
  "app_id" text NOT NULL,
  "action_version" text NOT NULL,
  "action" text NOT NULL,
  "environment" text NOT NULL,
  "mode" text NOT NULL,
  "assurance_effect" text NOT NULL,
  "nonce" text NOT NULL,
  "credential_expires_at_min" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "verify_attempt_count" integer NOT NULL DEFAULT 0,
  "last_verify_attempt_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "assertion_id" text REFERENCES "tokenless_assurance_assertions"("assertion_id"),
  CONSTRAINT "tokenless_world_id_requests_nonce_unique" UNIQUE("rp_id", "nonce"),
  CONSTRAINT "tokenless_world_id_requests_provider_check" CHECK ("provider_id" = 'world:poh'),
  CONSTRAINT "tokenless_world_id_requests_environment_check" CHECK ("environment" IN ('production', 'staging')),
  CONSTRAINT "tokenless_world_id_requests_mode_check" CHECK ("mode" = 'initial_unique'),
  CONSTRAINT "tokenless_world_id_requests_assurance_effect_check" CHECK ("assurance_effect" = 'bind_durable_unique_human'),
  CONSTRAINT "tokenless_world_id_requests_status_check" CHECK ("status" IN ('pending', 'verified', 'superseded')),
  CONSTRAINT "tokenless_world_id_requests_lifetime_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "tokenless_world_id_requests_attempt_check" CHECK ("verify_attempt_count" >= 0 AND "verify_attempt_count" <= 10),
  CONSTRAINT "tokenless_world_id_requests_consumed_check" CHECK (("status" IN ('pending', 'superseded') AND "consumed_at" IS NULL AND "assertion_id" IS NULL) OR ("status" = 'verified' AND "consumed_at" IS NOT NULL AND "assertion_id" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "tokenless_world_id_requests_rater_status_idx" ON "tokenless_world_id_requests" USING btree ("rater_id", "status", "expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_world_id_requests_one_pending_idx" ON "tokenless_world_id_requests" USING btree ("rater_id") WHERE "status" = 'pending';
