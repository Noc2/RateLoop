ALTER TABLE "tokenless_assurance_event_outbox"
  ADD COLUMN "evidence_reference_kind" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ADD COLUMN "evidence_reference_digest" text;--> statement-breakpoint
UPDATE "tokenless_assurance_event_outbox"
  SET "evidence_reference_kind" = 'decision_packet',
      "evidence_reference_digest" = "packet_hash";--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ALTER COLUMN "evidence_reference_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ALTER COLUMN "evidence_reference_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ALTER COLUMN "packet_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ADD CONSTRAINT "tokenless_assurance_event_outbox_evidence_reference_kind_check"
    CHECK ("evidence_reference_kind" IN ('decision_packet', 'gate_transition'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ADD CONSTRAINT "tokenless_assurance_event_outbox_evidence_reference_digest_check"
    CHECK ("evidence_reference_digest" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ADD CONSTRAINT "tokenless_assurance_event_outbox_evidence_reference_consistency_check"
    CHECK (
      ("evidence_reference_kind" = 'decision_packet' AND "packet_hash" = "evidence_reference_digest")
      OR ("evidence_reference_kind" = 'gate_transition' AND "packet_hash" IS NULL)
    );
