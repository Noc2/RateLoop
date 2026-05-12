CREATE UNIQUE INDEX "content_feedback_active_author_round_unique"
ON "content_feedback" USING btree ("content_id","round_id","author_address")
WHERE "deleted_at" IS NULL;
