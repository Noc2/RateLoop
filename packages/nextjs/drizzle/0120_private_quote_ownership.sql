ALTER TABLE "tokenless_agent_quotes" ADD COLUMN "owner_principal_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_quotes" ADD COLUMN "owner_workspace_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_quotes" ADD COLUMN "owner_api_key_id" text;--> statement-breakpoint

-- Pre-0120 private quote IDs were deterministic request digests and carried no
-- owner. Delete capabilities that have never been used. Referenced rows must
-- remain for ask/audit foreign keys, but are deliberately tombstoned so they
-- cannot be replayed across a rolling deployment as if they were new opaque,
-- owner-bound capabilities.
DELETE FROM "tokenless_agent_quotes"
WHERE COALESCE(("request_json"::jsonb ->> 'visibility'), 'private') = 'private'
  AND "owner_principal_id" IS NULL
  AND "owner_workspace_id" IS NULL
  AND "owner_api_key_id" IS NULL
  AND "quote_id" NOT IN (
    SELECT "quote_id" FROM "tokenless_agent_asks"
  );--> statement-breakpoint

-- A deliberately impossible insert is a portable migration-time assertion.
-- Keep this as ordinary SQL so both PostgreSQL and the pg-mem migration harness
-- fail closed without requiring a PL/pgSQL interpreter.
CREATE TABLE "tokenless_0120_active_legacy_private_ask_guard" (
  "marker" integer NOT NULL CHECK ("marker" = 0)
);--> statement-breakpoint
INSERT INTO "tokenless_0120_active_legacy_private_ask_guard" ("marker")
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM "tokenless_agent_quotes" q
  JOIN "tokenless_agent_asks" a ON a."quote_id"=q."quote_id"
  WHERE COALESCE((q."request_json"::jsonb ->> 'visibility'), 'private')='private'
    AND q."owner_principal_id" IS NULL
    AND q."owner_workspace_id" IS NULL
    AND q."owner_api_key_id" IS NULL
    AND (
      a."status" IN ('awaiting_payment','open')
      OR (a."status"='submitted' AND a."result_json" IS NULL)
    )
);--> statement-breakpoint
DROP TABLE "tokenless_0120_active_legacy_private_ask_guard";--> statement-breakpoint

-- Referenced legacy rows are retained only as commitment evidence. Remove both
-- the quote request and the linked product content so no historical plaintext
-- private prompt survives merely because settlement/audit foreign keys do.
UPDATE "tokenless_content_records"
SET "content_json"=jsonb_build_object(
      'schemaVersion','rateloop.erased-private-content.v1',
      'contentCommitment',"content_hash"
    )::text,
    "updated_at"=CURRENT_TIMESTAMP
WHERE "content_id" IN (
  SELECT qr."content_id"
  FROM "tokenless_agent_quotes" q
  JOIN "tokenless_agent_asks" a ON a."quote_id"=q."quote_id"
  JOIN "tokenless_ask_ownership" ao ON ao."operation_key"=a."operation_key"
  JOIN "tokenless_question_records" qr ON qr."question_id"=ao."question_id"
  WHERE COALESCE((q."request_json"::jsonb ->> 'visibility'), 'private')='private'
    AND q."owner_principal_id" IS NULL
    AND q."owner_workspace_id" IS NULL
    AND q."owner_api_key_id" IS NULL
);--> statement-breakpoint
UPDATE "tokenless_agent_quotes"
SET "request_json"=jsonb_build_object(
      'schemaVersion','rateloop.erased-private-quote.v1',
      'visibility','private',
      'requestCommitment',"request_hash"
    )::text
WHERE COALESCE(("request_json"::jsonb ->> 'visibility'), 'private')='private'
  AND "owner_principal_id" IS NULL
  AND "owner_workspace_id" IS NULL
  AND "owner_api_key_id" IS NULL
  AND "quote_id" IN (SELECT "quote_id" FROM "tokenless_agent_asks");--> statement-breakpoint
UPDATE "tokenless_agent_quotes"
SET "owner_principal_id" = 'legacy-invalidated:' || "quote_id"
WHERE COALESCE(("request_json"::jsonb ->> 'visibility'), 'private') = 'private'
  AND "owner_principal_id" IS NULL
  AND "owner_workspace_id" IS NULL
  AND "owner_api_key_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_quotes"
  ADD CONSTRAINT "tokenless_agent_quotes_visibility_owner_check" CHECK (
    (
      ("request_json"::jsonb ->> 'visibility') = 'public'
      AND "owner_principal_id" IS NULL
      AND "owner_workspace_id" IS NULL
      AND "owner_api_key_id" IS NULL
    )
    OR
    (
      COALESCE(("request_json"::jsonb ->> 'visibility'), 'private') = 'private'
      AND (
        (
          "owner_principal_id" IS NOT NULL
          AND "owner_workspace_id" IS NULL
          AND "owner_api_key_id" IS NULL
        )
        OR
        (
          "owner_principal_id" IS NULL
          AND "owner_workspace_id" IS NOT NULL
          AND "owner_api_key_id" IS NOT NULL
        )
      )
    )
  );--> statement-breakpoint
CREATE INDEX "tokenless_agent_quotes_principal_expiry_idx"
  ON "tokenless_agent_quotes" USING btree ("owner_principal_id", "expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_quotes_api_key_expiry_idx"
  ON "tokenless_agent_quotes" USING btree ("owner_workspace_id", "owner_api_key_id", "expires_at");--> statement-breakpoint

-- New code inserts immutable random quote capabilities. This guard makes an
-- old rolling-deployment writer's deterministic ON CONFLICT refresh fail closed
-- for private quotes while still permitting deletion-time owner anonymization.
CREATE OR REPLACE FUNCTION "tokenless_guard_private_quote_payload"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND COALESCE((NEW."request_json"::jsonb ->> 'visibility'), 'private') = 'private' THEN
    IF NEW."owner_principal_id" IS NOT NULL THEN
      PERFORM 1
      FROM "tokenless_principals"
      WHERE "principal_id" = NEW."owner_principal_id" AND "status" = 'active'
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'private quote owner is not active';
      END IF;
    ELSIF NEW."owner_workspace_id" IS NOT NULL AND NEW."owner_api_key_id" IS NOT NULL THEN
      PERFORM 1
      FROM "tokenless_workspaces" AS "workspace"
      JOIN "tokenless_workspace_api_keys" AS "api_key"
        ON "api_key"."workspace_id" = "workspace"."workspace_id"
      WHERE "workspace"."workspace_id" = NEW."owner_workspace_id"
        AND "workspace"."status" = 'active'
        AND "api_key"."key_id" = NEW."owner_api_key_id"
        AND "api_key"."revoked_at" IS NULL
      FOR KEY SHARE OF "workspace", "api_key";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'private quote owner is not active';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE'
     AND COALESCE((OLD."request_json"::jsonb ->> 'visibility'), 'private') = 'private'
     AND (
       NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
       OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
       OR NEW."request_json" IS DISTINCT FROM OLD."request_json"
       OR NEW."response_json" IS DISTINCT FROM OLD."response_json"
       OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     ) THEN
    IF NOT (
      (
        NEW."owner_principal_id" LIKE 'deleted-quote:%'
        OR NEW."owner_principal_id" LIKE 'deleted-workspace-quote:%'
      )
      AND (NEW."request_json"::jsonb ->> 'schemaVersion')='rateloop.erased-private-quote.v1'
      AND (NEW."request_json"::jsonb ->> 'visibility')='private'
      AND (NEW."request_json"::jsonb ->> 'requestCommitment')=OLD."request_hash"
      AND NEW."request_hash"=OLD."request_hash"
      AND NEW."response_json"=OLD."response_json"
      AND NEW."expires_at"=OLD."expires_at"
      AND NEW."created_at"=OLD."created_at"
    ) THEN
      RAISE EXCEPTION 'private quote payloads are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tokenless_agent_quotes_private_payload_immutable"
  BEFORE INSERT OR UPDATE ON "tokenless_agent_quotes"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_private_quote_payload"();
