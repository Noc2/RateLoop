# Tokenless thirdweb and enterprise authentication plan (July 2026)

**Status:** Approved design amendment for the `tokenless` branch. This document reopens and supersedes the earlier decision that Base Account must be the browser identity for every human user. It does not change the immutable fund-core, deployment key, settlement rules, or the isolation boundary from `main` and `rateloop.ai`.

## Outcome

RateLoop buyers, consultants, client stakeholders, and invited reviewers can enter with email OTP, Google, Apple, or a passkey through a thirdweb in-app wallet. The generated wallet address is a stable pseudonymous browser principal; users are not asked to install the Base app or create a Coinbase account. Base Account remains available as an external-wallet option and as a separately proven funding or payout destination where the relevant flow requires it.

Direct integrations continue to use hash-only workspace API keys. The browser login change must not give thirdweb, a social provider, or the RateLoop operator custody of panel funds, the ability to redirect claims, or authority over accepted commits.

## Identity and authority boundaries

1. **Browser principal:** thirdweb authenticates the user through `email`, `google`, `apple`, or `passkey` and exposes an app-scoped wallet. RateLoop verifies a domain-bound SIWE payload on the server and issues its own opaque, hashed, HttpOnly session cookie.
2. **Enterprise profile:** for an in-app wallet, RateLoop resolves the profile server-side with `THIRDWEB_SECRET_KEY` and stores only the verified provider, thirdweb user ID, normalized email, email domain, and display name needed for access and audit UX. Client-reported profile fields never authorize access.
3. **Workspace authorization:** the existing RateLoop session principal and workspace membership tables remain the authorization source. A verified email improves onboarding and future email/domain-bound invitations; it does not implicitly join a workspace.
4. **Wallet authorization:** browser identity and fund authority are separate. Funding, payout binding, and claim recovery require the exact wallet proof specified by those flows. A social login alone cannot spend, redirect, or claim escrowed funds.
5. **Machine access:** agents and enterprise backends use scoped, hash-only workspace API keys. Autonomous publishing
   requires a separately issued, versioned policy-bound key with explicit budgets, payment modes, wallet binding,
   audience/project/data limits, expiry, and revocation. x402 is the self-funded delegated lane first; accountless x402
   remains deferred until the B2B and abuse controls can be enforced without a workspace principal.

## Implementation slices and commits

### 1. Reopen the design decision

- Amend the tokenless design of record and agent instructions.
- Record the identity/authority split, rollout order, data minimization, rollback, and deployment guardrails in this document.
- Commit independently from application code.

### 2. Add thirdweb browser authentication

- Add `thirdweb@5.120.1` and a lazily initialized public/server client split.
- Add `ThirdwebProvider` without removing the Wagmi/Base Account provider needed by wallet-specific flows.
- Configure the compact RateLoop sign-in modal with email, Google, Apple, and passkey first; offer Base Account as an external wallet option.
- Use thirdweb Auth to generate and verify domain-bound, short-lived SIWE payloads. Consume the existing database-backed one-time nonce and create the existing RateLoop-owned session cookie.
- Keep the app build-safe when thirdweb variables are absent; sign-in must fail closed with an operator-readable configuration message.

### 3. Persist enterprise identity metadata

- Add a forward-only migration for session auth source and a minimized identity table keyed by the verified principal address.
- Resolve in-app-wallet profiles from the thirdweb server API after signature verification. Persist only verified fields needed for enterprise access UX and auditability.
- Return safe session metadata to the client: principal address, provider label, masked/normalized email, and expiry. Never expose thirdweb tokens or server secrets.
- Generalize Base-Account-specific session naming and user-facing copy to RateLoop account/principal terminology while retaining explicit Base Account language only for wallet-specific payment and payout checks.

### 4. Tokenless deployment readiness

- Add `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`, and `NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN` to the isolated tokenless environment contract.
- Require the thirdweb dashboard project to allow only localhost for development and the tokenless Vercel domain for hosted use. Do not authorize `rateloop.ai`.
- Add a readiness check that rejects missing production variables, an auth domain that does not match the resolved tokenless origin, public exposure of the secret, or a non-tokenless Vercel project link.
- Apply the new migration to the dedicated tokenless Postgres database before enabling the new hosted sign-in flow.

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
