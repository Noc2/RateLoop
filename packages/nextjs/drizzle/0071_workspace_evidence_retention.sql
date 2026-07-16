CREATE TABLE "tokenless_workspace_evidence_retention_policies" (
  "workspace_id" text NOT NULL,
  "version" integer NOT NULL,
  "evidence_retention_months" integer NOT NULL DEFAULT 12,
  "audit_retention_months" integer NOT NULL DEFAULT 12,
  "basis_json" text NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "superseded_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_evidence_retention_policies_pk" PRIMARY KEY("workspace_id", "version"),
  CONSTRAINT "tokenless_workspace_evidence_retention_policies_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_workspace_evidence_retention_months_check"
    CHECK ("evidence_retention_months" BETWEEN 6 AND 120),
  CONSTRAINT "tokenless_workspace_audit_retention_months_check"
    CHECK ("audit_retention_months" BETWEEN 6 AND 120),
  CONSTRAINT "tokenless_workspace_evidence_retention_superseded_check"
    CHECK ("superseded_at" IS NULL OR "superseded_at" >= "effective_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_workspace_evidence_retention_policies_active_idx"
  ON "tokenless_workspace_evidence_retention_policies" ("workspace_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint
INSERT INTO "tokenless_workspace_evidence_retention_policies"
  ("workspace_id", "version", "evidence_retention_months", "audit_retention_months", "basis_json",
   "effective_at", "created_by", "created_at")
SELECT w."workspace_id", 1, 12, 12,
       '{"floor":"six_calendar_months","reasons":["eu_ai_act_article_26_6_deployer_log_minimum","workspace_assurance_evidence_policy"]}',
       w."created_at", 'system:migration:0071', w."created_at"
FROM "tokenless_workspaces" w
WHERE w."status" = 'active';
