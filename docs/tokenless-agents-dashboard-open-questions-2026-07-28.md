# Agents dashboard: the four open questions, answered — 28 July 2026

Closes §10 of
[`tokenless-agents-dashboard-plan-2026-07-28.md`](tokenless-agents-dashboard-plan-2026-07-28.md).
Each answer ends with a recommendation. Where the answer is a product decision
rather than a fact, that is said plainly.

---

## Q1 — Is a per-scope agent table legible at scale?

**The plan's premise was wrong, in the direction that matters.**

It assumed a scope is agent × version × workflow × risk tier. The database
partitions on **twelve columns**
([`drizzle/0058:385`](../packages/nextjs/drizzle/0058_human_review_binding_backfill.sql:385)):
agent version, policy id and version, human-review binding id and version, request
profile id, version and hash, workflow key, risk tier, audience policy hash, and
execution profile hash.

Of everything that multiplies, **only `stage` is a closed enum** (four values).
`workflow_key` is free-form, bounded only by a per-integration allowlist of 1–32
entries. `risk_tier` is free-form and **not allowlisted at all** — an unlisted tier
is accepted and forks a new scope. `execution_profile_hash` derives from the
provider, model, resolved model, model version, reasoning effort and service tier,
so **a provider silently returning a date-stamped resolved model forks a new scope
with no user action**.

There is no cap on agent versions and no cap, quota or retention on scopes. The
serving query
([`agentRegistry.ts:955`](../packages/nextjs/lib/tokenless/agentRegistry.ts:955))
has no version filter, no `LIMIT` and no pagination, plus four unbounded
`GROUP BY scope_id` rollups alongside it.

Realistic distribution is 5–40 scopes per version, multiplied by accumulated
versions and config revisions. A three-agent workspace that has shipped twenty
versions each lands in the low thousands of rows, fetched on every page load.
**Sixty rows was the best case, not the worst.**

### Recommendation

Two-level master/detail — agent version as parent, scopes as children — but the
legibility fix is the query bound, not the grouping.

1. **Bound the query first.** Server-side default of current agent version ×
   active policy version, with `LIMIT` and cursor pagination. Without this no
   visual treatment helps. This makes §7 item 1 an S/M rather than an S.
2. **The parent cell shows a composition and a worst case, never a mean.** For
   example: *5 scopes · 3 monitoring, 1 high coverage, 1 calibrating · lowest
   endorsement LB 71% (refund-review / high)*. A minimum is an **observed scope
   value, not a derived score**, so it satisfies the immutability rule where an
   average would not. This follows Datadog's composite monitors ("the most severe
   status", never a mean) and Google SRE's warning that aggregation to a global
   SLO hides severe problems.
3. **Where scopes are incommensurable, show a link to the breakdown rather than a
   number** — SAP Fiori's analytical table renders an asterisk plus a "show
   details" popup for exactly this case.
4. **Facets, not more columns**: workflow, risk tier, stage, version — resolved
   server-side, URL-persisted.
5. **Use a native `<table>` with a disclosure button per parent row.** Adopt
   `role="treegrid"` only if full grid keyboard navigation ships with it;
   `aria-expanded` on a row is invalid outside a treegrid, so half-doing this is
   worse than not doing it.
6. **Product decision needed:** collapse the seven non-policy dimensions (request
   profile, binding, execution profile) into a "revisions" child level. Showing an
   `execution_profile_hash` fork — often provider noise — as a sibling of a genuine
   workflow scope is what makes the table unreadable. Trade-off: roughly an order
   of magnitude fewer rows, against a weaker literal reading of the immutability
   rule.

**Unresolved discrepancy.** The immutability plan names *five* dimensions; the
schema partitions on twelve. Either the plan text is stale or the schema
over-partitions relative to policy. This needs a ruling.

---

## Q2 — Two different "disagreement" numbers

**Answered, and it produced a correction to the plan.** See §6 of the plan, now
amended.

`assuranceMetrics.scopes[].disagreements`
([`assuranceMetrics.ts:342`](../packages/nextjs/lib/tokenless/assuranceMetrics.ts:342))
and `agreementCount`
([`agentRegistry.ts:980`](../packages/nextjs/lib/tokenless/agentRegistry.ts:980))
read the same column of the same table over the same denominator. They are
complements, not different measures.

Nor does `agreement` mean what the name suggests. The agent's output is stored
only as an opaque `suggestion_commitment` and is **never decoded or compared**. The
column records the panel's majority answer to the workspace owner's fixed binary
criterion — the UI default is literally *"Is this response safe and correct?"*. So
it is **panel endorsement of the agent's output**, not a per-reviewer comparison.

### The genuinely separate measures

| Concept | Field | Measures |
| --- | --- | --- |
| Endorsement | `agreement='agree'` / comparable | the panel versus the agent |
| Rejection | `agreement='disagree'` / comparable | its exact complement |
| Consensus (workspace) | `mechanismHealth.unanimityRateBps` | reviewers versus each other |
| Panel split (per case) | `OversightCase.disagreementBps` | reviewers versus each other |
| Pairwise (export only) | `human_human_agreement_bps` | reviewers versus each other |

### Naming

| Concept | On screen | Home |
| --- | --- | --- |
| endorsement | **Reviewer endorsement rate** | Overview headline, agent table, with Wilson LB |
| its complement | **Rejection rate** | attention list and alerts only |
| unanimity / pairwise | **Reviewer consensus** / **panel split** | a separate "Review quality" block |
| Krippendorff's α | **Reviewer consistency (α)** | Review quality block |

Endorsement and consensus answer different subjects — how good is the agent, versus
is the rubric well defined — so per the plan's own rule they must not share a tile
row.

### Two defects found in passing

- **`human_human_agreement_bps` holds two incompatible statistics in one column.**
  The public lane writes a majority share
  ([`adaptiveReviewEvidence.ts:122`](../packages/nextjs/lib/tokenless/adaptiveReviewEvidence.ts:122));
  the private lane writes true pairwise agreement
  ([`humanReviewResultObservation.ts:304`](../packages/nextjs/lib/tokenless/humanReviewResultObservation.ts:304)).
  For three positives and one negative these give 7500 and 5000. One threshold is
  applied to both, so **stage promotion is measurably easier on the public lane**.
  Any workspace-level inter-rater number built on this column today would mix two
  definitions. Whether the divergence is intentional is undocumented.
- **`agreement_threshold_bps` is overloaded**, gating both the human-human gate and
  the human-versus-agent Wilson bound.

---

## Q3 — What period should the overview default to?

**Almost nothing is windowed today.** The only 30-day aggregates are in
`assuranceMetrics`, and even there `blocked` and `approvalRequired` are lifetime
counts sitting inside a struct that advertises `windowSeconds = 2592000` — so every
Prometheus consumer currently misreads them. Everything the plan's headline row and
agent table are built from — endorsement, comparable counts, latency, tokens — is
**lifetime-ever**. The run list is `LIMIT 100`; the coverage sparkline is every
policy event ever, with no limit at all.

An asymmetry already ships: `stableCasesSinceStage` (since stage entry) sits beside
`humanAgreementBps` (lifetime) in the same card, so a scope that was poor while
calibrating and is good now shows a permanently depressed rate — and that is the
number the plan wants on the headline.

**Query cost is not the obstacle; indexing is.** No table backing these has a
`(workspace_id, timestamp)` index. `tokenless_agent_evaluation_observations` does
not index `workspace_id` at all, so the existing queries are already sequential
scans. Windowing costs no more than today — it is just that today is expensive.

**The volume reality settles the default.** The decision quota is 25 per period on
free and 250 on Early Access, so a 7-day window on the top plan is at most ~58
decisions spread across hundreds of scopes.

### Recommendation

**Default 30 days. Offer 7 / 30 / 90 / Lifetime. Never auto-widen.**

1. **30 days** — it is the only window already computed, it matches the billing
   period the quota is denominated in, and it is the shortest window that yields a
   usable sample. **7 days is a diagnostic, not a default**: it is under-powered by
   construction on every plan currently sold.
2. **Lifetime is the correct default for the agent table specifically.** Its Wilson
   lower bound is the stage-gating statistic, and the policy engine computes it
   lifetime. Rendering a 30-day version beside a stage badge would show a number
   that disagrees with the decision that produced the badge. This conflicts with
   the plan's "one period applies to the whole page" and the table should win.
3. **Under-powered periods: show, mark, and refuse to imply.** Below the minimum
   aggregation size, suppress (existing behaviour). Between that and n≈30, render
   greyed with the lower bound and an explicit `n = 12 — too few cases to be
   reliable`. **Do not auto-widen**: it silently changes the denominator under a
   control the user set, breaks the linkable-filter guarantee, and in an evidence
   product a number whose window differs from its label is worse than no number.
   Precedent: CMS publishes a "too few cases" label rather than extending the
   period; GitHub's Copilot metrics return nothing below five active seats; Viva
   Insights omits groups below a minimum size.
4. **Phase it against the index reality.** Phase 1 applies the selector only to the
   already-windowed fields and labels every lifetime tile "all time" — do not fake a
   selector over lifetime data. Phase 1.5 adds `(workspace_id, finalized_at)`,
   `(workspace_id, occurred_at)` and `(workspace_id, created_at)` indexes. Phase 3
   wires the dead `tokenless_agent_evaluation_rollups` writer, which already carries
   the right unique index and precomputes the Wilson bound — **this promotes §7 item
   12 from optional fallback to prerequisite** for a real selector.
5. **Fix in passing:** the lifetime `blocked`/`approvalRequired` inside a 30-day
   struct, and the "14-day" model chart that actually plots the last 14
   *dates-with-data*, so an idle workspace renders three months as a gapless
   14-bar chart.

---

## Q4 — Reviewer statistics versus reviewer pseudonymity

**There are two reviewer populations with opposite privacy postures, and the plan
treated them as one.**

**Invited workspace reviewers are not pseudonymous to the admin at all.** The
roster returns display name, verified email and principal address, and the
oversight case view returns each reviewer's choice, failure tags and **plaintext
rationale**.

**Network reviewers are strongly pseudonymous.** The reviewer key is a per-run
HMAC, displayed as eight hex characters, and network runs get no per-response rows
at all — the case view is aggregate-only, with the reasoning stated in the code.
Evidence packets assert `reviewerIdentitiesIncluded: false` structurally, and
coverage exports contain no reviewer identifier.

### The real risk is not re-identification

Re-identification is a live risk on the invited lane — a rotating pseudonym is no
protection when the admin invited the three people on the panel and can read their
prose — and essentially nil on the network lane.

**The sharper risk is performance management of non-employees.** The EU Platform
Work Directive 2024/2831 extends algorithmic-management transparency, limits on
automated monitoring, and a right to human review of significant decisions **to
non-employees**, with transposition due 2 December 2026. Under GDPR a computed
per-reviewer calibration score is personal data the reviewer can demand: the
Amsterdam Court of Appeal held in 2023 that secret worker profiling and management
assessments must be disclosed. Pseudonymisation does not exit GDPR — EDPB
Guidelines 01/2025 are explicit that pseudonymised data remains personal data while
re-identification is possible.

**And proving human oversight does not require any of it.** AI Act Article 14
requires the system be designed so it *can* be effectively overseen; Article 26(2)
requires assigning oversight to competent persons. Neither requires recording,
disclosing or computing statistics about those persons. What proves oversight is
the evidence packet, which already exists. **The "we need reviewer statistics to
prove oversight" argument has no legal support.**

### Three things already in the schema that must not be casually exposed

- `tokenless_forecast_pair_accumulators` is **already a pairwise matrix**, and for
  the network space its subject key is the **raw global rater id**. It is one
  endpoint away from being the Phase 3 matrix, keyed on a globally stable
  identifier. Do not build a workspace read path onto it.
- `tokenless_assurance_gold_outcomes` already stores per-reviewer correctness
  keyed by both lineage and stable rater id.
- The reviewer terms and consent machinery is **fully built and entirely unwired** —
  tables, version creation, acceptance gate, audit event, none with a caller
  outside its own test. There is no reviewer-facing contract in the product today.

### Recommendation

**Split Phase 3 along the lane boundary the product already enforces.**

*May be shown to the workspace, aggregate, no reviewer axis:* Krippendorff's α,
unanimity, the agreement-distribution histogram, disagreement decomposed by
workflow, risk tier, failure tag and case, and time-to-decision distributions. This
is Label Studio's Data Quality screen without its Members screen — and it delivers
essentially all the diagnostic value, because a low-agreement band is a **rubric**
finding, not a reviewer finding.

*Must stay hidden from the workspace:* any cross-run-stable reviewer identifier;
per-reviewer calibration for network reviewers; a pairwise matrix over network
reviewers.

*Operator-only:* pairwise correlation and calibration for collusion detection,
which is where the design already puts it, with `payoutEffect: "none"`.

*Reviewer-facing, self-only:* each reviewer sees their own calibration. If it is
computed, it is owed under Article 15 regardless.

*Requires consent and a contract first:* any per-reviewer statistic influencing
assignment, payout or removal. Wire the dormant terms machinery before that ships.

**The invited lane is a separate product decision.** A pairwise matrix over invited
reviewers is Label-Studio-precedented and defensible, but it is
employment-adjacent monitoring needing the workspace's own notice, and it must
never share a screen or a table with network reviewers.

Recommended: **rubric-level disagreement analysis only for Phase 3** (no reviewer
axis in either lane), with the invited-lane matrix deferred to a Phase 4 gated on
the reviewer terms being wired. The plan already excludes reviewer leaderboards;
this is the consistent extension, and its "disagreement hotspots by dimension" item
is already exactly this.

**One bug to fix regardless:** the hybrid lane shows network response rows —
pseudonym, choice, failure tags — to admins, withholding only the rationale, while
the terms page states hybrid review is not offered in this release. Either close
the leak or make the statement true in code.

---

## Undetermined

- **No production data on real scope cardinality.** Test fixtures use one scope per
  agent, which understates it badly. The Q1 estimate is derived from schema and
  churn sources, not measured.
- **No published study on default dashboard time ranges.** The 30-day
  recommendation rests on the product's own quotas and the 28/30-day analytics
  convention.
- **Which scope definition is authoritative** — five dimensions or twelve.
- **Whether the two `human_human_agreement_bps` formulas were meant to diverge.**
