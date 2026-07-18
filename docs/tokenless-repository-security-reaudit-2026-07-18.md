# RateLoop Tokenless Repository Bug and Security Re-audit — 18 July 2026

**Status:** Internal engineering re-audit of commit `40839eb52` on the `tokenless` branch. This document is not
customer-facing product copy. It supplements the
[17 July repository audit](tokenless-repository-bug-audit-2026-07-17.md), the
[immutable implementation plan](tokenless-immutable-implementation-plan-2026-07.md), and the
[production-readiness register](tokenless-production-readiness-2026-07.md).

**Remediation update:** All 15 findings were reproduced or otherwise revalidated and fixed on 18 July 2026. The
[remediation record](tokenless-security-reaudit-remediation-2026-07-18.md) records the decisions, isolated commits,
verification, and remaining release requirements. The findings below remain the point-in-time evidence for the audited
revision.

## Executive summary

This pass found **15 actionable defects**: 5 high, 9 medium, and 1 low. No critical issue was confirmed. The highest
priority findings are:

1. the keeper and Ponder use handwritten v4 `Round` tuples that omit `compensatedRevealCount`, shifting every later
   decoded field and breaking automated settlement decisions;
2. a valid late reveal is accepted as compensated work but receives zero when timely quorum already exists;
3. the autonomous agent signs x402 instructions without a locally pinned deployment identity, so a compromised or
   misconfigured API can direct a real USDC authorization to attacker-controlled contracts;
4. browser handoffs submit image and YouTube context that is never shown before the owner confirms the content is safe
   for public review; and
5. abandoned payment preparations reserve deployment-wide surprise-bounty capacity forever, allowing one tenant to
   exhaust a shared funder and block later tenants.

The prior audit drove substantial improvement. **Sixteen of its eighteen exact defects are closed.** The SSRF fix and
setup-retry fix are partial: the address filter misses one non-global NAT64 range, and a committed setup advance with a
lost response remains unrecoverable without a reload. The exact late-scoring bug is closed, but its compensation and
indexing follow-on paths contain new defects documented below.

The branch remains unsuitable for real users or real money. In addition to the findings, it has no current v4
deployment artifact, and the production-readiness register still treats network integrity epochs and real-money
acceptance as prospective gates.

| ID       | Severity | Area                      | Finding                                                                |
| -------- | -------- | ------------------------- | ---------------------------------------------------------------------- |
| REAUD-01 | High     | Keeper / ABI              | A missing v4 tuple field shifts the keeper's round state and cursors   |
| REAUD-02 | High     | Fund core                 | An accepted late reveal receives no base payment after timely quorum   |
| REAUD-03 | High     | Agent x402 custody        | Autonomous signing trusts server-supplied deployment addresses         |
| REAUD-04 | High     | Browser privacy approval  | Attached media is publicized without being shown to the approver       |
| REAUD-05 | High     | Shared bonus funding      | Abandoned asks permanently exhaust shared surprise-bounty capacity     |
| REAUD-06 | Medium   | Indexer / transparency    | Late reveals poison scored tallies and finalized evidence              |
| REAUD-07 | Medium   | Authentication            | Backslash normalization enables a post-sign-in open redirect           |
| REAUD-08 | Medium   | Setup recovery            | A committed advance with a lost response leaves retries stale          |
| REAUD-09 | Medium   | Payment authorization     | A `result:read` API key can perform payment mutations                  |
| REAUD-10 | Medium   | Chain execution recovery  | Broadcast-before-hash crashes can strand a mined payment               |
| REAUD-11 | Medium   | Assurance event delivery  | Reclaimed delivery leases have no fencing generation                   |
| REAUD-12 | Medium   | Webhook SSRF              | Local-use NAT64 addresses pass the global-address filter               |
| REAUD-13 | Medium   | Keeper scalability        | In-memory historical scans can starve new rounds after restarts        |
| REAUD-14 | Medium   | Browser verification gate | Two of six documented E2E checks fail on current UI/baselines          |
| REAUD-15 | Low      | Local database tooling    | A restarted container can be reported ready before its database exists |

## Detailed findings

### REAUD-01 — High — A missing v4 tuple field shifts the keeper's round state and cursors

**Evidence.** `TokenlessPanel.Round` places `compensatedRevealCount` between `revealCount` and `frozenRevealCount` in
`packages/foundry/contracts/tokenless/TokenlessPanel.sol:92-130`. The regenerated canonical ABI includes the field at
`packages/contracts/src/tokenless/abis/TokenlessPanelAbi.ts:964-988`.

The handwritten keeper ABI omits it at `packages/keeper/src/tokenless-abi.ts:13`, as does the keeper type at
`packages/keeper/src/tokenless-types.ts:21-58`. Ponder duplicates the same stale tuple at
`packages/ponder/src/tokenlessAbi.ts:3-41`. A viem reproduction encoded this canonical tail:

```text
commit=4 reveal=3 compensated=4 frozen=3 aggregate=2 score=1 up=2 state=4 scoring=1 stale=false
```

Decoding it through the keeper ABI produced:

```text
commit=4 reveal=3 frozen=4 aggregate=3 score=2 up=1 state=2 scoring=4 stale=true
```

`packages/keeper/src/keeper.ts:439-530` branches on the shifted state, scoring mode, stale flag, and cursors. Existing
tests miss the mismatch because `packages/keeper/src/__tests__/tokenless-keeper.test.ts:223-250` checks only older ABI
fields and mock clients return objects that are already decoded.

**Impact.** Against a fresh v4 deployment, the keeper can select the wrong lifecycle action, submit an invalid cursor,
suppress stale-return work, or stop advancing a round. The Ponder copy is a latent consistency hazard; current
post-creation reads happen to use pre-shift fields, while event handlers repair most later fields.

**Recommended fix.** Import the canonical generated ABI rather than maintaining full tuples by hand. Until that is
possible, update both tuple copies and the keeper type. Add an exact component-sequence assertion, a
canonical-encode/local-decode test for every manual ABI consumer, and an Anvil keeper lifecycle test.

### REAUD-02 — High — An accepted late reveal receives no base payment after timely quorum

**Evidence.** `reveal` accepts valid openings through `beaconFailureDeadline`, marks the record revealed, increments
`compensatedRevealCount`, and emits `RevealAccepted` at
`packages/foundry/contracts/tokenless/TokenlessPanel.sol:370-411`. A reveal after `revealDeadline` is correctly omitted
from `_roundRevealKeys` and the scored `revealCount`.

When timely reveals already satisfy quorum, settlement uses the scored path. `processScores` assigns payout only to
entries in `_roundRevealKeys` at `TokenlessPanel.sol:498-548`. The late record can call `claim` at `:567-580`, but its
`finalizedPayout` is zero and the call marks it claimed. `claimCompensation` at `:582-615` rejects the record because a
healthy round is `Finalized`, not a compensation terminal.

The reproduced schedule was four commits, a minimum quorum of three, three timely reveals, then one valid reveal after
`revealDeadline` but before `beaconFailureDeadline`. After successful settlement, the fourth record was
`revealed=true` with `finalizedPayout=0`; normal claim returned zero and compensation was unavailable.

**Impact.** The contract accepts work under a path that promises compensation and then pays nothing. This contradicts
the accepted-work guarantee in `docs/tokenless-immutable-implementation-plan-2026-07.md:193-203` and can cause a rater
to spend effort and gas on an unpaid terminal path.

**Recommended fix.** Either reject late reveals once timely quorum is fixed, or reserve and allocate their fixed base
payment during healthy settlement without adding them to quorum or RBTS scoring. Add the mixed three-timely/one-late
regression to the invariant suite.

### REAUD-03 — High — Autonomous x402 signing trusts server-supplied deployment addresses

**Evidence.** The unattended `run` path loads the encrypted signing key and performs quote, ask, payment, wait, and
result without a person at `packages/agents/src/cli.ts:171-205` and `packages/agents/src/tokenlessRun.ts:36-105`.
After receiving payment instructions, it checks only that `funderAddress` equals the local wallet at
`tokenlessRun.ts:51-55`, then signs both typed-data envelopes at `:56-77`.

The SDK already defines the required local pin as `TokenlessDeploymentIdentity` in
`packages/sdk/src/tokenlessTypes.ts:382-388` and can compare deployment key, chain, panel, submitter, and USDC at
`packages/sdk/src/tokenlessPayment.ts:187-250`. The builders used by the autonomous path call validation without that
identity at `tokenlessPayment.ts:254-257,290-305,386-397`, and the agent configuration contains no deployment fields.

A dynamic reproduction supplied real Base Sepolia USDC with an arbitrary deployment key, attacker submitter, and
attacker panel. The builder accepted the instructions and produced an EIP-3009 message sending `1,000,000` atomic
units to the attacker submitter, plus a round authorization for the attacker panel.

**Impact.** A compromised, malicious, or incorrectly routed API can cause the unattended local key to authorize real
USDC to an arbitrary recipient. This violates the tokenless trust split that the operator cannot redirect user funds.
The flaw is latent until a current deployment and real-value autonomous wallet are enabled, so it is a release
blocker rather than evidence of current loss.

**Recommended fix.** Require a complete deployment identity in autonomous-run configuration and pass it through every
authorization builder. Refuse to sign until deployment key, chain, USDC, panel, and submitter match exactly. Also bind
the signed total and terms back to the accepted quote and local spend ceiling.

### REAUD-04 — High — Attached media is publicized without being shown to the approver

**Evidence.** The MCP handoff normalizes and retains media-capable questions at
`packages/nextjs/lib/mcp/handoff.ts:60-113,143-183`; its regression test explicitly preserves image media at
`packages/nextjs/lib/mcp/handoff.test.ts:103-123`. Browser validation preserves the normalized question at
`packages/nextjs/components/tokenless/TokenlessHandoffClient.tsx:89-142`.

The review screen at `TokenlessHandoffClient.tsx:617-719` renders the prompt and answer labels, but never renders
`request.question.media`. The owner is then asked at `:721-737` to confirm that the whole ask is public, synthetic, or
meaningfully redacted. Quote and ask submit the full request, including the invisible media. A reusable media renderer
already exists at `packages/nextjs/components/tokenless/answer/QuestionMedia.tsx:9-124`.

**Impact.** An agent can attach an image or YouTube context containing secrets, personal data, or materially different
content. The owner sees only the text, confirms a false privacy premise, and publicizes/funds the unseen attachment.

**Recommended fix.** Render every canonical media item, in order, inside the approval surface before the privacy
confirmation. Show fetch/preview failures as blocking errors rather than silently omitting context. Add browser tests
that assert image and YouTube visibility before quote and ask.

### REAUD-05 — High — Abandoned asks permanently exhaust shared surprise-bounty capacity

**Evidence.** `reserveSurpriseBountyCapacity` calculates each operation's maximum liability at
`packages/nextjs/lib/tokenless/surpriseBountyService.ts:120-143`. It sums every `reserved` liability for the entire
deployment at `:175-186`, rejects new capacity at `:187-193`, and inserts a persistent reservation at `:198-218`.

`packages/nextjs/drizzle/0037_tokenless_surprise_bounties.sql:1-40` has no expiry timestamp and no released, expired,
or cancelled state. Repository-wide search found no release path; the only ordinary state transition is finalization
after an on-chain round exists. `prepareChainPayment` creates the reservation while returning payment instructions at
`packages/nextjs/lib/tokenless/chain/payments.ts:314-347,420-433`, before wallet or x402 funding is submitted.

**Impact.** One entitled workspace can create repeated wallet or x402 asks, request instructions, and abandon them.
Each row permanently consumes the shared bonus-funder balance used for every workspace, eventually returning
`surprise_bonus_capacity_unavailable` to unrelated tenants. Only deleting the owning ask or workspace through the
foreign-key cascade releases the accounting liability.

**Recommended fix.** Give pre-chain reservations a bounded expiry and explicit release/cancel states. Reclaim them
when payment authorization expires, asks terminate, or operations are abandoned. Tie reservation refresh to a fenced
payment lease and test one tenant exhausting then releasing shared capacity.

### REAUD-06 — Medium — Late reveals poison scored tallies and finalized transparency evidence

**Evidence.** The contract emits the same `RevealAccepted` event for timely scored reveals and late compensation-only
reveals at `packages/foundry/contracts/tokenless/TokenlessPanel.sol:403-411`. Ponder unconditionally marks every event
revealed and increments `revealCount` and `upVotes` at `packages/ponder/src/TokenlessPanel.ts:147-177` through
`packages/ponder/src/status.ts:41-55`.

`SettlementBegun` later corrects `frozenRevealCount`, but not the indexed `revealCount`, `upVotes`, or the late commit's
scored projection. The transparency builder rejects a finalized round when the reveal total disagrees with the frozen
total at `packages/nextjs/lib/tokenless/transparency.ts:1060-1082`.

**Impact.** A committed rater can deliberately submit one valid late reveal and leave otherwise finalized public
evidence pending indefinitely. Ordinary keeper delay between the two deadlines can produce the same result.

**Recommended fix.** Emit whether a reveal is scoring-eligible, or classify it from the event block timestamp and the
stored reveal deadline. Retain late records for compensation evidence while excluding them from scored tallies. Add a
Ponder test with three timely reveals and one late reveal.

### REAUD-07 — Medium — Backslash normalization enables a post-sign-in open redirect

**Evidence.** `safeReturnPath` accepts any value that begins with `/` except `//` at
`packages/nextjs/components/auth/BetterAuthSignIn.tsx:37-40`. It does not reject backslashes. The decoded value for:

```text
/sign-in?returnTo=/%5Cevil.example
```

is `/\evil.example`, which passes the check. URL-standard resolution treats the backslash as a slash in a special URL:

```text
new URL('/\\evil.example', 'https://rateloop-tokenless.vercel.app/sign-in').href
=> 'https://evil.example/'
```

After session exchange, `window.location.assign` uses the accepted value at `BetterAuthSignIn.tsx:62-68`. The same
path is nested into social and SSO callbacks at `:111-115,131-135`.

**Impact.** An attacker can send a RateLoop-branded sign-in link that redirects the victim to an attacker domain after
successful authentication, enabling credible phishing. No RateLoop session secret is placed in the destination URL,
but the trusted login transition is abused.

**Recommended fix.** Parse the return target against the exact application origin and require that origin to match,
or accept only a strict path/query/fragment grammar with no backslash or control characters. Add encoded and mixed
slash/backslash regression cases.

### REAUD-08 — Medium — A committed setup advance with a lost response leaves retries stale

**Evidence.** `saveReviewConfigurationAndAdvance` adopts the new binding revision after the configuration PUT, but
reloads authoritative state only when the PUT itself failed or its response was lost at
`packages/nextjs/components/tokenless/agents/setup/reviewConfigurationSave.ts:24-44`.

The caller sends the closure's `setup.revision` to `configure-reviews` at
`packages/nextjs/components/tokenless/agents/setup/AgentSetupFlow.tsx:758-814`. The server validates that exact revision
and atomically increments it at `packages/nextjs/lib/tokenless/workspaceAgentSetup.ts:754-842`.

If `configure-reviews` commits but its response is lost, the browser retains the old setup revision. Retry saves yet
another binding version, then sends the same stale setup revision and receives a 409. The loop repeats. Existing helper
tests cover an advance failure before commit and a lost PUT response, but not a committed advance with a lost response.

**Impact.** A transient network failure at the second request can strand onboarding until the user performs a full
reload, despite the UI offering Retry and the server already having advanced to the next step.

**Recommended fix.** Treat every ambiguous advance failure as a reason to reload the full authoritative setup,
including its step and revision. If the server is already at or beyond `people`, adopt that state rather than re-saving
the review binding. Add the commit-then-response-loss schedule to the helper and component tests.

### REAUD-09 — Medium — A `result:read` API key can perform payment mutations

**Evidence.** Product scopes distinguish `payment:submit` from `result:read` at
`packages/nextjs/lib/tokenless/productCore.ts:28-36`. `authorizeAskAccess` checks same-workspace access and only
`result:read` at `productCore.ts:1553-1574`. Creator-key binding is enforced only for policy-bound keys.

Both GET and POST in `packages/nextjs/app/api/agent/v1/asks/[operationKey]/payment/route.ts:14-53` reuse that helper.
POST can confirm a wallet transaction, attach x402 authorization, or execute a server-funded prepaid payment. An
unbound workspace API key may be created with only `result:read` and no policy ID.

**Impact.** A results-only credential can trigger another member or integration's prepared prepaid spend and create an
irreversible on-chain round without the explicit spending scope. This weakens least privilege and makes credential
separation misleading.

**Recommended fix.** Split read and mutation authorization. Require `payment:submit` plus creator/policy authority on
POST; keep `result:read` for non-mutating status reads only. Add a route test using an unbound results-only key against
another key's prepared ask.

### REAUD-10 — Medium — Broadcast-before-hash crashes can strand a mined payment

**Evidence.** The execution claim lease prevents concurrent workers, but the transaction nonce is persisted before
broadcast at `packages/nextjs/lib/tokenless/chain/payments.ts:713-769`. Approval, submission, and prepaid transaction
hashes are stored only after `sendTransaction` returns at `:919-942,955-971,1005-1025`.

If the process crashes after the RPC node accepts or mines a transaction but before the hash update commits, the
database retains a nonce with no transaction hash. After lease expiry, recovery reuses the same nonce. If the first
transaction mined, the retry receives nonce-too-low and has no persisted hash to reconcile.

**Impact.** The fixed lease prevents the prior double-fund race, but this crash window can permanently leave an
approval or funded round on-chain while the database payment and ask remain unconfirmed. This is a liveness and
reconciliation failure, not a demonstrated duplicate-spend path.

**Recommended fix.** Sign first, persist the raw signed transaction and derived hash under the fencing token, then
broadcast or rebroadcast those exact bytes. Reconcile the persisted hash and nonce before constructing any replacement.
Add a crash injection immediately after RPC acceptance.

### REAUD-11 — Medium — Reclaimed assurance delivery leases have no fencing generation

**Evidence.** Assurance CloudEvent delivery claims and reclaims rows at
`packages/nextjs/lib/tokenless/assuranceEventStreaming.ts:816-842` without a lease generation or unique claim token.
Success and failure updates at `:870-897` match only `delivery_id` and `state='delivering'` and ignore whether the
worker still owns the current lease. Migration `0073` stores lease expiry but no fencing field.

Reproduced schedule: worker A claims and pauses past the 60-second lease; B reclaims and sends; A resumes with failure
and changes the row to retry; B's successful completion update matches zero rows but is still reported delivered; the
next maintenance run sends a third copy.

**Impact.** Slow or partitioned workers can overwrite newer delivery state and generate duplicate customer webhook
events. This is separate from the result-webhook queue fixed by migration `0104`.

**Recommended fix.** Add a monotonically increasing lease generation, include it in every completion/failure update,
and require one updated row before reporting an outcome. Mirror the `0104_webhook_delivery_lease_fencing` pattern and
add a two-worker stale-completion test.

### REAUD-12 — Medium — Local-use NAT64 addresses pass the global-address filter

**Evidence.** The webhook classifier at `packages/nextjs/lib/tokenless/transparency.ts:459-493` rejects the well-known
NAT64 prefix `64:ff9b::/96` but omits the local-use prefix `64:ff9b:1::/48`. URL validation and the pinned delivery
resolver at `:507-559` both accepted:

```text
https://[64:ff9b:1::a9fe:a9fe]/hook
```

The embedded IPv4 address is `169.254.169.254`. The
[IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)
marks `64:ff9b:1::/48` as not globally reachable.

**Impact.** In a runtime network that routes RFC 8215 local-use NAT64, a tenant can reach link-local or internal IPv4
destinations despite the global-address policy. Exploitability is environment-dependent, but the validator's stated
boundary is incomplete.

**Recommended fix.** Reject the complete IANA special-purpose registry rather than maintaining an ad hoc subset. Test
both NAT64 prefixes, IPv4-embedded variants, and every non-global category; keep the egress firewall as defense in
depth.

### REAUD-13 — Medium — In-memory historical scans can starve new rounds after restarts

**Evidence.** Keeper cursors are process-memory globals initialized to round and pool ID 1 at
`packages/keeper/src/keeper.ts:62-69`. Each tick visits at most the configured count, 100 by default, at
`keeper.ts:545-555` and `packages/keeper/src/config.ts:224-229`. Historical terminal rounds remain in the scan, and
round work repeatedly queries `CommitAccepted` logs from the deployment block to latest at `keeper.ts:242-255,296-310`.

At the default 15-second interval, 10,000 rounds require roughly 25 minutes for one sweep and 100,000 require roughly
4.17 hours. Every restart begins at 1 again.

**Impact.** Repeated deploys, crashes, or autoscaling restarts can prevent the keeper from reaching new active rounds
before reveal or claim deadlines. RPC cost also grows with both total rounds and full-chain log history.

**Recommended fix.** Persist the cursor or, preferably, index lifecycle events into a due-work queue and exclude
terminal/stale-returned rounds. Query logs incrementally by saved block/cursor. Add restart tests with active work near
the high end of a large historical ID range.

### REAUD-14 — Medium — Two of six documented E2E checks fail on current UI and baselines

**Evidence.** The production-readiness register names `yarn workspace @rateloop/nextjs e2e` as the deterministic
browser gate. Against a freshly migrated `rateloop_e2e` database, fixture preparation succeeded and four journeys
passed, but two failed:

```text
workspace owner configures human review:
  locator.selectOption timed out waiting for getByLabel('Frequency')

landing and signed-out hubs retain their visual hierarchy:
  expected 1280x4730, received 1280x4842; 3% of pixels differ
```

The current form labels the control `When should RateLoop require human review?` and uses `Every output`, as shown by
the failure snapshot, while `packages/nextjs/e2e/tests/primary-journeys.spec.ts:24-36` still selects `Frequency` with
value `always`. The landing baseline asserted at `packages/nextjs/e2e/tests/visual-regression.spec.ts:26-39` no longer
matches the current page height and content.

**Impact.** The fixture defect from AUD-05 is fixed, but the named release gate remains red and spends 270 seconds on
a locator that cannot appear. Current owner-configuration and visual-regression evidence therefore cannot be accepted.

**Recommended fix.** Update the journey to use the current accessible label and option text/value, verify the saved
semantic state, and review the visual diff before deliberately refreshing the baseline. Add a shorter assertion that
the expected configuration control exists so vocabulary drift fails immediately.

### REAUD-15 — Low — A restarted container can be reported ready before its database exists

**Evidence.** The local helper creates a requested database when PostgreSQL is already reachable at
`scripts/dev-db.mjs:263-303`. When it must start the Compose service, however, it waits with `pg_isready -d <name>` at
`:437-451` and then reports success at `:486-516`. `pg_isready` reports server readiness even when the named database
does not exist.

The Compose service retains a named data volume at `docker-compose.dev.yml:10-19`; changing `DATABASE_URL` while the
container is stopped does not rerun `POSTGRES_DB` initialization. This audit reproduced:

```text
[dev-db] Local Postgres is ready at .../rateloop_e2e.
error: database "rateloop_e2e" does not exist
```

Running `yarn dev:db` a second time reached the existing-server branch, created the database, and unblocked E2E.

**Impact.** Developers and CI-like local runs receive a false readiness signal when reusing a volume under a new
database name, producing a confusing downstream failure.

**Recommended fix.** After Compose becomes reachable, run the same `SELECT 1`/create-database path used for an existing
server. Add a test or integration fixture for a retained volume with a new database name.

## Prior-audit closure matrix

| Prior ID | Status  | Re-audit result                                                                                 |
| -------- | ------- | ----------------------------------------------------------------------------------------------- |
| AUD-01   | Closed  | Browser validation preserves the full public-data contract and rejects stripped/mismatched data |
| AUD-02   | Closed  | Execution claim lease and fencing prevent the demonstrated two-request double-fund schedule     |
| AUD-03   | Closed  | Late reveals no longer enter the scored on-chain set; see new REAUD-02 and REAUD-06             |
| AUD-04   | Closed  | The URL-backed parent workspace is authoritative across settings requests                       |
| AUD-05   | Closed  | The E2E fixture satisfies the current request-profile contract; see separate REAUD-14           |
| AUD-06   | Closed  | x402 compares balance deltas and tolerates unsolicited dust                                     |
| AUD-07   | Closed  | Feedback pool identity is bound to the authorized requester/payer                               |
| AUD-08   | Closed  | Round, beacon, claim, and feedback horizons are contract-bounded                                |
| AUD-09   | Partial | DNS is pinned and most non-global ranges fail; local-use NAT64 remains open in REAUD-12         |
| AUD-10   | Closed  | Deployment export records and validates the earliest deployed block                             |
| AUD-11   | Closed  | Result-webhook leases recover and are generation-fenced; assurance events have REAUD-11         |
| AUD-12   | Closed  | Keeper treats reverted receipts as failures                                                     |
| AUD-13   | Closed  | The outer artifact lock now covers the E2E consumer lifetime                                    |
| AUD-14   | Partial | Lost PUT and ordinary advance failures recover; committed-advance response loss is REAUD-08     |
| AUD-15   | Closed  | Fragment-backed handoffs survive sign-in through the separate-tab flow                          |
| AUD-16   | Closed  | CLI resume no longer loads or decrypts the signing keystore                                     |
| AUD-17   | Closed  | Feedback Bonus is included in the duplicated deployment-size gate                               |
| AUD-18   | Closed  | Migration references follow the authoritative journal through `0104`                            |

## Verification performed

| Check                 | Result                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `yarn test:packages`  | Passed: 1,421 tests across contracts ABI, node utilities, SDK, agents, keeper, Ponder, promo, and Next.js |
| `yarn foundry:test`   | Passed: 61 tests, including fuzz and custody invariants                                                   |
| Slither               | Scanned 31 contracts with 101 detectors; no additional actionable fund-core issue survived manual triage  |
| `yarn test:node`      | Passed: 56 repository and Foundry tooling tests                                                           |
| `yarn lint`           | Passed with 0 errors and 11 Prettier warnings in recently changed files                                   |
| `yarn next:build`     | Passed on Next.js 15.5.18                                                                                 |
| Playwright E2E        | Fixture preparation passed; 4 journeys passed and 2 failed as REAUD-14                                    |
| `yarn dead-code:scan` | Reported 6 unused files, 1 unused dependency, 1 unused dev dependency, and a large unused-export backlog  |
| `yarn security:audit` | No production or development audit suggestions                                                            |
| GitHub security APIs  | 0 open Dependabot, code-scanning, or secret-scanning alerts                                               |
| `git diff --check`    | Passed before this report was added                                                                       |

Manual review covered the current contract core, deployment exporters and generated ABIs, keeper, Ponder, chain
execution, auth and OAuth redirects, API-key scope enforcement, MCP/browser handoffs, workspace setup, notification and
assurance delivery, SSRF controls, migrations through `0104`, SDK/CLI flows, and readiness documentation.

## Dependency and platform research

- The repository resolves Next.js `15.5.18`. That is the patched version for the May 2026 App Router middleware bypass
  follow-up ([GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6)).
- The pinned keeper and Ponder image digest was executed and reported Node.js `v24.18.0`, newer than the June security
  release `v24.17.0` ([Node.js 24.17.0 release](https://nodejs.org/en/blog/release/v24.17.0)).
- The local audit host was Node.js `v24.14.0`, which predates that security release. Upgrade developer runtimes and any
  cached self-hosted runner images to at least `24.17.0`; this is an environment action, not counted as a repository
  finding because the shipped Docker digest is `24.18.0` and GitHub workflows request the current Node 24 line.
- Yarn's production and development audits and all three queried GitHub alert queues were empty on 18 July 2026. An
  empty advisory feed does not cover application authorization, protocol economics, handwritten ABI drift, or logic
  races, which account for the substantive findings above.

## Verified release blockers outside the finding count

1. **No current v4 deployment bundle exists.** The checked-in Base Sepolia artifacts stop at tokenless v3, while
   application configuration expects `rateloop-tokenless-deployment-v4`. The fund-core changes after those deployments
   require a complete fresh deployment and atomic service update.
2. **The network integrity-epoch producer is not wired.** `buildIntegrityEpoch` and
   `persistIntegrityEpochSnapshot` exist at `packages/nextjs/lib/tokenless/integrityEpochs.ts:455-582` and
   `integrityEpochPersistence.ts:10-89`, but have no non-test caller. Network policies require a frozen epoch at
   `packages/sdk/src/humanAssuranceSchema.ts:383-458`, and assignment rejects a missing/expired epoch at
   `packages/nextjs/lib/tokenless/audienceAssignments.ts:797-812`. The readiness register already describes these
   epochs as prospective, so this is recorded as an incomplete release capability rather than a newly introduced bug.
3. **Real-money and external operational gates remain open.** Contract/privacy review, live eligibility providers,
   KMS and witness exercises, reconciliation, alerting, legal/tax controls, and deployment-pinned end-to-end evidence
   remain governed by `docs/tokenless-production-readiness-2026-07.md`.

## Recommended remediation order

1. Restore the accepted-work invariant and exact contract/keeper/indexer ABI agreement (REAUD-01, REAUD-02, REAUD-06).
2. Prevent autonomous custody redirection and invisible-media approval (REAUD-03, REAUD-04).
3. Add expiring shared bonus reservations and correct payment mutation scope enforcement (REAUD-05, REAUD-09).
4. Close crash/reclaim races and the residual NAT64 SSRF case (REAUD-10, REAUD-11, REAUD-12).
5. Fix authentication/setup recovery and keeper scheduling (REAUD-07, REAUD-08, REAUD-13).
6. Restore the browser gate and local database reliability (REAUD-14, REAUD-15), then rerun the complete verification
   matrix before a fresh v4 deployment.
