DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tokenless_network_benchmark_activation_evidence")
     OR EXISTS (SELECT 1 FROM "tokenless_network_benchmark_activations")
     OR EXISTS (SELECT 1 FROM "tokenless_network_benchmark_activation_deactivations") THEN
    RAISE EXCEPTION 'network benchmark activation v2 requires the documented empty activation baseline';
  END IF;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_is_permitted_network_worker_jurisdiction_set(p_json text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  ordered_codes text[];
  sorted_codes text[];
  distinct_code_count integer;
BEGIN
  IF NOT (p_json IS JSON ARRAY) THEN RETURN false; END IF;
  IF jsonb_array_length(p_json::jsonb) < 1 THEN RETURN false; END IF;

  SELECT array_agg(code ORDER BY ordinal_position),
         array_agg(code ORDER BY code COLLATE "C"),
         COUNT(DISTINCT code)::integer
  INTO ordered_codes,sorted_codes,distinct_code_count
  FROM jsonb_array_elements_text(p_json::jsonb) WITH ORDINALITY AS entry(code,ordinal_position);

  RETURN ordered_codes=sorted_codes
    AND distinct_code_count=cardinality(ordered_codes)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ordered_codes) AS permitted(code)
      WHERE permitted.code !~ '^[A-Z]{2}$'
         OR NOT (permitted.code = ANY (ARRAY[
           'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE',
           'IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE'
         ]::text[]))
    );
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activation_evidence"
  ADD COLUMN "compliance_operator_key_version" text NOT NULL,
  ADD COLUMN "activation_scope" text NOT NULL,
  ADD COLUMN "permitted_worker_jurisdictions_json" text NOT NULL,
  ADD COLUMN "permitted_worker_jurisdictions_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_evidence"
  RENAME COLUMN "recorded_by" TO "workspace_manager_reference_principal_id";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_evidence"
  RENAME CONSTRAINT "tokenless_network_benchmark_activation_evidence_actor_fk"
  TO "tokenless_network_benchmark_activation_evidence_manager_reference_fk";--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activations"
  ADD COLUMN "compliance_operator_key_version" text NOT NULL,
  ADD COLUMN "permitted_worker_jurisdictions_json" text NOT NULL,
  ADD COLUMN "permitted_worker_jurisdictions_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activations"
  RENAME COLUMN "activated_by" TO "workspace_manager_reference_principal_id";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activations"
  RENAME CONSTRAINT "tokenless_network_benchmark_activations_actor_fk"
  TO "tokenless_network_benchmark_activations_manager_reference_fk";--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_opportunity_authorizations"
  ADD COLUMN "compliance_operator_key_version" text NOT NULL,
  ADD COLUMN "workspace_manager_reference_principal_id" text NOT NULL,
  ADD COLUMN "activation_scope" text NOT NULL,
  ADD COLUMN "permitted_worker_jurisdictions_json" text NOT NULL,
  ADD COLUMN "permitted_worker_jurisdictions_hash" text NOT NULL,
  ADD CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_manager_reference_fk"
    FOREIGN KEY ("workspace_manager_reference_principal_id")
    REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
  ADD COLUMN "compliance_operator_key_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
  RENAME COLUMN "deactivated_by" TO "workspace_manager_reference_principal_id";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
  RENAME CONSTRAINT "tokenless_network_benchmark_activation_deactivations_actor_fk"
  TO "tokenless_network_benchmark_deactivations_manager_reference_fk";--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activation_evidence"
  DROP CONSTRAINT "tokenless_network_benchmark_activation_evidence_contract_check",
  ADD CONSTRAINT "tokenless_network_benchmark_activation_evidence_contract_check" CHECK (
    "benchmark_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "activation_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "method_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "deployment_key" ~ '^tokenless-v4:84532:[A-Za-z0-9:._-]{1,233}$'
    AND "activation_scope" = 'testnet_network_benchmark_exercise'
    AND "evidence_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "evidence_window_end" > "evidence_window_start"
    AND "completed_at" BETWEEN "evidence_window_start" AND "evidence_window_end"
    AND "evidence_window_end" <= "recorded_at"
    AND "evidence_type" IN (
      'audit_partner_method_acceptance',
      'provider_pilot_acceptance',
      'network_supply_demand_confirmation',
      'hosted_paid_core_testnet_exercise',
      'keeper_recovery_exercise',
      'indexer_recovery_exercise',
      'paid_eligibility_payout_tax_dac7_readiness',
      'sanctions_screening_readiness',
      'reviewer_contract_worker_information_appeal_readiness',
      'algorithmic_management_human_review_readiness',
      'private_worker_communication_readiness',
      'worker_data_privacy_governance_readiness'
    )
    AND (
      ("evidence_type" IN (
         'audit_partner_method_acceptance','provider_pilot_acceptance','network_supply_demand_confirmation'
       ) AND "evidence_outcome" = 'accepted')
      OR
      ("evidence_type" IN ('hosted_paid_core_testnet_exercise','keeper_recovery_exercise','indexer_recovery_exercise')
       AND "evidence_outcome" = 'passed')
      OR
      ("evidence_type" IN (
         'paid_eligibility_payout_tax_dac7_readiness','sanctions_screening_readiness',
         'reviewer_contract_worker_information_appeal_readiness',
         'algorithmic_management_human_review_readiness','private_worker_communication_readiness',
         'worker_data_privacy_governance_readiness'
       ) AND "evidence_outcome" = 'documented_ready')
    )
    AND "counterparty_reference_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "artifact_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_hash" = 'sha256:' || encode(digest(convert_to("evidence_json", 'UTF8'), 'sha256'), 'hex')
    AND tokenless_is_permitted_network_worker_jurisdiction_set("permitted_worker_jurisdictions_json")
    AND "permitted_worker_jurisdictions_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "permitted_worker_jurisdictions_hash" =
      'sha256:' || encode(digest(convert_to("permitted_worker_jurisdictions_json", 'UTF8'), 'sha256'), 'hex')
    AND "compliance_operator_key_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    AND "evidence_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "evidence_json"::jsonb ->> 'schemaVersion' = 'rateloop.network-benchmark-activation-evidence.v2'
    AND "evidence_json"::jsonb ->> 'attestedBy' =
      'tokenless_compliance_operator:' || "compliance_operator_key_version"
    AND "evidence_json"::jsonb ->> 'complianceOperatorKeyVersion' = "compliance_operator_key_version"
    AND "evidence_json"::jsonb ->> 'workspaceManagerReferencePrincipalId' =
      "workspace_manager_reference_principal_id"
    AND "evidence_json"::jsonb = jsonb_build_object(
      'schemaVersion','rateloop.network-benchmark-activation-evidence.v2',
      'workspaceId',"workspace_id",
      'projectId',"project_id",
      'benchmarkId',"benchmark_id",
      'activationReference',"activation_reference",
      'evidenceWindowStart',to_char("evidence_window_start" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'evidenceWindowEnd',to_char("evidence_window_end" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'methodVersion',"method_version",
      'deploymentKey',"deployment_key",
      'activationScope',"activation_scope",
      'permittedWorkerJurisdictions',"permitted_worker_jurisdictions_json"::jsonb,
      'permittedWorkerJurisdictionsHash',"permitted_worker_jurisdictions_hash",
      'evidenceId',"evidence_id",
      'evidenceType',"evidence_type",
      'evidenceOutcome',"evidence_outcome",
      'counterpartyReferenceHash',"counterparty_reference_hash",
      'artifactDigest',"artifact_digest",
      'completedAt',to_char("completed_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attestedBy','tokenless_compliance_operator:' || "compliance_operator_key_version",
      'complianceOperatorKeyVersion',"compliance_operator_key_version",
      'workspaceManagerReferencePrincipalId',"workspace_manager_reference_principal_id",
      'recordedAt',to_char("recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_opportunity_authorizations"
  ADD CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_v2_contract_check" CHECK (
    "compliance_operator_key_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    AND "deployment_key" ~ '^tokenless-v4:84532:[A-Za-z0-9:._-]{1,233}$'
    AND "activation_scope" = 'testnet_network_benchmark_exercise'
    AND tokenless_is_permitted_network_worker_jurisdiction_set("permitted_worker_jurisdictions_json")
    AND "permitted_worker_jurisdictions_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "permitted_worker_jurisdictions_hash" =
      'sha256:' || encode(digest(convert_to("permitted_worker_jurisdictions_json", 'UTF8'), 'sha256'), 'hex')
    AND "authorization_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "authorization_json"::jsonb ->> 'schemaVersion' =
      'rateloop.network-benchmark-opportunity-authorization.v2'
    AND "authorization_json"::jsonb ->> 'attestedBy' =
      'tokenless_compliance_operator:' || "compliance_operator_key_version"
    AND "authorization_json"::jsonb ->> 'complianceOperatorKeyVersion' = "compliance_operator_key_version"
    AND "authorization_json"::jsonb ->> 'workspaceManagerReferencePrincipalId' =
      "workspace_manager_reference_principal_id"
    AND "authorization_json"::jsonb = jsonb_build_object(
      'schemaVersion','rateloop.network-benchmark-opportunity-authorization.v2',
      'workspaceId',"workspace_id",
      'projectId',"project_id",
      'benchmarkId',"benchmark_id",
      'activationReference',"activation_reference",
      'evidenceWindowStart',to_char("evidence_window_start" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'evidenceWindowEnd',to_char("evidence_window_end" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'methodVersion',"method_version",
      'deploymentKey',"deployment_key",
      'activationScope',"activation_scope",
      'permittedWorkerJurisdictions',"permitted_worker_jurisdictions_json"::jsonb,
      'permittedWorkerJurisdictionsHash',"permitted_worker_jurisdictions_hash",
      'opportunityId',"opportunity_id",
      'requestProfileId',"request_profile_id",
      'requestProfileVersion',"request_profile_version",
      'requestProfileHash',"request_profile_hash",
      'sourceEvidenceHash',"source_evidence_hash",
      'suggestionCommitment',"suggestion_commitment",
      'attestedBy','tokenless_compliance_operator:' || "compliance_operator_key_version",
      'complianceOperatorKeyVersion',"compliance_operator_key_version",
      'workspaceManagerReferencePrincipalId',"workspace_manager_reference_principal_id"
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activations"
  DROP CONSTRAINT "tokenless_network_benchmark_activations_contract_check",
  ADD CONSTRAINT "tokenless_network_benchmark_activations_v2_contract_check" CHECK (
    "benchmark_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "activation_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "method_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "evidence_window_end" > "evidence_window_start"
    AND "status" = 'active'
    AND "public_safe_only" = true
    AND "unrelated_opportunity_authority" = 'none'
    AND "expected_evidence_count" >= 14
    AND "expected_opportunity_count" >= 1
    AND "evidence_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "opportunity_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_duration_seconds" BETWEEN 1 AND 2592000
    AND "authorization_not_before" = "activated_at"
    AND "authorization_expires_at" =
      "activated_at" + make_interval(secs => "authorization_duration_seconds")
    AND "activation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "activation_hash" =
      'sha256:' || encode(digest(convert_to("activation_json", 'UTF8'), 'sha256'), 'hex')
    AND "evidence_window_end" <= "activated_at"
    AND "deployment_key" ~ '^tokenless-v4:84532:[A-Za-z0-9:._-]{1,233}$'
    AND "activation_scope" = 'testnet_network_benchmark_exercise'
    AND tokenless_is_permitted_network_worker_jurisdiction_set("permitted_worker_jurisdictions_json")
    AND "permitted_worker_jurisdictions_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "permitted_worker_jurisdictions_hash" =
      'sha256:' || encode(digest(convert_to("permitted_worker_jurisdictions_json", 'UTF8'), 'sha256'), 'hex')
    AND "compliance_operator_key_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    AND "activation_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "activation_json"::jsonb ->> 'schemaVersion' = 'rateloop.network-benchmark-activation.v2'
    AND "activation_json"::jsonb ->> 'attestedBy' =
      'tokenless_compliance_operator:' || "compliance_operator_key_version"
    AND "activation_json"::jsonb ->> 'complianceOperatorKeyVersion' = "compliance_operator_key_version"
    AND "activation_json"::jsonb ->> 'workspaceManagerReferencePrincipalId' =
      "workspace_manager_reference_principal_id"
    AND "activation_json"::jsonb = jsonb_build_object(
      'schemaVersion','rateloop.network-benchmark-activation.v2',
      'workspaceId',"workspace_id",
      'projectId',"project_id",
      'benchmarkId',"benchmark_id",
      'activationReference',"activation_reference",
      'evidenceWindowStart',to_char("evidence_window_start" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'evidenceWindowEnd',to_char("evidence_window_end" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'methodVersion',"method_version",
      'deploymentKey',"deployment_key",
      'permittedWorkerJurisdictions',"permitted_worker_jurisdictions_json"::jsonb,
      'permittedWorkerJurisdictionsHash',"permitted_worker_jurisdictions_hash",
      'status',"status",
      'activationScope',"activation_scope",
      'publicSafeOnly',"public_safe_only",
      'unrelatedOpportunityAuthority',"unrelated_opportunity_authority",
      'expectedEvidenceCount',"expected_evidence_count",
      'evidenceManifestRoot',"evidence_manifest_root",
      'expectedOpportunityCount',"expected_opportunity_count",
      'opportunityManifestRoot',"opportunity_manifest_root",
      'authorizationDurationSeconds',"authorization_duration_seconds",
      'authorizationNotBefore',to_char("authorization_not_before" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'authorizationExpiresAt',to_char("authorization_expires_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attestedBy','tokenless_compliance_operator:' || "compliance_operator_key_version",
      'complianceOperatorKeyVersion',"compliance_operator_key_version",
      'workspaceManagerReferencePrincipalId',"workspace_manager_reference_principal_id",
      'activatedAt',to_char("activated_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
  ADD CONSTRAINT "tokenless_network_benchmark_deactivations_v2_contract_check" CHECK (
    "compliance_operator_key_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    AND "deactivation_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "deactivation_json"::jsonb ->> 'schemaVersion' =
      'rateloop.network-benchmark-activation-deactivation.v2'
    AND "deactivation_json"::jsonb ->> 'attestedBy' =
      'tokenless_compliance_operator:' || "compliance_operator_key_version"
    AND "deactivation_json"::jsonb ->> 'complianceOperatorKeyVersion' = "compliance_operator_key_version"
    AND "deactivation_json"::jsonb ->> 'workspaceManagerReferencePrincipalId' =
      "workspace_manager_reference_principal_id"
    AND "deactivation_json"::jsonb = jsonb_build_object(
      'schemaVersion','rateloop.network-benchmark-activation-deactivation.v2',
      'workspaceId',"workspace_id",
      'projectId',"project_id",
      'benchmarkId',"benchmark_id",
      'activationReference',"activation_reference",
      'activationHash',"activation_hash",
      'attestedBy','tokenless_compliance_operator:' || "compliance_operator_key_version",
      'complianceOperatorKeyVersion',"compliance_operator_key_version",
      'workspaceManagerReferencePrincipalId',"workspace_manager_reference_principal_id",
      'reason',"reason",
      'supersededByActivationReference',"superseded_by_activation_reference",
      'deactivatedAt',to_char("deactivated_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_validate_network_benchmark_activation(
  p_workspace_id text, p_activation_reference text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  activation_record "tokenless_network_benchmark_activations"%ROWTYPE;
  actual_evidence_count integer;
  actual_evidence_root text;
  actual_opportunity_count integer;
  actual_opportunity_root text;
  audit_count integer;
  provider_count integer;
  demand_count integer;
  hosted_count integer;
  keeper_count integer;
  indexer_count integer;
  paid_readiness_count integer;
  sanctions_readiness_count integer;
  worker_contract_readiness_count integer;
  algorithmic_human_review_readiness_count integer;
  private_worker_communication_readiness_count integer;
  worker_privacy_readiness_count integer;
BEGIN
  SELECT * INTO activation_record
  FROM "tokenless_network_benchmark_activations"
  WHERE "workspace_id"=p_workspace_id AND "activation_reference"=p_activation_reference;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*)::integer,
         'sha256:' || encode(digest(convert_to(COALESCE(string_agg(
           b."manifest_position"::text || '|' || b."evidence_type" || '|' || b."evidence_id" || '|' || b."evidence_hash",
           E'\n' ORDER BY b."manifest_position"), ''), 'UTF8'), 'sha256'), 'hex'),
         COUNT(DISTINCT e."counterparty_reference_hash")
           FILTER (WHERE b."evidence_type"='audit_partner_method_acceptance')::integer,
         COUNT(DISTINCT e."counterparty_reference_hash")
           FILTER (WHERE b."evidence_type"='provider_pilot_acceptance')::integer,
         COUNT(DISTINCT e."counterparty_reference_hash")
           FILTER (WHERE b."evidence_type"='network_supply_demand_confirmation')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='hosted_paid_core_testnet_exercise')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='keeper_recovery_exercise')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='indexer_recovery_exercise')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='paid_eligibility_payout_tax_dac7_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='sanctions_screening_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='reviewer_contract_worker_information_appeal_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='algorithmic_management_human_review_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='private_worker_communication_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='worker_data_privacy_governance_readiness')::integer
  INTO actual_evidence_count,actual_evidence_root,audit_count,provider_count,demand_count,hosted_count,keeper_count,
       indexer_count,paid_readiness_count,sanctions_readiness_count,worker_contract_readiness_count,
       algorithmic_human_review_readiness_count,private_worker_communication_readiness_count,
       worker_privacy_readiness_count
  FROM "tokenless_network_benchmark_activation_evidence_bindings" b
  JOIN "tokenless_network_benchmark_activation_evidence" e
    ON e."workspace_id"=b."workspace_id" AND e."evidence_id"=b."evidence_id"
  WHERE b."workspace_id"=p_workspace_id AND b."activation_reference"=p_activation_reference;

  SELECT COUNT(*)::integer,
         'sha256:' || encode(digest(convert_to(COALESCE(string_agg(
           "manifest_position"::text || '|' || "opportunity_id" || '|' || "authorization_hash",
           E'\n' ORDER BY "manifest_position"), ''), 'UTF8'), 'sha256'), 'hex')
  INTO actual_opportunity_count,actual_opportunity_root
  FROM "tokenless_network_benchmark_opportunity_authorizations"
  WHERE "workspace_id"=p_workspace_id AND "activation_reference"=p_activation_reference;

  IF actual_evidence_count <> activation_record."expected_evidence_count"
     OR actual_evidence_root <> activation_record."evidence_manifest_root"
     OR audit_count <> 1 OR provider_count < 2 OR demand_count < 2
     OR EXISTS (
       SELECT 1
       FROM "tokenless_network_benchmark_activation_evidence_bindings" audit_binding
       JOIN "tokenless_network_benchmark_activation_evidence" audit_evidence
         ON audit_evidence."workspace_id"=audit_binding."workspace_id"
        AND audit_evidence."evidence_id"=audit_binding."evidence_id"
       WHERE audit_binding."workspace_id"=p_workspace_id
         AND audit_binding."activation_reference"=p_activation_reference
         AND audit_binding."evidence_type"='audit_partner_method_acceptance'
         AND EXISTS (
           SELECT 1
           FROM "tokenless_network_benchmark_activation_evidence_bindings" commercial_binding
           JOIN "tokenless_network_benchmark_activation_evidence" commercial_evidence
             ON commercial_evidence."workspace_id"=commercial_binding."workspace_id"
            AND commercial_evidence."evidence_id"=commercial_binding."evidence_id"
           WHERE commercial_binding."workspace_id"=audit_binding."workspace_id"
             AND commercial_binding."activation_reference"=audit_binding."activation_reference"
             AND commercial_binding."evidence_type" IN (
               'provider_pilot_acceptance','network_supply_demand_confirmation'
             )
             AND commercial_evidence."counterparty_reference_hash"=audit_evidence."counterparty_reference_hash"
         )
     )
     OR EXISTS (
       SELECT 1
       FROM "tokenless_network_benchmark_activation_evidence_bindings" provenance_binding
       JOIN "tokenless_network_benchmark_activation_evidence" provenance_evidence
         ON provenance_evidence."workspace_id"=provenance_binding."workspace_id"
        AND provenance_evidence."evidence_id"=provenance_binding."evidence_id"
       WHERE provenance_binding."workspace_id"=p_workspace_id
         AND provenance_binding."activation_reference"=p_activation_reference
         AND (
           provenance_evidence."compliance_operator_key_version"
             IS DISTINCT FROM activation_record."compliance_operator_key_version"
           OR provenance_evidence."workspace_manager_reference_principal_id"
             IS DISTINCT FROM activation_record."workspace_manager_reference_principal_id"
           OR provenance_evidence."activation_scope" IS DISTINCT FROM activation_record."activation_scope"
           OR provenance_evidence."permitted_worker_jurisdictions_json"
             IS DISTINCT FROM activation_record."permitted_worker_jurisdictions_json"
           OR provenance_evidence."permitted_worker_jurisdictions_hash"
             IS DISTINCT FROM activation_record."permitted_worker_jurisdictions_hash"
         )
     )
     OR EXISTS (
       SELECT 1
       FROM "tokenless_network_benchmark_activation_evidence_bindings" demand_binding
       JOIN "tokenless_network_benchmark_activation_evidence" demand_evidence
         ON demand_evidence."workspace_id"=demand_binding."workspace_id"
        AND demand_evidence."evidence_id"=demand_binding."evidence_id"
       WHERE demand_binding."workspace_id"=p_workspace_id
         AND demand_binding."activation_reference"=p_activation_reference
         AND demand_binding."evidence_type"='network_supply_demand_confirmation'
         AND NOT EXISTS (
           SELECT 1
           FROM "tokenless_network_benchmark_activation_evidence_bindings" provider_binding
           JOIN "tokenless_network_benchmark_activation_evidence" provider_evidence
             ON provider_evidence."workspace_id"=provider_binding."workspace_id"
            AND provider_evidence."evidence_id"=provider_binding."evidence_id"
           WHERE provider_binding."workspace_id"=demand_binding."workspace_id"
             AND provider_binding."activation_reference"=demand_binding."activation_reference"
             AND provider_binding."evidence_type"='provider_pilot_acceptance'
             AND provider_evidence."counterparty_reference_hash"=demand_evidence."counterparty_reference_hash"
         )
     )
     OR hosted_count < 1 OR keeper_count < 1 OR indexer_count < 1
     OR paid_readiness_count < 1 OR sanctions_readiness_count < 1
     OR worker_contract_readiness_count < 1 OR algorithmic_human_review_readiness_count < 1
     OR private_worker_communication_readiness_count < 1 OR worker_privacy_readiness_count < 1 THEN
    RAISE EXCEPTION 'network benchmark activation evidence is incomplete or unrelated';
  END IF;
  IF actual_opportunity_count <> activation_record."expected_opportunity_count"
     OR actual_opportunity_root <> activation_record."opportunity_manifest_root"
     OR EXISTS (
       SELECT 1
       FROM "tokenless_network_benchmark_opportunity_authorizations" provenance_authorization
       WHERE provenance_authorization."workspace_id"=p_workspace_id
         AND provenance_authorization."activation_reference"=p_activation_reference
         AND (
           provenance_authorization."compliance_operator_key_version"
             IS DISTINCT FROM activation_record."compliance_operator_key_version"
           OR provenance_authorization."workspace_manager_reference_principal_id"
             IS DISTINCT FROM activation_record."workspace_manager_reference_principal_id"
           OR provenance_authorization."activation_scope" IS DISTINCT FROM activation_record."activation_scope"
           OR provenance_authorization."permitted_worker_jurisdictions_json"
             IS DISTINCT FROM activation_record."permitted_worker_jurisdictions_json"
           OR provenance_authorization."permitted_worker_jurisdictions_hash"
             IS DISTINCT FROM activation_record."permitted_worker_jurisdictions_hash"
         )
     )
     OR EXISTS (
       SELECT 1
       FROM "tokenless_network_benchmark_opportunity_authorizations" profile_authorization
       WHERE profile_authorization."workspace_id"=p_workspace_id
         AND profile_authorization."activation_reference"=p_activation_reference
         AND NOT EXISTS (
           SELECT 1
           FROM "tokenless_agent_review_request_profiles" profile
           WHERE profile."workspace_id"=profile_authorization."workspace_id"
             AND profile."profile_id"=profile_authorization."request_profile_id"
             AND profile."version"=profile_authorization."request_profile_version"
             AND profile."profile_hash"=profile_authorization."request_profile_hash"
             AND profile."audience"='public_network'
             AND profile."content_boundary"='public_or_test'
             AND profile."compensation_mode"='usdc'
             AND profile."configuration_status"='ready'
             AND profile."superseded_at" IS NULL
         )
     ) THEN
    RAISE EXCEPTION 'network benchmark opportunity authorization is incomplete';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_network_benchmark_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  replacement_project text;
  replacement_benchmark text;
BEGIN
  PERFORM 1 FROM "tokenless_network_benchmark_activations"
  WHERE "workspace_id"=NEW."workspace_id"
    AND "activation_reference"=NEW."activation_reference"
    AND "workspace_manager_reference_principal_id"=NEW."workspace_manager_reference_principal_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network benchmark activation does not exist or manager provenance differs';
  END IF;
  IF NEW."reason"='superseded' THEN
    SELECT "project_id","benchmark_id" INTO replacement_project,replacement_benchmark
    FROM "tokenless_network_benchmark_activations"
    WHERE "workspace_id"=NEW."workspace_id"
      AND "activation_reference"=NEW."superseded_by_activation_reference"
    FOR SHARE;
    IF replacement_project IS DISTINCT FROM NEW."project_id"
       OR replacement_benchmark IS DISTINCT FROM NEW."benchmark_id" THEN
      RAISE EXCEPTION 'network benchmark supersession must preserve the exact project and benchmark';
    END IF;
  END IF;
  NEW."deactivated_at" := date_trunc('milliseconds', transaction_timestamp());
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_bind_network_benchmark_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authorization_record record;
BEGIN
  SELECT a."benchmark_id",a."activation_reference",a."method_version",a."deployment_key",
         o."authorization_hash"
  INTO authorization_record
  FROM "tokenless_network_benchmark_opportunity_authorizations" o
  JOIN "tokenless_network_benchmark_activations" a
    ON a."workspace_id"=o."workspace_id" AND a."activation_reference"=o."activation_reference"
  JOIN "tokenless_workspaces" w
    ON w."workspace_id"=a."workspace_id" AND w."status"='active'
  JOIN "tokenless_assurance_projects" p
    ON p."workspace_id"=a."workspace_id"
   AND p."project_id"=a."project_id"
   AND p."status"='active'
   AND p."visibility"='public'
   AND p."data_classification"='public'
   AND p."material_kind" IN ('public','synthetic','redacted')
  JOIN "tokenless_agent_review_request_profiles" profile
    ON profile."workspace_id"=o."workspace_id"
   AND profile."profile_id"=o."request_profile_id"
   AND profile."version"=o."request_profile_version"
   AND profile."profile_hash"=o."request_profile_hash"
   AND profile."audience"='public_network'
   AND profile."content_boundary"='public_or_test'
   AND profile."compensation_mode"='usdc'
   AND profile."configuration_status"='ready'
   AND profile."superseded_at" IS NULL
  WHERE o."workspace_id"=NEW."workspace_id"
    AND o."project_id"=NEW."project_id"
    AND o."opportunity_id"=NEW."opportunity_id"
    AND o."request_profile_id"=NEW."request_profile_id"
    AND o."request_profile_version"=NEW."request_profile_version"
    AND o."request_profile_hash"=NEW."request_profile_hash"
    AND o."source_evidence_hash"=NEW."source_evidence_hash"
    AND o."suggestion_commitment"=NEW."suggestion_commitment"
    AND a."status"='active'
    AND a."activation_scope"='testnet_network_benchmark_exercise'
    AND a."deployment_key" ~ '^tokenless-v4:84532:'
    AND a."activation_json"::jsonb ->> 'schemaVersion' = 'rateloop.network-benchmark-activation.v2'
    AND transaction_timestamp() >= a."authorization_not_before"
    AND transaction_timestamp() < a."authorization_expires_at"
    AND NOT EXISTS (
      SELECT 1 FROM "tokenless_network_benchmark_activation_deactivations" d
      WHERE d."workspace_id"=a."workspace_id" AND d."activation_reference"=a."activation_reference"
    )
  FOR SHARE OF a,w,p,profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public network work requires one exact active benchmark activation';
  END IF;
  INSERT INTO "tokenless_network_benchmark_execution_bindings"
    ("workspace_id","binding_id","project_id","benchmark_id","activation_reference",
     "opportunity_id","run_id","request_profile_id","request_profile_version","request_profile_hash",
     "source_evidence_hash","suggestion_commitment","authorization_hash","method_version","deployment_key")
  VALUES
    (NEW."workspace_id",NEW."binding_id",NEW."project_id",authorization_record."benchmark_id",
     authorization_record."activation_reference",NEW."opportunity_id",NEW."run_id",NEW."request_profile_id",
     NEW."request_profile_version",NEW."request_profile_hash",NEW."source_evidence_hash",
     NEW."suggestion_commitment",authorization_record."authorization_hash",authorization_record."method_version",
     authorization_record."deployment_key");
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_require_active_network_benchmark_for_run(
  p_workspace_id text, p_project_id text, p_run_id text, p_deployment_key text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  active_reference text;
BEGIN
  SELECT a."activation_reference" INTO active_reference
  FROM "tokenless_network_benchmark_execution_bindings" x
  JOIN "tokenless_network_benchmark_activations" a
    ON a."workspace_id"=x."workspace_id" AND a."activation_reference"=x."activation_reference"
  JOIN "tokenless_workspaces" w
    ON w."workspace_id"=a."workspace_id" AND w."status"='active'
  JOIN "tokenless_assurance_projects" p
    ON p."workspace_id"=a."workspace_id"
   AND p."project_id"=a."project_id"
   AND p."status"='active'
   AND p."visibility"='public'
   AND p."data_classification"='public'
   AND p."material_kind" IN ('public','synthetic','redacted')
  JOIN "tokenless_agent_review_request_profiles" profile
    ON profile."workspace_id"=x."workspace_id"
   AND profile."profile_id"=x."request_profile_id"
   AND profile."version"=x."request_profile_version"
   AND profile."profile_hash"=x."request_profile_hash"
   AND profile."audience"='public_network'
   AND profile."content_boundary"='public_or_test'
   AND profile."compensation_mode"='usdc'
   AND profile."configuration_status"='ready'
   AND profile."superseded_at" IS NULL
  WHERE x."workspace_id"=p_workspace_id AND x."project_id"=p_project_id AND x."run_id"=p_run_id
    AND x."deployment_key"=p_deployment_key AND a."deployment_key"=p_deployment_key
    AND a."status"='active'
    AND a."activation_scope"='testnet_network_benchmark_exercise'
    AND a."deployment_key" ~ '^tokenless-v4:84532:'
    AND a."activation_json"::jsonb ->> 'schemaVersion' = 'rateloop.network-benchmark-activation.v2'
    AND transaction_timestamp() >= a."authorization_not_before"
    AND transaction_timestamp() < a."authorization_expires_at"
    AND NOT EXISTS (
      SELECT 1 FROM "tokenless_network_benchmark_activation_deactivations" d
      WHERE d."workspace_id"=a."workspace_id" AND d."activation_reference"=a."activation_reference"
    )
  FOR SHARE OF a,w,p,profile;
  IF active_reference IS NULL THEN
    RAISE EXCEPTION 'network assignment requires its exact active benchmark activation';
  END IF;
  RETURN active_reference;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_require_network_benchmark_assignment_acceptance(
  p_workspace_id text, p_project_id text, p_run_id text, p_residence_country text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  active_reference text;
BEGIN
  SELECT a."activation_reference" INTO active_reference
  FROM "tokenless_network_benchmark_execution_bindings" x
  JOIN "tokenless_network_benchmark_activations" a
    ON a."workspace_id"=x."workspace_id"
   AND a."activation_reference"=x."activation_reference"
   AND a."deployment_key"=x."deployment_key"
  JOIN "tokenless_network_benchmark_opportunity_authorizations" opportunity_authorization
    ON opportunity_authorization."workspace_id"=x."workspace_id"
   AND opportunity_authorization."activation_reference"=x."activation_reference"
   AND opportunity_authorization."project_id"=x."project_id"
   AND opportunity_authorization."opportunity_id"=x."opportunity_id"
   AND opportunity_authorization."authorization_hash"=x."authorization_hash"
   AND opportunity_authorization."activation_scope"=a."activation_scope"
   AND opportunity_authorization."permitted_worker_jurisdictions_hash"=
       a."permitted_worker_jurisdictions_hash"
   AND opportunity_authorization."permitted_worker_jurisdictions_json"=
       a."permitted_worker_jurisdictions_json"
  JOIN "tokenless_public_network_review_bindings" public_binding
    ON public_binding."workspace_id"=x."workspace_id"
   AND public_binding."binding_id"=x."binding_id"
   AND public_binding."project_id"=x."project_id"
   AND public_binding."run_id"=x."run_id"
   AND public_binding."opportunity_id"=x."opportunity_id"
   AND public_binding."deployment_key"=x."deployment_key"
  WHERE x."workspace_id"=p_workspace_id
    AND x."project_id"=p_project_id
    AND x."run_id"=p_run_id
    AND a."status"='active'
    AND a."activation_scope"='testnet_network_benchmark_exercise'
    AND a."deployment_key" ~ '^tokenless-v4:84532:'
    AND a."activation_json"::jsonb ->> 'schemaVersion'='rateloop.network-benchmark-activation.v2'
    AND transaction_timestamp() >= a."authorization_not_before"
    AND transaction_timestamp() < a."authorization_expires_at"
    AND p_residence_country ~ '^[A-Z]{2}$'
    AND a."permitted_worker_jurisdictions_json"::jsonb ? p_residence_country
    AND NOT EXISTS (
      SELECT 1 FROM "tokenless_network_benchmark_activation_deactivations" d
      WHERE d."workspace_id"=a."workspace_id" AND d."activation_reference"=a."activation_reference"
    )
  FOR SHARE OF x,a,opportunity_authorization,public_binding;
  IF active_reference IS NULL THEN
    RAISE EXCEPTION 'network assignment acceptance requires its exact active testnet benchmark activation and permitted residence';
  END IF;
  RETURN active_reference;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_network_benchmark_assignment_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  frozen_residence_country text;
BEGIN
  IF NEW."source" <> 'rateloop_network' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NOT (OLD."status"='reserved' AND NEW."status"='accepted') THEN RETURN NEW; END IF;

  frozen_residence_country := NEW."assurance_snapshot_json"::jsonb
    #>> '{publicNetworkLegalResidence,countryCode}';
  PERFORM tokenless_require_network_benchmark_assignment_acceptance(
    NEW."workspace_id",NEW."project_id",NEW."run_id",frozen_residence_country
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS tokenless_assurance_assignments_network_benchmark_guard
  ON "tokenless_assurance_assignments";--> statement-breakpoint
CREATE TRIGGER tokenless_assurance_assignments_network_benchmark_guard
BEFORE INSERT OR UPDATE ON "tokenless_assurance_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_network_benchmark_assignment_reservation();
