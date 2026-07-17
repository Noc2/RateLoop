CREATE TABLE "tokenless_workspace_stop_states" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "engaged_by" text NOT NULL,
  "engaged_at" timestamp with time zone NOT NULL,
  "released_by" text,
  "released_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_stop_states_status_check"
    CHECK ("status" IN ('engaged', 'released')),
  CONSTRAINT "tokenless_workspace_stop_states_reason_check"
    CHECK (char_length("reason") BETWEEN 1 AND 2000),
  CONSTRAINT "tokenless_workspace_stop_states_release_check" CHECK (
    ("status" = 'engaged' AND "released_at" IS NULL AND "released_by" IS NULL)
    OR ("status" = 'released' AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL)
  )
);
