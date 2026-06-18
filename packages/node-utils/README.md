# RateLoop Node Utils

Shared Node.js helpers used by RateLoop services, scripts, and public packages.

## Exports

- `@rateloop/node-utils/keystore` for encrypted local signer keystore helpers.
- `@rateloop/node-utils/json` for JSON parsing and validation utilities.
- `@rateloop/node-utils/submissionValidation` for shared submission guardrails.
- `@rateloop/node-utils/contentModeration` for moderation helpers.
- `@rateloop/node-utils/correlationScoring` for payout-root scoring utilities.
- `@rateloop/node-utils/identityKeys` for identity-key derivation helpers.
- `@rateloop/node-utils/x402QuestionFields` for x402 question payload helpers.

Build with `yarn workspace @rateloop/node-utils build`. Run tests with
`yarn workspace @rateloop/node-utils test`.
