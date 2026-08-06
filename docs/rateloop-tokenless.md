# RateLoop tokenless — what the system is

Written 29 July 2026 against branch `tokenless`. Every claim here was checked
against the code rather than against earlier documents, several of which had drifted.
Where a document and the code disagreed, the code won and the disagreement is
recorded at the end.

---

## 1. In one paragraph

RateLoop is a **human-review gate for AI agent output**. Before an agent publishes
or acts on something, it asks RateLoop whether that output needs a human look. If
it does, RateLoop routes it to reviewers, collects their verdicts, and returns a
signed evidence packet recording who reviewed what, when, and what they decided.
The product exists because a growing set of obligations — and a larger set of
commercial anxieties — require that a person, not only a model, stood behind a
decision.

---

## 2. The flow, end to end

**1. The agent connects.** Via MCP OAuth device flow or a workspace API key. Nine
hosts are in the registry.

**2. The agent declares a completed run.** MCP tool
`rateloop_evaluate_review_requirement`, or `POST /api/agent/v1/assurance/review`.
It sends **commitments only** — a hash of the output, a source-evidence reference,
a workflow key, a risk tier, and an execution manifest. Payload text is forbidden
at this step.

In one transaction the server derives a scope identity, records the execution,
runs the sampling decision, and writes a review opportunity with a decision of
`required`, `recommended` or `skip`.

**3. Routing.** If review is required and the workspace granted automatic asking,
the agent calls `rateloop_request_review` with the real payloads. The server
verifies they hash to the commitments it already holds, then forks by lane.

**4. Review.** Reviewers work at `/human/review`. An assignment moves
`reserved → accepted → completed`, or expires or is released.

**5. Verdict.** `rateloop_wait_for_review`, then `rateloop_get_review_result`.
Neither is read-only: both finalise reviews whose deadline has passed and write the
immutable observation. Terminal statuses are `publishable`, `inconclusive`,
`delisted`, and three settlement-specific outcomes.

**6. Evidence.** A signed packet, and once published it is immutable — republishing
with a different evidence root returns 409.

---

## 3. Two lanes, and only one is live

### Invited unpaid — the lane that actually runs

Entirely off-chain. No quote, no payment, no chain execution, no voucher.

The workspace owner invites named reviewers by email. Artifacts are AES-256-GCM
encrypted in private storage and handed out under short-lived leases — a 15-minute
reservation and a 10-minute artifact lease. Responses are a binary choice plus a
rationale, whose mode is `off`, `optional` or `required` — and the shipped default in
both the setup path and the editor is **required**.

**The workspace can read plaintext rationales and per-response choices in this
lane**, because it owns the material. This is the lane the hosted end-to-end test
exercises: a three-account, two-reviewer private journey.

### Paid network — Base Sepolia exercise only, gated off

Accepts only public, synthetic or owner-confirmed redacted content under a short-lived
operator authorization for exact preselected opportunities, exact permitted reviewer
countries and the complete Base Sepolia deployment. It has no task browser or
self-selection and cannot authorize mainnet or real-money release. Funding escrows test USDC in the
fund contract. Reviewers must clear identity, residence, tax declaration, sanctions
and wallet screening **before their first voucher**. A reviewer then generates an
ephemeral vote key, payout key and salt **in their own browser**, timelock-encrypts
their verdict, and commits it on chain. A keeper decrypts at the appointed time,
reveals, scores and settles.

The workspace sees **aggregates only** — the per-response view refuses to open for
network runs.

Activation expiry or deactivation blocks reserved but unaccepted seats. Work already
accepted or committed retains its settlement, compensation and claim path. A later live
network would require a separate design decision and append-only result evidence from the
testnet exercise; no such live path exists.

Two further lanes exist in code: invited-paid, and a hybrid of both. Hybrid is
hardcoded off and its adapter is unreachable.

---

## 4. The pieces

| Package                                    | Deployed                  | Does                                                                                                              |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `nextjs`                                   | Vercel, `fra1`            | Everything user-facing: agent API, two MCP servers, browser app, database, evidence signing, eligibility, privacy |
| `keeper`                                   | Railway                   | Permissionless chain driver on a 15-second tick; decrypts timelock ciphertexts and drives settlement              |
| `ponder`                                   | Railway                   | Chain indexer; serves settlements, rounds and keeper work                                                         |
| `foundry`                                  | artifacts on Base Sepolia | Solidity source and deploy scripts                                                                                |
| `contracts`, `sdk`, `agents`, `node-utils` | npm libraries             | ABIs, the client and schemas, framework adapters, keystore loading                                                |

The SDK is consumed both server-side and in the browser, which makes it the shared
contract rather than a convenience wrapper.

Automatic deployment is **off** for this branch. A cron runs maintenance every five
minutes.

---

## 5. The mechanism

### Adaptive review coverage

Four stages: `calibrating` at 100%, `high_coverage` at 50%, `medium_coverage` at
25%, and `monitoring` at 10%. The effective rate is always the greater of the stage
rate and the workspace's production floor.

The 10% monitoring floor is defined once and shared by runtime sampling, policy
management, owner UI, overview and registry projections, evaluation reporting, and
coverage-floor alerts. Reaching `monitoring` can therefore reduce baseline coverage
from 25% to 10%; every 100 comparable monitoring cases starts a full-review
recalibration block.

Promotion is one step at a time, but only the first promotion requires two
consecutive passing windows. `high_coverage → medium_coverage` and
`medium_coverage → monitoring` each need one passing window plus a case-count
threshold. **Demotion always goes straight back to `calibrating`**, never one step.

A window is the 30 most recent comparable observations, split in half. It passes
only if all of a set of conditions hold, including a Wilson lower bound at or above the
agreement threshold, at least two responding humans per case, latency within
policy, and no open severe disagreement on a critical-risk case.

Everything is **case-count based**. There are no wall-clock windows anywhere in the
stage machine.

**Sampling is deterministic, not random.** The bucket is an HMAC over the scope and
opportunity identity, and the full digest is stored so the draw can be verified
afterwards. A missing sampler key fails the request closed rather than falling back
to chance.

**A scope is keyed on twelve dimensions**, not the five an older document claimed:
agent version, policy id and version, review binding id and version, request
profile id, version and hash, workflow key, risk tier, audience policy hash, and
execution profile hash. Only the stage is a closed enum; workflow key and risk tier
are free-form, so a provider silently returning a date-stamped model name forks a
new scope with no user action. **Nothing enforces that the three places defining
this tuple stay in sync.**

### RBTS scoring

Robust Bayesian Truth Serum. The Solidity library is normative; a server-side
verifier recomputes it and rejects the evidence bundle on any mismatch, and a
second Solidity implementation, kept in the test suite, acts as an independent
oracle for the sort and selection steps.

**What it is used for: payout weighting, and nothing else.** Eighty per cent of a
seat's pay is unconditional; RBTS weights only the top twenty. It is not used for
reviewer reputation, eligibility, verdict weighting, or stage transitions. In the
app it appears only as an observability statistic.

Peer and reference selection is a canonical permutation seeded by chain id, panel
address, round id, the frozen reveal set, and verified beacon entropy. It needs at
least three distinct commits.

### Commit–reveal with timelock encryption

What goes on chain: a vote-key, a sealed commitment, a payout commitment, and the
**raw timelock ciphertext**, which is emitted in an event.

Encryption targets a future drand round on the `quicknet-t` testnet chain. The
parameters are pinned in **at least seven places that must agree** — the panel contract, the
beacon verifier, the keeper, and the browser.

There are two distinct beacon rounds. The **scoring** round is verified on chain.
The **disclosure** round is validated when the round is created and then never read
again — the chain cannot check which round a ciphertext actually unlocks at,
because that lives in the ciphertext's own header. **That check exists in exactly
one place, off-chain, in the relayer.** It is a real single point of enforcement
and deserves to be named as such.

The keeper reveals on everyone's behalf, permissionlessly, re-deriving both
commitments and rejecting mismatches. **The contract never decrypts anything** — it
only checks hash preimages. Reviewers can self-reveal from locally held secrets as
a fallback.

Beacon proofs are verified on chain with real BLS pairing operations. Both the
contract and the vendored library label that implementation **experimental and
unaudited**. If a proof is invalid or unavailable, the only alternative path takes
no entropy at all, zeroes every score, and pays each revealer the unconditional
portion.

### The fund core

No owner, no proxy, no initializer, no pause, no sweep, no upgrade path.

**Exactly one access-controlled function exists**: cancelling an empty round, which
only the funder may call and only while no commit has been accepted. Since the
commit count only ever increases, **a single commit permanently closes the funder's
exit**. The no-cancellation-after-commit rule is structural, not a policy.

Value only leaves through a claim to an address fixed by an on-chain preimage, or a
withdrawal of the caller's own credit. Settlement accrues pull credit rather than
pushing transfers. Solvency is checked when a round is created, so the refund
arithmetic cannot underflow.

The credential issuer **signs nothing** — it verifies against a digest the panel
builds, and it holds no token reference at all.

**The current disposable Base Sepolia artifact was released at block `45115708`.** Its
complete v4 deployment key is the only supported identity for the web, keeper, and
indexer; hosted components fail closed on an older or mixed bundle.
The currency remains an unrestricted mock token; this is not a real-value deployment.

### Evidence packets

A run manifest hash, Merkle roots over cases and responses, per-case judgment
counts, reviewer-source counts (counts only, never identifiers), quality
statistics, stated limitations, chain references, and the customer's own decision.

Signed with Ed25519 from a server-only key whose identifier must equal its own
public-key fingerprint or signing fails closed. Workspace identity appears only as
a keyed commitment.

Decision-packet attestations always require the distinct managed Ed25519 signer,
its purpose-bound published verification key, and the pinned Rekor trust anchor.
Hosted readiness rejects an absent or invalid core witness configuration, and due
work reports broken health instead of succeeding silently. RFC 3161 timestamping
remains an additional all-or-none requirement for audit and coverage export heads;
it is not enabled on the Base Sepolia review deployment until a qualified provider
and trust chain are approved.

---

## 6. What is live, and what is not

### The branch bypass, which contextualises everything else

Tokenless and main are separate deployment lines. The tokenless readiness path permits a
network-off hosted application only when the ordinary network capability remains disabled;
it does not waive the active address-bundle invariant. Every hosted release requires one
complete deployment key shared by the app, Ponder and keeper. The chain registry publishes
the released v4 test bundle beginning at block `45115708`; every hosted component must fail
closed on an older or mixed bundle.

The hosted release capability map is a frozen all-false set, and nothing in the
repository ever passes a different one, so a `main` hosted release is currently
structurally impossible.

### Working

Invited unpaid review end to end; the adaptive ladder and deterministic sampling;
Better Auth with email OTP and passkeys; opaque principals and hashed sessions;
self-custodial wallet binding; evidence packet generation and signing; per-run
agent attribution; trace ingest and the audit, OSCAL and subject-access exports.
The keeper and indexer have no feature flags at all and fail closed on every
dependency.

### Implemented, disabled by configuration

Both paid lanes; World ID assurance — note that it **cannot be enabled without also
enabling paid public panels**; Stripe subscriptions and prepaid top-ups; enterprise
SSO and SCIM; document-verification adapters; wallet screening; tax declaration.

Paid-lane activation is not a flag but a **five-way evidence lock**: a published
reference must equal the hash of a canonical record covering the privacy assessment,
the transfer inventory, funding validation, an adulthood reference, a timestamp, the
flag pairs and the assurance values. Any drift turns the lanes off, and every
fund-touching call site re-validates independently — the public projection only
hides the interface.

### Partial, or silently absent

Hybrid review is hardcoded off and unreachable. Surprisingly Popular is implemented as a
network-round mechanic, but ordinary customer and agent configuration cannot reach it:
the governed experiment and public-network controls are both default-off, and an exact
closed-benchmark activation does not grant unrelated method or opportunity authority.

Several subsystems fail _quietly_ rather than loudly when unconfigured: the
integrity-epoch producer returns a disabled result that no health signal names;
the integrity-epoch producer returns a disabled result; the top-up reconciler
returns zeroes. Separately, the maintenance runner catches every processor error
into a failures array and returns a zero-valued fallback, so any of roughly twenty
processors can be permanently broken while the endpoint returns 200. It is
observable in the run summary — but only if someone reads it.

**No host holds the "verified" tier.** Two are supported, seven experimental, zero
verified. The type system permits the tier and merely couples it to evidence fields;
what holds the count at zero is a runtime test assertion. This matters because
the verified tier is what several documents point at as the answer to enforcing
withheld delivery.

### An honesty mechanism worth knowing about

There is a machine-enforced claim gate. A capability map hardcodes fourteen of
seventeen capabilities to false, and a regex matrix blocks matching phrases across
every public page and doc, enforced by a test. Five claims are permanently
forbidden, including "compliance-ready" and "guarantees compliance".

Because of it the **in-app public docs are honest** about the hosted path being
invited and unpaid. The root README is outside the gate's scan and is not: it
advertises USDC payment, proof-of-human admission and incentive mechanisms with no
availability caveat, and cites a deployment a full generation out of date.

Relatedly, agent execution evidence is typed such that `independentlyVerified` can
only ever be false, and the parser rejects any other value. There is no code path
that can mark an execution as independently verified. That is a deliberate,
correctly enforced boundary, not a gap.

---

## 7. Trust and privacy

**Identity is an opaque principal**, deliberately not derived from a wallet.
Authentication is a separate concern mapped through identity bindings. The session
token is stored only as a hash.

**Wallets are purpose-bound adapters** for funding, payout or recovery. The purpose
is baked into the signed challenge, which ends with a line stating the proof does
not authorise account access. Wallet sign-in endpoints return 410 Gone, and a
principal with no wallet can own a workspace.

**Reviewer pseudonymity is per-run.** The pseudonym is an HMAC over the run id and
the account, so the same reviewer appears under a different pseudonym in every run
— there is no cross-run correlation available to the workspace.

**But the two lanes differ far more in disclosure than in identifier, and this is
the most commonly misread part of the model.** In the invited lane the roster is
fully identified: an owner or admin sees principal id, display name and verified
email, and rationales are decrypted for them. Pseudonymity there protects _which
response came from whom_, not _who is on the panel_. In the network lane the
per-response view refuses to open at all.

Is a reviewer's account linked to their vote key and payout address? **Yes — in
RateLoop's own database, and only there.** On chain, the nullifier is per-content
and per-round and does not correlate a reviewer across rounds. This is not
cross-round unlinkability, and the design documents say so.

**Permanent and public** at reveal: the vote, the prediction, the response hash, the
payout address, every amount and every score. **Private**: rationale text, rater
profiles, keyrings, eligibility evidence, artifact keys, audit chains.

**Operator power is split across four separately credentialed surfaces** — a
pipeline token for moderation, a compliance secret for sanctions and appeals, an
expertise operator allowlist (which returns 404 rather than 403 to non-operators),
and five distinct signer roles. None grants authority over another.

The operator cannot erase the chain, rewrite the hash-chained audit log, or put
secrets in audit metadata. **Legal holds are customer-controlled, not
operator-controlled.** What the operator inherently _can_ do, holding the keyrings,
is resolve pseudonyms and decrypt rationales and artifacts. Nothing in code
prevents that; the controls are keyring separation, audit chaining and release
gates. The privacy notice says as much — platform secrets are not a
customer-held-key boundary.

---

## 8. Scale and limits

Two plans. Free allows one active agent and one invited reviewer group. Early
Access allows three agents and five groups, at $29/month against a $99 list price.
The primary hosted invited-review path does not expose a universal completed-decision
allowance. Internal decision caps remain safety boundaries for the explicit assurance
APIs that enforce them; they are not a customer-facing quota until every hosted path
shares the same enforcement.

On-chain caps include 500 commits per round and a 20% fee ceiling. The MCP surface
is limited to 60 requests per minute per client identity, and fails closed without
a sufficiently long secret.

**Unbounded and worth capping:** roughly 200 SQL statements order without limiting. The
subject-access export is roughly thirty consecutive unbounded selects. Evidence
packet generation loads an entire run — every case, every response, every override
— with no database-level cap. There is no cap on workspace members, API keys,
cohort size, or assignments per run.

Migrations are hand-authored, hash-verified at deploy, and applied under an
advisory lock; generation and push are both hard-disabled. The checked-in journal is the
only head of record; readiness and migration tests validate its current ordered entries
and hashes instead of relying on a hard-coded historical head.

---

## 9. Where earlier documents were wrong

Recorded so the same drift is not reintroduced.

| Claim                                          | Reality                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A scope has five dimensions                    | Twelve in the database constraint, fourteen in the identity hash                                           |
| Monitoring floor is 10%                        | Shared runtime, UI, projection, and alert invariant                                                        |
| Adaptive reports safety gates unavailable      | That branch is unreachable; gates are available                                                            |
| Opportunity keyed on integration id            | Keyed on agent id                                                                                          |
| Deployment is `tokenless-v3` at an older block | The released `tokenless-v4` bundle begins at block `45115708`; every hosted consumer must match its complete key |
| README advertises paid mechanisms plainly      | All of them are gated off                                                                                  |
| Adaptive coverage pinned at 100%               | The ladder shipped                                                                                         |
| An agents `handoff` CLI command exists         | It does not; the real path is a media upload followed by an MCP tool call                                  |
| Schema table counts are stable documentation   | They are intentionally partial and must be derived from the current migration journal                      |

**Left deliberately unresolved**, because they are decisions rather than facts:
whether the adaptive ladder shipped ahead of its safety gate or the register is
merely stale; whether the single off-chain disclosure-round check is an accepted
boundary or an open gap.
