UPDATE "tokenless_assurance_assertions"
SET "status" = 'revoked', "revoked_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
WHERE "provider_namespace" = 'legacy:v2'
  AND "provider_assertion_reference_scheme" = 'legacy-sha256-v2'
  AND "status" = 'active';--> statement-breakpoint
UPDATE "tokenless_provider_subject_bindings"
SET "status" = 'revoked', "revoked_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
WHERE "provider_namespace" = 'legacy:v2'
  AND "subject_reference_scheme" = 'legacy-sha256-v2'
  AND "status" = 'active';
