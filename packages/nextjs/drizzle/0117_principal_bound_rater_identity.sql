ALTER TABLE "tokenless_rater_profiles" ADD COLUMN "principal_id" text;--> statement-breakpoint

CREATE TABLE "tokenless_payout_wallet_ownership" (
  "wallet_address" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "first_binding_id" text NOT NULL REFERENCES "tokenless_wallet_bindings"("binding_id") ON DELETE CASCADE,
  "first_bound_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_payout_wallet_ownership_address_check"
    CHECK ("wallet_address" ~ '^0x[0-9a-f]{40}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_payout_wallet_ownership_principal_idx"
  ON "tokenless_payout_wallet_ownership" USING btree ("principal_id", "first_bound_at");--> statement-breakpoint
INSERT INTO "tokenless_payout_wallet_ownership"
  ("wallet_address", "principal_id", "first_binding_id", "first_bound_at")
SELECT lower(binding."wallet_address"), binding."principal_id",
       min(binding."binding_id"), min(binding."created_at")
FROM "tokenless_wallet_bindings" binding
WHERE binding."purpose" = 'payout'
GROUP BY lower(binding."wallet_address"), binding."principal_id";--> statement-breakpoint

UPDATE "tokenless_rater_profiles"
SET "principal_id" = ownership."principal_id"
FROM "tokenless_payout_wallet_ownership" ownership
WHERE ownership."wallet_address" = lower("tokenless_rater_profiles"."account_address");--> statement-breakpoint

UPDATE "tokenless_rater_profiles"
SET "account_address" = lower(active."wallet_address")
FROM "tokenless_wallet_bindings" active
WHERE "tokenless_rater_profiles"."principal_id" = active."principal_id"
  AND active."purpose" = 'payout' AND active."revoked_at" IS NULL;--> statement-breakpoint

ALTER TABLE "tokenless_rater_profiles"
  ADD CONSTRAINT "tokenless_rater_profiles_principal_fk"
  FOREIGN KEY ("principal_id") REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_rater_profiles"
  ADD CONSTRAINT "tokenless_rater_profiles_principal_unique" UNIQUE("principal_id");--> statement-breakpoint
ALTER TABLE "tokenless_rater_profiles" ADD COLUMN "deletion_receipt_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_rater_profiles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_rater_profiles"
  ADD CONSTRAINT "tokenless_rater_profiles_lifecycle_check" CHECK (
    ("principal_id" IS NOT NULL AND "deletion_receipt_hash" IS NULL AND "deleted_at" IS NULL)
    OR
    ("principal_id" IS NULL AND "deletion_receipt_hash" ~ '^sha256:[0-9a-f]{64}$' AND "deleted_at" IS NOT NULL)
  );--> statement-breakpoint
CREATE INDEX "tokenless_rater_profiles_principal_idx"
  ON "tokenless_rater_profiles" USING btree ("principal_id", "rater_id");--> statement-breakpoint

ALTER TABLE "tokenless_eligibility_provider_handoffs" ADD COLUMN "principal_id" text;--> statement-breakpoint
UPDATE "tokenless_eligibility_provider_handoffs"
SET "principal_id" = ownership."principal_id"
FROM "tokenless_payout_wallet_ownership" ownership
WHERE lower("tokenless_eligibility_provider_handoffs"."account_address") = ownership."wallet_address";--> statement-breakpoint
ALTER TABLE "tokenless_eligibility_provider_handoffs" ALTER COLUMN "principal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_eligibility_provider_handoffs"
  ADD CONSTRAINT "tokenless_eligibility_provider_handoffs_principal_fk"
  FOREIGN KEY ("principal_id") REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "tokenless_eligibility_provider_handoffs_principal_status_idx"
  ON "tokenless_eligibility_provider_handoffs" USING btree ("principal_id", "status", "expires_at");--> statement-breakpoint

ALTER TABLE "tokenless_world_id_requests" ADD COLUMN "principal_id" text;--> statement-breakpoint
UPDATE "tokenless_world_id_requests"
SET "principal_id" = profile."principal_id"
FROM "tokenless_rater_profiles" profile
WHERE profile."rater_id" = "tokenless_world_id_requests"."rater_id";--> statement-breakpoint
ALTER TABLE "tokenless_world_id_requests" ALTER COLUMN "principal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_world_id_requests"
  ADD CONSTRAINT "tokenless_world_id_requests_principal_fk"
  FOREIGN KEY ("principal_id") REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "tokenless_world_id_requests_principal_status_idx"
  ON "tokenless_world_id_requests" USING btree ("principal_id", "status", "expires_at");--> statement-breakpoint

ALTER TABLE "tokenless_paid_vouchers" ADD COLUMN "payout_account_snapshot" text;--> statement-breakpoint
UPDATE "tokenless_paid_vouchers"
SET "payout_account_snapshot" = lower(payout."payout_account")
FROM "tokenless_payout_eligibility" payout
WHERE payout."rater_id" = "tokenless_paid_vouchers"."rater_id";--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers" ALTER COLUMN "payout_account_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD CONSTRAINT "tokenless_paid_vouchers_payout_snapshot_check"
  CHECK ("payout_account_snapshot" ~ '^0x[0-9a-f]{40}$');--> statement-breakpoint

ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "rater_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "payout_account_snapshot" text;--> statement-breakpoint
UPDATE "tokenless_assurance_assignments"
SET "rater_id" = resolved."rater_id",
    "payout_account_snapshot" = CASE
      WHEN lower("tokenless_assurance_assignments"."reviewer_account_address") ~ '^0x[0-9a-f]{40}$'
        THEN lower("tokenless_assurance_assignments"."reviewer_account_address")
      ELSE lower(resolved."payout_account")
    END
FROM (
  SELECT profile."rater_id", profile."account_address", profile."principal_id", payout."payout_account"
  FROM "tokenless_rater_profiles" profile
  JOIN "tokenless_payout_eligibility" payout ON payout."rater_id" = profile."rater_id"
) resolved
WHERE "tokenless_assurance_assignments"."paid_assignment" = true
  AND (
    lower("tokenless_assurance_assignments"."reviewer_account_address") = lower(resolved."account_address")
    OR "tokenless_assurance_assignments"."reviewer_account_address" = resolved."principal_id"
  );--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_rater_fk"
  FOREIGN KEY ("rater_id") REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_paid_rater_snapshot_check" CHECK (
    ("paid_assignment" = false AND "rater_id" IS NULL AND "payout_account_snapshot" IS NULL)
    OR
    ("paid_assignment" = true AND "rater_id" IS NOT NULL
      AND "payout_account_snapshot" ~ '^0x[0-9a-f]{40}$')
  );--> statement-breakpoint
CREATE INDEX "tokenless_assurance_assignments_rater_status_idx"
  ON "tokenless_assurance_assignments" USING btree ("rater_id", "status", "reservation_expires_at");
