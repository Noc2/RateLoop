# Tokenless design review — 18 July 2026

**Status:** Point-in-time independent design review of the `tokenless` branch at commit `40839eb52`. Produced by a
multi-agent review (six parallel dimensions: fund core, trust/privacy, services/ops, application/auth, agent
integration, incentive mechanism), an adversarial verification pass, and external literature/market research. This
document records findings and ideas; it is not a release gate and does not change the
[production-readiness register](tokenless-production-readiness-2026-07.md), which remains the only release checklist.
The [implementation plan](tokenless-immutable-implementation-plan-2026-07.md) remains the design of record.

Verification status: the findings marked **[code-verified]** were re-checked directly against source during synthesis.
The remainder are single-reviewer findings whose cited evidence was spot-checked but not independently re-derived; treat
severities as provisional until triaged.

## Overall assessment

The tokenless design is unusually coherent for its ambition. Its central claim — an immutable, adminless fund core
whose custody and settlement behavior can be independently recomputed, surrounded by explicitly disclosed operator
authority over admission, moderation, and eligibility — is actually true of the deployed code, not just the prose. The
review found no path by which the operator, credential issuer, keeper, or any signer can take customer funds, redirect
an accepted claim, or alter settled pay, and the discipline connecting docs to code (claims-match-code tests, candid
readiness register, published attack benchmark, self-critical enterprise analysis and MCP compatibility review) is
stronger than most production systems ever reach.

The weaknesses cluster in three places. First, the **incentive layer's stated defenses do not exist yet**: the adaptive
coverage ladder's drift and severe-disagreement gates are hardcoded to pass, gold is disabled in the paid public lane,
and "correlation analytics" is a per-round mismatch ratio — so the known lazy/collusive equilibrium of the RBTS bonus
currently meets no implemented counter-pressure precisely where the product's value (calibrated reduced review) is
created. Second, several **customer-facing claims are stronger than the shipped system** — most seriously the
vote-key-to-payout linkage timing (exposure at commit-deadline tlock maturity, not at claim) and the deletion story
(World ID bindings survive deletion outside any receipt category). For a product whose brand is exact-claims
discipline, these are the highest-priority fixes. Third, **operational liveness leans on a single unincentivized
keeper** with an O(all-rounds) scan that collides with the 256-block entropy window, and an indexer tally that can
permanently block evidence publication for rounds with late reveals.

None of these undermine the architecture. Every one is fixable inside the existing trust split, and most of the
protocol-level items land naturally in the already-planned v4/v5 redeploy. The register's own honesty about what is
red is the main reason this review found so much: the system documents its own gaps better than most reviews could.

## Strengths

### Custody and settlement core

- **The no-admin-path-to-funds claim is true in code.** `TokenlessPanel` has no owner, proxy, pause, sweep, setter,
  oracle, or upgrade hook; the issuer is consulted only via a view call before commit acceptance and never after, so
  rotation or compromise cannot touch accepted commits, scores, liabilities, or claims (pinned by
  `test_IssuerRotationCannotAffectAcceptedWorkOrPayment`). Round terms freeze at the first accepted commit.
- **Complete terminal-path coverage with immutable liveness bounds.** Every round provably exits into
  ZeroCommitRefund, UnderQuorumCompensation, BeaconFailureCompensation, or Finalized within immutable horizons; term
  validation forces failure-path pay identical to healthy base pay, deliberately preventing quiet consolation-payment
  substitution; conservation holds by construction and is pinned by exact-balance invariants.
- **Restart-safe, order-independent, externally recomputable settlement.** Exact-cursor pagination, XOR + modular-sum
  reveal-set commitments, a seed bound to chain/panel/round/count/accumulators/entropy, JS/Solidity parity vectors that
  block deployment on divergence, and invariant tests that actively fire wrong-cursor calls.
- **Unusually careful x402/EIP-3009 usage.** `receiveWithAuthorization` (payee-must-be-caller) defeats
  authorization front-running; a second funder EIP-712 signature binds the exact `RoundTerms` digest, target panel, and
  3009 nonce; delta-based balance checks, fee-on-transfer fail-closed, and the user (not the adapter) recorded as
  funder. Each property has a dedicated adversarial test. This matches or exceeds the published best practice for
  x402 services.
- **Pull-payment credit ledger** hardened against blocked/blacklisted recipients, with claim-state rollback on
  shortfall.

### Trust, identity, and privacy architecture

- **Three-way trust split that is disclosed as three separate authorities** (immutable custody / issuer-attested
  admission / operator moderation) instead of blended into a "trustless" claim, with candid public copy: no
  database-level anonymity claim, no cross-round unlinkability claim, issuer censorship power disclosed.
- **Client-side key custody with real enforcement:** vote/payout keys and salts generated in the browser, a deny-list
  on the relay queue rejecting secret material, locally encrypted recovery packages, drand chain-info pinning in the
  keeper — "the operator never possesses a rater spend key" is enforced, not aspirational.
- **Textbook two-layer session architecture:** short-lived Better Auth primary layer exchanged exactly once into an
  opaque principal and hashed `__Host-` session; wallet sign-in retired to 410s; purpose-bound wallet proofs with
  schema-level uniqueness; step-up re-auth for deletion; deleted accounts provably map to fresh principals.
- **Paid-eligibility-before-first-voucher is complete and fail-closed** (adulthood, sanctions, residence/tax/DAC7,
  payout setup), with the right rule encoded: eligibility follows money, not audience visibility.
- **First-class deletion lifecycle** with settlement-aware blockers, category receipts, and honest public-chain
  caveats (see weaknesses for its two gaps).
- **World ID integration is tightly scoped and data-minimized:** HMAC-keyed subject references under a versioned
  keyring, frozen action registry, uniqueness-only capability with explicit non-claims.

### Services, operations, and release discipline

- **Complete-deployment-key identity genuinely fails closed across all three consumers**, including live on-chain
  wiring verification in the keeper and a deliberately empty v4 registry instead of a relabeled stale artifact.
- **The app treats its own indexer as untrusted input** and recomputes full RBTS settlement from indexed reveals
  before publishing evidence — a materially stronger stance than indexer-as-source-of-truth.
- **Supply-chain posture above weight class:** digest-pinned images, npm stripped from runtime, SBOM + SLSA
  attestations in CI matching the docs, keystore fallback refusal, pairwise signing-role distinctness enforced by the
  readiness script.
- **Isolation with runtime teeth:** Railway project/service/region identity checks that regex-reject legacy
  identifiers, Vercel project pinning, and the readiness register's refusal to treat builds as approval.

### Agent integration and mechanism honesty

- **The single-use connection intent + OAuth 2.1 flow is genuinely well designed:** hash-only claim nonces,
  owner-bound claiming (rejecting a different authenticated subject), S256-only PKCE, resource indicators, refresh
  rotation with family revocation, and — most importantly — OAuth granting only four safe scopes while publishing and
  spending authority live in a separate server-side versioned owner grant with exact policy-version equality.
- **Frozen, idempotent review state machine implemented faithfully:** deterministic opportunity identity, 409 on
  divergent retries, question freezing with canonical hashes, "required is a decision, not a terminal state".
- **Fail-closed feedback-question boundaries are real:** agent-written questions hard-fail without immutable question
  storage; feedback semantics are excluded from adaptive observations at finalization.
- **Honest provenance framing:** host-reported metadata is stored as unattested and never laundered into verified
  claims; deep structural validation of traces; no prompts/outputs accepted anywhere in the evaluation path.
- **Published self-adversarialism:** the attack benchmark fixture showing the mechanism's own failure modes, the
  candid MCP cross-client review with a real protocol defect found and fixed, and the enterprise analysis citing the
  literature against the project's own mechanism are rare and materially improve external reviewability.

## Weaknesses

Ranked by severity after verification. Severity reflects design impact on the tokenless target's own goals, not
today's disposable-testnet exposure.

### Critical

**W1. The adaptive coverage ladder's promised safety gates do not exist, and reviewer laziness feeds de-escalation.
[code-verified]**
The design of record conditions every coverage reduction on drift gates and no open severe disagreement, but
`adaptiveReviewService.ts:489-490` hardcodes `driftGatePassed: true` and `severeDisagreementOpen: false`; the
human-human agreement gate auto-passes for single-reviewer observations. Because adaptive windows use panel agreement
as ground truth, lazy approval-biased reviewing inflates measured agreement, unlocks the 100→50→25→10% ladder, and
silently hollows out the product's core deliverable. This is the largest single divergence between the design of
record and the implementation. *(Paired with W2 — the same reviewer-laziness pressure the mechanism cannot yet
counter.)*

**W2. The lazy/collusive equilibrium out-pays honest play and the compensating controls are aspirational in the paid
public lane.**
By the project's own benchmark, a unanimous constant-report coalition earns ~9,950 bps of the bonus versus ~7,238 for
honest reporting (~5 percentage points of seat pay premium at the funder's expense), and the honest-effort premium over
random clicking is roughly 2% of seat pay. Verification correctly narrows the claim: honesty remains the *local* best
response (a unilateral constant reporter earns ~6,300 bps, below honest), this is the known payoff-dominant
uninformative equilibrium of the BTS family, it is disclosed in the spec, and real money is gated on an economics
acceptance review. What makes it critical *in combination with W1*: the spec explicitly delegates the defense to
"World ID, hidden assignment, integrity epochs, qualification, gold tasks, and verdict gates", but gold is disabled in
the paid public lane pending an unbuilt synthetic corpus, invited-lane gold is off by default, and the implemented
correlation analytics is a per-round assignment-mismatch ratio plus a duplicate-response-hash check — no cross-round
reviewer-pair vote correlation, timing clustering, or payout-address clustering exists anywhere. The benchmark also
lacks the single most decision-relevant scenario: a unilateral lazy deviator against an honest population.

### High

**W3. The vote-key-to-payout linkage disclosure is wrong in timing and scope. [code-verified]**
Four surfaces (design of record, legal reference, terms, privacy notice) locate the public vote-key→payout linkage "at
claim". In fact the publicly emitted sealed commit payload is a tlock ciphertext of the full reveal material
*including `payoutAddress` and salt* (`rater/material.ts` `REVEAL_PARAMETERS`), sealed to the drand round derived from
the **commit deadline** (`chain/payments.ts:241`). Once that round arrives, anyone can decrypt every committer's vote,
prediction, and payout address — days before any claim, for raters who never reveal or claim, with no post-commit
abort. The legal reference's "only salted commitments stay on-chain" DPIA premise is false (plaintext votes land in
reveal calldata), and the privacy notice's on-chain data list omits votes. The shipped privacy is strictly weaker than
the disclosed privacy — the exact failure mode the project's claims-discipline exists to prevent.

**W4. The indexer's reveal tally contradicts contract timely/late semantics and can permanently block evidence
publication. [code-verified]**
The contract accepts (and compensates in terminal paths) reveals through `beaconFailureDeadline` but freezes the
scoring set at `revealDeadline`; the Ponder `RevealAccepted` handler increments the indexed `revealCount` and vote
tallies unconditionally. The keeper itself manufactures the divergence (it submits tlock-decrypted late reveals before
calling `beginSettlement` in the same tick). A finalized round with any late reveal then has indexed
`revealCount > frozenRevealCount`, and the transparency gate throws "not completely finalized" as a retriable 409
forever — the customer decision packet for that round can never publish while every health check stays green.

**W5. Keeper liveness: O(all-time-rounds) scan, dead `/keeper/work` endpoint, and the 256-block entropy window.
[code-verified]**
`scanRoundIds` round-robins over every round ever created (100 per 15s tick) with no terminal-round retirement; at
roughly 3,400 lifetime rounds the revisit period alone exceeds Base's 256-block blockhash retention, so rounds in
AwaitingSeed would systematically age out and degrade to base-only pay — silently destroying the RBTS bonus at
moderate scale with a healthy keeper. The Ponder `/keeper/work` endpoint built for targeted discovery is never called;
the keeper is a single replica on a single RPC with no caller incentive for outsiders, so "any caller may continue the
state machine" is permissionless but practically operator-only.

**W6. The self-funded x402 runner signs server-supplied spend instructions with no deployment pinning or quote
cross-check. [code-verified]**
`runTokenlessAutonomous` verifies only that `funderAddress` matches the local wallet, then signs whatever
`paymentInstructions` supplies (`usdcAddress`, submitter address, chain, total) — never comparing against the agent's
own quote or a pinned deployment identity, although the SDK already ships
`validateTokenlessPaymentInstructions(instructions, deployment)`. A compromised API server or base-URL
misconfiguration can obtain a valid EIP-3009 signature moving the wallet's total to an arbitrary address. The
server-side "complete deployment key, fail closed" doctrine simply hasn't been extended to the one component that can
protect the funder against the API layer.

**W7. The entire review-trigger surface is agent-self-reported, with no under-reporting detection.**
Risk tier, criticality, confidence, metadata completeness, and whether an output is reported at all are supplied by
the reviewed agent under advisory MCP. An agent that declares everything low-risk/high-confidence neutralizes the
owner's risk rules; an agent that never calls `evaluate_review_requirement` produces no opportunities and no
unreviewed-gap increments (the counter only advances inside evaluate). The owner guide presents risk rules as owner
controls without stating the values are self-assigned by the party under review; there is no server-side expectation
model or cadence alarm to catch silent under-reporting.

**W8. Account deletion silently retains World ID bindings and rater profiles, contradicting receipt completeness and
"never reconnects".**
`deleteAccount()` never touches provider subject bindings, assurance assertions, or rater profiles; the rows survive
active, appear in no receipt category, and re-enrollment of the same World ID is rejected with
`world_id_already_bound` — a permanent paid-lane lockout plus a durable biometric-adjacent link between the deleted
principal and the human, undisclosed by the deletion receipt. Directly contradicts the design of record's deletion
evidence and identity-severance claims.

**W9. The Surprisingly Popular bounty is exploitable for net-positive coalition extraction that can exceed fee
revenue.**
A coordinated unanimous panel voting one side while predicting ~30% for it saturates the leave-one-out margin and
collects the maximum top-up (~10% of seat pay) against an RBTS sacrifice of ~6.4% — netting ~+3.6% of seat pay per
member in platform funds per round. Worst-case SP reserve (10% of bounty) exceeds the default 7.5% platform fee, so
farmed SP rounds are unit-negative. The spec has no verdict-independent sanity check, no outlay cap tied to fee
revenue, and the attack simulator has no SP-farming scenario. External research adds that SP only reliably beats
majority voting among screened experts and is noisy at small n — it is currently priced as a payout mechanism while
performing like a diagnostic.

**W10. Adaptive ladder statistics contradict their owner-facing semantics and have poor power at both ends.**
Windows are exactly 15 cases with a Wilson lower bound (z=1.96) ≥ 7,000 bps — arithmetically 14/15 (93.3%) observed
agreement, so an owner configuring a "70% agreement threshold" is operating a 93% gate (and the doc says "at least
15", which the code never builds). A genuinely-90% agent passes two consecutive windows with probability ~0.30;
conversely at the 10% floor a degraded agent at 75% true agreement trips the reset only ~31% of the time per ~150
outputs. Slow, unreliable regression detection exactly when coverage is lowest.

**W11. Sybil/collusion bounding is an operator promise, not a mechanism property.**
The on-chain nullifier is whatever the issuer signs; one-human-one-seat is exactly as strong as the operator's
unverifiable off-chain derivation. World ID proves scoped uniqueness, not non-transferability (credential renting is a
documented failure mode), and with no stake a rented identity risks nothing. Off-platform rings — the attack that
broke the only controlled peer-prediction experiment (Gao et al. 2014, cited by the project's own analysis) — are
untouched by commit-reveal. Consistent with the disclosed trust model, but the honest answer to "does World ID +
admission bound sybils" is: only to the extent of analytics that do not yet exist (see W2).

**W12. The durable paid-rater identity is the payout wallet address, contradicting "a wallet is never identity" in
substance.**
Rater profiles, legal eligibility, DAC7 records, subject bindings, and voucher history key on the payout wallet
address resolved from the current binding. Wallet rotation (explicitly supported) orphans the eligibility record, and
re-verification then collides with the global subject-uniqueness constraint with no supported re-link path — stranding
KYC/tax evidence and blocking legitimate rotation at exactly the paid-work layer where the wallet/identity separation
matters most. The code itself flags the legacy keying as debt.

### Medium

- **Credential issuer blast radius and custody.** A compromised issuer signer can mint vouchers for attacker vote keys
  and fill open rounds (verdict capture and bounty redirection of in-flight rounds), which the "admit or censor future
  work" disclosure understates; `rotationAuthority` is a single immutable env-var address — loss freezes rotation
  forever, compromise grants `rotateEmergency`, and either forces full-bundle abandonment. No multisig/HSM requirement
  appears anywhere on the mainnet path.
- **Late reveals in healthy rounds pay zero**, contradicting the in-code comment and the design of record's
  accepted-work guarantee; payment for identical work is decided by a race with `beginSettlement`, and no test pins
  the healthy-round outcome.
- **"No universal decryption key" is over-broad.** All private artifacts wrap to one operator-controlled key per
  domain; the legal reference's per-rater/per-project envelope key requirement (its own DPIA precondition) is
  unimplemented. The operator can decrypt every customer artifact; the public page never denies it, but the design of
  record's phrasing invites the stronger reading.
- **Non-deletion subject requests are accepted with no fulfilment path** (no operator console or approved procedure),
  starting statutory clocks the system cannot yet serve; deletion receipts also fabricate a synthetic
  received→completed transition history and hash labels rather than erasure evidence.
- **No finality/confirmation rule for evidence and a single RPC everywhere.** Decision packets pin block hashes with
  no safe/finalized-head requirement, no post-hoc re-verification, and no fallback transport — undercutting the
  "independently checkable evidence" differentiator for cheap-to-fix reasons.
- **Interim key posture:** five-plus hot raw private keys (credential signer, relayer, prepaid funder, bonus funder,
  keeper) in SaaS env stores with unexercised rotation drills. Correctly red-gated in the register, but the weakest
  link on the stated staging path.
- **Health checks prove process/DB liveness, not indexer freshness or keeper progress**; a stalled sync reports "ok"
  indefinitely and the keeper's platform healthcheck is process-up only. Alerting is an admitted open gate — every
  evidence-pipeline failure currently manifests as a silent green "pending".
- **Operational surface vs. team size.** ~115 required production variables for the app alone, a signed EU manifest,
  ten-plus vault key families, and a fully manual atomic redeploy choreography across three platforms; founder
  continuity itself is an unexercised gate.
- **No host-enforced path exists end-to-end** — the product's strongest assurance tier ("prove output remained
  blocked") is normatively documented but unreachable in any supported configuration; the host-gate client is finished
  and fail-closed, but no server issues its evidence schema.
- **Evaluation-profile partitioning taxes honesty and cannot catch fraud.** `serviceTier` and `reasoningEffort` sit in
  the partition hash despite the design's own observations-not-keys principle; honest hosts fragment scopes and
  restart calibration on every provider snapshot roll, while a dishonest host holds a reduced-review scope by
  reporting a stale profile. No scope-churn visibility or alias/merge mechanism exists.
- **Long-window continuation is under-served:** the state machine promises list/resume, but no MCP tool enumerates
  open opportunities, so a fresh task on a generic host cannot rediscover a pending review it must not run ahead of.
- **Public-lane redaction is agent-asserted.** The "owner-confirmed redacted material only" promise is implemented as
  an agent-supplied `confirmedNoSensitiveData: true` boolean and agent-authored redaction summary inside an active
  grant — a ceremonial control for a model.
- **No named host is Verified** against the project's own acceptance criteria, so the flagship connection UX
  (intent preservation across install/consent/reload, schema survival through host adapters) is unproven at release
  scope.
- **Feedback Bonus patronage channel.** The requester-as-awarder default with vote-visible feedback creates a
  repeated-game favoritism/kickback channel that can dwarf the 20% RBTS bonus; the third-party-funder configuration has
  no specified countermeasure.
- **Small-panel statistics.** At the normal n=3–5, the bonus signal is variance-dominated, near-unanimous rounds
  collapse discrimination, and 5-gold-at-80% qualification passes a coin-flipper 18.75% of the time. The 3-vote
  majority verdict — the actual deliverable — carries no statistical qualification beyond disagreement disclosure.
- **Thin unit economics with a high-friction funding rail.** A 7.5% default fee must carry identity, moderation,
  analytics, relayer gas, and worst-case SP top-ups of 10% of bounty; the only fiat rail is USD bank-transfer
  invoicing; no document models reviewer supply-side earnings or retention under a ~2% effort premium.
- **Migration journal has an excised entry (idx 66). [code-verified]** The append-only premise behind
  journal-as-source-of-truth is enforceable by nothing today (no contiguity test), and any environment that applied
  0066 diverges silently.
- **Enterprise identity (SAML SSO, SCIM, admin plugin) is mounted unconditionally** in the auth root of a pre-staging
  product — an exploit-rich parsing surface present in every deployment, gated only at the route/policy level, and
  undisclosed in the design of record's identity section.
- **Key auth invariants are guarded by source-string regex tests** (wallet-never-on-sign-in as a `readFileSync`
  match), per-route CSRF opt-in with at least one mutating route missing it, and cookie names wired by string
  convention (the deletion route clears the wrong Better Auth cookie names).

### Low (abbreviated)

Settlement is O(n²) with only a single-seat gas benchmark; `TokenlessFeedbackBonus.refundRemainder` pushes to the
funder instead of using the panel's pull-credit pattern; Circle/USDC token-layer authority (pause/blacklist including
the escrow itself) is disclosed only in the legal reference, not the trust-model section; the "conservation checks"
phrasing implies an on-chain gate that is actually by-construction arithmetic; keeper container runs as root with a
dead entrypoint and an unbounded reveal-material cache; AGENTS.md still says journal `0000`–`0047` against a `0104`
head; quicknet-t has only two relay hosts; the EU KMS residency check is `includes("eu")`; server-pushed MCP pairing
instructions tell models to "act immediately without asking the user" — a prompt-injection-shaped precedent; the
agents-layer idempotency-key validation contradicts the SDK's; the contrast fix aliases 181 legacy utility classes in
CSS rather than migrating call sites; the reviewer answering shell remains two divergent 600-line implementations.

## Improvement ideas

### A. Truth-in-claims fixes (do before anything else; mostly docs + small code)

1. **Rewrite the linkage disclosure across all four surfaces** to state that committing schedules irrevocable public
   disclosure of vote, prediction, and payout address at the commit-deadline beacon round, independent of reveal or
   claim, with no abort — and correct the legal reference's "only salted commitments on-chain" and "unlinkable until
   claim" sentences before any DPIA builds on them (W3). If claim-time-only linkage is the intended property, remove
   `payoutAddress`/salt from the tlock payload (open the payout commitment only at claim) in the v4 protocol — the
   fund core is being redeployed anyway.
2. **Add World ID bindings and rater profiles to the deletion lifecycle** (erase, or retain under an explicit receipt
   category with basis and deadline), decide deliberately whether a deleted human may re-enroll, and fix the "never
   reconnects" language (W8). Replace fabricated receipt transitions with real timestamps and erasure-backed digests.
3. **Extend the issuer disclosure to name open-round verdict/bounty capture** as the compromise consequence, alongside
   censorship (medium above), and move the Circle/USDC token-layer authority into the design of record's trust
   section.
4. **Amend the owner guide** to state plainly that risk tier, confidence, and output reporting are agent-supplied
   under advisory integrations, and have `rateloop_get_agent_context` return `enforcementBoundary: "advisory"`
   programmatically (W7, host-enforced gap).

### B. Mechanism and application fixes before hosted staging

5. **Implement the drift and severe-disagreement gates** (or hard-pin the ladder in calibrating until they exist), and
   require ≥2 responding humans for a comparable observation (W1). This is the single highest-leverage change in the
   review.
6. **Reconcile the Wilson gate with its owner-facing semantics**: display the effective observed-agreement bar
   (14/15 at n=15) or move to larger windows; publish expected regression-detection latency at the floor; consider a
   sequential test (SPRT) for faster reset on degradation (W10).
7. **Make platform-synthetic gold a launch blocker for the paid public lane, and build real correlation analytics**
   (pairwise reviewer vote-agreement matrices, commit-timing clustering, payout-address linkage — the chain data is
   already public and indexed). Add the two missing benchmark scenarios: unilateral lazy deviator vs honest
   population, and SP farming (W2, W9, W11). External literature (Gao/Wright/Leyton-Brown) says spot-checking against
   sparse gold *dominates* pure peer prediction — the project's own R3 recommendation is the theoretically correct
   one; ship it first.
8. **Cap and sanity-check the SP bounty**: bound per-round SP outlay below that round's platform fee, disqualify the
   manufactured-surprise signature (unanimous votes with uniformly depressed same-side predictions), or restrict SP to
   gold-passing panels. Consider using SP as a contested-item flag rather than a payout until validated (W9).
9. **Blind the Feedback Bonus awarder to votes**, log awards to the workspace owner, flag repeated awarder-payee
   pairs, and require co-approval when the funder differs from the awarder.
10. **Fix the indexer late-reveal divergence** (track timeliness or reconcile against `SettlementBegun.frozenRevealCount`;
    gate evidence on the frozen set) and add the regression test where a reveal lands between `revealDeadline` and
    `beginSettlement` (W4).
11. **Retire terminal rounds from the keeper scan, service AwaitingSeed as a priority queue, and wire (or delete) the
    `/keeper/work` endpoint**; alert on entropy-window age; make health checks freshness-aware and ship the minimal
    alert set (indexer lag, consecutive errors, gas balance, evidence-pending age) (W5).
12. **Pin deployment identity and cross-check economics in the self-funded runner**: require a
    `RATELOOP_DEPLOYMENT_KEY` in the runner/CLI passed to `validateTokenlessPaymentInstructions`, compare instructions
    against the agent's own quote, and add a `maxTotalAtomic` ceiling (W6). Also apply the x402 research checklist:
    tight authorization windows are already right; add `AuthorizationUsed` watching and treat used-nonce-on-settle as
    possibly-paid in reconciliation.
13. **Re-key paid-rater identity to the opaque principal** with the payout wallet as a mutable, history-tracked
    attribute and a deliberate re-link path for the subject-uniqueness collision (W12).
14. **Structural auth guards**: default-deny cross-origin on mutating routes with explicit opt-out; a journal
    contiguity test plus an excision policy; behavioral (rendered-DOM/chunk-graph) tests for wallet-never-identity;
    shared cookie-name constants; gate `sso()`/`scim()` plugin registration behind the enterprise flag so the parsing
    surface does not exist in non-enterprise deployments; publish the route→session-type→role→eligibility
    authorization matrix and assert it in CI.
15. **Agent-integration completions**: add `rateloop_list_open_reviews` (read-only, integration-bound) so fresh tasks
    can rediscover pending work across 24-hour windows; remove `serviceTier` (and likely `reasoningEffort`) from the
    evaluation-profile partition per the design's own principle, add scope-churn visibility and an owner-approved
    profile-alias operation; route agent-declared "redacted" public material through the existing one-tap owner
    approval; execute the compatibility review's own host-verification harness before any broad compatibility claim.

### C. Protocol changes for the v4/v5 redeploy (before real money)

16. **Replace blockhash scoring entropy with an independent drand scoring round frozen in round terms.** Round terms
    carry `beaconNetworkHash`/`beaconRound` for tlock disclosure and a distinct `scoringBeaconRound` strictly after
    the protected cutoff 24 hours after reveal closure. Using only the latter for scoring entropy (verifiable on-chain
    via the EIP-2537 BLS12-381 precompiles now live, ~130–140k gas) removes the ordinary sequencer-selection path under
    the documented OP Stack/L1-liveness assumption and eliminates the 256-block
    cliff (drand rounds are permanently retrievable, so keeper outage no longer converts reviewer bonuses into funder
    refunds), and makes base-only a true beacon-failure path. The spec already mandates a reviewed beacon before
    mainnet — but that mandate is absent from the readiness register; add it as an explicit gate either way.
17. **Resolve the late-reveal compensation contradiction**: pay `fixedBasePay` to revealed-but-unscored records in
    Finalized rounds from the already-funded attempt reserve, or correct the comment/design claim and pin the
    pays-zero behavior in a test.
18. **Harden issuer rotation authority**: require a multisig (deployment-config change, not a contract change),
    consider a timelocked two-step handover or dead-man backup authority, and document that authority loss forces
    full-bundle redeployment.
19. **Propagate the pull-credit pattern to `TokenlessFeedbackBonus.refundRemainder`** with a blocked-recipient test.
20. **Add an end-to-end 500-seat settlement gas benchmark** (the spec makes this normative; only a single-seat
    benchmark exists), cut the per-page O(n²) rank recomputation, and for mainnet consider a small funder-paid
    settlement tip so permissionless continuation is incentive-backed; publish "run your own keeper" instructions
    earlier than phase 3.
21. **Raise the effort premium for qualified reviewers** (e.g. shift toward 70/30 after probation), bind continued
    paid-network admission to rolling gold accuracy and RBTS percentile (the issuer's admission authority is the
    already-disclosed enforcement point), aggregate bonuses over many questions per pay period to cut variance (the
    literature's standard fix for small-panel noise), and evaluate multi-task Correlated Agreement scoring alongside
    per-question RBTS once reviewers answer many questions. Run the preregistered equal-pay experiment the worked
    examples already declare a release gate — before real money.
22. **Implement per-tenant envelope keys** (KMS-wrapped tenant KEKs) to meet the legal reference's own DPIA
    precondition, or scope the "universal decryption key" claim to rater material and state plainly that the operator
    can decrypt customer artifacts.
23. **State and enforce an evidence finality rule** (publish only at/below the safe head or N confirmations;
    re-verify the pinned block hash at publication) and add fallback RPC transports to Ponder and keeper.

### D. Product and go-to-market ideas from external research

24. **Sell the decision packet as compliance evidence.** The EU AI Act omnibus moved Annex III high-risk obligations
    to 2 December 2027 (Annex I to August 2028), but procurement cycles are running now. No comparable product
    (HumanLayer, gotoHuman, Permit.io, Amazon A2I) produces a portable, tamper-evident, settlement-backed decision
    packet; pre-mapping packet fields to AI Act Articles 12/14/26 and ISO 42001 evidence requests and selling to
    compliance, not just engineering, is the clearest differentiation the market research found. Two-person review and
    reviewer-competence attestation (Article 26) generalize naturally from the existing panel machinery.
25. **Match the table stakes the category now assumes**: framework-native integrations beyond MCP (LangGraph
    interrupts, n8n), Slack/email review routing, latency SLAs with escalation and fallback behavior when reviewers
    are unavailable, and (eventually) SOC 2/ISO 27001 — without these, the packet differentiation may not reach
    procurement. Framework-native "pause and ask a human" is commoditizing; the defensible layers are the reviewer
    network, the evidence record, and settlement finality.
26. **Neutrality is a wedge**: Scale's Meta entanglement created demand for neutral human-review supply, and the
    expert marketplaces (Mercor, micro1, Handshake) sell training labor, not production-time decision assurance with
    SLAs — the exact gap a versioned decision packet with settlement evidence occupies.
27. **Fix the funding rail friction**: the USD-bank-transfer-only invoice flow is the enterprise analysis's own
    identified blocker for procurement; card/SEPA support will matter more to demand than any mechanism refinement.

## External research notes

Condensed from the four research briefs produced for this review (full source lists retained in the review artifacts):

- **Peer prediction.** RBTS (Witkowski–Parkes 2012) is the correct binary/small-panel choice and the implementation is
  a faithful instantiation; but truth-telling is never the unique equilibrium, coalition thresholds on n=3–5 panels
  are two people, and the strongest theoretical result in the space (Gao/Wright/Leyton-Brown) says limited gold
  spot-checking dominates pure peer prediction. Field evidence for RBTS on judgment tasks is positive; registered
  reports on sensitive self-reports are negative; explaining the formula to participants backfires — publish the
  plain-language guarantee, not the math. Detect lazy equilibria via report entropy, content-unconditional agreement,
  and answer-rate drift.
- **Surprisingly Popular.** Beats majority reliably only among screened experts; noisy at small n; use as a
  contested-item flag or tie-breaker with pooled estimates, and log votes plus meta-predictions to A/B it against
  majority on resolved items before paying real money through it.
- **x402/EIP-3009.** The design's `receiveWithAuthorization` + terms-bound second signature already defeats the
  classic front-running and mutation attacks the literature documents. Remaining checklist items: agent-side
  origin/deployment allowlisting before signing (W6), `AuthorizationUsed` event watching with used-nonce-treated-as-
  possibly-paid reconciliation, and tight authorization windows (already present). Facilitator/discovery-layer trust
  and application-layer replay are the ecosystem's active failure modes.
- **Randomness and immutability.** Auditors now routinely flag sequencer-influenced entropy on OP-Stack chains;
  drand quicknet verification on-chain is ~130–140k gas post-Pectra, and Chainlink VRF v2.5 is live on Base as the
  boring alternative. Commit-reveal best practice matches the design (deadlines, settle-without-non-revealers,
  outcome-independent base pay) — the missing pieces are beacon-XOR entropy and an incentive-neutral failure path.
  Migration-by-new-deployment is the accepted bug response for immutable contracts; the disposable versioned
  deployment-key discipline here is exactly the recommended pattern, and user escape hatches (self-reveal, self-claim,
  permissionless continuation) are already present.

## Method

Six review agents each read the design of record, dimension-specific docs, and implementation code; four research
agents surveyed external literature and the competitive/regulatory landscape; an adversarial verification pass
attempted to refute every non-low finding (completed for the fund-core dimension, where it downgraded two findings;
interrupted by session limits for the remainder, after which the highest-severity claims were re-verified manually
against source). Findings that review deleted legacy surfaces were excluded per the tokenless review boundaries.
