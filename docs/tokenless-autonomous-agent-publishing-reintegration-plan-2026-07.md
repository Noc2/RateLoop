# Tokenless autonomous agent publishing reintegration plan (July 2026)

**Status:** Proposed design amendment for the `tokenless` branch. This document does not override the
[tokenless architecture and implementation plan](tokenless-immutable-implementation-plan-2026-07.md) until the decision
is accepted there. It restores a narrowly delegated machine-publishing path; it does not restore the legacy contract,
governance, local-signer, category, or rating-tool graph.

## Decision

Restore autonomous paid panel creation as an explicit, bounded workspace capability.

- The default public MCP and browser handoff remain draft-first and human-approved.
- A workspace owner or admin may separately issue an agent credential with a frozen publishing policy.
- A delegated agent may then quote, submit, pay, wait, and read the result without a person approving each run, but only
  inside that policy.
- The preferred self-funded lane is an agent-controlled encrypted wallet signing short-lived x402/EIP-3009
  authorizations. RateLoop's gas-only relayer broadcasts them; RateLoop never receives the wallet key.
- Prepaid workspace balance remains the easiest production B2B lane. Direct wallet transactions are a secondary
  fallback, not the first restored CLI path.
- Truly accountless x402 publishing is deferred until the B2B trader, funder-screening, terms-acceptance, rate-limit,
  and abuse controls can be enforced without a workspace principal.

"Autonomous" means that a human has delegated a limited class of RateLoop purchases in advance. It does not mean that
RateLoop results may silently deploy software, approve regulated activity, or trigger another irreversible action.

## Why this is a reintegration, not a new protocol

The present branch already contains most of the payment and orchestration substrate:

| Capability           | Current state                                                                                      | Gap                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Machine quote        | Public and implemented in `@rateloop/sdk`                                                          | None                                                                 |
| Machine ask          | Implemented behind a workspace API key or browser session                                          | No bounded autonomous-publish policy                                 |
| Prepaid execution    | Implemented through the isolated prepaid funder                                                    | CLI does not expose the full payment lifecycle                       |
| Wallet execution     | API accepts a payer and reconciles an exact matching `RoundCreated` receipt                        | No current tokenless transaction builder/signer                      |
| x402 execution       | Stateless `X402PanelSubmitter`, two funder signatures, and gas-only server relayer are implemented | No current tokenless authorization builder/signer                    |
| Wait/result/webhooks | Implemented, idempotent, and resumable                                                             | CLI needs a one-command orchestration path and durable resume output |
| Public MCP           | Four privacy-safe browser-handoff tools                                                            | Intentionally remains non-publishing                                 |
| Workspace API keys   | Hash-only, revocable, and workspace-bound                                                          | Keys are role-based only; no scopes, caps, wallet binding, or expiry |
| Active deployment    | Current `tokenless-v3` exports intentionally contain no active addresses                           | A fresh isolated deployment is required before live payment testing  |

The old `packages/agents/src/localSigner.ts` proved the product demand but is not suitable for revival. It was roughly
four thousand lines and validated the removed registry, escrow, LREP, feedback-bonus, confidentiality, category, and
legacy transaction-plan surfaces. The replacement should be a small tokenless-only signer over the existing
`quote -> ask -> payment -> wait -> result` API.

## Product contract

### Lane 1: browser-approved handoff

Keep the existing public MCP behavior unchanged:

1. The agent prepares public, synthetic, or safely redacted content.
2. A person approves the exact outbound draft.
3. The MCP creates a fragment-backed browser handoff.
4. The browser requests a quote and submits the panel.

This remains the correct lane for one-off use, untrusted agents, material outside-workspace data, and any request that
does not match a preapproved policy.

### Lane 2: delegated autonomous publishing

A workspace owner or admin creates an **agent publishing policy** and binds one new API key to it. The policy is shown in
plain language before issuance and is independently revocable. Within the policy, the agent may:

1. obtain a quote without sending payment;
2. locally verify the request against the policy;
3. submit the ask using its idempotency key and bound payment mode;
4. sign and submit x402 authorization evidence, or consume prepaid balance;
5. resume after a crash from the operation key without resubmitting or spending twice;
6. wait for and retrieve the versioned result.

Requests outside the policy return a stable `approval_required` response containing a browser-handoff continuation.
They never silently broaden the policy or fall back to a more privileged workspace key.

### Lane 3: accountless x402

Keep this as a later acquisition lane. A wallet signature can establish fund authority, but it does not by itself
establish B2B status, data rights, sanctions disposition, retention terms, or an acceptable abuse budget. Enable this
only after those facts can be bound to a short-lived signed offer and audited without turning the gas relayer or fund
core into an operator-controlled custody path.

## Publishing policy

Add a forward-only migration for a policy bound one-to-one to an API key. At minimum, freeze:

- enabled state, policy version, effective time, expiry, and revocation time;
- allowed payment modes: `prepaid` and/or `x402` initially;
- for x402, the one allowed payer address;
- maximum USDC per panel, per rolling day, and per calendar month;
- maximum panel size, bounty, fee basis points, and attempt reserve;
- allowed project IDs and reviewer sources;
- exact allowed admission-policy hashes, not a tier comparison;
- allowed data classifications and maximum retention;
- whether public URLs or private workspace artifacts are allowed;
- allowed webhook endpoint IDs, not arbitrary callback URLs;
- optional prompt/rubric template allowlist;
- `onPolicyMiss: "handoff" | "deny"`.

Reserve policy budget transactionally when the ask is created, keyed by workspace plus idempotency key. Convert the
reservation to spent only when chain confirmation succeeds; release it on terminal preparation failure. Retries must
return the same reservation and operation. Record policy ID/version, API-key ID, quote ID, operation key, amount,
payment mode, request commitment, and final round ID in an append-only audit event.

Existing unrestricted role-only API keys must not silently become autonomous publishing keys. New policy-bound keys
use explicit scopes such as `quote:read`, `panel:publish`, `payment:submit`, `result:read`, and `webhook:use`. Existing
keys should be migrated to their current non-autonomous project/read behavior or require an owner to opt them into a
publishing policy.

## Tokenless signer and CLI

Create a new focused module such as `packages/agents/src/tokenlessSigner.ts`. Do not copy the legacy signer wholesale.

Recommended commands:

```bash
rateloop-agents wallet create --keystore ~/.rateloop/tokenless-agent.json
rateloop-agents wallet address --keystore ~/.rateloop/tokenless-agent.json
rateloop-agents wallet balance --keystore ~/.rateloop/tokenless-agent.json

rateloop-agents run --file run.json --payment x402
rateloop-agents resume --operation-key op_...
```

`run` performs the complete workflow:

1. Load the explicit tokenless origin, API key, local policy mirror, and encrypted signer.
2. Quote the request.
3. Fail locally if the quote exceeds the mirrored policy or wallet balance.
4. Submit `ask` with `payment: { mode: "x402", payerAddress }` and a caller-chosen idempotency key.
5. Fetch canonical payment instructions.
6. Verify every instruction independently before signing.
7. Build the EIP-3009 USDC authorization and `X402PanelSubmitter` round authorization locally.
8. Submit only the signatures; the server gas relayer executes the stateless adapter.
9. Persist a non-secret resume receipt containing the origin, deployment key, idempotency key, operation key, amount,
   round ID when known, and latest wait cursor.
10. Wait for readiness or return the continuation cleanly when the caller's time budget expires.

The SDK may expose pure builders and validators, but it stays wallet-agnostic. Private-key loading and signing belong in
`@rateloop/agents` or an injected signer adapter, not `@rateloop/sdk`.

### Signer backends

Support in this order:

1. encrypted Web3 Secret Storage v3 keystore with `0600` permissions;
2. injected viem `LocalAccount` for programmatic hosts;
3. later, KMS/HSM or agent-wallet provider adapters implementing the same narrow `getAddress`/`signTypedData` contract.

Do not print private keys, keystore passwords, full API keys, or authorization signatures in normal logs. A raw private
key environment variable may be allowed only as an explicitly unsafe development escape hatch and must be rejected by
production-mode CLI configuration.

## x402 authorization rules

The signer must derive and verify the authorization rather than signing opaque server-supplied typed data.

Before signing, require all of the following:

- the API origin is explicit, HTTPS, and not `rateloop.ai` on `tokenless`;
- chain ID, deployment key, panel, x402 submitter, and USDC addresses exactly match the active
  `@rateloop/contracts/tokenless` deployment bundle;
- bytecode exists at every required contract address and the server reports the same complete deployment key;
- funder equals the local signer address and the policy-bound payer address;
- the complete round terms reproduce the quoted content, audience-policy hash, panel size, bounty, fee, reserve,
  deadlines, and fee recipient;
- `totalFundedAtomic` equals bounty plus fee plus attempt reserve and is inside every policy cap;
- the EIP-3009 recipient is the stateless x402 submitter and the value is exactly the total;
- the random nonce has not been used locally and the authorization lifetime is short (target ten minutes, hard cap one
  hour);
- the second EIP-712 signature binds funder, panel, exact round-terms digest, authorization window, and nonce;
- no unlimited ERC-20 approval or operator-selected destination is introduced.

The server keeps its current on-chain reconciliation: accept success only when exactly one `RoundCreated` event and the
stored round state match every expected immutable term. A failed or ambiguous receipt remains retryable and must never
be reinterpreted as a new ask.

## Server and SDK changes

1. Add versioned policy CRUD and API-key issuance endpoints for workspace owners/admins.
2. Enforce policy and budget reservation inside the same preparation path that currently resolves workspace ownership
   and payment intent; client-side checks are convenience only.
3. Extend payment instructions with a versioned authorization specification containing the EIP-712 domain facts,
   short validity window, nonce, and digest inputs. Keep the existing full round terms.
4. Add pure SDK functions that reconstruct both typed-data messages and reject any mismatch with the quote and active
   deployment.
5. Add CLI `payment`, `run`, and `resume` commands. Keep the lower-level `quote`, `ask`, `wait`, and `result` commands.
6. Add stable policy failure codes and a signed/opaque browser-handoff continuation for `onPolicyMiss: "handoff"`.
7. Include policy/audit information in workspace settings without exposing prompts, private artifacts, or secrets in
   general billing logs.
8. Keep the four-tool public MCP unchanged. If authenticated MCP publishing is later needed, make it a separate
   OAuth/API-key surface that calls the same policy-enforced service; never add an unscoped publish tool to the public
   endpoint.

## Implementation sequence and commits

Keep each numbered item as an independent commit.

1. **`docs: define delegated agent publishing`**
   Accept this decision in the tokenless design of record; reconcile the human-assurance integration plan, trust copy,
   and the meaning of accountless x402.
2. **`feat(db): add agent publishing policies`**
   Add policy, policy-budget reservation, and audit-event tables plus authorization-tested services.
3. **`feat(auth): scope agent publishing keys`**
   Add explicit key scopes, policy binding, expiry/revocation, wallet binding, owner/admin issuance UI, and fail-closed
   handling for existing role-only keys.
4. **`feat(sdk): define tokenless payment authorizations`**
   Version payment instructions and add pure deployment/terms/EIP-712 builders and validators without key custody.
5. **`feat(api): enforce delegated publishing policy`**
   Enforce request, audience, classification, retention, payment-mode, and spend caps transactionally in ask/payment
   preparation. Add policy-miss handoff continuations.
6. **`feat(agents): add tokenless encrypted wallet`**
   Implement keystore create/address/balance and injected-signer support with secret-safe output.
7. **`feat(agents): run self-funded panels`**
   Implement x402 signing, submit, resume, bounded wait, result, and crash/idempotency recovery. Do not include legacy
   transaction-plan validation.
8. **`feat(agents): support delegated prepaid runs`**
   Add the no-wallet B2B path through the same policy and audit controls.
9. **`test(e2e): verify autonomous agent publishing`**
   Exercise sandbox, Base Sepolia x402, prepaid, policy misses, cap races, retries, revocation, expiry, bad deployment,
   relayer outage, and browser fallback.
10. **`docs(marketing): explain agent publishing choices`**
    Update landing, agent docs, SDK docs, examples, plugin instructions, and security guidance only after the behavior is
    live in the isolated tokenless deployment.
11. **`chore(deploy): publish the isolated tokenless signer flow`**
    Deploy the fresh active contract bundle and all isolated services atomically, following the tokenless branch,
    Vercel, Railway, and `rateloop.ai` non-movement guards.

## Verification matrix

### Unit and property tests

- policy allow/deny at every boundary and exact-policy-hash matching;
- transactional spend caps under concurrent idempotency keys;
- reservation release and retry behavior;
- keystore permissions, wrong-password handling, and no-secret logs;
- EIP-3009 domain, amount, nonce, deadline, recipient, and signature validation;
- round-authorization digest reconstruction across SDK, CLI, Solidity, and Foundry fixtures;
- deployment-key/address mismatch and stale-artifact rejection;
- authorization replay, altered quote, altered fee recipient, altered policy, and altered deadline rejection.

### Integration tests

- `quote -> ask -> payment instructions -> sign -> relayer -> round reconciliation -> wait -> result`;
- process crash before signing, after signing, after broadcast, and before result retrieval;
- API-key revocation and policy revocation between quote, ask, and payment;
- policy-miss browser handoff without duplicate ask or budget reservation;
- prepaid and self-funded x402 accounting produce the same frozen round terms;
- gas relayer has gas only and cannot fund, redirect, cancel, settle selectively, or recover fund-core assets.

### Live gates

Start only on the isolated Base Sepolia stack. A real-money or Base-mainnet launch remains blocked until:

- the active `tokenless-v3` deployment bundle is fresh and every service uses the same complete deployment key;
- the reopened scoring/integrity work is approved for paid network or hybrid panels;
- B2B trader/VAT, funder screening/geoblocking, terms, invoices/reconciliation, rate limits, alerting, and legal furniture
  are operational;
- external review covers the small fund core, x402 adapter, signer builders, policy budget races, and relayer recovery;
- a red-team run proves that a compromised agent key is bounded by the frozen cap, wallet, audience, project,
  classification, expiry, and revocation controls.

## Landing-page and docs outcome

Once the end-to-end path is live, replace the current absolute answer with a precise distinction:

> **Can an Agent Launch a Review by Itself?**
>
> Yes, when you give it a scoped RateLoop key and a prepaid budget or agent-controlled wallet. Otherwise it creates a
> browser draft for you to approve.

The agent docs should show three clearly labeled choices: browser-approved handoff, delegated prepaid run, and delegated
self-funded x402 run. They must continue to say that RateLoop returns decision support and that a result does not by
itself authorize a release.

## Acceptance criteria

The reintegration is complete only when:

1. a new agent can create an encrypted wallet, receive test USDC, and launch a Base Sepolia panel with one documented
   command;
2. no human click is required when the request is inside a preapproved policy;
3. the same request outside policy fails closed or returns a browser handoff, according to policy;
4. a crash at any step resumes without duplicate spend or duplicate panel creation;
5. an owner can revoke the policy or key and prevent the next spend immediately;
6. compromise impact is mechanically bounded by wallet balance and server-enforced policy caps;
7. the public MCP remains draft-first and privacy-safe;
8. the fund core and x402 adapter gain no owner, operator, sweep, redirect, cancellation, or mutable-wiring path;
9. deployment-key checks prevent the signer from using a stale or mixed address bundle;
10. the landing-page answer matches the verified behavior of the isolated live tokenless deployment.
