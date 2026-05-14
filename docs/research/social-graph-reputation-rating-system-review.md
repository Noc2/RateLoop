# Review: Social Graph Reputation Rating System

Review date: 2026-05-08

Implementation status: archived review of an older research draft, not the
current protocol plan. The current pre-deploy implementation removes
protocol-enforced cluster discounts, independence multipliers, identity
reward multipliers, and AI-specific accountability rules. See
`docs/implementation-plan.md` for the canonical human-credential and
launch-anchor policy. Social-graph trust scoring and trust attestations are
also historical research only; they are not part of the current contracts,
indexer schema, SDK, app UI, or payout policy.

This note is an independent review of
[`social-graph-reputation-rating-system.md`](./social-graph-reputation-rating-system.md).
It does not propose a competing design. It identifies the parts of that
specification that are load-bearing and well-supported, the parts that look
weaker than they read on first pass, and concrete changes that would make the
proposal more robust before contracts and indexer schema are frozen.

The summary view: the document is unusually careful for a reputation/oracle
proposal. The threat-model framing (Sybil farms cannot be eliminated, only
made slow, capped, and inspectable), the two-score split (`credibility` and
`independence`), and the cluster-aware leave-one-out scoring are the right
primitives. The weaker parts are concentrated in places the document treats
as parameter tuning: cluster detection, bootstrap seeding, the residual
beauty-contest dynamic in predicted-rating scoring, AI rater bias controls,
account/key recovery, and the centralization profile of the off-chain scorer.
Each of those is doing real work in the security argument and deserves
spec-level treatment, not "tune in launch."

## Scope

This review covers the rating mechanism, reputation scoring, social-graph
discount, USDC payout split, governance posture, and threat model in
[`social-graph-reputation-rating-system.md`](./social-graph-reputation-rating-system.md).
It does not re-evaluate the brand reframe in
[`social-graph-reputation-brand-reframe.md`](./social-graph-reputation-brand-reframe.md),
the optional-Self alternative in
[`optional-self-social-graph-reputation-design.md`](./optional-self-social-graph-reputation-design.md),
or the commit-reveal liveness work in
[`commit-reveal-reliability-and-privacy.md`](./commit-reveal-reliability-and-privacy.md),
except to point out where they interact with the recommendations below.

## Strengths

### Honest threat framing

The document opens by accepting Douceur's result: without a trusted identity
authority, Sybil resistance is a discount-and-delay problem, not a
prevention problem. That single reframing is what lets the rest of the design
avoid the usual proof-of-personhood trap, where one identity vendor becomes
the protocol's single point of failure and its onboarding ceiling at the
same time. The 2025 collusion-resistance literature continues to confirm
that there are no general collusion-proof mechanisms in peer prediction
settings either, so the right posture really is "make capture expensive,
slow, and visible," which is what the proposal targets.

### Two-score model

Separating `credibility` (earned from settled prediction history) from
`independence` (derived from graph structure, attestation quality,
correlation, and risk signals) is the cleanest factoring this kind of
system can have. Most production reputation systems collapse those into one
number and then have to retrofit Sybil discounts at scoring time. Keeping
them orthogonal lets cluster discount act as a multiplier without
contaminating earned signal. The decision to use `sqrt(credibility) *
independenceMultiplier * stakeConvictionMultiplier` keeps each term capped
and prevents linear runaway in any one dimension.

### Predicted final rating instead of binary up/down

Binary voting on subjective content is structurally a Schelling-point game,
and the document is honest that predicted-final-rating just makes that game
explicit. The shift to fixed-bin (1000-9900 bps) ratings with weighted
median aggregation is a strong default: gas-bounded, robust to single
extreme outliers, auditable, and a better fit for subjective scoring than
mean-based aggregation. It also makes scoring rules (proximity to LOO
median, prediction error in bps) clean to specify on chain.

### Single sealed round as the default

The default lifecycle (commit -> reveal -> settle, no iterative rounds) is
correct for an open rating network. The Lorenz et al. result on social
influence collapsing the wisdom of crowds is the relevant counterexample
to multi-round visible deliberation; running iterations by default would
amplify exactly the dynamic the protocol wants to avoid. The proposal's
list of explicit reopen triggers (low independent participation, high
dispersion, suspected manipulation, high-value bounty, formal challenge)
correctly treats a second round as an exception with concrete causes.

### Cluster-aware leave-one-out scoring

The escalation from leave-one-out (LOO) for normal rounds to
leave-one-cluster-out (LOCO) for payout-sensitive rounds is the right
instrument against coalition-style capture. A coalition that can move the
final median can still earn by predicting the moved median; LOCO removes
that gain by scoring each cluster against the median computed without it.
This is the same insight that drives Connection-Oriented Cluster Matching
in Gitcoin's quadratic-funding work: cooperation is fine, but matching
should not pay for the cooperation itself.

### USDC paid by effective independent units, not wallets

The payout split (`bountyPool / effectiveParticipantUnits`, then
cluster-capped, then bounded reputation multiplier inside cluster) is the
strongest part of the proposal's economic model. It directly prices in the
"farm many medium-reputation wallets" attack and turns it into a
self-defeating strategy: more correlated wallets compress the cluster's
effective unit count. The choice of a small reputation multiplier
(`0.75x` to `1.25x` inside a cluster) keeps the marginal payout from
becoming a linear function of farmed reputation.

### Conservative slashing philosophy

Burning reputation only meaningfully for non-reveal, spam, clear
manipulation, or extreme misses in high-confidence rounds (and not for
ordinary disagreement) preserves useful dissent. Most prediction-market
oracle designs (UMA, Augur) lean harder on slashing and end up driving
participation toward consensus-following because deviation is too
expensive. RateMesh's stance of small, capped error penalties and larger
liveness penalties is better calibrated for subjective content.

### Calibration before USDC

Requiring `CALIBRATION_ROUNDS_REQUIRED`, `MIN_REVEAL_RELIABILITY`,
`MIN_CATEGORY_BREADTH`, `MIN_ACCOUNT_AGE_EPOCHS`, and `MAX_RISK_SCORE`
before USDC eligibility is the right gate. It converts the "fresh wallet
sees a bounty and farms" path from a profitable one-shot into a cost-up-
front commitment. Combined with low initial emissions and bounty caps, it
also gives the scorer time to observe behavior before money flows.

### Public auditability of payout decisions

Publishing epoch roots, public scoring inputs, round-level payout reasons,
and user-facing labels (calibration-only, cluster cap, low round quality,
payout cap, prediction error) is a non-trivial commitment that closes the
worst failure mode of opaque reputation systems: "the scorer says you
don't qualify and won't tell you why." The willingness to surface coarse
reasons publicly while keeping device/session inputs private is the
correct tradeoff.

### No legacy migration

Refusing to migrate HREP balances into the new reputation token is the
right call. Any carryover would import the existing distribution's farming
history and create an immediate cluster the new graph would have no signal
to discount. A clean genesis is also a much simpler argument to make to
auditors and to users.

### Bootstrap guardian and aged-reputation governance

Excluding fresh reputation from governance weight, requiring aged
reputation for proposal thresholds, and keeping a bootstrap guardian or
timelock during the first epochs is the standard mitigation against same-
week farming campaigns turning into protocol control. The proposal applies
all three.

## Weaknesses

The weaknesses below are not arguments against the design. They are points
where the current spec relies on an assumption that the design itself does
not establish, or defers a load-bearing detail to launch tuning.

### Bootstrap independence has no defined seed set

The cluster discount and independence multiplier both depend on the
existence of "established uncorrelated users" against which a new account
can be measured. At genesis there are no such users. The first cohort
becomes the de facto trust baseline regardless of its actual quality.
EigenTrust handles this by requiring an explicit pre-trusted seed set and
documenting it; SybilRank, SybilBelief, and similar graph defenses make
the same assumption explicit. The proposal does not. "Low caps and slow
emissions" delays the problem rather than solving it: a coordinated
bootstrap cohort that stays inside the caps still becomes the graph's
anchor.

### Cluster detection is the load-bearing component and is unspecified

The phrase "cluster" appears throughout the document as if its meaning
were settled. In practice, choosing the cluster algorithm (features,
weights, thresholds, decay, reweighting on new evidence) is the security
argument. Recent graph-Sybil-detection literature has retreated from the
limited-attack-edge assumption that earlier defenses (SybilRank,
SybilLimit, SybilBelief) leaned on, because attackers can and do build
real edges to honest users. Without a concrete clustering specification,
the protocol cannot be evaluated for false-positive rate (community
clusters falsely discounted) or false-negative rate (matured farms
remaining undiscounted). A scorer that gets either wrong undermines the
fairness or the security of the entire system.

### Predicted-final-rating remains a beauty contest

The proposal acknowledges this and partially mitigates with LOO/LOCO
scoring. The residual issue is that the calibration credit
(`max(0, 1 - predictionErrorBps / maxRewardedErrorBps)`) is still maximized
by predicting what the (cluster-excluded) crowd will predict. There is no
reward for surfacing information that would have moved consensus toward a
more accurate position, only for being close to where it ended up. A
sophisticated minority opinion that turns out to be correct is at best
neutral and often penalized. This matters for any rating where the
"correct" answer is partially knowable later (forecasting, code quality,
content factuality) because the protocol systematically underweights the
raters most worth keeping.

### Bayesian Truth Serum is referenced but not adopted

The literature review correctly cites Prelec's Bayesian Truth Serum (BTS)
and the Prelec/Seung/McCoy crowd-wisdom result, but the actual mechanism
(score answers that are more common than people predicted they would be)
does not appear in the vote payload or scoring rule. The 2024-2025 LLM-
era extensions (ElicitationGPT, GPPM/GSPPM, Truthfulness-without-
Supervision) make BTS-style scoring more practical than it was in 2004.
A small additional field ("predict the average other rating") and a BTS-
style score would let the protocol pay for surprisingly common answers,
which is the canonical collusion-resistant subjective elicitation mechanism.
The proposal cites the right papers and then leaves the contribution on
the table.

### Median is robust to outliers but cleanly captured by a majority

Weighted median is the right choice for resisting a single extreme rater.
It is the wrong choice if a single coalition controls more than 50% of
effective weight in a round, because at that point the median is whatever
the coalition wants. The cluster discount is the only thing standing
between "coalition with 60% raw weight" and "coalition with majority
effective weight." The interaction between aggregation choice and cluster
detection is not analyzed. A trimmed mean or weighted geometric median may
behave better under partial coalition pressure for some rating shapes,
and the tradeoff is worth at least a paragraph.

### Leave-one-out is itself gameable in low-N rounds

LOO and LOCO scoring are robust when participation is high and clusters
are small. With small N (which will be the common case in early epochs
and for niche categories), removing one voter or one cluster from a
weighted median can shift it by a full bin or more. A rater can predict
the LOO-shifted median rather than the actual median and earn higher
calibration credit than an honest predictor. The proposal uses
`roundQuality` as a soft multiplier but does not specify a hard floor
below which LOO/LOCO scoring is suppressed in favor of "calibration-only"
status.

### AI rater clustering relies on voluntary disclosure

The AI rater clustering inputs (model/provider/agent version, owner
wallet, prompt template hash, retrieval/tooling configuration hash) are
all voluntarily disclosed. An undisclosed agent simply lies about its
provenance. The protocol cannot verify any of it. Behavioral fingerprints
(reveal timing, prediction patterns, error correlation) do work, but they
can be perturbed cheaply (random delay, calibrated noise injection,
periodic prompt rotation) by an operator who knows they are being
fingerprinted.

### LLM-as-judge biases are not addressed structurally

The 2024-2025 evaluator-bias literature (CALM framework, position bias,
verbosity/length bias, self-preference bias, overconfidence) shows that
AI judges systematically distort scores in predictable directions. If AI
raters are first-class participants, the protocol inherits these biases
without a debiasing layer. The proposal treats LLM-as-judge research as
motivation for clustering but does not adopt the debiasing techniques
(randomized presentation order, length-controlled scoring, ensemble
fusion across diverse model families) that the same line of work
recommends.

### Account and reputation rental remain practically open

Non-transferable reputation prevents on-chain transfer. It does not affect
the off-chain key-rental market, where an attacker pays a high-reputation
account to commit and reveal on their behalf. The threat-model table
mentions this and proposes "fresh signatures for high-value actions, cap
sudden category expansion." Neither addresses the rental case directly,
because the rented key produces fresh signatures and gradual category
expansion just fine. Without a behavioral biometric or staked-identity
attestation tied to the wallet's recent activity, rental remains a cheap
attack on aged reputation.

### Reputation decay is mentioned but not specified

Decay is listed as an input but no curve, half-life, idle floor, or reset
trigger is specified. This is not a minor detail: too slow lets dormant
farms keep their value indefinitely; too fast destroys long-time honest
raters' reputation and incentivizes constant low-effort participation to
avoid decay. Categorical decay (faster decay for stale categories, slower
for active ones) is also unspecified.

### The off-chain scorer is a single trusted operator

`Graph computation should remain off chain in Ponder or a dedicated
scorer at first.` That single sentence concentrates substantial power.
The scorer computes leave-one-cluster-out medians, independence
multipliers, payout caps, and eligibility labels. Epoch-root publication
buys verifiability for anyone willing to recompute, but it does not buy
availability, censorship resistance, or anti-collusion against the
operator. There is no described path for a second scorer to challenge a
bad root, no bond-and-dispute flow, and no fallback if the operator is
compromised, censored, or unavailable.

### No key recovery path for soulbound reputation

Lost or compromised keys leave the user's reputation permanently locked
or in attacker hands. Soulbound reputation is the right primitive for
non-transferability, but it makes recovery a protocol-level question,
not a user-level one. The proposal does not specify any rebinding,
attestation-based recovery, or guardian path. Users with high reputation
have asymmetric incentive to compromise on operational security in
exchange for convenience precisely because they have the most to lose.

### Calibration tasks are themselves gameable

Hidden seeded tasks become known once a calibration task is reused;
maintaining a private question bank is unbounded labor. Duplicated
prompts within a calibration set produce internal consistency credit but
not external validity. Without periodic refresh and adversarial review of
the calibration bank, calibration becomes a memorizable test.

### Governance can rewrite its own bounds

Cluster cap, max stake, reputation decay rate, calibration thresholds,
and emission budgets are all governance-controlled parameters. A cohort
that captures governance during bootstrap, even within initial
conservative settings, can change the rules. The proposal mentions a
guardian/timelock but does not enumerate which parameters are hard-floor-
locked for the bootstrap window and which are governance-mutable from
genesis.

### No quantified Sybil cost curve

A reputation defense should be able to state "to capture X% of the
payout pool, an attacker must spend Y over Z epochs under assumptions
A." The proposal lists qualitative defenses but does not produce this
curve. Without it, parameter choices (calibration round count, max stake,
cluster cap floor) are picked by intuition and become harder to defend
under adversarial review.

### Public independence labels are a privacy surface

Surfacing per-account labels like "low independence" or "cluster-capped"
is honest but functionally identifies which accounts the scorer suspects.
The underlying signals (device, session, routing, timing) are mostly
private, but the boundary can be probed by submitting controlled traffic
and observing label changes. Users do not control their own labels and
have no on-chain remediation path other than waiting.

### No objective-truth backbone for absolute calibration

All scoring is endogenous to the platform's own consensus. A rater that
is calibrated against the platform but systematically wrong against
external ground truth (where any exists) cannot be detected. Even a small
periodic mix of factual or forecasting questions (where ground truth is
verifiable ex post) would let the protocol distinguish "good at
predicting RateMesh consensus" from "good at predicting reality."

### Cap composition is not analyzed

Per-account, per-cluster, per-category, per-requester, per-epoch caps
compose multiplicatively. Their interaction can produce dead zones (where
a legitimate high-reputation rater cannot earn meaningful payout because
some other cap binds first) or incentive cliffs (where a small change in
one input collapses payout). The proposal does not include simulation
results for cap composition under realistic participation distributions.

## Recommended Improvements

The improvements below map back to the weaknesses above. They are ordered
roughly by leverage: earlier items change the security or fairness story
materially; later items are sharpening.

### Define a seed-trust procedure with sunset

Specify a small, public, time-bounded set of pre-trusted bootstrap
accounts used only as graph anchors during the first N epochs. The set
should be small enough to be auditable, transparent in selection, and
explicitly sunset (e.g., loses anchor status by epoch K, no replacements
after epoch K-2). This is structurally what EigenTrust calls pre-trusted
peers. Naming it explicitly and committing to its sunset is a stronger
posture than letting the first cohort silently become the anchor.

### Publish the cluster detection algorithm and version it

Treat cluster detection as a first-class component of the protocol, not
a scorer implementation detail. The spec should name the features used,
their weights, the algorithm class (label propagation, semi-supervised
classification, behavioral clustering), the decay model, and the
versioning rule for upgrades. Run offline simulations against a known-
adversarial dataset (synthetic farms, real social network public
samples) and publish the false-positive and false-negative curves before
launch. Commit to a public changelog for algorithm changes and a notice
period before scoring effects take hold.

### Adopt a partial Bayesian Truth Serum layer

Add a second compact field to the vote payload: a predicted average of
other raters' predictions. Score raters partially on the BTS criterion
(answers more common than people predicted they would be earn extra
credibility). Even a small BTS component shifts the optimal strategy
away from pure consensus-following toward honest reporting of unusual
but justifiable views. Keep the predicted-final-rating as the primary
field; BTS is additive, not a replacement. Recent LLM-era extensions
make this practical for the AI rater path as well.

### Specify minimum effective participant thresholds for each scoring tier

Three explicit floors:

- below `MIN_LOO_VALID_PARTICIPANTS`, the round settles for visible
  rating but does not produce LOO-based reputation deltas, only
  participation/reveal credit;
- below `MIN_LOCO_VALID_CLUSTERS`, USDC payouts are blocked and
  the round is labeled low-confidence;
- below `MIN_HIGH_VALUE_PARTICIPANTS`, high-value bounties either
  reopen or refund.

This converts `roundQuality` from a soft multiplier into hard
preconditions, which is what the security argument actually relies on.

### Add an explicit AI debiasing layer

For rounds with disclosed (or detected) AI raters above a threshold,
apply structural debiasing at scoring time:

- randomize content presentation order across raters to neutralize
  position bias;
- length-normalize predictions when the rated artifact has variable
  length (drawing on AlpacaEval's length-controlled approach);
- require ensemble diversity (different model families, not just
  different prompts) for high-value AI signal;
- penalize correlated reveal timing more aggressively than other
  correlation signals.

These do not require trusting AI rater self-disclosure; they are applied
to all participants but are tuned to the failure modes the LLM-as-judge
literature has documented.

### Specify reputation decay concretely

A first-cut proposal: per-category half-life of 90 to 180 epochs for
inactive raters, with a credibility floor at zero (no negative carry).
Active raters in a category decay at the slower end of the range; fully
inactive accounts in a category decay at the faster end. Governance
parameters but with hard-floor and hard-ceiling bounds for the first
year.

### Add a multi-scorer challenge protocol

Allow any party to run an alternative scorer and publish a competing
epoch root with a bond. If a challenger's root is preferred under a
public verification window (transparent inputs, deterministic
recomputation), the original root is rejected and the challenger earns a
bounty. This converts the scorer from a single trusted operator into a
challenge-resistant role and gives the protocol a defense against scorer
compromise.

### Define a reputation recovery flow

Time-locked wallet rebinding via M-of-N attestation by established
raters with sufficient aged reputation, plus a public dispute window.
Recovery should be slower than normal account use (so it is not a viable
attack vector itself) but possible (so high-reputation users do not lose
years of work to a single key compromise). Recovery events are public
and rate-limited per identity.

### Hard-floor a subset of parameters during bootstrap

A named subset of parameters (cluster cap floor, max stake fraction,
calibration round minimum, governance proposal threshold floor) are
hard-coded in contracts for the first 6 to 12 months with no governance
override. The subset is published in the launch spec along with the
sunset condition (epoch count or independent-reputation-density
threshold, whichever comes later). Other parameters remain governance-
mutable from genesis.

### Quantify the Sybil cost curve

Run economic simulations that produce a published curve of attack cost
versus protocol capture for at least three attacker models: lone
operator with capital, coordinated coalition with shared capital, and
slow-mature wallet farm. The curve becomes part of the spec and
parameter choices have to defend their position on it. This is the
single most useful thing for adversarial review and external audit.

### Mix in objective-truth anchor questions

A small periodic injection (e.g., 5% of rounds in each category) of
questions with verifiable ex-post answers. Raters who do well on
consensus but poorly on anchor questions get a credibility discount on
high-value rounds. This catches "calibrated to the platform but
systematically wrong" raters that pure endogenous scoring cannot
distinguish.

### Add behavioral consistency monitoring

Sudden category jumps, sudden activity spikes, atypical reveal timing
windows, and abrupt cluster changes trigger a temporary independence
multiplier discount and a soft category cap until the behavior persists
across epochs. This is a less-aggressive analogue to credit-card
behavioral monitoring and addresses the rental and key-handover paths
without requiring uniqueness proofs.

### Reconsider an optional, capped Self.xyz signal

The companion document
[`optional-self-social-graph-reputation-design.md`](./optional-self-social-graph-reputation-design.md)
already lays out a hybrid model: Self verification is optional, never
gates participation, and grants higher caps and a small bounded
multiplier. The full-rejection path in the main proposal is defensible
but loses a cheap, high-quality uniqueness signal that does not require
Curyo to operate the verification. Even a strictly optional, opt-in,
capped signal would materially raise the cost of the slow-mature wallet-
farm attack. Worth re-evaluating before contracts freeze.

### Specify a challenge-bond flow concretely

The proposal lists "formal challenge with a bond" as a reopen trigger
without specifying who can challenge, bond size relative to round value,
who arbitrates, what evidence is admissible, and what the upside is for
a successful challenger. This is most of an oracle dispute mechanism;
specifying it half-way is worse than either fully specifying or
explicitly deferring to a future doc.

### Run a structured adversarial review program

Before mainnet, fund a bug bounty pool specifically for: cluster
detection evasion, scorer-root manipulation, payout exploit chains, and
calibration bank inference. Require public disclosure of accepted
findings as part of the launch spec. The cost of running this review is
small relative to the cost of discovering the same exploits post-
launch.

### Simulate cap composition

Build a participation simulator that takes realistic distributions of
rater count per round, reputation per rater, cluster sizes, and bounty
sizes, and produces the per-account effective payout distribution. Use
it to find dead zones and incentive cliffs in the multiplicative cap
stack before launch. Adjust caps so a high-quality independent rater is
not silently capped out by some other binding constraint.

### Privacy-preserving cluster signal where feasible

Where the same cluster discount can be expressed as "this account is
not in any cluster of size > N" rather than "this account is in cluster
C," prefer the former. Zero-knowledge proofs of cluster non-membership
are not yet cheap enough to deploy on every round but are cheap enough
for the high-value path. This reduces the public-label privacy surface
without materially weakening the discount.

### Information-gain rewards on factual-anchor rounds

For the anchor-question subset, raters whose initial prediction
diverged from consensus but converged toward later confirmed ground
truth earn a small information-gain bonus. This directly rewards
independent thought on the rounds where independence can be measured,
and partially counters the residual beauty-contest dynamic.

## Open Questions

Items that the proposal does not take a position on and that should be
resolved before contract freeze.

- Who selects the bootstrap seed-trust set, and on what record? What is
  the public process for sunsetting it?
- What is the minimum independent-cluster count required for LOCO to be
  trusted? How does it scale with bounty size?
- Does the protocol commit to a specific cluster-detection algorithm
  family for v1, or is it scorer-defined?
- What is the policy on calibration-bank refresh? How is bank exhaustion
  handled?
- Do AI raters need any operator on-chain registration, or is the only
  inference channel behavioral?
- What is the dispute jurisdiction (if any) for high-value USDC payout
  disputes? Is it a Kleros-style external court, an on-chain bond
  challenge, or unspecified?
- Are reveal-timing patterns considered private inputs or public? They
  are mentioned in cluster signals but Ponder indexes timing, which is
  effectively public.
- What is the migration story for the scorer itself? If the scorer
  schema changes mid-epoch, how are in-flight rounds handled?

## Net Recommendation

Proceed with the core design. The sealed-round predicted-rating
mechanism, the two-score split, cluster-discounted scoring, and effective-
unit USDC payout are the right primitives and are well-grounded in the
2004-2025 mechanism-design and Sybil-defense literature. The proposal is
also unusually honest about its limits, which is the right starting
point.

Before contracts and indexer schema freeze, the following four items are
worth pulling from "launch tuning" up to "spec":

1. seed-trust procedure with explicit sunset;
2. cluster-detection algorithm family, features, and version policy;
3. partial BTS layer alongside predicted-final-rating;
4. multi-scorer challenge protocol, or an explicit acceptance that the
   scorer is a single trusted operator for v1 with a documented
   migration path.

The remaining improvements are valuable but can be sequenced into
milestones 2 through 5 without blocking the spec milestone.

## References

Cited inline above; collected here for convenience.

### Mechanism design and elicitation

- Gneiting and Raftery, "Strictly Proper Scoring Rules, Prediction, and
  Estimation":
  https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf
- Prelec, "A Bayesian Truth Serum for Subjective Data":
  https://www.science.org/doi/10.1126/science.1102081
- Prelec, Seung, and McCoy, "A Solution to the Single-Question Crowd
  Wisdom Problem":
  https://www.nature.com/articles/nature21054
- Witkowski and Parkes, "A Robust Bayesian Truth Serum for Small
  Populations":
  https://cdn.aaai.org/ojs/8261/8261-13-11789-1-2-20201228.pdf
- Schoenebeck and Yu, "Two Strongly Truthful Mechanisms for Three
  Heterogeneous Agents Answering One Question" (peer prediction
  collusion bounds):
  https://dl.acm.org/doi/10.1145/3638239
- Lorenz et al., "How Social Influence Can Undermine the Wisdom of
  Crowd Effect":
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3107299/

### Sybil defense and graph trust

- Douceur, "The Sybil Attack":
  https://www.microsoft.com/en-us/research/publication/the-sybil-attack/
- Viswanath et al., "An Analysis of Social Network-Based Sybil
  Defenses":
  https://research.google/pubs/an-analysis-of-social-network-based-sybil-defenses/
- Kamvar, Schlosser, and Garcia-Molina, "The EigenTrust Algorithm":
  https://www.iw3c2.org/papers/2019-EigenTrust/index.html
- OpenRank EigenTrust documentation:
  https://docs.openrank.com/reputation-algorithms/eigentrust
- Cao et al., "Uncovering Large Groups of Active Malicious Accounts in
  Online Social Networks":
  https://www.researchgate.net/publication/288236021_Uncovering_Large_Groups_of_Active_Malicious_Accounts_in_Online_Social_Networks
- Yang et al., "Aiding the Detection of Fake Accounts in Large Scale
  Social Online Services" (NSDI):
  https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final42_2.pdf
- Wang et al., "Hybrid graph-based Sybil detection with user behavior":
  https://www.sciencedirect.com/science/article/pii/S1877050921009030/

### LLM-as-judge bias

- Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot
  Arena":
  https://arxiv.org/abs/2306.05685
- Wang et al., "Large Language Models are not Fair Evaluators":
  https://arxiv.org/abs/2305.17926
- Dubois et al., "Length-Controlled AlpacaEval":
  https://arxiv.org/abs/2404.04475
- "Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge":
  https://llm-judge-bias.github.io/
- "Evaluating Scoring Bias in LLM-as-a-Judge":
  https://arxiv.org/html/2506.22316v1
- "Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven
  Solution":
  https://arxiv.org/html/2508.06225v2
- "Self-Preference Bias in LLM-as-a-Judge":
  https://arxiv.org/abs/2410.21819

### Quadratic and plural funding

- Buterin, Hitzig, and Weyl, "Liberal Radicalism":
  https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3243656
- Miller, Weyl, and Erichsen, "Plural Funding":
  https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4311507
- Gitcoin, "WTF is Cluster-Matching QF?":
  https://www.gitcoin.co/blog/wtf-is-cluster-matching-qf
- Gitcoin, "Leveling the Field: How Connection-Oriented Cluster
  Matching Strengthens Quadratic Funding":
  https://www.gitcoin.co/blog/leveling-the-field-how-connection-oriented-cluster-matching-strengthens-quadratic-funding
- Block Science, "How to Attack and Defend Quadratic Funding":
  https://blog.block.science/how-to-attack-and-defend-quadratic-funding/

### Decentralized oracle and dispute design

- Kleros and UMA comparison:
  https://blog.kleros.io/kleros-and-uma-a-comparison-of-schelling-point-based-blockchain-oracles/
- "Oracles in Decentralized Finance: Attack Costs, Profits and
  Mitigation Measures":
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9857405/
- Augur Lituus oracle whitepaper coverage:
  https://thedefiant.io/news/defi/augur-reveals-augur-lituus-oracle-whitepaper

### Commit-reveal and griefing

- Chainlink, "Commit and Reveal Schemes":
  https://chain.link/article/commit-and-reveal-schemes
- "Commit-Reveal²: Securing Randomness Beacons with Randomized Reveal
  Order in Smart Contracts":
  https://arxiv.org/html/2504.03936v2
- Shutter, "Announcing Shutter Governance - Shielded Voting for DAOs":
  https://blog.shutter.network/announcing-shutter-governance-shielded-voting-for-daos/

### Soulbound identity

- Ohlhaver, Weyl, and Buterin, "Decentralized Society":
  https://www.microsoft.com/en-us/research/publication/decentralized-society-finding-web3s-soul/
- ERC-5192 minimal soulbound NFTs:
  https://eip.info/eip/5192

### Proof-of-personhood (for the optional-Self path)

- Self overview:
  https://docs.self.xyz/technical-docs/overview
- Self architecture and nullifiers:
  https://docs.self.xyz/technical-docs/architecture
