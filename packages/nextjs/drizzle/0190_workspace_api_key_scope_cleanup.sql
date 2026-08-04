ALTER TABLE "tokenless_workspace_api_keys"
  ALTER COLUMN "scopes_json" SET DEFAULT '[]';--> statement-breakpoint

UPDATE "tokenless_workspace_api_keys"
SET "scopes_json" = '["quote:read","panel:publish","payment:submit","result:read"]'
WHERE "scopes_json" = '["quote:read","panel:publish","payment:submit","result:read","webhook:use"]';
