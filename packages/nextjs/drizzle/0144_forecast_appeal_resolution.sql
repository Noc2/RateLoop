CREATE TABLE "tokenless_forecast_integrity_appeal_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "appeal_id" text NOT NULL REFERENCES "tokenless_forecast_integrity_appeals"("appeal_id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "event_reason" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_forecast_appeal_event_type_check"
    CHECK ("event_type" IN ('opened','accepted','rejected','withdrawn')),
  CONSTRAINT "tokenless_forecast_appeal_event_status_check"
    CHECK (
      ("event_type" = 'opened' AND "from_status" IS NULL AND "to_status" = 'open')
      OR
      (
        "event_type" IN ('accepted','rejected','withdrawn')
        AND "from_status" = 'open'
        AND "to_status" = "event_type"
      )
    ),
  CONSTRAINT "tokenless_forecast_appeal_event_actor_check"
    CHECK ("actor_kind" IN ('principal','workspace_manager','compliance_operator','migration')),
  CONSTRAINT "tokenless_forecast_appeal_event_actor_reference_check"
    CHECK (char_length("actor_reference") BETWEEN 1 AND 200),
  CONSTRAINT "tokenless_forecast_appeal_event_reason_check"
    CHECK (char_length("event_reason") BETWEEN 1 AND 1000)
);--> statement-breakpoint
CREATE INDEX "tokenless_forecast_appeal_events_appeal_idx"
  ON "tokenless_forecast_integrity_appeal_events" ("appeal_id","occurred_at","event_id");--> statement-breakpoint

INSERT INTO "tokenless_forecast_integrity_appeal_events"
  ("event_id","appeal_id","event_type","from_status","to_status","actor_kind",
   "actor_reference","event_reason","occurred_at")
SELECT
  'cfae_' || md5("appeal_id" || ':' || "status"),
  "appeal_id",
  CASE WHEN "status" = 'open' THEN 'opened' ELSE "status" END,
  CASE WHEN "status" = 'open' THEN NULL ELSE 'open' END,
  "status",
  'migration',
  COALESCE(NULLIF("resolved_by", ''), 'legacy_forecast_appeal'),
  COALESCE(NULLIF("resolution_reason", ''), 'Migrated existing forecast appeal.'),
  COALESCE("resolved_at", "opened_at")
FROM "tokenless_forecast_integrity_appeals";--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_forecast_appeal_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('rateloop.account_erasure', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'forecast integrity appeals may only be deleted during account erasure';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'resolved forecast integrity appeals are immutable';
  END IF;
  IF NEW.appeal_id IS DISTINCT FROM OLD.appeal_id
     OR NEW.finding_id IS DISTINCT FROM OLD.finding_id
     OR NEW.subject_space IS DISTINCT FROM OLD.subject_space
     OR NEW.subject_key IS DISTINCT FROM OLD.subject_key
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.status NOT IN ('accepted','rejected','withdrawn') THEN
    RAISE EXCEPTION 'forecast integrity appeal identity and transition are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_forecast_appeals_guard_update"
  BEFORE UPDATE ON "tokenless_forecast_integrity_appeals"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_forecast_appeal_mutation"();--> statement-breakpoint
CREATE TRIGGER "tokenless_forecast_appeals_guard_delete"
  BEFORE DELETE ON "tokenless_forecast_integrity_appeals"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_forecast_appeal_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_forecast_appeal_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('rateloop.account_erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'forecast integrity appeal events are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_forecast_appeal_events_no_update"
  BEFORE UPDATE ON "tokenless_forecast_integrity_appeal_events"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_forecast_appeal_event_mutation"();--> statement-breakpoint
CREATE TRIGGER "tokenless_forecast_appeal_events_no_delete"
  BEFORE DELETE ON "tokenless_forecast_integrity_appeal_events"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_forecast_appeal_event_mutation"();
