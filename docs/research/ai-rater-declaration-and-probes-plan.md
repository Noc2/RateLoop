# AI Rater Declaration And Optional Probes: Implementation Plan

Plan date: 2026-05-08

This plan specifies the easiest implementable AI rater verification layer
for RateMesh, drawing on the verification ladder discussion in
[`social-graph-reputation-rating-system-review.md`](./social-graph-reputation-rating-system-review.md).
It targets Phase 1 of the verification ladder — signed declaration plus an
optional one-shot probe at declaration time — and is designed to ship in
roughly two engineer-weeks without depending on zkTLS, TEEs, or zkML.

The constraint that shapes the design: **probes are optional, and they only
run when the operator first declares or when a re-declaration changes a
model-behavior field.** No recurring protocol-initiated probing. Ongoing
safety after declaration comes from passive behavioral drift detection
(using data the protocol already has) and an event-driven community
challenge mechanism (anyone can audit, with skin in the game).

This plan composes with the rest of the system:

- It does not replace cluster discounting, calibration gating, or the
  effective-independent-units USDC payout formula. Those still apply.
  Declaration buys higher caps and a small bounded multiplier; it never
  removes cluster discount.
- It is structurally analogous to the optional Self.xyz design in
  [`optional-self-social-graph-reputation-design.md`](./optional-self-social-graph-reputation-design.md),
  but for AI raters rather than humans.
- It uses the same MREP locking primitives the new reputation token
  exposes; no new token machinery.

Phase 2 (zkTLS via Reclaim Protocol; TEE attestation via Phala/Atoma) and
Phase 3 (zkML for highest-value rounds) layer on top of the registry
described here. They add new tier flags to the same declaration object
without changing its shape.

## Tiers

| Tier | Declaration | Probe | Bond | Caps and multiplier |
| --- | --- | --- | --- | --- |
| A0 — Undisclosed | No | No | No | Default. Lowest caps. Cluster discount applies normally. |
| A1-Unverified | Yes | Skipped | Yes | Modest cap uplift. Operator is on record and slashable. |
| A1-Verified | Yes | Passed | Yes | Larger cap uplift. Small bounded multiplier (e.g. 1.05–1.15x). |

A2 (zkTLS) and A3 (TEE) are deferred. They are added later as additional
tier flags on the same declaration object.

The choice between A1-Unverified and A1-Verified is the lever that respects
"probes are optional." Either is a valid working tier; A1-Verified is the
upgrade for operators who want higher caps in exchange for a one-shot
verification.

## Declaration Object

EIP-712 typed message stored in a new `RaterDeclarationRegistry` contract:

```text
RaterDeclaration {
  rater:                address   // wallet that submits ratings
  operator:             address   // who controls the rater (may equal rater)
  modelClass:           uint8     // 0=closed-API, 1=open-weight,
                                  // 2=fine-tuned, 3=ensemble
  modelId:              bytes32   // for open-weight: hash of weights
                                  // for closed-API: keccak256("anthropic/...")
  provider:             bytes32   // hash of provider name (or zero)
  endpointHint:         bytes32   // hash of endpoint URL, kept private
  promptTemplateHash:   bytes32
  retrievalConfigHash:  bytes32   // zero if none
  toolingHash:          bytes32   // zero if none
  version:              uint32    // increments on every re-declaration
  effectiveEpoch:       uint64
  expiresAtEpoch:       uint64    // optional
  disclosure:           uint8     // 0=private, 1=tier-only, 2=full-public
  nonce:                uint96
}
```

Signature is by `operator`. The rater wallet links to its operator
one-to-many (one operator can run several rater wallets, all sharing the
operator's bond and clustering treatment).

The hashed fields keep private inputs out of public state while still
letting the protocol detect changes. Endpoint URLs are never published; only
their hashes are on chain. Operators with privacy concerns can keep all
declarations at `disclosure = 0` and still benefit from the tier uplift.

## Bond

Operator posts `MIN_DECLARATION_BOND_MREP` when first declaring. Bond:

- locked while any declaration is active;
- slashable through the challenge mechanism on proven mismatch;
- partially slashable on behavioral drift past a threshold;
- fully refundable on declaration retirement after a cooldown if no
  challenges are pending.

Bond size scales with the cap uplift the operator wants. Larger bonds
unlock higher A1-Verified caps. This makes the deterrent proportional to
the abuse opportunity. Bond denomination is MREP rather than USDC because
the protocol already has the locking primitives and because reputation-
denominated bonds align operator incentive with long-term protocol health.

## Optional One-Shot Probe

The probe is triggered only when:

1. The operator submits a **first declaration**, or
2. The operator submits a **re-declaration that changes any of:**
   `modelClass`, `modelId`, `provider`, `promptTemplateHash`,
   `retrievalConfigHash`, or `toolingHash`.

Field changes that do not touch model behavior (for example,
`endpointHint` rotation, `expiresAtEpoch` extension) do not trigger a probe.

The probe lives in a new `packages/prober` service or as a module in
`packages/keeper`. Flow:

```text
operator -> registry: submit declaration (with bond)
operator -> prober:   one-shot ephemeral credential for endpoint
prober -> endpoint:   N probe queries (typically 8-32, bounded)
prober -> detector:   aggregate behavioral evidence
detector -> registry: probe result + library version hash, signed
registry:             tier set to A1-Unverified or A1-Verified
```

If the operator never grants the ephemeral credential within a window,
the declaration finalizes as A1-Unverified by default. The probe never
runs without the operator's explicit handoff. This is what makes the
probe operator-controlled and optional.

Concrete protections:

- **Cap probe cost.** ≤ 50 prompts per probe; ≤ ~$0.10 in API costs at
  typical rates. Operator picks up the cost (their endpoint, their key).
- **Probe runs on operator's endpoint.** Not on a RateMesh-hosted proxy
  — the operator's own infrastructure. Closer to ground truth and avoids
  becoming a hosted-AI service.
- **Single window.** Probe completes within roughly five minutes or the
  slot expires; operator can retry by submitting a fresh declaration.
- **Probe library is versioned.** Result includes the library version
  hash so probes from different versions are distinguishable in the
  audit trail.

## Probe Library

Curated set of canary prompts per `(modelClass, modelId)` pair. Five
probe categories:

- **Identity probes.** System-prompt leak attempts, characteristic
  refusal phrasings. Each model family has stable refusal patterns; a
  model claiming to be Claude that refuses with OpenAI-style language is
  a red flag.
- **Tokenizer probes.** Questions whose responses depend on tokenization
  quirks (BPE artifacts, character-counting on words with rare tokens).
  Tokenizers are largely unique per family.
- **Numerical probes.** Long-precision arithmetic, recurring decimals,
  large-number boundary cases. Different families produce stably
  different errors.
- **Stylistic probes.** Open-ended prompts where embedding distance to a
  reference response distribution discriminates between families.
- **Knowledge-cutoff probes.** Questions about post-cutoff events where
  each model has a characteristic refusal or hallucination pattern.

Each probe encodes:

```text
{
  id, version, weight,
  prompt,
  expectedFeature: regex | numericRange | embeddingSimThreshold,
  declaredModelMatchScore(response) -> 0..1
}
```

Detectors aggregate probe scores into a confidence value. Two thresholds:

- `PROBE_CONFIDENCE_THRESHOLD_PASS`: above this, declaration becomes
  A1-Verified.
- `PROBE_CONFIDENCE_THRESHOLD_FAIL`: below this, declaration is rejected;
  operator may revise and resubmit.
- Between the two: declaration finalizes as A1-Unverified (probe
  inconclusive).

Probe library secrecy. Categories of probes are public; specific prompts
are private and rotated periodically (for example, 25% rotation each
quarter). This raises the cost of memorization without making the test
fully secret. The library version hash is public and on chain.

## Detector Ensemble

Three detectors, each independently scored, then combined:

1. **LLMmap.** [github.com/pasquini-dario/LLMmap](https://github.com/pasquini-dario/LLMmap),
   MIT license, ships pretrained PyTorch weights for 52 LLM versions.
   Run as a Python subprocess; supplies a probability distribution over
   its known set. If the declared model is in its set, compare directly.
   If not, use the distribution as a sanity check (the predicted top
   model should at least be plausible).
2. **Pattern-matching rules.** Implemented in TypeScript inside the
   prober. Cheap, deterministic, transparent. Catches the easy lies
   (Claude claiming to be GPT and vice versa) and gives a result that
   does not depend on a research-grade dependency.
3. **Embedding-similarity probes.** Embed the response and compare to a
   reference distribution per declared model. Use a fixed, versioned
   embedding model (OpenAI, Voyage, or open-weight). Phase 1.5 — not
   required for v0.

Aggregator: weighted vote with conservative defaults. A single detector
flag does not fail the probe; persistent disagreement across detectors
does. Library and aggregator versions are part of the on-chain result so
changes are auditable.

LLMmap considerations: ~291 stars and small commit count on the public
repo. Stable enough to embed but not actively maintained as a product.
Treat its output as one feature among several, not as ground truth. Re-
evaluate against newer fingerprinting research (for example,
[RoFL](https://arxiv.org/html/2505.12682), 2025) at the quarterly library
review.

## After-Declaration Safeguards

Three passive mechanisms keep the operator honest after the one-shot
probe, without pinging the operator's endpoint.

### Behavioral Drift Detection

The scorer computes statistics on the operator's public rating history:

- prediction-error distribution per category;
- response timing histogram (commit-to-reveal latency);
- vote-pattern entropy and clustering proximity;
- feedback-text length and stylistic features (if feedback is enabled).

A simple change-point detector (CUSUM or Page-Hinkley) flags substantive
shifts. On flag:

- independence multiplier drops gradually toward A0 levels;
- a public soft notice is posted on the rater profile inviting re-
  declaration;
- the operator can re-declare to re-enter A1-Verified (which retriggers
  the probe per the rules above).

This is fully passive — no protocol-initiated queries to the operator. It
uses data the protocol already indexes.

### Community Challenge

Anyone can challenge an operator's declaration by:

1. Posting `CHALLENGE_BOND_MREP`.
2. Submitting reproducible evidence: signed probe transcripts collected
   from the operator's declared endpoint. The challenger runs the probe
   themselves; the protocol does not.
3. Specifying which feature they claim is mismatched.

Resolution flow:

```text
challenge submitted
  -> operator notification window (e.g., 48h)
  -> operator may re-declare (clears the challenge, retriggers probe
     if applicable) or contest with counter-evidence
  -> arbitration:
       - if the protocol's prober elects to re-test (one-shot, with
         the operator's grant), result is decisive
       - else governance/arbiter resolves based on submitted evidence
  -> on success: challenger earns CHALLENGE_REWARD_FRACTION of operator
     bond; operator tier drops to A0 with cooldown
  -> on failure: challenger bond is slashed
```

This is the canonical "anyone can audit with skin in the game" pattern.
It converts continuous probing into an event-driven mechanism.

### Bond Slash On Detected Mismatch

On a successful drift flag or successful challenge, the bond is partially
or fully slashed depending on severity. Recent USDC payouts can also be
partially clawed back through the existing escrow flow, capped to bond
size to keep the math bounded.

## Re-Declaration

The operator can re-declare at any time. Re-declaration:

- always creates a new declaration record with `version + 1`;
- triggers a new probe only if the changed fields touch model behavior;
- never invalidates existing rating history — past ratings stand;
- can preserve A1-Verified status seamlessly if the new probe passes;
- returns the old bond and locks the new one (or extends in place if
  the bond size is unchanged).

Operators are encouraged to re-declare proactively when they upgrade
prompts or models. Failing to re-declare and letting drift detection
catch it later is more expensive than a self-initiated re-declaration.

## Implementation Breakdown

### Solidity

New contract: `packages/foundry/contracts/identity/RaterDeclarationRegistry.sol`.
Responsibilities:

- store current and historical declarations per rater;
- hold operator bonds in MREP using existing lock primitives;
- expose tier and version to `RoundVotingEngine` and the off-chain scorer;
- accept signed probe results from a probe-runner role with a key managed
  by the protocol multisig (replaceable, like the keeper);
- implement challenge state machine: open challenge, counter-evidence
  window, resolution, slash, reward;
- emit events for every state change (declaration, probe result, drift
  flag, challenge, slash).

Updates to existing contracts:

- `RoundVotingEngine.sol`: when computing `usableWeight`, multiply by a
  tier-dependent factor sourced from the registry. Bounded — never
  larger than the multiplier ceiling in the spec.
- `MeshReputation`: add a `lockForDeclarationBond` accounting role.
- `CuryoGovernor`: declaration parameters are governance-controlled with
  hard floors during bootstrap.

### Off-Chain Prober

New service in `packages/prober`, or as a module in `packages/keeper` if
co-locating with the existing keeper service is cheaper. Components:

- HTTP API: `POST /probe` accepts a declaration ID and an ephemeral
  endpoint credential. Returns a probe job ID.
- Probe runner: drives the probe queries against the operator's endpoint.
  Concurrency-bounded.
- Detector ensemble: LLMmap subprocess, pattern matchers, embedding
  similarity (Phase 1.5).
- Result publisher: signs the aggregated result and posts to
  `RaterDeclarationRegistry`.
- Library manager: loads probe library, versioning, rotation cadence.

Operationally lightweight. LLMmap inference fits in a small CPU footprint;
embedding models can be local or hosted. The service runs alongside
keeper and can share its monitoring and deployment posture.

### Indexer

New tables in `packages/ponder`:

- `rater_declaration` — current declaration per rater
- `rater_declaration_history` — all versions
- `probe_result` — outcome, library version hash, detector breakdown
- `behavioral_drift` — detector outputs over time
- `declaration_challenge` — challenge lifecycle
- `bond_event` — bond locks, slashes, refunds

New views:

- per-rater current tier
- per-rater drift score
- per-operator aggregate cluster info (for cluster scoring)

### Frontend

Operator side (`packages/nextjs`):

- "Declare model" form with disclosure controls (private, tier-only,
  full-public);
- Bond size selector with caps preview;
- Probe opt-in with cost estimate and consent flow;
- Probe result view with detector breakdown;
- Re-declaration flow with diff against current declaration;
- Bond management (top-up, retire).

Public side:

- Rater profile shows tier, declared model (if disclosure permits), last
  probe result, drift score;
- Challenge form with bond requirement and evidence upload;
- Public log of declarations, probes, challenges, slashes.

### SDK

Helpers in `packages/sdk`:

- AI raters: build the EIP-712 declaration, sign it, post bond, request
  probe slot, reveal probe credential, observe result;
- Apps: read current tier and disclosed model fields when rendering
  rounds.

## Probe Library Lifecycle

- Initial library covers the major model families: GPT (3.5 / 4 / 4o /
  5), Claude (3 / 3.5 / 4 / 4.5 / 4.6 / 4.7), Gemini (1.5 / 2 / 2.5 /
  3), Llama (3.x / 4), Mistral (Mixtral / Codestral / etc.), Qwen,
  DeepSeek. Roughly 6 to 10 probes per family at launch.
- Library is maintained in a versioned JSON file in the repo. Updates are
  committed openly so the change record is public, but the prompts
  inside private categories are not surfaced in plaintext (encrypted at
  rest, hashes published).
- Quarterly review: 25% rotation, plus addition of new models on
  release. Maintenance is light — about one engineer-day per quarter at
  steady state.
- Adversarial review: invite the existing security review program to
  attack the probe set. Disclose findings publicly.

## Parameters

Defined in the spec, governance-mutable but with hard floors during
bootstrap:

```text
MIN_DECLARATION_BOND_MREP                 // min bond for A1
A1_VERIFIED_BOND_MULTIPLIER               // bond required for higher caps
PROBE_QUERY_BUDGET                        // max prompts per probe
PROBE_CONFIDENCE_THRESHOLD_PASS           // e.g., 0.80
PROBE_CONFIDENCE_THRESHOLD_FAIL           // e.g., 0.40
PROBE_LIBRARY_VERSION                     // hash, updated on rotation
DECLARATION_EXPIRY_EPOCHS                 // optional, can be zero
A1_UNVERIFIED_CAP_MULTIPLIER              // caps for A1-Unverified
A1_VERIFIED_CAP_MULTIPLIER                // caps for A1-Verified
A1_VERIFIED_INDEPENDENCE_BOOST            // bounded, e.g., 1.10
DRIFT_FLAG_THRESHOLD                      // statistical threshold
DRIFT_FLAG_INDEPENDENCE_DECAY             // multiplier reduction per epoch
CHALLENGE_BOND_MREP
CHALLENGE_REWARD_FRACTION                 // e.g., 0.50 of slashed bond
CHALLENGE_OPERATOR_RESPONSE_WINDOW        // e.g., 48h
SLASH_FRACTION_DRIFT                      // fractional bond slash on drift
SLASH_FRACTION_CHALLENGE                  // fractional bond slash on challenge
```

## Security And Edge Cases

- **Probe leakage and memorization.** Mitigated by category-public-prompt-
  private design plus quarterly rotation. An operator who memorizes a
  rotated-out probe set still has to pass current probes.
- **Operator runs the declared model only during the probe, then swaps.**
  Caught by passive drift detection and by community challenges. Bond and
  clawback bound the upside.
- **Self-hosted fine-tunes.** Fingerprinting fine-tunes is hard. Allow
  operators to register custom-tune declarations with a higher bond,
  weaker probe weight, and stronger reliance on drift and challenge.
- **Multi-model raters.** Allow declaring multiple
  `(modelId, applicabilityHash)` entries with a routing policy hash.
  Probe each declared model.
- **Operator endpoint privacy.** Endpoint URL never published; only its
  hash is on chain. Probe credentials are ephemeral.
- **Probe runner trust.** This is a centralization point, similar to the
  off-chain scorer. Phase 2 should add multiple independent probe
  runners with bonds, modeled on the multi-scorer challenge protocol
  proposed in the review.
- **Operator wants to retire cleanly.** Retirement closes the
  declaration after a cooldown (for example, 30 days) during which
  challenges may still slash.
- **Closed-API model spoofing.** Even with a passing probe, the operator
  could route through Anthropic but cherry-pick or post-process the
  response. Phase 2 (zkTLS) is the structural answer; in Phase 1, drift
  detection and community challenge are the practical defenses, and
  cluster discount still applies.

## Phased Delivery

A realistic two-week build with one engineer for the v0 path:

| Day | Deliverable |
| --- | --- |
| 1–2 | Spec freeze; pick parameters; commit probe-library v0 (top three model families) |
| 2–4 | `RaterDeclarationRegistry` contract and tests |
| 4–6 | Bond locking in `MeshReputation`; `RoundVotingEngine` tier read |
| 6–9 | Prober service: probe runner, LLMmap subprocess, pattern matchers |
| 9–11 | Ponder schema and indexers; rater profile display |
| 11–13 | Frontend declaration flow and opt-in probe UX |
| 13–14 | E2E tests, adversarial review of probe library, doc update |

Phase 1.5 (later, optional, not blocking v0):

- Embedding-similarity detector;
- Drift detection — needs roughly two weeks of post-launch ratings as a
  baseline before it produces useful signal;
- Community challenge UI;
- Multi-probe-runner federation.

Phase 2 layers on top of this exact registry without disturbing it. A2
(zkTLS via Reclaim Protocol) and A3 (TEE attestation via Phala or Atoma)
are added as new tier flags on the same declaration object.

## Test Plan Highlights

- **Foundry unit tests.** Declaration submission, bond lock, version
  increment, tier read, slashing math, challenge state machine.
- **Foundry invariant tests.** Bond conservation across declare, lock,
  slash, refund. Tier monotonicity (A0 → A1-Unverified → A1-Verified is
  the only allowed promotion path; demotions are explicit events).
- **Adversarial probe tests.** Operator declares Claude, runs Llama —
  probe must catch with > 80% confidence on probe set v0. Operator
  declares GPT-4, runs GPT-3.5 — catch rate > 70%. Document false-
  positive rate against honest operators.
- **Drift detector tests.** Synthetic time series with injected behavior
  shifts at known epochs; detector should flag within N epochs.
- **Challenge end-to-end.** Honest challenge succeeds; spurious challenge
  fails and slashes challenger bond.
- **Re-declaration tests.** Field changes that do not touch behavior do
  not trigger a probe.
- **Frontend Playwright.** Operator declares, opts into probe, passes;
  operator declares, skips probe, lands in A1-Unverified; operator re-
  declares with a model change, probe re-runs.

## What This Buys

- A real Sybil-cost increase against AI rater farms with a production-
  ready, all-DIY toolchain — no zkTLS, TEE, or zkML dependency.
- A clean upgrade path: Phase 2 snaps onto the same declaration object
  as new tier flags.
- Operator burden bounded to one signed declaration, one optional probe,
  and a bond they can retire.
- Protocol burden bounded to: one new contract, one off-chain probe
  service, one indexer schema addition, light frontend work. Roughly two
  engineer-weeks for v0.
- Threat coverage that fits the constraint: probes only run when
  declarations change; ongoing safety comes from passive drift detection
  plus open community challenges, never from continuous protocol-
  initiated probing.

## References

- LLMmap repository:
  https://github.com/pasquini-dario/LLMmap
- LLMmap paper (USENIX Security 2025):
  https://www.usenix.org/system/files/usenixsecurity25-pasquini.pdf
- Attacks and Defenses Against LLM Fingerprinting (2025):
  https://arxiv.org/abs/2508.09021
- RoFL: Robust Fingerprinting of Language Models (2025):
  https://arxiv.org/html/2505.12682
- Reclaim Protocol JS SDK (Phase 2 reference):
  https://github.com/reclaimprotocol/reclaim-js-sdk
- Phala Confidential AI (Phase 2 reference):
  https://phala.com/confidential-ai
- Atoma Network (Phase 2 reference):
  https://docs.atoma.network/documentation/get-started/overview
- ERC-712 Typed Structured Data:
  https://eips.ethereum.org/EIPS/eip-712
