# Tokenless identity and optional wallet runbook (July 2026)

**Status:** Current provisioning and verification runbook.

## Boundary

Better Auth is the primary browser authenticator. RateLoop authorization uses an opaque `rlp_*` principal and its own
hash-only, HttpOnly application session. A wallet address is never created from that principal and never grants
workspace access. thirdweb is an optional wallet processor used only after an authenticated user chooses a funding,
payout, or recovery action; an existing self-custodial wallet remains supported.

## Provision Better Auth

1. Apply migration `0044_provider_neutral_identity` to the isolated tokenless Postgres database.
2. Set a unique, server-only `BETTER_AUTH_SECRET` of at least 32 random characters.
3. Configure an approved Resend account and a verified domain dispatched from `eu-west-1` for email OTP. Resend account
   data, email metadata, logs, and API records remain in the US, so attach the DPA/transfer assessment and do not count
   this processor as EU-resident. RateLoop stores OTP values hashed and limits them to three attempts and five minutes.
4. Set `BETTER_AUTH_PASSKEY_RP_ID=rateloop-tokenless.vercel.app` for the isolated hosted application. Register only the exact
   `https://rateloop-tokenless.vercel.app` WebAuthn origin.
5. Add Google or Apple credentials only as complete server-only pairs. Their callback must use the isolated tokenless
   origin; never authorize `rateloop.ai`.
6. Verify `/api/auth/config`, email OTP, passkey registration, passkey sign-in, social callbacks if enabled, the
   Better-Auth-to-RateLoop session exchange, logout, expiry, and revocation.

The Better Auth session is deliberately short. After authentication, `/api/auth/exchange` resolves or creates the
opaque principal and issues the RateLoop-owned application cookie. Protected routes continue to authorize from
workspace membership, explicit project assignments, or scoped API keys rather than from middleware or provider
profile fields.

## Provision optional thirdweb wallet creation

Keep `TOKENLESS_THIRDWEB_WALLET_ENABLED=false` until every step below is complete:

1. Create a distinct thirdweb project for the isolated tokenless deployment and restrict browser origins to local
   development plus `rateloop-tokenless.vercel.app`.
2. Generate an Ed25519 signing key outside the repository. Store the private JWK only in the server secret store and
   assign a versioned key ID.
3. Configure the thirdweb custom-JWT audience exactly as `TOKENLESS_THIRDWEB_WALLET_AUDIENCE` and configure its JWKS
   URL as `https://rateloop-tokenless.vercel.app/.well-known/rateloop-wallet-jwks.json`.
4. Set the public thirdweb client ID and the server-only issuer variables from `.env.example`, then enable the flag.
5. Verify that the JWT contains only `iss`, `aud`, `sub`, `jti`, `iat`, `nbf`, and `exp`; `sub` must be the opaque
   principal and expiry must be five minutes.
6. Test explicit thirdweb creation and existing-wallet connection separately. Both must finish with a signed challenge
   containing domain, URI, principal, purpose, wallet, Base Sepolia chain ID, nonce, and expiry.
7. Verify replay rejection, cross-account binding rejection, purpose replacement, revocation, and the absence of
   wallet-based workspace authorization.

Rotate the issuer by publishing the new public JWK before switching the active key ID. Retain the old public key only
for the maximum five-minute token lifetime, then remove it. A thirdweb outage must disable only new app-scoped wallet
creation; Better Auth account access, enterprise workspaces, API keys, and existing self-custodial wallet connections
remain available.

## External claim gates

Repository completion does not establish EU hosting or compliance. Before production, separately record:

- the live EU Postgres, compute, object-store, KMS, log, backup, email, Better Auth, and support-access resource IDs;
- processor agreements and transfer assessments for Resend, Google, Apple, thirdweb, RPC, billing, and support tools;
- the thirdweb recovery/export behavior shown to users;
- key-generation, recovery, and rotation evidence; and
- legal approval for the identity retention schedule and public-chain exception wording.

Do not market SAML, SCIM, enforced enterprise MFA, strict EU residency, SOC 2, HIPAA, or a thirdweb/Better Auth
certification as implemented by this runbook.
