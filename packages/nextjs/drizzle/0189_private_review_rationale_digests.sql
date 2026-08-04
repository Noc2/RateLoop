UPDATE "tokenless_assurance_responses" AS projected
SET "rationale_digest" = source."rationale_digest"
FROM "tokenless_private_review_responses" AS source
JOIN "tokenless_private_unpaid_review_deliveries" AS delivery
  ON delivery."delivery_id" = source."delivery_id"
JOIN "tokenless_agent_review_opportunities" AS opportunity
  ON opportunity."workspace_id" = delivery."workspace_id"
 AND opportunity."opportunity_id" = delivery."opportunity_id"
WHERE projected."run_id" = opportunity."run_id"
  AND projected."reviewer_key" = source."reviewer_key"
  AND projected."response_digest" = source."response_commitment"
  AND projected."rationale_ciphertext" = source."rationale_ciphertext"
  AND projected."rationale_key_ref" = source."rationale_key_ref"
  AND projected."rationale_digest" IS NULL
  AND source."rationale_digest" IS NOT NULL;
