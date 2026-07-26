# Paid eligibility adapter

Paid eligibility is completed before the API can issue a paid-task voucher. The application never accepts a browser-asserted identity or sanctions result in production.

## Provider handoff

1. An authenticated RateLoop browser session calls `POST /api/rater/eligibility/provider/start` from the application origin.
2. RateLoop creates a 15-minute, HMAC-authenticated state and returns the configured provider URL. The URL includes `state`, `callback_url`, and `return_url` query parameters.
3. The provider posts `{ state, provider, payload, signature }` to the callback. RateLoop verifies the provider's Ed25519 signature, account binding, evidence lifetime, provider-neutral capabilities, and sanctions result. The verified result is encrypted in the provider-evidence key domain.
4. The browser answers residence first. Only EU residents receive and submit the full tax/DAC7 dataset; a user may
   instead record a versioned advisory-only election. The final unlock request carries `providerState`.
5. Before any identity or tax row is written, RateLoop applies the server-derived country/region geoblock. It then
   compares declared residence with the Vercel edge country and held locale, and screens the active payout destination
   through the configured server-only wallet provider. Mismatches and provider review results remain in manual review;
   a location block or wallet match cannot authorize a voucher.
6. `POST /api/rater/vouchers` fails closed unless every stored legal gate and risk check is current and the rater
   satisfies the round's exact frozen admission policy.

`payload` is base64url JSON with version `2`, `provider`, unique `assertionId`, stable provider `subjectId`, bound `accountAddress`, `capabilities`, evidence timestamps, and a `sanctions` object containing `status`, `reference`, and screening timestamps. It may separately attest `minimumAgeVerified`, `documentIssuingCountry`, `nationalityCountry`, and `verifiedResidenceCountry`. Document issuer and nationality are never inferred to be residence. The browser separately supplies declared residence and tax residence; mismatches remain distinct and require review. The Ed25519 signature covers the decoded JSON bytes. Provider subject and screening references are stored only as hashes. Public responses collapse screening failures into the neutral `legal_eligibility_review` reason class.

Voucher rounds persist canonical admission-policy JSON and its SHA-256 digest. The contract receives the same digest as `bytes32` (`sha256:<hex>` becomes `0x<hex>` without rehashing). Historical numeric identity tiers are not converted and cannot authorize a v2 voucher.

Required server-only configuration:

- `TOKENLESS_ELIGIBILITY_PROVIDER_ID`
- `TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY`
- `TOKENLESS_ELIGIBILITY_PROVIDER_START_URL`
- `TOKENLESS_ELIGIBILITY_HANDOFF_SECRET`
- `TOKENLESS_PROVIDER_EVIDENCE_VAULT_KEY_VERSION`
- `TOKENLESS_PROVIDER_EVIDENCE_VAULT_KEYS` (JSON key-version to base64 32-byte AES key)
- `TOKENLESS_TAX_VAULT_KEY_VERSION`
- `TOKENLESS_TAX_VAULT_KEYS`
- `TOKENLESS_VOTE_MAPPING_VAULT_KEY_VERSION`
- `TOKENLESS_VOTE_MAPPING_VAULT_KEYS`
- `TOKENLESS_DAC7_POLICY` (`all`, `eu`, or `configured`)
- `TOKENLESS_DAC7_REQUIRED_COUNTRIES` when policy is `configured`
- `TOKENLESS_WALLET_SCREENING_PROVIDER_ID`
- `TOKENLESS_WALLET_SCREENING_PROVIDER_URL` (HTTPS)
- `TOKENLESS_WALLET_SCREENING_PROVIDER_SECRET` (at least 32 characters)
- optional `TOKENLESS_PAID_BLOCKED_COUNTRIES` and `TOKENLESS_PAID_BLOCKED_REGIONS` overrides, after compliance approval
- `TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY`
- `TOKENLESS_VOUCHER_ISSUER_EPOCH`
- `TOKENLESS_PANEL_ADDRESS`
- `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`
- `BASE_SEPOLIA_RPC_URL`

None of the secrets may have a `NEXT_PUBLIC_` variant. The explicitly enabled `rateloop-development` provider is available only outside production with `TOKENLESS_ELIGIBILITY_TEST_PROVIDER_ENABLED=true`; production always requires a signed provider result.

The provider registry reports the configured signed identity adapter, the imported `self:document` predicate adapter,
the sanctions source, and the wallet-screening adapter. Self remains unavailable unless every existing release gate
plus `TOKENLESS_SELF_VERIFIER_URL` and `TOKENLESS_SELF_VERIFIER_SECRET` is satisfied. Its adapter requests only the
minimum-age predicate by default and never upgrades document possession into unique-human assurance. Sanctions
screening uses `TOKENLESS_SANCTIONS_SCREENING_SOURCE` (default `manual:v1`) and persists the selected source with each
screening instead of embedding a provider literal in the eligibility flow.

Voucher signing rechecks that the configured panel references the configured issuer, the epoch is accepted on-chain, and the configured signer is the epoch signer. The EIP-712 domain and voucher fields exactly match `TokenlessPanel`.
