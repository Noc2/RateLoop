# Paid eligibility adapter

Paid eligibility is completed before the API can issue a paid-task voucher. The application never accepts a browser-asserted identity or sanctions result in production.

## Provider handoff

1. An authenticated Base Account calls `POST /api/rater/eligibility/provider/start` from the application origin.
2. RateLoop creates a 15-minute, HMAC-authenticated state and returns the configured provider URL. The URL includes `state`, `callback_url`, and `return_url` query parameters.
3. The provider posts `{ state, provider, payload, signature }` to the callback. RateLoop verifies the provider's Ed25519 signature, the account binding, assertion lifetime, adult status, residence evidence, identity tier, and sanctions result. The verified result is envelope-encrypted at rest.
4. The browser submits the combined tax/DAC7/payout unlock sheet to `POST /api/rater/eligibility` with `providerState`. The handoff is consumed in the same transaction as the eligibility record.
5. `POST /api/rater/vouchers` fails closed unless every stored gate is current and eligible.

`payload` is base64url JSON with version `1`, `provider`, unique `assertionId`, stable provider `subjectId`, bound `accountAddress`, `identityTierId`, `adultVerified`, `residenceCountry`, identity verification timestamps, and a `sanctions` object containing `status`, `reference`, and screening timestamps. The Ed25519 signature covers the decoded JSON bytes. Provider subject and screening references are stored only as hashes. Public responses collapse screening failures into the neutral `legal_eligibility_review` reason class.

Required server-only configuration:

- `TOKENLESS_ELIGIBILITY_PROVIDER_ID`
- `TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY`
- `TOKENLESS_ELIGIBILITY_PROVIDER_START_URL`
- `TOKENLESS_ELIGIBILITY_HANDOFF_SECRET`
- `TOKENLESS_ELIGIBILITY_VAULT_KEY_VERSION`
- `TOKENLESS_ELIGIBILITY_VAULT_KEYS` (JSON key-version to base64 32-byte AES key)
- `TOKENLESS_DAC7_POLICY` (`all`, `eu`, or `configured`)
- `TOKENLESS_DAC7_REQUIRED_COUNTRIES` when policy is `configured`
- `TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY`
- `TOKENLESS_VOUCHER_ISSUER_EPOCH`
- `TOKENLESS_PANEL_ADDRESS`
- `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`
- `BASE_SEPOLIA_RPC_URL`

None of the secrets may have a `NEXT_PUBLIC_` variant. The explicitly enabled `rateloop-development` provider is available only outside production with `TOKENLESS_ELIGIBILITY_TEST_PROVIDER_ENABLED=true`; production always requires a signed provider result.

Voucher signing rechecks that the configured panel references the configured issuer, the epoch is accepted on-chain, and the configured signer is the epoch signer. The EIP-712 domain and voucher fields exactly match `TokenlessPanel`.
