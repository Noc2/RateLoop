ALTER TABLE "tokenless_agent_integrations"
  ADD CONSTRAINT "tokenless_agent_integrations_mcp_session_binding_unique"
  UNIQUE ("integration_id","workspace_id","token_family_id","oauth_subject_principal_id");--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_approval_requests"
  ADD CONSTRAINT "tokenless_agent_review_approval_requests_elicitation_binding_unique"
  UNIQUE ("approval_id","workspace_id","opportunity_id","revision","prepared_request_hash","derived_economics_hash");--> statement-breakpoint
CREATE TABLE "tokenless_mcp_sessions" (
  "session_hash" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "integration_id" text NOT NULL,
  "subject_principal_id" text NOT NULL,
  "token_family_id" text NOT NULL,
  "client_name" text NOT NULL,
  "client_version" text NOT NULL,
  "protocol_version" text NOT NULL,
  "elicitation_mode" text DEFAULT 'none' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_mcp_sessions_status_check"
    CHECK ("status" IN ('active','revoked','expired')),
  CONSTRAINT "tokenless_mcp_sessions_protocol_check"
    CHECK ("protocol_version" IN ('2025-03-26','2025-06-18','2025-11-25')),
  CONSTRAINT "tokenless_mcp_sessions_elicitation_mode_check"
    CHECK (
      "elicitation_mode" IN ('none','form') AND
      ("elicitation_mode" = 'none' OR "protocol_version" = '2025-06-18')
    ),
  CONSTRAINT "tokenless_mcp_sessions_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "tokenless_mcp_sessions_hash_check"
    CHECK ("session_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_mcp_sessions_principal_fk"
    FOREIGN KEY ("subject_principal_id") REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_mcp_sessions_family_fk"
    FOREIGN KEY ("token_family_id")
    REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_mcp_sessions_integration_binding_fk"
    FOREIGN KEY ("integration_id","workspace_id","token_family_id","subject_principal_id")
    REFERENCES "tokenless_agent_integrations"
      ("integration_id","workspace_id","token_family_id","oauth_subject_principal_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_mcp_sessions_workspace_binding_unique"
    UNIQUE ("session_hash","workspace_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_mcp_sessions_active_idx"
  ON "tokenless_mcp_sessions" ("workspace_id","integration_id","expires_at")
  WHERE "status" = 'active';--> statement-breakpoint
CREATE TABLE "tokenless_mcp_elicitation_requests" (
  "request_id" text PRIMARY KEY NOT NULL,
  "session_hash" text NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "approval_id" text NOT NULL,
  "approval_revision" integer NOT NULL,
  "prepared_request_hash" text NOT NULL,
  "derived_economics_hash" text NOT NULL,
  "request_json" text NOT NULL,
  "state" text DEFAULT 'queued' NOT NULL,
  "delivery_count" integer DEFAULT 0 NOT NULL,
  "last_delivered_at" timestamp with time zone,
  "last_event_id" text,
  "delivery_lease_expires_at" timestamp with time zone,
  "processing_started_at" timestamp with time zone,
  "processing_lease_id" text,
  "processing_response_json" text,
  "response_json" text,
  "responded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_mcp_elicitation_requests_session_binding_fk"
    FOREIGN KEY ("session_hash","workspace_id")
    REFERENCES "tokenless_mcp_sessions"("session_hash","workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_mcp_elicitation_requests_approval_binding_fk"
    FOREIGN KEY ("approval_id","workspace_id","opportunity_id","approval_revision",
                 "prepared_request_hash","derived_economics_hash")
    REFERENCES "tokenless_agent_review_approval_requests"
      ("approval_id","workspace_id","opportunity_id","revision",
       "prepared_request_hash","derived_economics_hash") ON DELETE CASCADE,
  CONSTRAINT "tokenless_mcp_elicitation_requests_state_check"
    CHECK ("state" IN ('queued','delivered','processing','responded','expired')),
  CONSTRAINT "tokenless_mcp_elicitation_requests_revision_check"
    CHECK ("approval_revision" > 0),
  CONSTRAINT "tokenless_mcp_elicitation_requests_delivery_check"
    CHECK ("delivery_count" BETWEEN 0 AND 2147483647),
  CONSTRAINT "tokenless_mcp_elicitation_requests_id_check"
    CHECK ("request_id" ~ '^mcpel_[0-9a-f]{48}$'),
  CONSTRAINT "tokenless_mcp_elicitation_requests_event_id_check"
    CHECK ("last_event_id" IS NULL OR "last_event_id" ~ '^mcpel_[0-9a-f]{48}:[1-9][0-9]*$'),
  CONSTRAINT "tokenless_mcp_elicitation_requests_processing_lease_id_check"
    CHECK ("processing_lease_id" IS NULL OR "processing_lease_id" ~ '^mcpl_[0-9a-f]{48}$'),
  CONSTRAINT "tokenless_mcp_elicitation_requests_hashes_check"
    CHECK (
      "prepared_request_hash" ~ '^sha256:[0-9a-f]{64}$' AND
      "derived_economics_hash" ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT "tokenless_mcp_elicitation_requests_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "tokenless_mcp_elicitation_requests_state_coherence_check"
    CHECK (
      ("state" = 'queued' AND "delivery_count" = 0 AND "last_delivered_at" IS NULL
        AND "last_event_id" IS NULL AND "delivery_lease_expires_at" IS NULL
        AND "processing_started_at" IS NULL AND "processing_lease_id" IS NULL
        AND "processing_response_json" IS NULL AND "response_json" IS NULL AND "responded_at" IS NULL)
      OR ("state" = 'delivered' AND "delivery_count" > 0 AND "last_delivered_at" IS NOT NULL
        AND "last_event_id" IS NOT NULL AND "delivery_lease_expires_at" IS NOT NULL
        AND "processing_started_at" IS NULL AND "processing_lease_id" IS NULL
        AND "processing_response_json" IS NULL AND "response_json" IS NULL AND "responded_at" IS NULL)
      OR ("state" = 'processing' AND "delivery_count" > 0 AND "last_delivered_at" IS NOT NULL
        AND "last_event_id" IS NOT NULL AND "delivery_lease_expires_at" IS NULL
        AND "processing_started_at" IS NOT NULL AND "processing_lease_id" IS NOT NULL
        AND "processing_response_json" IS NOT NULL AND "response_json" IS NULL AND "responded_at" IS NULL)
      OR ("state" = 'responded' AND "delivery_count" > 0 AND "last_delivered_at" IS NOT NULL
        AND "last_event_id" IS NOT NULL AND "delivery_lease_expires_at" IS NULL
        AND "processing_started_at" IS NULL AND "processing_lease_id" IS NULL
        AND "processing_response_json" IS NULL AND "response_json" IS NOT NULL AND "responded_at" IS NOT NULL)
      OR ("state" = 'expired' AND "response_json" IS NULL AND "responded_at" IS NULL)
    ),
  UNIQUE ("session_hash","approval_id","approval_revision"),
  UNIQUE ("session_hash","last_event_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_mcp_elicitation_requests_delivery_idx"
  ON "tokenless_mcp_elicitation_requests" ("session_hash","state","delivery_lease_expires_at","created_at")
  WHERE "state" IN ('queued','delivered');
