CREATE UNIQUE INDEX "tokenless_audit_events_retention_run_unique"
  ON "tokenless_audit_events" ("workspace_id", "target_id")
  WHERE "action" = 'evidence.retention.enforced'
    AND "target_kind" = 'evidence_retention_run';
