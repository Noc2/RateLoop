ALTER TABLE "tokenless_assurance_run_cases" DROP CONSTRAINT "tokenless_assurance_run_cases_round_status_check";--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases" ADD CONSTRAINT "tokenless_assurance_run_cases_round_status_check" CHECK ("round_status" IN ('planned', 'submitted', 'open', 'revealable', 'settling', 'finalized', 'terminal', 'failed', 'offchain_complete'));
