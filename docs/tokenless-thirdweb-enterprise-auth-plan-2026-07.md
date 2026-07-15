# Tokenless thirdweb and enterprise authentication plan (July 2026)

**Status:** Historical implementation reference. The [EU trust and identity implementation plan](tokenless-eu-trust-and-identity-implementation-plan-2026-07-15.md) supersedes this document's thirdweb-primary browser identity decision. thirdweb remains an optional, explicit funding/payout wallet adapter after Better Auth login. This document does not change the immutable fund-core, deployment key, settlement rules, or the isolation boundary from `main` and `rateloop.ai`.

## Outcome

The original proposal let RateLoop buyers, consultants, client stakeholders, and invited reviewers enter through a thirdweb in-app wallet. That browser-principal model is superseded: users now authenticate with Better Auth into a RateLoop-owned opaque principal, and no wallet is created during ordinary account or workspace use. A user may later create a thirdweb in-app wallet or connect Base Account or another self-custodial wallet when a funding or payout flow requires one.

Direct integrations continue to use hash-only workspace API keys. The browser login change must not give thirdweb, a social provider, or the RateLoop operator custody of panel funds, the ability to redirect claims, or authority over accepted commits.

## Identity and authority boundaries

1. **Browser principal:** self-hosted Better Auth verifies email OTP, passkey, or an explicitly configured social provider. RateLoop maps the provider subject to an opaque `rlp_*` principal and exchanges the short Better Auth session for its own hash-only, HttpOnly session cookie.
2. **Enterprise profile:** provider subjects and account email data remain inside the identity boundary. They are not transformed into wallet addresses, and client-reported profile fields never authorize access.
3. **Workspace authorization:** RateLoop workspace membership and principal-scoped project assignments remain the authorization source. A verified email does not implicitly join a workspace.
4. **Wallet authorization:** funding, payout, and recovery require a separate one-time proof bound to the domain, opaque principal, purpose, wallet, chain, nonce, and expiry. thirdweb receives a short, audience-bound JWT only after an explicit wallet-creation choice. A wallet signature never grants general account access.
5. **Machine access:** agents and enterprise backends use scoped, hash-only workspace API keys. Autonomous publishing
   requires a separately issued, versioned policy-bound key with explicit budgets, payment modes, wallet binding,
   audience/project/data limits, expiry, and revocation. x402 is the self-funded delegated lane first; accountless x402
   remains deferred until the B2B and abuse controls can be enforced without a workspace principal.

## Implementation slices and commits

### 1. Reopen the design decision

- Amend the tokenless design of record and agent instructions.
- Record the identity/authority split, rollout order, data minimization, rollback, and deployment guardrails in this document.
- Commit independently from application code.

### 2. Historical: thirdweb-primary browser authentication (superseded)

- Add `thirdweb@5.120.1` and a lazily initialized public/server client split.
- Add `ThirdwebProvider` without removing the Wagmi/Base Account provider needed by wallet-specific flows.
- Configure the compact RateLoop sign-in modal with email, Google, Apple, and passkey first; offer Base Account as an external wallet option.
- Use thirdweb Auth to generate and verify domain-bound, short-lived SIWE payloads. Consume the existing database-backed one-time nonce and create the existing RateLoop-owned session cookie.
- Keep the app build-safe when thirdweb variables are absent; sign-in must fail closed with an operator-readable configuration message.

### 3. Replacement: provider-neutral principal and optional wallet binding

- Add a forward-only migration for opaque principals, Better Auth provider bindings, hash-only application sessions,
  single-use wallet JWT records, purpose-bound challenges, and revocable wallet bindings.
- Keep ordinary workspace and invited unpaid-review authorization on the opaque principal; require a real bound wallet
  only in funding, payout, recovery, or other onchain paths.
- Return only the principal, authentication method, application-session expiry, and active purpose bindings to the
  account UI. Never expose provider tokens, thirdweb JWT signing keys, or raw application-session tokens.
- Keep Base Account, thirdweb, and other wallet brands inside explicit wallet-specific payment and payout controls.

### 4. Tokenless deployment readiness for the replacement

- Add the Better Auth, email, passkey, optional social-provider, and optional thirdweb wallet-JWT variables from
  `packages/nextjs/.env.example` to the isolated environment contract.
- Require every callback, WebAuthn RP/origin, thirdweb browser origin, JWT issuer, audience, and JWKS URL to use only
  localhost or the isolated tokenless Vercel domain. Do not authorize `rateloop.ai`.
- Fail closed when primary authentication is incomplete. Keep optional wallet creation disabled unless its complete
  audience/JWKS/key configuration is present; never expose the Ed25519 private JWK publicly.
- Apply migration `0044_provider_neutral_identity` to the dedicated tokenless Postgres database before enabling sign-in.

### 5. Verification and rollout

- Unit-test nonce replay rejection, wrong-domain payloads, invalid signatures, external-wallet fallback, verified-profile normalization, session creation/revocation, and missing configuration.
- Component-test the signed-out, pending, authenticated, and failed states and the enterprise-oriented button copy.
- Run Next.js typecheck, tests, lint, and production build.
- Before push, require branch `tokenless`, upstream `origin/tokenless`, record remote `main` and `tokenless` SHAs, and push only `HEAD:tokenless`; verify `main` is unchanged afterward.
- Before any Vercel mutation, require project `rateloop-tokenless` and ID `prj_H6C2pfWKEAupFroHbLfzhquaNCLm`. Verify both the tokenless review URL and `rateloop.ai` deployment identity before and after deployment.

## Rollback

The database migration is additive. Rollback switches the header back to the existing Base Account SIWE entry point and stops creating thirdweb-authenticated sessions; existing opaque sessions may expire naturally or be revoked. No contract redeployment, address-bundle change, Ponder reset, keeper change, or fund migration is required because browser authentication has no fund-core authority.

## Deferred enterprise capabilities

SAML/OIDC through a customer identity provider, SCIM, organization-domain claims, domain-bound workspace invitations, enforced MFA, and customer-managed data planes remain separate enterprise milestones. thirdweb supports custom OIDC/JWT authentication, but those capabilities must be added behind explicit workspace policy and tested tenant-isolation rules rather than being inferred from an email domain.
