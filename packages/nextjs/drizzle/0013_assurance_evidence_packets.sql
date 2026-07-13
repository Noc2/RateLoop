ALTER TABLE "tokenless_assurance_evidence_packets" ADD COLUMN "packet_digest" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_evidence_packets" ADD COLUMN "packet_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_evidence_packets" ADD COLUMN "signature_algorithm" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_evidence_packets" ADD COLUMN "signing_key_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_evidence_packets" ADD COLUMN "signing_public_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_assurance_evidence_packets_digest_unique" ON "tokenless_assurance_evidence_packets" USING btree ("packet_digest");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_client_decisions" ADD COLUMN "evidence_packet_digest" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_client_decisions" ADD COLUMN "decision_digest" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_client_decisions" ADD COLUMN "decision_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_client_decisions" ADD CONSTRAINT "tokenless_assurance_client_decisions_value_check" CHECK ("decision" IN ('go', 'revise', 'stop'));--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_assurance_client_decisions_digest_unique" ON "tokenless_assurance_client_decisions" USING btree ("decision_digest");
