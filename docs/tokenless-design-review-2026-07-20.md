# Tokenless design review, round 2 — 20 July 2026

**Status:** Second independent design review of the `tokenless` branch, at commit `1686824c` (19 July 2026). Follow-up
to the [first review of 2026-07-18](tokenless-design-review-2026-07.md), which examined `40839eb52`; 153 commits landed
between the two. Produced by a multi-agent review: two status sweeps re-verifying every round-1 finding against current
source, dimension reviewers on the settlement-core hardening and the managed-KMS signing migration, and external
research (HITL pricing benchmarks, cloud-KMS chain-signing practice). Findings marked **[code-verified]** were
re-checked directly against source (or reproduced empirically) during synthesis. This document records findings and
ideas; the [production-readiness register](tokenless-production-readiness-2026-07.md) remains the only release
checklist.

Coverage note: reviewers for four planned dimensions (pricing implementation, setup/grant-flow rework, evidence/webhook
pipeline, release-record truthfulness) were cut short by session limits. Pricing and release-record truthfulness are
partially covered below via the status sweeps and manual verification; the evidence pipeline and the reworked
setup/automatic-grant machinery received no dedicated pass this round and deserve one next round.

## Overall assessment

The dominant fact of this round is remediation velocity with unusual fidelity. Of the 26 tracked findings from the
first review, 14 are fixed outright and 11 more are partially fixed or safely contained — in roughly 36 hours. The
fixes are not paper: the adaptive ladder now hard-pins to 100% review with a `safety_gates_unavailable` reason instead
of trusting stubbed gates; account deletion erases World ID bindings with measured row-count receipts; paid-rater
identity was re-keyed from wallet address to principal with a migration and fail-closed lifecycle checks; the tlock
linkage disclosure was corrected on all four surfaces; late reveals were fixed at the protocol level; the SP bounty is
now fee-capped with unanimous panels ineligible; scoring entropy moved from sequencer-biasable blockhash to an
immutable on-chain beacon verifier; hardened issuer rotation remains a real-money release gate while the disposable
Base Sepolia stack permits an EOA; the x402 runner pins deployment identity and a local spend ceiling; evidence
publication gained a finality policy and RPC
failover; and a full managed-KMS signing path exists for all seven roles. Several fixes went beyond what the review
asked for.

Velocity is also this round's central risk finding. Everything that landed *before* the repo's own final audit pass on
the 19th went through the audit loop; the managed-KMS migration and the settlement-core hardening landed *after* it,
uncovered. The results are visible: the flagship web-side KMS signer contains a DER-parsing defect that rejects roughly
70% of valid KMS signatures (empirically reproduced; the keeper's divergent copy of the same parser is correct); the
`managedSigning` capability flag was flipped to `true` in the same commit that introduced the broken implementation,
while the readiness register still says the opposite; and the entropy hardening quietly reuses the commit-deadline
tlock beacon round as scoring entropy, breaking the spec's own post-closure-entropy property in a way that would be
permanent once the adminless v4 core deploys. None of these diminish the architecture — but they demonstrate that the
audit loop, not author discipline, is what has been catching this class of defect, and the newest, most
custody-critical code is precisely the code that skipped it.

The deliberately contained items remain contained: adaptive reduction is disabled until real gates exist, real money is
gated on the economics acceptance review, and the register carries the open mechanism work (platform-synthetic gold,
cross-round correlation analytics, reviewer economics) honestly.

## Round-1 finding scoreboard

Verified against source at `1686824c`. "Fixed" means the design defect is gone in code; several fixes only take effect
on-chain with the v4 redeploy, noted where relevant.

| Round-1 finding | Status | Note |
| --- | --- | --- |
| W1 adaptive gates hardcoded / single-reviewer auto-pass | Partially fixed | Ladder hard-pinned to 100% (`safety_gates_unavailable`); ≥2-human rule added; drift/severe-disagreement gates still unimplemented (inert placeholders remain) |
| W2 lazy-equilibrium counters absent in paid lane | Partially fixed | Contained by the W1 pin + real-money gate; benchmark gained unilateral-deviator and correlation-ring scenarios (honesty confirmed locally dominant, 6,335 vs 7,238 bps); gold and cross-round analytics still unbuilt |
| W3 tlock linkage disclosed "at claim" | Fixed | Disclosure corrected on all four surfaces (protocol unchanged: commit still schedules irrevocable disclosure at the commit-deadline round — now truthfully described) |
| W4 indexer late-reveal tally blocks evidence | Fixed | Protocol-level: late reveals rejected once timely quorum exists; `scoringEligible` on the event; indexer and gate aligned (effective at v4) |
| W5 keeper O(all-rounds) scan / dead feed / entropy cliff | Fixed | `/keeper/work` feed real and consumed; drand entropy removes the 256-block cliff; residual round-robin is a bounded backstop |
| W6 x402 runner signs unpinned server instructions | Fixed | Deployment identity + `maxTotalFundedAtomic` ceiling now required; full quote-intent cross-check before either signature |
| W7 self-reported triggers, no under-reporting detection | Partially fixed | Honest owner-guide disclosure + programmatic `enforcementBoundary`; detection half (cadence baselines, alarms) still absent |
| W8 deletion retains World ID bindings | Fixed | Erasure + `world_id_and_rater_linkage` receipt category with measured counts; re-enrollment possible; honest atomic receipt event |
| W9 SP bounty coalition extraction | Partially fixed | Per-round SP liability capped at the frozen fee; unanimous panels ineligible; register admits a near-unanimous (14/15) residual and keeps the bounty experimental |
| W10 Wilson gate semantics/power | Partially fixed | Impossible-threshold implication removed; underlying n=15/14-of-15 semantics and power unreworked (moot while the ladder is pinned) |
| W11 sybil bounding is an operator promise | Open (unchanged) | Carried honestly in the register; analytics still per-round only |
| W12 rater identity keyed to payout wallet | Fixed | Re-keyed to principal (migration 0117, fail-closed lifecycle tests); wallet is a rotatable attribute |
| Issuer rotation authority single EOA | Deferred to real-money hardening | Disposable Base Sepolia permits an EOA; require a multisig or equivalent hardened authority before real value. |
| Late reveals pay zero in healthy rounds | Fixed | Protocol now rejects work it would not pay; both outcomes pinned by tests (effective at v4) |
| Blockhash entropy replacement | Fixed-with-caveats | Replaced by immutable `IBeaconVerifier` + deadline-gated base-only fallback — but see NF2/NF5/NF6 below |
| Hot keys in SaaS env stores | Partially fixed | KMS paths exist for all seven roles, hot keys forbidden on hosted `main`; the running isolated deployment still legally uses local keys, and see NF1 |
| Evidence finality / single RPC | Fixed | Finality policy (safe/finalized tag or ≥64 confirmations), hash re-verification, ordered RPC failover |
| Health freshness / alerting | Partially fixed | Freshness-aware health + the review's exact alert signal set; alert *delivery* remains an unexercised operations gate |
| Per-tenant envelope keys | Partially fixed | Workspace/project-scoped KMS wrapping implemented for managed mode + claims corrected; deployed posture still single local master key |
| Subject requests without fulfilment | Partially fixed | Authenticated intake with a legal state machine and real self-service paths; operator console still missing |
| Enterprise identity always mounted | Fixed | SSO/SCIM plugins registered only when the enterprise flag is exactly `true` |
| Journal excision idx 66 | Fixed | Contiguity test + immutable declared-excision artifact |
| CSRF opt-in / cookie names / regex tests | Partially fixed | Default-deny CSRF by method; shared cookie constants; source-regex remains the dominant identity-invariant guard style |
| Profile partitioning / list-resume / redaction | Partially fixed | Profile schema v2 drops serviceTier/effort from cohort identity; `rateloop_list_open_reviews` shipped; redacted public material now owner-approved; scope-churn visibility still absent |
| Deletion receipt fabrication / EU KMS substring | Fixed | Honest atomic receipt + postcondition verification; region regexes with ARN cross-check |
| Low set (root container, push refund, Circle placement, AGENTS.md drift) | Fixed | All four verified in source |

## New findings (this round)

### Critical

**NF1. The web-side KMS DER parser rejects ~70% of valid KMS signatures. [code-verified, empirically reproduced]**
`packages/nextjs/lib/tokenless/chain/awsKmsAccount.ts` `readDerInteger` strips a leading `0x00` pad byte and then
unconditionally rejects a high-bit first byte — but a high-bit first byte is exactly why DER adds the pad. Any
signature whose `r` or `s` top byte is ≥ `0x80` fails: reproduction against `node:crypto`-generated secp256k1 DER
signatures rejected 142/200. Every credential-issuer, relayer, prepaid-funder, and surprise-bonus signature flows
through this parser, so in live operation most KMS sign attempts would 503. The keeper's independent copy
(`packages/keeper/src/aws-kms-account.ts:91-98`) handles the pad correctly — two "identical" security-critical parsers
have silently diverged, and the test fixtures (deterministic RFC-6979 vectors) never exercised the padded branch. This
is the textbook pitfall the external KMS literature warns about first.

### High

**NF2. Scoring entropy is now pre-closure: the reused commit-deadline beacon round enables computable reveal-set
grinding. [code-verified]**
`RoundTerms` carries a single `beaconRound` serving two contradictory roles: the tlock disclosure round (derived from
the *commit* deadline, `chain/payments.ts:327`, so the keeper can force reveals during the reveal window) and — since
the hardening — the scoring-entropy round consumed by `finalizeScoringSeed` (`TokenlessPanel.sol:493`). The beacon
output is therefore public for the entire reveal window while every commit's vote is simultaneously tlock-public, so
for any candidate reveal subset the seed, canonical sort, peer assignments, and every RBTS score are exactly computable
before the set freezes. A coalition submitting deliberately undecryptable sealed payloads (only length is validated at
commit) retains a per-seat reveal/abstain bit and can grind assignments to shift the bonus band. The old blockhash
design sampled entropy strictly after reveal-set freeze — this is a regression introduced by the hardening, it
contradicts the spec section still titled "Post-closure entropy," and it becomes permanent at the adminless v4
deployment. Impact is bounded (20% bonus band; withholding forfeits full seat pay; admission is operator-gated), but it
is exactly the class of flaw an immutable core cannot patch. Neither the first review (which proposed the beacon reuse)
nor any internal audit doc flags it.

**NF3. The `managedSigning` capability flipped to `true` outside the audit loop, and the register now contradicts the
code. [code-verified]**
The entire KMS architecture postdates the final audit-remediation commit of 19 July by ~10 hours; none of the four
audit/remediation documents cover it. `DEFAULT_HOSTED_RELEASE_CAPABILITIES.managedSigning` was flipped to `true` in
the same commit that introduced the implementation — the implementation NF1 shows cannot work against real KMS output —
while at the reviewed head the readiness register (line 17) still stated `managedSigning` "remain[s] explicitly
unavailable." (Update during synthesis: commit `3c1f9444`, landing after the reviewed head, reconciles the register
text to "implemented but still requires provisioned resource evidence" — the contradiction half of this finding is
resolved.) The structural half stands: the flagship custody subsystem is the one major body of code the repo's own
audit trail does not cover, the capability flag was flipped in the implementing commit without independent review, and
NF1 shows what that skipped review would have caught. Both NF1 and NF2 remain present at `3c1f9444`.

**NF4. KMS role separation is env-var-deep: one workload identity, no IAM-principal distinctness.**
All web-side KMS roles authenticate through the same Vercel OIDC workload, differing only in per-role `ROLE_ARN` env
values; the readiness gate enforces distinct key ARNs and addresses but never distinct IAM principals — a single IAM
role with `kms:Sign` on all seven keys passes every check, and a compromised web app can sign as credential issuer,
funders, relayer, evidence signer, and wallet issuer simultaneously. KMS converts key exfiltration into key use
(revocable, logged — a real improvement), but no key-policy or trust-policy IaC/attestation exists in-repo, so the
compartmentalization story is one aspirational README sentence.

### Medium

**NF5. The production beacon verifier — the linchpin of the entropy hardening — does not exist.**
Only the 13-line `IBeaconVerifier` interface and a test-only mock are in-repo; there is no BLS12-381 (EIP-2537)
quicknet verifier, no written proof-format specification (the keeper de facto defines proof = raw drand signature with
`randomness == sha256(signature)`, stated nowhere), and the deploy script accepts any address with code. The immutable
panel binds to it forever; a wrong verifier silently reintroduces caller-selected entropy. The docs honestly gate
release on "an audited beacon verifier," but the gas ceiling for `finalizeScoringSeed` has never been measured with a
real verifier.

**NF6. Post-deadline race between `finalizeScoringSeed` and `finalizeScoringFallback` lets a funder claw back
bonuses.**
`finalizeScoringSeed` has no upper time bound, so after `beaconFailureDeadline` both paths are live from AwaitingSeed
and up to 20% of every seat's pay is decided by transaction ordering. Because `beginSettlement` also has no upper
deadline, a funder can wait out the beacon grace and atomically bundle settlement-begin → aggregation → fallback,
converting all reviewer bonuses to refund even though drand output is permanently retrievable — partially defeating the
stated rationale for the beacon migration. The protecting floor is `MIN_BEACON_GRACE` = 5 minutes; no test pins
post-deadline seed behavior or the ordering rule.

**NF7. Invariant fuzzing no longer exercises the RBTS settlement path.**
The invariant handler now settles every fuzzed round via the base-only fallback; the verified-seed path — including the
new in-place storage heap sort and score-dependent liabilities, the most complex new code in the immutable core — is
covered only by small deterministic unit tests and the fixed 500-seat benchmark. The sort-vs-scan assignment parity
test runs only at n=7, and the library now carries two normative assignment definitions whose equivalence is
load-bearing.

**NF8. "Hosted custody moved to managed KMS" describes latent capability, not current custody.**
KMS enforcement binds only a hypothetical `main`-branch production release; the actually running isolated deployment
remains fully entitled to hot env-var keys (checked only for role distinctness off-main), and nothing verifies whether
KMS is configured there. The commit language overstates today's operational posture.

**NF9. Nonce-gap wedge when a KMS sign fails after nonce reservation.**
The DB nonce allocator reserves before signing; if signing fails (timeout — or NF1) and the business row is later
abandoned, the reserved nonce is never consumed and every subsequent transaction from that signer sits behind the gap.
No maintenance job detects allocator-vs-network nonce drift or fills orphaned gaps (rebroadcast only covers rows that
already hold signed bytes).

**NF10. Chain-signing auditability stops at CloudTrail; error taxonomy collapsed.**
No application-side ledger binds digest → KMS request → purpose for the EVM roles (the evidence and wallet paths do
have equivalents), so reconstructing "what did the credential issuer sign" requires chain archaeology — and CloudTrail
logs that a signature happened, not what was signed. The keeper's timeout wrapper collapses key-mismatch, throttling,
and outage into one opaque error, erasing the misconfiguration-vs-incident distinction.

**NF11. The keeper and web KMS modules have quietly diverged, and keeper-vs-web signer distinctness is unchecked.**
Independent copies of DER parsing, SPKI parsing, and timeout wrapping differ materially in strictness (the keeper
validates the SPKI curve; the web module takes the last 65 bytes on faith; the DER divergence produced NF1). The
keeper's key/address lives in a separate env namespace no readiness check cross-references against the web roles.

### Low

The v4 deployment registry is empty while the shipped keeper/Ponder/app already speak the v4 ABI — end-to-end
settlement is currently impossible against any live deployment, and readiness gates 2/5 still instruct operators to
settle "on the configured v3 deployment," which the current source cannot do. Expected under the atomic-redeploy
doctrine, but the gate text has drifted.

## Strengths (this round)

- **Remediation fidelity.** Nearly every round-1 recommendation was implemented as specified or better: the beacon
  entropy fix went to an on-chain verifier rather than a register note; the late-reveal contradiction was resolved at
  the protocol level; the rater-identity re-keying shipped with migration tests covering the exact dead-end the review
  described; deletion receipts went from fabricated to measured-and-verified. Truthful-disclosure fixes (W3) chose
  honesty over cosmetics.
- **The interim safety posture is correct.** Rather than shipping half-built gates, adaptive reduction is disabled
  outright with an explicit machine-readable reason, and the register carries the disabled state as a gate. Same
  pattern for SP (experimental, fee-capped) and real money (economics review gate).
- **KMS implementation depth where it is right.** KeySpec/KeyUsage/algorithm verification, key-ID echo pinning,
  address-recovery binding on every signature, low-s normalization, mutual exclusion between local and KMS
  configuration, DB-serialized nonce allocation, trust-anchor fingerprint checks on the evidence and wallet signers —
  the design matches published best practice almost point for point (the defect is in one parser, not the
  architecture).
- **The settlement hardening's test posture.** A normative 500-seat gas benchmark with per-transaction ceilings
  (7.88M measured vs 10M ceiling for seed finalization, 60M CI lifecycle bound), deploy-script rejection of EOA
  rotation authorities and codeless verifiers, and boundary tests for the 16,384-byte ciphertext cap.
- **Pricing is evidence-based and in-market.** The $99 anchor exactly matches the gotoHuman Team tier and sits under
  HumanLayer's $100/user; the 10% execution fee is at the low end of comparable takes (MTurk 20–40%, Prolific 33–43%,
  Fiverr 20%+), defensible as a penetration price with documented headroom. The plan's forward-only fee semantics
  (quotes pin `feeBps`) and its refusal to quantify competitors' internal costs show the claims discipline extending
  into marketing.
- **The register still tells the truth about the mechanism.** Platform-synthetic gold, cross-round correlation
  analytics, qualified-reviewer economics, and the SP residual are all held open as blocking gates rather than
  declared solved by the interim mitigations. (NF3 is the exception that proves how load-bearing this register is.)

## Improvement ideas

### Immediately (before any further KMS or contract work builds on these)

1. **Fix the DER parser and consolidate to one shared KMS module.** Apply the keeper's canonical-strict logic (high-bit
   check only when no pad was stripped), extract a single package consumed by keeper and web, and replace
   deterministic fixtures with property tests over hundreds of random hashes plus explicit padded/non-canonical/
   negative/truncated vectors (NF1, NF11). Add a live sign-and-recover smoke test against real AWS KMS as the evidence
   for any capability flag.
2. **Split the scoring beacon round from the tlock disclosure round before freezing v4.** Add `scoringBeaconRound` to
   `RoundTerms`, validated arithmetically (quicknet has fixed genesis/period) to emit strictly after `revealDeadline`,
   and feed only it into `finalizeScoringSeed` (NF2). One uint64 and one validation line now; impossible after
   deployment. Update the RBTS spec section title to be true again.
3. **Close the audit gap and reconcile the register.** Run the audit/remediation loop over every commit since
   `248b2fff` (KMS migration, settlement hardening, wallet exchanges); correct register line 17; and adopt the rule
   that release-capability flags flip only in a dedicated, audit-reviewed commit with recorded evidence — never in the
   implementing commit (NF3, NF8).

### Before the v4 deploy

4. **Neutralize the seed-vs-fallback race**: make exactly one finalization path live at any time (disable seed after
   `beaconFailureDeadline`, or require an extra disclosed grace before fallback) and raise `MIN_BEACON_GRACE` from 5
   minutes to hours — drand output never expires, so the grace only needs to outlast drand outages (NF6). Pin the
   chosen rule with a regression test.
5. **Implement, specify, and benchmark the real drand verifier in-repo**: a reference EIP-2537 quicknet verifier, a
   written proof-format spec (proof = raw signature; `randomness == sha256(signature)`), Solidity/JS parity vectors
   against live quicknet-t rounds, deploy-script verification of the verifier's runtime code hash against the audited
   artifact, and a benchmark rerun with the real verifier (NF5).
6. **Restore RBTS-path invariant fuzzing** using the mock verifier's proof helper so solvency/conservation invariants
   traverse verified-seed settlement and the storage re-sort; fuzz the sort-vs-scan parity across sizes up to the
   panel cap, or delete one of the two assignment definitions (NF7).
7. **Broadcast v4 and reconcile gate text** so the flagship paid-path exercise gate is satisfiable again.

### Signing operations (before hosted staging)

8. **Make IAM-principal separation checkable**: cross-role `ROLE_ARN` distinctness (including the keeper) in the
   readiness gate; KMS key policies and trust policies as IaC or signed attestations in CI; longer-term, move
   credential-issuer signing behind a minimal separate service with its own workload identity and rate/shape limits
   (NF4).
9. **Nonce-drift sweep and signing ledger**: a scheduled job comparing allocator vs network nonces with orphan-gap
   filling; an append-only (role, key ARN, digest, purpose, KMS request id, outcome) ledger for EVM roles reconciled
   against CloudTrail and chain activity — unmatched Sign events are a compromise indicator; split the collapsed error
   taxonomy into distinct codes and metrics (NF9, NF10).

### Carried forward from round 1 (still the right next moves)

10. The mechanism gate remains the real product blocker: platform-synthetic gold for the paid public lane, cross-round
    reviewer-pair correlation and payout-address clustering analytics, the preregistered equal-pay experiment, and
    reworked Wilson windows (larger n or SPRT) before adaptive reduction is re-enabled.
11. Under-reporting detection for advisory integrations (cadence baselines, evaluate-rate collapse alarms,
    plugin-side turn counters) — the disclosure half is done, the detection half is not.
12. Scope-churn visibility and profile aliasing for evaluation-profile partitioning; an operator fulfilment console
    for non-deletion subject requests; EUR/SEPA and card rails (the enterprise analysis's own procurement blocker);
    and a reviewer supply-side economics model — none moved this round.
13. Behavioral (rendered-DOM/route-level) guards for the wallet-never-identity invariant and a CI-asserted
    route→session-type→role authorization matrix — the register's own guard-style debt.

### Product

14. **Hold the 10% fee as a wedge, not a ceiling.** Market comparables sustain 20–43%; the "reviewers keep 90%" story
    is a genuine differentiator against Prolific (57–67% to participants) and MTurk. If margin pressure comes, prefer
    decision-pack pricing and the deferred $1k+/mo assurance tier over touching the fee — the fee is the marketing.
15. Next review round should cover what this one could not: the evidence/webhook/attestation pipeline end-to-end
    semantics, and the reworked setup/automatic-grant lifecycle against confused-deputy and replay.

## External research notes

- **HITL pricing.** Entry paid tiers for AI-review SaaS cluster at $99–100/mo (gotoHuman Team $99, HumanLayer Pro
  $100/user); per-judgment reference points are $0.02–$0.10 for commodity checks (A2I, MTurk) and ~$1–1.50 all-in for
  a five-minute vetted-human judgment (Prolific, whose corporate take is 42.8%); marketplace takes for human-judgment
  platforms run 20–43%. RateLoop's $99 anchor and 10% fee are squarely in-market, at the generous end.
- **KMS chain signing.** The published pitfall list — DER r/s extraction, low-s normalization, recovery-id derivation
  by address recovery, per-role keys with separate IAM principals, DB-backed nonce tracking with drift reconciliation,
  durable sign-then-broadcast queues, CloudTrail reconciliation against an app-side ledger, multi-region key replicas
  for DR — matches the implemented architecture closely except for the four gaps flagged above (parser defect, IAM
  principal separation, nonce-gap repair, signing ledger). Notably, the literature's first warning (DER parsing) is
  exactly where the defect landed, and its standard prescription (use a battle-tested shared adapter, property-test
  the parser) is the fix.

## Method

Two status-sweep agents re-verified all 26 round-1 findings against source at `1686824c`, cross-checking the repo's own
remediation records rather than trusting them; two dimension agents reviewed the settlement-core hardening and KMS
migration in depth; two research agents surveyed HITL pricing and KMS signing practice. Four further dimension agents
and the adversarial-verification stage were interrupted by session limits; in compensation, the three highest-severity
new findings (NF1, NF2, NF3) were manually re-verified against source during synthesis, including an empirical
reproduction of the DER-parser rejection rate (142/200 valid signatures rejected). Severities on NF4–NF11 are
single-reviewer assessments; treat them as provisional until triaged.
