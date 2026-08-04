UPDATE "tokenless_workspace_api_keys"
SET "scopes_json" = ("scopes_json"::jsonb - 'quote:read')::text
WHERE "scopes_json"::jsonb @> '["quote:read"]'::jsonb;--> statement-breakpoint

UPDATE "tokenless_agent_integrations"
SET "granted_scopes_json" = ("granted_scopes_json"::jsonb - 'quote:read')::text
WHERE "granted_scopes_json"::jsonb @> '["quote:read"]'::jsonb;
