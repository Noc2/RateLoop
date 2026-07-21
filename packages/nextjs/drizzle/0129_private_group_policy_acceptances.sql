CREATE TABLE "tokenless_private_group_policy_acceptances" (
  "group_id" text NOT NULL,
  "policy_version" integer NOT NULL,
  "policy_hash" text NOT NULL,
  "principal_address" text NOT NULL,
  "accepted_from_assignment_id" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("group_id", "policy_version", "principal_address"),
  CONSTRAINT "tokenless_private_group_policy_acceptances_policy_fk"
    FOREIGN KEY ("group_id", "policy_version", "policy_hash")
    REFERENCES "tokenless_private_group_policy_versions"("group_id", "version", "policy_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_private_group_policy_acceptances_membership_fk"
    FOREIGN KEY ("group_id", "principal_address")
    REFERENCES "tokenless_private_group_memberships"("group_id", "principal_address")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_private_group_policy_acceptances_version_check"
    CHECK ("policy_version" >= 1),
  CONSTRAINT "tokenless_private_group_policy_acceptances_hash_check"
    CHECK ("policy_hash" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_private_group_policy_acceptances_principal_idx"
  ON "tokenless_private_group_policy_acceptances" USING btree
  ("principal_address", "group_id", "policy_version");--> statement-breakpoint

INSERT INTO "tokenless_private_group_policy_acceptances"
  ("group_id", "policy_version", "policy_hash", "principal_address",
   "accepted_from_assignment_id", "accepted_at")
SELECT d."private_group_id", d."private_group_policy_version", d."private_group_policy_hash",
       a."reviewer_account_address", MIN(a."assignment_id"), MIN(a."accepted_at")
FROM "tokenless_private_unpaid_review_assignments" a
JOIN "tokenless_private_unpaid_review_deliveries" d ON d."delivery_id" = a."delivery_id"
WHERE a."status" IN ('accepted', 'completed') AND a."accepted_at" IS NOT NULL
GROUP BY d."private_group_id", d."private_group_policy_version", d."private_group_policy_hash",
         a."reviewer_account_address"
ON CONFLICT ("group_id", "policy_version", "principal_address") DO NOTHING;
