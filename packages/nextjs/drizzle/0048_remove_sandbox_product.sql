CREATE TABLE "tokenless_removed_sandbox_asks" (
  "operation_key" text PRIMARY KEY NOT NULL,
  "quote_id" text NOT NULL
);--> statement-breakpoint
INSERT INTO "tokenless_removed_sandbox_asks" ("operation_key", "quote_id")
SELECT "operation_key", "quote_id" FROM "tokenless_agent_asks" WHERE "sandbox" = true;--> statement-breakpoint
CREATE TABLE "tokenless_removed_sandbox_quotes" (
  "quote_id" text PRIMARY KEY NOT NULL
);--> statement-breakpoint
INSERT INTO "tokenless_removed_sandbox_quotes" ("quote_id")
SELECT "quote_id" FROM "tokenless_removed_sandbox_asks"
UNION
SELECT "quote_id" FROM "tokenless_agent_quotes"
WHERE "request_json" LIKE '%"source":"sandbox"%'
   OR "response_json" LIKE '%"source":"sandbox"%';--> statement-breakpoint
CREATE TABLE "tokenless_removed_sandbox_questions" (
  "question_id" text PRIMARY KEY NOT NULL,
  "content_id" text NOT NULL
);--> statement-breakpoint
INSERT INTO "tokenless_removed_sandbox_questions" ("question_id", "content_id")
SELECT "question_id", "content_id" FROM "tokenless_question_records"
WHERE "quote_id" IN (SELECT "quote_id" FROM "tokenless_removed_sandbox_quotes");--> statement-breakpoint
CREATE TABLE "tokenless_removed_sandbox_content" (
  "content_id" text PRIMARY KEY NOT NULL
);--> statement-breakpoint
INSERT INTO "tokenless_removed_sandbox_content" ("content_id")
SELECT DISTINCT s."content_id"
FROM "tokenless_removed_sandbox_questions" s
LEFT JOIN "tokenless_question_records" q
  ON q."content_id" = s."content_id"
 AND q."question_id" NOT IN (SELECT "question_id" FROM "tokenless_removed_sandbox_questions")
WHERE q."question_id" IS NULL;--> statement-breakpoint
CREATE TABLE "tokenless_removed_sandbox_runs" (
  "run_id" text PRIMARY KEY NOT NULL
);--> statement-breakpoint
INSERT INTO "tokenless_removed_sandbox_runs" ("run_id")
SELECT DISTINCT r."run_id"
FROM "tokenless_assurance_runs" r
JOIN "tokenless_assurance_audience_policies" p
  ON p."policy_id" = r."audience_policy_id" AND p."version" = r."audience_policy_version"
WHERE p."reviewer_source" = 'sandbox' OR p."policy_json" LIKE '%"sandbox"%'
UNION
SELECT DISTINCT "run_id" FROM "tokenless_assurance_run_subpanels" WHERE "source" = 'sandbox'
UNION
SELECT DISTINCT "run_id" FROM "tokenless_assurance_responses" WHERE "reviewer_source" = 'sandbox';--> statement-breakpoint
CREATE TABLE "tokenless_removed_sandbox_vouchers" (
  "voucher_id" text PRIMARY KEY NOT NULL
);--> statement-breakpoint
INSERT INTO "tokenless_removed_sandbox_vouchers" ("voucher_id")
SELECT "voucher_id" FROM "tokenless_voucher_assurance_snapshots" WHERE "reviewer_source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_webhook_deliveries"
WHERE "publication_id" IN (
  SELECT p."publication_id" FROM "tokenless_result_publications" p
  JOIN "tokenless_removed_sandbox_asks" s ON s."operation_key" = p."operation_key"
);--> statement-breakpoint
DELETE FROM "tokenless_ask_webhook_subscriptions"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_transparency_events"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_analytics_reviews"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_result_publications"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_post_round_integrity_records"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_post_round_integrity_inputs"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_agent_evaluation_observations"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_agent_review_opportunities"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_chain_executions"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_surprise_bounty_rounds"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_agent_policy_audit_events"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_agent_policy_budget_reservations"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_payment_intents"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks") OR "state" = 'simulated';--> statement-breakpoint
DELETE FROM "tokenless_prepaid_reservations"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
DELETE FROM "tokenless_ask_ownership"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks") OR "payment_state" = 'simulated';--> statement-breakpoint
DELETE FROM "tokenless_agent_asks"
WHERE "operation_key" IN (SELECT "operation_key" FROM "tokenless_removed_sandbox_asks");--> statement-breakpoint
UPDATE "tokenless_public_question_media"
SET "question_id" = NULL, "bound_at" = NULL, "updated_at" = NOW()
WHERE "question_id" IN (SELECT "question_id" FROM "tokenless_removed_sandbox_questions");--> statement-breakpoint
DELETE FROM "tokenless_question_records"
WHERE "question_id" IN (SELECT "question_id" FROM "tokenless_removed_sandbox_questions");--> statement-breakpoint
DELETE FROM "tokenless_content_records"
WHERE "content_id" IN (SELECT "content_id" FROM "tokenless_removed_sandbox_content");--> statement-breakpoint
DELETE FROM "tokenless_agent_quotes"
WHERE "quote_id" IN (SELECT "quote_id" FROM "tokenless_removed_sandbox_quotes");--> statement-breakpoint
DELETE FROM "tokenless_agent_evaluation_observations"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_agent_review_opportunities"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_assurance_client_decisions"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_assurance_evidence_packets"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_integrity_assignment_history"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_assurance_assignments"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs") OR "source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_assurance_run_subpanels"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs") OR "source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_assurance_responses"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs") OR "reviewer_source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_assurance_run_cases"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
UPDATE "tokenless_assurance_runs" SET "previous_run_id" = NULL
WHERE "previous_run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_assurance_runs"
WHERE "run_id" IN (SELECT "run_id" FROM "tokenless_removed_sandbox_runs");--> statement-breakpoint
DELETE FROM "tokenless_assurance_audience_policies"
WHERE "reviewer_source" = 'sandbox' OR "policy_json" LIKE '%"sandbox"%';--> statement-breakpoint
DELETE FROM "tokenless_integrity_assignment_history"
WHERE "assignment_id" IN (SELECT "assignment_id" FROM "tokenless_assurance_assignments" WHERE "source" = 'sandbox');--> statement-breakpoint
DELETE FROM "tokenless_assurance_assignments" WHERE "source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_assurance_run_subpanels" WHERE "source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_assurance_reviewer_invitations"
WHERE "cohort_id" IN (SELECT "cohort_id" FROM "tokenless_assurance_cohorts" WHERE "source" = 'sandbox');--> statement-breakpoint
DELETE FROM "tokenless_assurance_cohort_reviewers"
WHERE "cohort_id" IN (SELECT "cohort_id" FROM "tokenless_assurance_cohorts" WHERE "source" = 'sandbox');--> statement-breakpoint
DELETE FROM "tokenless_assurance_cohorts" WHERE "source" = 'sandbox';--> statement-breakpoint
DELETE FROM "tokenless_rater_commits"
WHERE "voucher_id" IN (SELECT "voucher_id" FROM "tokenless_removed_sandbox_vouchers");--> statement-breakpoint
DELETE FROM "tokenless_paid_vouchers"
WHERE "voucher_id" IN (SELECT "voucher_id" FROM "tokenless_removed_sandbox_vouchers");--> statement-breakpoint
DELETE FROM "tokenless_reviewer_qualifications" WHERE "reviewer_source" = 'sandbox';--> statement-breakpoint
UPDATE "tokenless_agent_versions" SET "environment" = 'staging' WHERE "environment" = 'sandbox';--> statement-breakpoint
UPDATE "tokenless_agent_pairing_sessions" SET "environment" = 'staging' WHERE "environment" = 'sandbox';--> statement-breakpoint
ALTER TABLE "tokenless_assurance_cohorts" DROP CONSTRAINT "tokenless_assurance_cohorts_source_check";--> statement-breakpoint
ALTER TABLE "tokenless_assurance_cohorts" ADD CONSTRAINT "tokenless_assurance_cohorts_source_check"
  CHECK ("source" IN ('customer_invited', 'rateloop_network'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" DROP CONSTRAINT "tokenless_assurance_run_subpanels_source_check";--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD CONSTRAINT "tokenless_assurance_run_subpanels_source_check"
  CHECK ("source" IN ('customer_invited', 'rateloop_network'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" DROP CONSTRAINT "tokenless_assurance_assignments_source_check";--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD CONSTRAINT "tokenless_assurance_assignments_source_check"
  CHECK ("source" IN ('customer_invited', 'rateloop_network'));--> statement-breakpoint
ALTER TABLE "tokenless_voucher_assurance_snapshots" DROP CONSTRAINT "tokenless_voucher_assurance_snapshots_source_check";--> statement-breakpoint
ALTER TABLE "tokenless_voucher_assurance_snapshots" ADD CONSTRAINT "tokenless_voucher_assurance_snapshots_source_check"
  CHECK ("reviewer_source" IN ('customer_invited', 'rateloop_network'));--> statement-breakpoint
ALTER TABLE "tokenless_agent_versions" DROP CONSTRAINT "tokenless_agent_versions_environment_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_versions" ADD CONSTRAINT "tokenless_agent_versions_environment_check"
  CHECK ("environment" IN ('staging', 'production'));--> statement-breakpoint
ALTER TABLE "tokenless_agent_pairing_sessions" DROP CONSTRAINT "tokenless_agent_pairing_sessions_environment_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_pairing_sessions" ADD CONSTRAINT "tokenless_agent_pairing_sessions_environment_check"
  CHECK ("environment" IS NULL OR "environment" IN ('staging', 'production'));--> statement-breakpoint
ALTER TABLE "tokenless_agent_asks" DROP COLUMN "sandbox";--> statement-breakpoint
DROP TABLE "tokenless_removed_sandbox_vouchers";--> statement-breakpoint
DROP TABLE "tokenless_removed_sandbox_runs";--> statement-breakpoint
DROP TABLE "tokenless_removed_sandbox_content";--> statement-breakpoint
DROP TABLE "tokenless_removed_sandbox_questions";--> statement-breakpoint
DROP TABLE "tokenless_removed_sandbox_quotes";--> statement-breakpoint
DROP TABLE "tokenless_removed_sandbox_asks";
