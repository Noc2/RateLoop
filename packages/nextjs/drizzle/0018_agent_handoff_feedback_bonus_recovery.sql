ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "feedback_bonus_transaction_hashes" text;
--> statement-breakpoint
ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "feedback_bonus_status" text;
--> statement-breakpoint
ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "feedback_bonus_error" text;
