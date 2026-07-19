ALTER TABLE "tokenless_principals"
  ADD COLUMN "welcome_completed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "tokenless_principals"
SET "welcome_completed_at" = CURRENT_TIMESTAMP
WHERE "welcome_completed_at" IS NULL;
