# RateLoop Tokenless Repository Bug Audit — 17 July 2026

**Status:** Internal engineering audit of commit `21a1b5563` on the `tokenless` branch. This is not customer-facing
product copy and does not replace the
[immutable implementation plan](tokenless-immutable-implementation-plan-2026-07.md) or the
[production-readiness register](tokenless-production-readiness-2026-07.md).

## Executive summary

The audit found **18 actionable defects**: 2 critical, 4 high, 10 medium, and 2 low. The most urgent issues are:

1. the browser handoff removes the public-data fields from a request, so a public paid ask is persisted as
   private/internal and cannot enter the public rater queue;
2. concurrent server-funded payment requests can create and fund more than one on-chain round for a single logical
   reservation;
3. reveals received after the disclosed reveal deadline can still change quorum, verdict, and RBTS scoring; and
4. permissionless token dust can permanently disable the x402 adapter.

The current branch must not be treated as ready for real users or real money. That conclusion is consistent with the
existing production-readiness register, but the defects below are implementation bugs rather than merely incomplete
release gates.

| ID     | Severity | Area                 | Finding                                                                 |
| ------ | -------- | -------------------- | ----------------------------------------------------------------------- |
| AUD-01 | Critical | Browser handoff      | Public privacy fields are stripped before quote and ask                 |
| AUD-02 | Critical | Chain payment        | Concurrent prepaid execution can double-fund rounds                     |
| AUD-03 | High     | Fund core            | Late reveals can change the frozen scoring set                          |
| AUD-04 | High     | Workspace UI         | Two workspace selectors can target different workspaces                 |
| AUD-05 | High     | Browser verification | The deterministic E2E fixture no longer satisfies the server contract   |
| AUD-06 | High     | x402 adapter         | A one-unit unsolicited transfer permanently bricks submissions          |
| AUD-07 | Medium   | Feedback Bonus       | Permissionless review IDs can be squatted                               |
| AUD-08 | Medium   | Fund core            | Unbounded deadlines can strand accepted work and funds                  |
| AUD-09 | Medium   | Webhook security     | DNS rebinding and special IP ranges bypass the SSRF boundary            |
| AUD-10 | Medium   | Deployment/indexer   | Export records the latest deployment block and can skip earlier events  |
| AUD-11 | Medium   | Webhook delivery     | A crash can strand deliveries forever in `delivering`                   |
| AUD-12 | Medium   | Keeper               | Reverted transactions are counted as successful work                    |
| AUD-13 | Medium   | Build tooling        | The E2E artifact lock ends before consumers finish                      |
| AUD-14 | Medium   | Setup workflow       | A partial review save becomes unretryable without a reload              |
| AUD-15 | Medium   | Authentication UX    | Sign-in loses the fragment-backed browser handoff                       |
| AUD-16 | Medium   | Agent CLI            | `resume` unnecessarily requires and decrypts the signing keystore       |
| AUD-17 | Low      | Size gate/docs       | Feedback Bonus is absent from a duplicated deployment-size gate         |
| AUD-18 | Low      | Operations docs      | Migration-head references stop at `0091` while the journal is at `0101` |

## Detailed findings

### AUD-01 — Critical — Browser handoff strips the public-data contract

**Evidence.** The MCP handoff creator adds `visibility: "public"`, the safe `dataClassification`, the
`redactionSummary`, and `confirmedNoSensitiveData: true` to `payload.request` in
`packages/nextjs/lib/mcp/handoff.ts:143-181`. The browser validator reconstructs a new request containing only the
audience, budget, question, panel size, and response window in
`packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:92-123`. It then sends that stripped object to the
quote route at `:443-457`.

The server defaults missing fields to `visibility: "private"` and `dataClassification: "internal"` in
`packages/nextjs/lib/tokenless/server.ts:136-176`. Those defaults are persisted into the content and question records
by `packages/nextjs/lib/tokenless/productCore.ts:1075-1140`. Public task discovery requires
`q.visibility = 'public'` and a safe public classification at
`packages/nextjs/lib/tokenless/raterService.ts:103-123`.

**Impact.** The primary browser handoff path silently changes the owner's approved data boundary. A public paid ask can
be prepared and funded but remain undiscoverable to the public rater queue, ending in delay and likely zero-commit
refund instead of review.

**Recommended fix.** Validate and preserve all four privacy fields in the browser request. Require the outer handoff
classification and redaction summary to match the embedded request. Add an end-to-end test from MCP handoff creation
through quote, ask, persisted question, and public task discovery.

### AUD-02 — Critical — Concurrent prepaid payment execution can double-fund rounds

**Evidence.** Every authenticated payment POST can call server-funded execution directly in
`packages/nextjs/app/api/agent/v1/asks/[operationKey]/payment/route.ts:34-53`. The implementation snapshots the chain
execution once and branches on stale hash fields in `packages/nextjs/lib/tokenless/chain/payments.ts:754-905`.

`allocateNonce` reads the per-execution nonce before its transaction at `:699-704`, serializes only the shared signer
nonce at `:709-733`, and unconditionally overwrites the execution nonce at `:729-732`. Transaction hashes are also
unconditional updates at `:743-751`. The execution schema has no claim lease or fencing token in
`packages/nextjs/drizzle/0004_tokenless_chain_payments.sql:1-35`.

Two requests can therefore both observe no approval/submission hash, allocate different signer nonces, and broadcast
two approvals followed by two `createRound` calls. `TokenlessPanel._createRound` always allocates a fresh round and
transfers the full amount; it has no operation/payment uniqueness key
(`packages/foundry/contracts/tokenless/TokenlessPanel.sol:249-277`). Receipt reconciliation happens only after both
transactions can have mined.

**Impact.** One logical prepaid reservation can debit the isolated funder twice and leave a second funded round outside
the database's winning binding. Client retries or deliberate concurrency can desynchronize custody and accounting and
drain prepaid liquidity.

**Recommended fix.** Claim each execution transactionally with an expiring lease and fencing token before any chain
work. Fence every nonce, hash, and state write. Resume only a persisted transaction after a crash. Add an immutable
on-chain request/payment identifier so duplicate round creation reverts before transferring funds. Cover the precise
two-request schedule with a barrier-controlled concurrency test.

### AUD-03 — High — Reveals after the reveal deadline can change scoring

**Evidence.** `TokenlessPanel.reveal` accepts a reveal through `beaconFailureDeadline`, not `revealDeadline`, at
`packages/foundry/contracts/tokenless/TokenlessPanel.sol:360-396`. `beginSettlement` becomes available immediately after
`revealDeadline` and freezes the current `revealCount` at `:399-422`. The repository test at
`packages/foundry/test/tokenless/TokenlessPanel.t.sol:189-197` explicitly demonstrates a reveal after
`revealDeadline`.

The RBTS specification says settlement after the reveal deadline fixes the exact reveal set
(`docs/tokenless-rbts-v1-spec.md:27-38`). In the implementation, a committer can instead reveal after the disclosed
closure and before someone calls `beginSettlement`, changing quorum, majority verdict, peer assignment, and scoring.

**Impact.** A late committer can front-run settlement, turn an under-quorum round into a scored round, or change the
frozen verdict after the public response window has closed.

**Recommended fix.** Separate timely scoring reveals from late compensation-only reveals. Only reveals at or before
`revealDeadline` should enter quorum and RBTS state; a valid late opening may remain eligible for the fixed accepted-work
payment through the failure deadline without altering the scoring set.

### AUD-04 — High — Workspace controls can target two different workspaces

**Evidence.** `AgentWorkspacePanels` owns the URL-backed workspace selector and passes its workspace to stop, settings,
deletion, and evidence panels at `packages/nextjs/components/tokenless/agents/AgentWorkspacePanels.tsx:91-132`.
`WorkspaceSettingsClient` renders a second selector at
`packages/nextjs/components/tokenless/WorkspaceSettingsClient.tsx:719-735`, but that selector only calls
`setSelectedId`.

It bypasses the component's own `selectWorkspace` helper at `WorkspaceSettingsClient.tsx:189-216`, so
`WorkspaceRequestScope` continues to identify the original workspace. New top-up and identity requests for the locally
selected workspace are immediately aborted by `packages/nextjs/lib/tokenless/workspaceRequestScope.ts:40-65`.
Billing and billing-profile loads are not request-scoped at `WorkspaceSettingsClient.tsx:235-274`, allowing an older
workspace response to overwrite the display after selection changes.

**Impact.** A user can see billing controls for workspace B while adjacent stop, deletion, and evidence controls remain
bound to workspace A. Funding and identity actions can hang or display stale data, and the split context creates a high
risk of acting on the wrong workspace.

**Recommended fix.** Remove the inner selector and use the URL-backed parent workspace as the sole source of truth, or
make the inner control navigate the parent route. Scope every billing/profile request with the same generation and
workspace guard used by top-up and identity requests.

### AUD-05 — High — The deterministic browser gate cannot prepare its fixtures

**Evidence.** Running the documented E2E command against a fresh isolated `rateloop_e2e` database fails before
Playwright starts:

```text
TokenlessServiceError: requestProfile.questionAuthority is required.
  at connectedWorkspace (.../packages/nextjs/e2e/scripts/prepare.ts:125:18)
```

The fixture builds the request profile at `packages/nextjs/e2e/scripts/prepare.ts:125-158` without the now-required
`questionAuthority`. The server correctly rejects it in
`packages/nextjs/lib/tokenless/humanReviewConfiguration.ts:123,769`.

**Impact.** The release register names `yarn workspace @rateloop/nextjs e2e` as the deterministic browser gate, but the
gate currently runs zero browser assertions. UI regressions can merge while the intended end-to-end evidence is
unavailable.

**Recommended fix.** Migrate the fixture to the complete current request-profile contract and add a small compile-time
or schema-based fixture assertion so future required fields fail closer to the change that introduced them.

### AUD-06 — High — One unsolicited token unit permanently bricks the x402 adapter

**Evidence.** After receiving the authorized amount, `X402PanelSubmitter` requires its total USDC balance to equal that
amount, and after submission requires the total balance to equal zero
(`packages/foundry/contracts/tokenless/X402PanelSubmitter.sol:55-87`). ERC-20 balances can be transferred to a contract
without its consent. The existing test at `packages/foundry/test/tokenless/X402PanelSubmitter.t.sol:70-82` proves that
one stray unit makes the authorized call revert while leaving the unit stuck.

**Impact.** Any account can permanently deny every x402-funded round on the adapter with a one-unit transfer. There is
no recovery or sweep path, appropriately, so the failure is permanent for that deployment.

**Recommended fix.** Compare balance deltas rather than total balances. Record the pre-call balance, require the
authorization to increase it by exactly the expected amount, and require the post-panel balance to return to the same
pre-call value.

### AUD-07 — Medium — Feedback Bonus review IDs can be squatted

**Evidence.** `TokenlessFeedbackBonus.createPool` and `createPoolFor` let any payer select arbitrary pool terms and
roles at `packages/foundry/contracts/tokenless/TokenlessFeedbackBonus.sol:141-166`. The first pool for a `reviewId`
permanently wins the global mapping at `:168-189`.

**Impact.** An attacker who learns or predicts a legitimate review ID can front-run it with the minimum funded pool.
The legitimate request then always reverts with `PoolAlreadyExists`, disabling its Feedback Bonus path.

**Recommended fix.** Require requester/funder authorization over the exact review ID, terms, and roles, preferably via
an EIP-712 envelope, or namespace pool uniqueness by the authenticated requester rather than a globally caller-chosen
ID.

### AUD-08 — Medium — Unbounded deadlines can strand accepted work and funds

**Evidence.** `_validateTerms` checks only deadline ordering and caps the claim grace period at
`packages/foundry/contracts/tokenless/TokenlessPanel.sol:751-779`. It applies no maximum horizon to the reveal or beacon
failure deadlines. After a valid commit, settlement before those deadlines may be impossible. The Feedback Bonus
contract similarly caps the interval from feedback deadline to award deadline, but not the absolute feedback horizon
(`packages/foundry/contracts/tokenless/TokenlessFeedbackBonus.sol:168-173`).

**Impact.** Malformed or hostile terms can lock the bounty, attempt reserve, and accepted-work terminal path for years
or centuries. A malformed bonus pool can lock its funder for the same period.

**Recommended fix.** Enforce protocol-wide maximum horizons from creation for every deadline, with minimum operational
windows where necessary. Keep the application validation, but enforce the custody liveness boundary in the contracts.

### AUD-09 — Medium — Webhook SSRF controls allow DNS rebinding and special addresses

**Evidence.** The address classifier in `packages/nextjs/lib/tokenless/transparency.ts:397-418` blocks common private
ranges but accepts other non-global ranges, including carrier-grade NAT, benchmarking, documentation/reserved,
multicast, and IPv4-mapped IPv6 forms. Delivery resolves and validates the hostname at `:1829`, then ordinary `fetch`
at `:1830-1841` performs an independent DNS resolution.

**Impact.** A workspace administrator controlling DNS can return a public address during validation and a network-local
or provider-internal address during the actual fetch. The service then sends a signed blind POST across the tenant-to-
platform network boundary. Assurance event delivery shares the same destination pattern.

**Recommended fix.** Reject every address that is not globally routable, resolve once, and pin the selected IP in the
HTTP connection while retaining the correct TLS SNI and Host. Recheck all addresses and redirects. An egress proxy,
firewall, or explicit destination allowlist is stronger defense in depth.

### AUD-10 — Medium — Deployment export can make Ponder skip earlier contract events

**Evidence.** The deployment exporter sets the common `deploymentBlockNumber` to the maximum per-contract deployment
block at `packages/foundry/scripts-js/tokenlessDeployment.js:270-304`. Validation checks that values are integers but
does not require the common block to equal the earliest contract block at `:316-374`. Ponder applies one common start
block to the panel, issuer, and Feedback Bonus contracts in `packages/ponder/ponder.config.ts:29-55`.

**Impact.** A deployment spanning multiple blocks starts indexing at the last block. Earlier constructor events,
including the credential issuer's initial signer epoch, can be skipped and leave indexed deployment evidence
incomplete.

**Recommended fix.** Export the minimum deployed block and validate equality with the minimum of every included
contract. Alternatively carry and consume per-contract start blocks.

### AUD-11 — Medium — Webhooks can remain forever in `delivering`

**Evidence.** `deliverPendingWebhooks` selects only `pending` and `retry` rows and claims each by setting
`state='delivering'` before network I/O at `packages/nextjs/lib/tokenless/transparency.ts:1798-1818`. Success or retry is
written only after the fetch at `:1842-1867`. The schema has no lease expiry or claim generation in
`packages/nextjs/drizzle/0005_tokenless_transparency_webhooks.sql:64-81`.

**Impact.** A process kill, hosting timeout, or lost database connection after claim permanently strands a
`result.ready` delivery. Future workers never select it again.

**Recommended fix.** Add a lease expiry and fencing token, reclaim expired `delivering` rows, and fence completion
writes by claim generation. The newer assurance-event and WORM queues already contain lease patterns that can be
adapted.

### AUD-12 — Medium — Keeper reports reverted transactions as successful work

**Evidence.** `writeAndConfirm` waits for a transaction receipt but never checks its status in
`packages/keeper/src/keeper.ts:166-180`. A mined reverted receipt therefore returns normally, and
`permissionlessWrite` reports success at `:190-209`. The service then calls `recordRun`, which increments work counters,
updates the last-success timestamp, and resets consecutive errors in `packages/keeper/src/index.ts:74-75` and
`packages/keeper/src/metrics.ts:63-89`. The Feedback Bonus refund path repeats the same unchecked receipt pattern.

**Impact.** Settlement, reveal, claim, stale-return, or bonus-refund work can revert while health remains green.
Persistent failures can delay terminal paths without alerting operators.

**Recommended fix.** Require `receipt.status === "success"` in the common write helper and route bonus refunds through
that helper. Add reverted-receipt tests that assert zero success counters and degraded/error health.

### AUD-13 — Medium — The workspace artifact lock does not cover E2E consumption

**Evidence.** The E2E script builds workspace dependencies, releases their individual locks, and only then prepares
fixtures and starts Playwright (`packages/nextjs/package.json:23-24`). SDK builds delete and recreate the shared
`dist` directory under a per-command lock (`packages/sdk/package.json:36-47`).

During this audit, a concurrent Next.js typecheck and E2E run produced:

```text
Cannot find module '.../packages/nextjs/node_modules/@rateloop/sdk/dist/cjs/index.js'
```

An immediate isolated rerun resolved the module, confirming a build/consume race rather than a missing package output.

**Impact.** Parallel agents or local verification jobs fail nondeterministically and can hide the actual E2E result.

**Recommended fix.** Hold `scripts/with-workspace-dist-lock.mjs` around the complete build, fixture preparation, and
Playwright lifecycle. Longer term, build into a staging directory and atomically swap immutable output trees.

### AUD-14 — Medium — A partial review save makes setup retry stale forever

**Evidence.** The setup client commits the human-review configuration first, then separately advances the wizard at
`packages/nextjs/components/tokenless/agents/setup/AgentSetupFlow.tsx:757-787`. Its catch path keeps the stale setup
draft at `:789-793`. The server strictly rejects any old `expectedBindingVersion` at
`packages/nextjs/lib/tokenless/humanReviewConfiguration.ts:1413-1430`.

**Impact.** If the first response is lost or the second request fails, Retry repeats the first PUT with the old binding
revision and receives a permanent conflict until the user reloads the entire setup.

**Recommended fix.** Make review save and setup advancement one atomic/idempotent server operation, or reload and adopt
the authoritative binding after an ambiguous/partial failure before enabling retry.

### AUD-15 — Medium — Sign-in loses the fragment-backed handoff

**Evidence.** The signed-out handoff tells the user to use the header sign-in action at
`packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:789-793`. The shared action always navigates to
`/sign-in` at `packages/nextjs/components/thirdweb/ThirdwebSessionButton.tsx:12-16`. Without an explicit `returnTo`, the
sign-in client navigates to `/agents` at `packages/nextjs/components/auth/BetterAuthSignIn.tsx:37-40,62-69`.

**Impact.** The bearer handoff intentionally exists only in the URL fragment. Normal sign-in navigation leaves that
fragment behind, so the advertised primary path is not resumable without browser-history or manual-link recovery.

**Recommended fix.** Use a handoff-specific sign-in flow that preserves the fragment client-side and returns to
`/handoff`, or open sign-in in a separate tab and refresh the session in the original handoff tab.

### AUD-16 — Medium — CLI `resume` unnecessarily requires the signing key

**Evidence.** `packages/agents/src/cli.ts:171-185` requires and decrypts the keystore for both `run` and `resume`.
Only `run` uses the account at `:188-201`; `resume` only polls an existing operation at `:204-210`.

**Impact.** Recovery after a restart fails when the signing key is intentionally offline or unavailable, even though
polling needs only the API credential and operation key.

**Recommended fix.** Keep the API-key requirement for both commands but move keystore validation and loading inside
the `run` branch.

### AUD-17 — Low — Feedback Bonus is missing from a duplicated size gate

**Evidence.** The JavaScript deployment-size manifest lists Test USDC, issuer, panel, and x402 adapter but omits
`TokenlessFeedbackBonus` at `packages/foundry/scripts-js/checkTokenlessContractSizes.js:14-35`. Its test hard-codes the
same four-contract set. The Solidity deploy script independently checks all five contracts, so the current deployment
path still has a hard size check.

Related package and Foundry documentation still describes a four-contract/v2 bundle even though the active runtime
schema is the five-slot v4 identity.

**Impact.** One documented CI/tooling gate can pass without measuring a contract that the deployment includes, and the
duplicated stale inventory makes future regressions easier to miss.

**Recommended fix.** Generate one deployment contract manifest and consume it from the JS gate, deploy script,
artifact generator, and docs. Include Feedback Bonus in the size-gate test.

### AUD-18 — Low — Migration-head references are stale

**Evidence.** The design of record says the journal head is `0091_mcp_elicitation_sessions` at
`docs/tokenless-immutable-implementation-plan-2026-07.md:34-37`. The production-readiness register repeats `0091` at
`docs/tokenless-production-readiness-2026-07.md:14,64-65`. The authoritative journal ends at
`0101_feedback_result_semantics` in `packages/nextjs/drizzle/meta/_journal.json:698-710`.

**Impact.** A release operator following the copied head can record incomplete migration evidence or misdiagnose a
hosted schema mismatch. The documents do point to the journal as authoritative, which limits severity.

**Recommended fix.** Replace copied head numbers with an observed-revision note that is updated mechanically, or omit
the number and link only to the journal.

## Verification performed

| Check                 | Result                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `yarn test:packages`  | Passed; all package type checks and 1,392 tests passed, including 1,203 Next.js tests                   |
| `yarn test:node`      | Passed; 54 repository/tooling tests passed                                                              |
| `yarn lint`           | Passed, including Foundry formatting and Next.js lint                                                   |
| `yarn next:build`     | Passed; optimized Next.js production build completed                                                    |
| Foundry suite         | Passed; 55 tests                                                                                        |
| Foundry tooling suite | Passed; 31 tests                                                                                        |
| Contract package      | Passed; typecheck and 7 tests                                                                           |
| SDK package           | Passed; typecheck and 33 tests                                                                          |
| Agents package        | Passed; typecheck and 86 tests                                                                          |
| Keeper package        | Passed; typecheck and 23 tests                                                                          |
| Ponder package        | Passed; typecheck and 32 tests                                                                          |
| Slither               | Reviewed; no additional material custody/authorization finding beyond the issues above                  |
| `yarn dead-code:scan` | Completed; six unused files and one unused dependency were reported as cleanup, not elevated here       |
| Next.js E2E           | Failed during fixture preparation on missing `requestProfile.questionAuthority`; zero browser tests ran |

The E2E command was run against a dedicated local `rateloop_e2e` database. The test service was stopped after the
audit. The earlier missing-SDK failure was reproduced only during concurrent builds and is recorded separately as
AUD-13.

## Relevant non-findings

- No owner, proxy, pause, sweep, setter, or operator path to fund-core assets was found.
- Foundry conservation/invariant coverage passed for finalized payouts, compensation, refunds, credits, claims, and
  stale returns.
- Stripe webhook ingestion verifies the raw-body signature and uses transactional/idempotent processing; no concrete
  double-credit defect was found.
- Prepaid ledger reservation serializes the workspace balance correctly. AUD-02 begins later at chain execution.
- Wallet payment confirmation checks successful receipts and complete immutable round terms.
- Better Auth sessions remain server-owned and hash-only; no concrete browser-session authorization bypass was found.
- Ponder deployment identity checks fail closed; AUD-10 concerns only the exported common start block.

## Recommended remediation order

1. Block paid browser handoffs and server-funded chain execution until AUD-01 and AUD-02 are fixed and covered by
   end-to-end/concurrency tests.
2. Correct AUD-03, AUD-06, AUD-07, and AUD-08 together as fund-core work. Per branch policy, any fund-core change makes
   every checked-in deployment address and hosted consumer stale until a complete fresh deployment is published and all
   isolated services are updated atomically.
3. Restore the deterministic browser gate (AUD-05 and AUD-13), then fix the split workspace context (AUD-04) and rerun
   the complete browser journey.
4. Fix webhook/keeper/deployment reliability and security (AUD-09 through AUD-12) before hosted staging evidence is
   accepted.
5. Resolve the remaining recovery, CLI, size-gate, and documentation defects before release sign-off.
