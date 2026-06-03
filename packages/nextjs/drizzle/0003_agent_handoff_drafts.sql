ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "original_request_body" text;
--> statement-breakpoint
UPDATE "agent_ask_handoff_intents"
SET "original_request_body" = "request_body"
WHERE "original_request_body" IS NULL;
--> statement-breakpoint
ALTER TABLE "agent_ask_handoff_intents" ALTER COLUMN "original_request_body" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "draft_revision" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "prepared_draft_revision" integer;
--> statement-breakpoint
ALTER TABLE "agent_ask_handoff_intents" ADD COLUMN "edited_by_user" boolean NOT NULL DEFAULT false;
