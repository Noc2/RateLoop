CREATE OR REPLACE FUNCTION tokenless_is_complete_v4_base_sepolia_deployment_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT p_key ~ '^tokenless-v4:84532:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}$'
    AND p_key NOT LIKE '%:0x0000000000000000000000000000000000000000%';
$$;--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activation_evidence"
  ADD CONSTRAINT "network_activation_evidence_complete_deployment_key"
  CHECK (tokenless_is_complete_v4_base_sepolia_deployment_key("deployment_key")) NOT VALID;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activations"
  ADD CONSTRAINT "network_activation_complete_deployment_key"
  CHECK (tokenless_is_complete_v4_base_sepolia_deployment_key("deployment_key")) NOT VALID;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_evidence_bindings"
  ADD CONSTRAINT "network_evidence_binding_complete_deployment_key"
  CHECK (tokenless_is_complete_v4_base_sepolia_deployment_key("deployment_key")) NOT VALID;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_opportunity_authorizations"
  ADD CONSTRAINT "network_opportunity_auth_complete_deployment_key"
  CHECK (tokenless_is_complete_v4_base_sepolia_deployment_key("deployment_key")) NOT VALID;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
  ADD CONSTRAINT "network_deactivation_complete_deployment_key"
  CHECK (tokenless_is_complete_v4_base_sepolia_deployment_key("deployment_key")) NOT VALID;--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_execution_bindings"
  ADD CONSTRAINT "network_execution_binding_complete_deployment_key"
  CHECK (tokenless_is_complete_v4_base_sepolia_deployment_key("deployment_key")) NOT VALID;--> statement-breakpoint

ALTER TABLE "tokenless_network_benchmark_activation_evidence"
  VALIDATE CONSTRAINT "network_activation_evidence_complete_deployment_key";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activations"
  VALIDATE CONSTRAINT "network_activation_complete_deployment_key";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_evidence_bindings"
  VALIDATE CONSTRAINT "network_evidence_binding_complete_deployment_key";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_opportunity_authorizations"
  VALIDATE CONSTRAINT "network_opportunity_auth_complete_deployment_key";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
  VALIDATE CONSTRAINT "network_deactivation_complete_deployment_key";--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_execution_bindings"
  VALIDATE CONSTRAINT "network_execution_binding_complete_deployment_key";
