CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_criterion_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_criterion_check"
  CHECK (char_length("criterion") BETWEEN 1 AND 500);--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  ALTER COLUMN "response_window_seconds" DROP NOT NULL,
  ALTER COLUMN "panel_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_response_window_check",
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_panel_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_response_window_check" CHECK (
    ("response_window_seconds" IS NULL AND "configuration_status" = 'action_required')
    OR "response_window_seconds" BETWEEN 1200 AND 86400
  ),
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_panel_check" CHECK (
    ("panel_size" IS NULL AND "configuration_status" = 'action_required')
    OR "panel_size" BETWEEN 1 AND 100
  );--> statement-breakpoint

CREATE TEMPORARY TABLE "_tokenless_review_backfill_guard" (
  "violation" boolean NOT NULL CHECK ("violation" = false)
);--> statement-breakpoint
INSERT INTO "_tokenless_review_backfill_guard" ("violation")
SELECT true
WHERE EXISTS (
    SELECT 1
    FROM "tokenless_agent_review_policies" p
    WHERE p."audience_policy_json"::jsonb ->> 'reviewerSource' IS NULL
       OR (p."audience_policy_json"::jsonb ->> 'reviewerSource')
          NOT IN ('private_invited', 'public_network', 'hybrid')
  )
  OR EXISTS (
    SELECT 1
    FROM "tokenless_agent_review_policies" left_policy
    JOIN "tokenless_agent_review_policies" right_policy
      ON right_policy."workspace_id" = left_policy."workspace_id"
     AND right_policy."agent_id" = left_policy."agent_id"
     AND right_policy."agent_version_id" = left_policy."agent_version_id"
     AND (
       right_policy."policy_id" > left_policy."policy_id"
       OR (
         right_policy."policy_id" = left_policy."policy_id"
         AND right_policy."version" > left_policy."version"
       )
     )
    WHERE left_policy."enabled" = true AND left_policy."superseded_at" IS NULL
      AND right_policy."enabled" = true AND right_policy."superseded_at" IS NULL
  );--> statement-breakpoint
DROP TABLE "_tokenless_review_backfill_guard";--> statement-breakpoint

CREATE TEMPORARY TABLE "_tokenless_review_policy_backfill" AS
WITH policy_source AS (
  SELECT
    p.*,
    p."audience_policy_json"::jsonb AS "audience_json",
    p."audience_policy_json"::jsonb ->> 'reviewerSource' AS "reviewer_source"
  FROM "tokenless_agent_review_policies" p
), exact_group AS (
  SELECT
    p."workspace_id",
    p."policy_id",
    p."version" AS "policy_version",
    COALESCE(json_group."group_id", setup_group."group_id") AS "group_id",
    COALESCE(json_group."policy_version", setup_group."policy_version") AS "group_policy_version",
    COALESCE(json_group."policy_hash", setup_group."policy_hash") AS "group_policy_hash",
    COALESCE(json_group."max_private_sensitivity", setup_group."max_private_sensitivity") AS "group_sensitivity"
  FROM policy_source p
  LEFT JOIN LATERAL (
    SELECT
      g."group_id",
      gp."version" AS "policy_version",
      gp."policy_hash",
      gp."max_private_sensitivity"
    FROM "tokenless_private_groups" g
    JOIN "tokenless_private_group_policy_versions" gp
      ON gp."group_id" = g."group_id"
     AND gp."version" = g."current_policy_version"
    WHERE g."workspace_id" = p."workspace_id"
      AND g."status" = 'active'
      AND g."group_id" = p."audience_json" -> 'group' ->> 'groupId'
      AND gp."version"::text = p."audience_json" -> 'group' ->> 'policyVersion'
      AND gp."policy_hash" = p."audience_json" -> 'group' ->> 'policyHash'
    LIMIT 1
  ) json_group ON true
  LEFT JOIN LATERAL (
    SELECT
      g."group_id",
      gp."version" AS "policy_version",
      gp."policy_hash",
      gp."max_private_sensitivity"
    FROM "tokenless_workspace_agent_setups" s
    JOIN "tokenless_private_groups" g
      ON g."workspace_id" = s."workspace_id"
     AND g."group_id" = s."private_group_id"
     AND g."status" = 'active'
    JOIN "tokenless_private_group_policy_versions" gp
      ON gp."group_id" = g."group_id"
     AND gp."version" = g."current_policy_version"
    WHERE s."workspace_id" = p."workspace_id"
      AND s."review_policy_id" = p."policy_id"
      AND s."review_policy_version" = p."version"
    LIMIT 1
  ) setup_group ON json_group."group_id" IS NULL
), semantic_source AS (
  SELECT
    p."workspace_id",
    p."policy_id",
    p."version" AS "policy_version",
    p."agent_id",
    p."agent_version_id",
    p."enabled",
    p."created_by",
    p."approved_by",
    p."created_at",
    p."superseded_at",
    CASE p."reviewer_source"
      WHEN 'private_invited' THEN 'private_invited'
      WHEN 'public_network' THEN 'public_network'
      ELSE 'hybrid'
    END AS "audience",
    CASE WHEN p."reviewer_source" = 'private_invited' THEN 'private_workspace' ELSE 'public_or_test' END
      AS "content_boundary",
    CASE
      WHEN p."reviewer_source" = 'private_invited' THEN COALESCE(
        g."group_sensitivity",
        CASE
          WHEN p."audience_json" ->> 'maximumPrivateSensitivity'
            IN ('internal', 'confidential', 'restricted', 'regulated')
          THEN p."audience_json" ->> 'maximumPrivateSensitivity'
          ELSE 'confidential'
        END
      )
      ELSE NULL
    END AS "private_sensitivity",
    CASE WHEN p."reviewer_source" IN ('private_invited', 'hybrid') THEN g."group_id" ELSE NULL END AS "group_id",
    CASE WHEN p."reviewer_source" IN ('private_invited', 'hybrid') THEN g."group_policy_version" ELSE NULL END
      AS "group_policy_version",
    CASE WHEN p."reviewer_source" IN ('private_invited', 'hybrid') THEN g."group_policy_hash" ELSE NULL END
      AS "group_policy_hash",
    CASE WHEN p."reviewer_source" = 'private_invited' AND g."group_id" IS NOT NULL THEN 1800 ELSE NULL END
      AS "response_window_seconds",
    CASE WHEN p."reviewer_source" = 'private_invited' AND g."group_id" IS NOT NULL THEN 1 ELSE NULL END
      AS "panel_size",
    CASE WHEN p."reviewer_source" = 'private_invited' THEN 'unpaid' ELSE 'usdc' END AS "compensation_mode",
    CASE
      WHEN p."reviewer_source" = 'private_invited' AND g."group_id" IS NOT NULL THEN 'ready'
      ELSE 'action_required'
    END AS "configuration_status"
  FROM policy_source p
  JOIN exact_group g
    ON g."workspace_id" = p."workspace_id"
   AND g."policy_id" = p."policy_id"
   AND g."policy_version" = p."version"
), semantic_document AS (
  SELECT
    s.*,
    '{' ||
      '"agent":{"agentId":' || to_jsonb(s."agent_id")::text ||
        ',"agentVersionId":' || to_jsonb(s."agent_version_id")::text || '},' ||
      '"audience":{"audience":' || to_jsonb(s."audience")::text ||
        ',"contentBoundary":' || to_jsonb(s."content_boundary")::text ||
        ',"privateGroupPolicy":' || CASE
          WHEN s."group_id" IS NULL THEN 'null'
          ELSE '{"groupId":' || to_jsonb(s."group_id")::text ||
            ',"policyHash":' || to_jsonb(s."group_policy_hash")::text ||
            ',"policyVersion":' || s."group_policy_version"::text || '}'
        END ||
        ',"privateSensitivity":' || COALESCE(to_jsonb(s."private_sensitivity")::text, 'null') || '},' ||
      '"economics":{"bountyPerSeatAtomic":null,"compensationMode":' ||
        to_jsonb(s."compensation_mode")::text || ',"currency":' ||
        CASE WHEN s."compensation_mode" = 'usdc' THEN '"USDC"' ELSE 'null' END || '},' ||
      '"panelSize":' || COALESCE(s."panel_size"::text, 'null') || ',' ||
      '"question":{"criterion":"Is this output correct and safe to use?",' ||
        '"negativeLabel":"Reject","positiveLabel":"Approve","rationaleMode":"optional"},' ||
      '"responseWindowSeconds":' || COALESCE(s."response_window_seconds"::text, 'null') || ',' ||
      '"schemaVersion":"rateloop.review-request-profile.v1"}' AS "profile_document"
  FROM semantic_source s
), profile_identity AS (
  SELECT
    d.*,
    'sha256:' || encode(digest(convert_to(d."profile_document", 'UTF8'), 'sha256'), 'hex') AS "profile_hash"
  FROM semantic_document d
)
SELECT
  i.*,
  'rrp_' || substr(encode(digest(convert_to(i."workspace_id" || '|' || i."profile_hash", 'UTF8'), 'sha256'), 'hex'), 1, 40)
    AS "profile_id"
FROM profile_identity i;--> statement-breakpoint

INSERT INTO "tokenless_agent_review_request_profiles" (
  "profile_id", "version", "workspace_id", "agent_id", "agent_version_id", "criterion",
  "positive_label", "negative_label", "rationale_mode", "audience", "content_boundary",
  "private_sensitivity", "private_group_id", "private_group_policy_version", "private_group_policy_hash",
  "response_window_seconds", "panel_size", "compensation_mode", "bounty_per_seat_atomic",
  "configuration_status", "profile_hash", "created_by", "created_at", "approved_by", "approved_at",
  "superseded_at"
)
SELECT DISTINCT ON (b."workspace_id", b."profile_id")
  b."profile_id", 1, b."workspace_id", b."agent_id", b."agent_version_id",
  'Is this output correct and safe to use?', 'Approve', 'Reject', 'optional', b."audience", b."content_boundary",
  b."private_sensitivity", b."group_id", b."group_policy_version", b."group_policy_hash",
  b."response_window_seconds", b."panel_size", b."compensation_mode", NULL, b."configuration_status",
  b."profile_hash", b."created_by", b."created_at",
  CASE WHEN b."configuration_status" = 'ready' THEN b."approved_by" ELSE NULL END,
  CASE WHEN b."configuration_status" = 'ready' THEN b."created_at" ELSE NULL END,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "_tokenless_review_policy_backfill" current_profile
      WHERE current_profile."workspace_id" = b."workspace_id"
        AND current_profile."profile_id" = b."profile_id"
        AND current_profile."enabled" = true
        AND current_profile."superseded_at" IS NULL
    ) THEN NULL
    ELSE COALESCE(b."superseded_at", b."created_at")
  END
FROM "_tokenless_review_policy_backfill" b
ORDER BY b."workspace_id", b."profile_id", b."created_at", b."policy_id", b."policy_version"
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "tokenless_agent_human_review_bindings" (
  "binding_id", "version", "workspace_id", "agent_id", "agent_version_id",
  "selection_policy_id", "selection_policy_version", "request_profile_id", "request_profile_version",
  "request_profile_hash", "publishing_policy_id", "publishing_policy_version", "authority", "enabled",
  "canonical_hash", "created_by", "created_at", "approved_by", "approved_at", "superseded_at"
)
SELECT
  'hrb_' || substr(encode(digest(convert_to(
    b."workspace_id" || '|' || b."policy_id" || '|' || b."policy_version"::text,
    'UTF8'), 'sha256'), 'hex'), 1, 40),
  1, b."workspace_id", b."agent_id", b."agent_version_id", b."policy_id", b."policy_version",
  b."profile_id", 1, b."profile_hash", NULL, NULL, 'check_only',
  b."enabled" = true AND b."superseded_at" IS NULL,
  'sha256:' || encode(digest(convert_to(
    '{"agent":{"agentId":' || to_jsonb(b."agent_id")::text ||
      ',"agentVersionId":' || to_jsonb(b."agent_version_id")::text || '},' ||
    '"authority":"check_only","publishingPolicy":null,' ||
    '"requestProfile":{"hash":' || to_jsonb(b."profile_hash")::text ||
      ',"id":' || to_jsonb(b."profile_id")::text || ',"version":1},' ||
    '"schemaVersion":"rateloop.human-review-configuration.v1",' ||
    '"selectionPolicy":{"id":' || to_jsonb(b."policy_id")::text ||
      ',"version":' || b."policy_version"::text || '},' ||
    '"workspaceId":' || to_jsonb(b."workspace_id")::text || '}',
    'UTF8'), 'sha256'), 'hex'),
  b."created_by", b."created_at", b."approved_by", b."created_at",
  CASE WHEN b."enabled" = true AND b."superseded_at" IS NULL THEN NULL ELSE COALESCE(b."superseded_at", b."created_at") END
FROM "_tokenless_review_policy_backfill" b
WHERE NOT EXISTS (
  SELECT 1
  FROM "tokenless_agent_human_review_bindings" existing
  WHERE existing."workspace_id" = b."workspace_id"
    AND existing."selection_policy_id" = b."policy_id"
    AND existing."selection_policy_version" = b."policy_version"
)
ON CONFLICT DO NOTHING;--> statement-breakpoint

CREATE TEMPORARY TABLE "_tokenless_review_policy_binding_map" AS
SELECT DISTINCT ON (b."workspace_id", b."selection_policy_id", b."selection_policy_version")
  b."workspace_id", b."selection_policy_id", b."selection_policy_version",
  b."binding_id", b."version" AS "binding_version",
  b."request_profile_id", b."request_profile_version", b."request_profile_hash"
FROM "tokenless_agent_human_review_bindings" b
ORDER BY b."workspace_id", b."selection_policy_id", b."selection_policy_version",
  b."enabled" DESC, b."version" DESC, b."binding_id";--> statement-breakpoint

INSERT INTO "tokenless_agent_human_review_binding_events" (
  "event_id", "workspace_id", "binding_id", "binding_version", "event_type", "actor_type",
  "actor_reference", "details_json", "event_hash", "created_at"
)
SELECT
  'hrbe_' || substr(encode(digest(convert_to(m."workspace_id" || '|' || m."binding_id" ||
    '|' || m."binding_version"::text || '|backfill', 'UTF8'), 'sha256'), 'hex'), 1, 40),
  m."workspace_id", m."binding_id", m."binding_version", 'created', 'service',
  'human-review-binding-backfill-v1',
  '{"source":"0058_human_review_binding_backfill"}',
  'sha256:' || encode(digest(convert_to(
    m."workspace_id" || '|' || m."binding_id" || '|' || m."binding_version"::text ||
      '|0058_human_review_binding_backfill', 'UTF8'), 'sha256'), 'hex'),
  p."created_at"
FROM "_tokenless_review_policy_binding_map" m
JOIN "tokenless_agent_review_policies" p
  ON p."workspace_id" = m."workspace_id"
 AND p."policy_id" = m."selection_policy_id"
 AND p."version" = m."selection_policy_version"
ON CONFLICT ("event_id") DO NOTHING;--> statement-breakpoint

UPDATE "tokenless_agent_integrations" i
SET "human_review_binding_id" = m."binding_id",
    "human_review_binding_version" = m."binding_version"
FROM "_tokenless_review_policy_binding_map" m
WHERE m."workspace_id" = i."workspace_id"
  AND m."selection_policy_id" = i."review_policy_id"
  AND m."selection_policy_version" = i."review_policy_version";--> statement-breakpoint

UPDATE "tokenless_workspace_agent_setups" s
SET "human_review_binding_id" = m."binding_id",
    "human_review_binding_version" = m."binding_version"
FROM "_tokenless_review_policy_binding_map" m
WHERE m."workspace_id" = s."workspace_id"
  AND m."selection_policy_id" = s."review_policy_id"
  AND m."selection_policy_version" = s."review_policy_version";--> statement-breakpoint

UPDATE "tokenless_workspace_agent_setups" s
SET "human_review_binding_id" = i."human_review_binding_id",
    "human_review_binding_version" = i."human_review_binding_version"
FROM "tokenless_agent_integrations" i
WHERE s."human_review_binding_id" IS NULL
  AND i."integration_id" = s."primary_integration_id"
  AND i."workspace_id" = s."workspace_id";--> statement-breakpoint

WITH ranked_integrations AS (
  SELECT DISTINCT ON (i."workspace_id")
    i."workspace_id", i."human_review_binding_id", i."human_review_binding_version"
  FROM "tokenless_agent_integrations" i
  WHERE i."status" = 'active' AND i."human_review_binding_id" IS NOT NULL
  ORDER BY i."workspace_id", i."updated_at" DESC, i."integration_id"
)
UPDATE "tokenless_workspace_agent_setups" s
SET "human_review_binding_id" = candidate."human_review_binding_id",
    "human_review_binding_version" = candidate."human_review_binding_version"
FROM ranked_integrations candidate
WHERE s."human_review_binding_id" IS NULL
  AND candidate."workspace_id" = s."workspace_id";--> statement-breakpoint

UPDATE "tokenless_agent_evaluation_scopes" s
SET "human_review_binding_id" = m."binding_id",
    "human_review_binding_version" = m."binding_version",
    "request_profile_id" = m."request_profile_id",
    "request_profile_version" = m."request_profile_version",
    "request_profile_hash" = m."request_profile_hash"
FROM "_tokenless_review_policy_binding_map" m
WHERE m."workspace_id" = s."workspace_id"
  AND m."selection_policy_id" = s."policy_id"
  AND m."selection_policy_version" = s."policy_version";--> statement-breakpoint

UPDATE "tokenless_agent_review_opportunities" o
SET "human_review_binding_id" = m."binding_id",
    "human_review_binding_version" = m."binding_version",
    "request_profile_id" = m."request_profile_id",
    "request_profile_version" = m."request_profile_version",
    "request_profile_hash" = m."request_profile_hash"
FROM "_tokenless_review_policy_binding_map" m
WHERE m."workspace_id" = o."workspace_id"
  AND m."selection_policy_id" = o."policy_id"
  AND m."selection_policy_version" = o."policy_version";--> statement-breakpoint

CREATE TEMPORARY TABLE "_tokenless_review_provenance_guard" (
  "violation" boolean NOT NULL CHECK ("violation" = false)
);--> statement-breakpoint
INSERT INTO "_tokenless_review_provenance_guard" ("violation")
SELECT true
WHERE EXISTS (
    SELECT 1 FROM "tokenless_agent_integrations"
    WHERE "human_review_binding_id" IS NULL OR "human_review_binding_version" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_agent_evaluation_scopes"
    WHERE "human_review_binding_id" IS NULL OR "human_review_binding_version" IS NULL
      OR "request_profile_id" IS NULL OR "request_profile_version" IS NULL OR "request_profile_hash" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_agent_review_opportunities"
    WHERE "human_review_binding_id" IS NULL OR "human_review_binding_version" IS NULL
      OR "request_profile_id" IS NULL OR "request_profile_version" IS NULL OR "request_profile_hash" IS NULL
  );--> statement-breakpoint
DROP TABLE "_tokenless_review_provenance_guard";--> statement-breakpoint

ALTER TABLE "tokenless_agent_evaluation_scopes"
  ALTER COLUMN "human_review_binding_id" SET NOT NULL,
  ALTER COLUMN "human_review_binding_version" SET NOT NULL,
  ALTER COLUMN "request_profile_id" SET NOT NULL,
  ALTER COLUMN "request_profile_version" SET NOT NULL,
  ALTER COLUMN "request_profile_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_opportunities"
  ALTER COLUMN "human_review_binding_id" SET NOT NULL,
  ALTER COLUMN "human_review_binding_version" SET NOT NULL,
  ALTER COLUMN "request_profile_id" SET NOT NULL,
  ALTER COLUMN "request_profile_version" SET NOT NULL,
  ALTER COLUMN "request_profile_hash" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "tokenless_agent_evaluation_scopes"
  DROP CONSTRAINT "tokenless_agent_evaluation_scopes_partition_unique";--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_scopes"
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_partition_unique" UNIQUE (
    "agent_version_id", "policy_id", "policy_version", "human_review_binding_id", "human_review_binding_version",
    "request_profile_id", "request_profile_version", "request_profile_hash", "workflow_key", "risk_tier",
    "audience_policy_hash", "execution_profile_hash"
  );--> statement-breakpoint

DROP TABLE "_tokenless_review_policy_binding_map";--> statement-breakpoint
DROP TABLE "_tokenless_review_policy_backfill";
