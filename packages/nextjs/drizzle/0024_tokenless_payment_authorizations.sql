ALTER TABLE "tokenless_chain_executions" ADD COLUMN "authorization_valid_after" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions" ADD COLUMN "authorization_valid_before" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions" ADD COLUMN "authorization_nonce" text;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions" ADD COLUMN "authorization_eip712_name" text;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions" ADD COLUMN "authorization_eip712_version" text;
