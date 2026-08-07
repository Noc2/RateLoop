ALTER TABLE "tokenless_assurance_event_outbox"
  DROP CONSTRAINT "tokenless_assurance_event_outbox_type_check";--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ADD CONSTRAINT "tokenless_assurance_event_outbox_type_check"
    CHECK ("event_type" IN (
      'ai.rateloop.review.completed',
      'ai.rateloop.review.failed',
      'ai.rateloop.review.expired',
      'ai.rateloop.review.inconclusive',
      'ai.rateloop.review.cancelled',
      'ai.rateloop.packet.anchored',
      'ai.rateloop.gate.blocked'
    ));
