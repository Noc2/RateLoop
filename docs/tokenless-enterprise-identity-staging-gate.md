# Tokenless enterprise identity staging gate

This gate applies before RateLoop describes the tokenless product as supporting enterprise SSO or SCIM.
Passing local tests is necessary but is not the release signal.

## Implemented boundary

- Better Auth owns OIDC, SAML 2.0, and SCIM protocol handling.
- A DNS TXT proof binds an identity-provider domain to exactly one RateLoop workspace.
- IdP-initiated SAML is disabled. Service-provider initiated responses require `InResponseTo`, signed
  assertions, valid timestamps, bounded clock skew, and current signature algorithms.
- A successful provider callback creates a RateLoop workspace member with the `member` role. It never
  overwrites an existing RateLoop role or creates a parallel Better Auth organization authority.
- Enforced domains reject OTP and social sessions. Only a session bound to the matching verified provider
  may enter the workspace.
- SCIM tokens are provider-scoped. SCIM supports `/Users` only; `/Groups` is not implemented or advertised.
- SCIM deactivation removes only the mapped workspace membership and RateLoop sessions. Cross-workspace
  provisioning and deprovisioning fail closed.

## Automated evidence

The focused identity suite must pass in CI:

```sh
yarn workspace @rateloop/nextjs node --conditions=react-server --import tsx --test \
  lib/auth/enterpriseAuthRoute.test.ts \
  lib/auth/enterpriseIdentityMigration.test.ts \
  lib/auth/enterpriseIdentityPolicy.test.ts \
  lib/auth/enterpriseScimProjection.test.ts
```

This covers strict callback context, provider-to-workspace binding, default-member provisioning, existing-role
preservation, SSO-only enforcement, SCIM update/deactivation projection, and cross-workspace rejection. These
tests use controlled protocol fixtures and do not replace a staging exercise against an identity provider.

## Required staging exercise

Run all of the following against the isolated `rateloop-tokenless` staging deployment and retain the provider
configuration, timestamps, request IDs, and screenshots in the internal release record:

1. Register one OIDC provider as a workspace owner or admin, publish the DNS TXT value, verify the domain,
   and confirm a second workspace cannot claim it.
2. Complete an SP-initiated OIDC sign-in for a new user and verify a `member` membership is created. Repeat
   for an existing workspace admin and verify the role remains `admin`.
3. Enable SSO-only for the verified domain. Verify OIDC succeeds while email OTP and configured social login
   are rejected for that domain, without blocking unrelated domains.
4. Register one SAML provider and complete an SP-initiated sign-in. Reject an IdP-initiated response, a
   replayed response, a mismatched `InResponseTo`, an expired assertion, a not-yet-valid assertion outside the
   clock-skew allowance, an unsigned assertion, and a response using a disallowed legacy algorithm.
5. Create one SCIM token, record it once, and prove it is not recoverable from the UI or API. Use it to create,
   update, deactivate, and reactivate a user through `/Users`.
6. Verify SCIM never changes an existing RateLoop role, deactivation revokes RateLoop sessions and only the
   mapped workspace membership, and cross-workspace provisioning/deactivation is rejected.
7. Revoke the SCIM token and verify it can no longer call SCIM. Rotate provider credentials and verify domain
   verification and SSO-only enforcement remain intact when the domain did not change.
8. Delete the provider only after an explicit confirmation. Verify enforcement is removed, managed mappings
   reach a terminal audit state, and the audit outbox drains in order.

Any failure blocks the enterprise identity claim. Fix and repeat the entire affected protocol journey; do not
waive the gate based on the local fixture suite.

## Deferred capabilities

SCIM Groups, automated group-to-role mapping, and Ory Polis are demand-only follow-ups. A real customer
requirement and a separate trust-boundary review are required before adding any of them.
