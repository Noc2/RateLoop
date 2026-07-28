# Agents dashboard: overview-first redesign — plan, 28 July 2026

Answers the three questions raised about `/agents` (what separates Results from
Evidence, where the charts are, why detail arrives before overview), then sets out
a plan to invert the hierarchy.

Every claim about the current code was verified by reading it; file and line
references are given so each can be rechecked. External research is cited to
source, and separates what was confirmed from what was inferred.

---

## 1. The three questions, answered

### Results vs Evidence: two projections of one table, joined at `run_id`

Internally "Results" is the `evaluations` tab
([`EvaluationDashboardPanel.tsx`](../packages/nextjs/components/tokenless/agents/EvaluationDashboardPanel.tsx))
and "Evidence" is
([`EvidenceWorkspacePanel.tsx`](../packages/nextjs/components/tokenless/agents/EvidenceWorkspacePanel.tsx)).
The intended axis is **decide** versus **verify and export**, and that axis is
real. The implementation does not communicate it.

The load-bearing fact: **both tabs call the same endpoint.**
[`EvidenceWorkspacePanel.tsx:329`](../packages/nextjs/components/tokenless/agents/EvidenceWorkspacePanel.tsx:329)
fetches `/evaluations`, filters to `run.evidencePacketAvailable`, then issues one
packet fetch per surviving run. Evidence's row set is therefore a strict subset of
Results' row set — the same runs, minus those without a packet.

|        | Results                                                                                                                            | Evidence                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Job    | read outcomes and decide                                                                                                           | verify and export                                                                                                                |
| Unique | Wilson interval, mechanism health, the decision and override forms, per-case reviewer rationales, all three charts, 30-day metrics | packet digest, signing key, Rekor entry, settlement statement, reviewer provenance, trusted keys, retention editor, every export |
| Shared | project, suite, run identity, response counts, outcome, timestamp                                                                  | the same                                                                                                                         |

Neither is a superset. What makes the split feel arbitrary is that they share a
card layout, a data source, and vocabulary — the word "Evidence" is itself a
section heading _inside_ a Results card
([`:574`](../packages/nextjs/components/tokenless/agents/EvaluationDashboardPanel.tsx:574)).

**And there is no link between them in either direction.** No run-scoped deep
link exists anywhere in the codebase. Having just decided on a run, the only way
to reach its evidence packet is to switch tabs and re-find it by name in a filter
box. Two tabs share a primary key and expose no path along it.

### Where the charts are

There are exactly three, all hand-rolled inline SVG. No charting library is
installed in the repository at all.

| Chart                           | Location                                                                                                          | Visible by default |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| Evaluation volume (14-day bars) | [`ModelEvidencePanel.tsx:59`](../packages/nextjs/components/tokenless/agents/ModelEvidencePanel.tsx:59)           | no                 |
| Agreement (stacked proportion)  | [`ModelEvidencePanel.tsx:159`](../packages/nextjs/components/tokenless/agents/ModelEvidencePanel.tsx:159)         | no                 |
| Coverage sparkline              | [`AdaptiveCoverageSummary.tsx:45`](../packages/nextjs/components/tokenless/agents/AdaptiveCoverageSummary.tsx:45) | no                 |

All three render at
[`EvaluationDashboardPanel.tsx:796`](../packages/nextjs/components/tokenless/agents/EvaluationDashboardPanel.tsx:796),
inside a `<details>` labelled **"Operations and policy details"**, collapsed, at
the bottom of the Results tab. The only performance visualisations in the product
sit behind a disclosure whose label says they are operational minutiae.

The sole default-visible visual on the whole surface is the plan-usage
`role="progressbar"` on Overview.

### Why detail arrives first

Measured by reading the render order: the default-visible portion of Results is
essentially 100% per-run record cards. Every aggregate, every chart, and every
cross-run comparison is inside that one collapsed element. Evidence is 100% record
list and settings forms, with zero aggregates.

Overview, meanwhile, renders the setup flow, a maintenance-health strip, and
workspace settings — members, API keys, plan usage, funding, SSO, danger zone. It
is an administration page wearing the name of a dashboard.

So the diagnosis is precise, and it is the one raised: **the product leads with
the raw record and hides the summary.**

---

## 2. The larger finding: the metrics already exist

The redesign is mostly a surfacing problem, not a computation problem.

### Already computed, already served over the wire, rendered by nothing

`AgentAssuranceScopeSummary`
([`agentRegistry.ts:157`](../packages/nextjs/lib/tokenless/agentRegistry.ts:157))
is attached to every agent and returned by `GET /api/account/workspaces/{id}/agents`.
It carries, per **agent × version × workflow × risk tier**:

`stage`, `reviewRateBps`, `completedComparableCases`, `stableCasesSinceStage`,
`reviewedOpportunityCount`, `skippedOpportunityCount`, `comparableCount`,
`agreementCount`, `humanAgreementBps`, `humanAgreementLower95Bps`,
`executionCount`, `averageTotalDurationMs`, `averageInputTokenTotal`,
`averageOutputTokenTotal`, `averageReasoningOutputTokenTotal`,
`nextReassessmentAfter`, `lastTransition`.

That is a per-agent performance rollup with a Wilson lower bound on agreement and
mean latency, ready to render. A repository-wide search for `assuranceScopes`,
`humanAgreementLower95Bps` and `reviewedOpportunityCount` outside tests returns
**zero component hits**. Three components fetch the route and discard the field.

This single object supplies most of a per-agent overview.

### Other computed-but-unrendered values

- **Per-scope assurance metrics.** `collectWorkspaceAssuranceMetrics`
  ([`assuranceMetrics.ts:278`](../packages/nextjs/lib/tokenless/assuranceMetrics.ts:278))
  returns a `scopes[]` array with per-scope `requested`, `completed`, `blocked`,
  `approvalRequired`, `comparable`, `disagreements`, `latencyMilliseconds`. The UI
  sums all scopes into five workspace-wide tiles and discards the breakdown. The
  shipped Grafana JSON _does_ define "Disagreement by scope" — the per-scope view
  exists for Grafana and not for the product.
- **Cost per decision.** `tokenless_agent_evaluation_observations.cost_atomic`
  holds a per-decision cost, alongside `latency_ms`, `agreement`, `comparable` and
  `human_human_agreement_bps`. `cost_atomic` is read nowhere in the codebase
  except the JSON coverage export.
- **Baseline/candidate split.** `choices: {baseline, candidate, tie}` is computed
  at [`evaluationDashboard.ts:631`](../packages/nextjs/lib/tokenless/evaluationDashboard.ts:631)
  and never rendered.
- **Latency percentiles.** Each evidence packet computes
  `responseSubmissionLatencyFromPeriodStartMs = {count, minimum, median, p95, maximum}`.
  Unrendered — the Evidence tab's own type does not declare it.
- **Judgment coverage.** The packet's `judgmentCoverage` (nine fields covering
  expected, assigned, submitted, valid, invalid, pending and missing judgments) is
  entirely unrendered; only `suite.outcome` is shown.
- **Model profile detail.** `failedExecutionCount`, `skippedCount`,
  `inputTokenTotal`, `outputTokenTotal`, `lastExecutedAt` are all served and
  unrendered; the daily series carries `comparableCount` and `agreementCount` that
  the chart does not plot.

### Per-agent attribution is switched off in four type annotations

Runs are reported as unattributed, and each card says so:

> "This run has no immutable agent-version reference, so it is excluded from
> per-agent comparisons."

But this is not a data limitation. `evaluationDashboard.ts` pins it at the _type_
level — `attribution: { status: "unattributed"; agentId: null; versionId: null }`
([`:44`](../packages/nextjs/lib/tokenless/evaluationDashboard.ts:44)),
`attributionReady: false` ([`:155`](../packages/nextjs/lib/tokenless/evaluationDashboard.ts:155)),
`attributedRuns: 0` ([`:161`](../packages/nextjs/lib/tokenless/evaluationDashboard.ts:161)).
These are literal types, so the value can never be anything else without a code
change.

Meanwhile the join exists and is indexed:
`tokenless_agent_review_opportunities` carries `agent_id`, `agent_version_id` and
`run_id`, with
`CONSTRAINT tokenless_agent_review_opportunities_run_unique UNIQUE ("run_id")`
([`drizzle/0031:114`](../packages/nextjs/drizzle/0031_adaptive_review_evidence.sql:114)).
Run → agent is one hop, 1:1, with a unique index behind it. **No migration is
required to attribute a run to an agent version.**

### The one policy constraint that must be respected

[`docs/tokenless-immutable-implementation-plan-2026-07.md:76`](tokenless-immutable-implementation-plan-2026-07.md)
states: "The result updates evidence for the exact agent version, policy,
workflow, risk tier, and reviewer audience. **Evidence never becomes a global
agent score.**"

So per-agent performance is expressible at _scope_ granularity and deliberately
not as a single number per agent. The design below respects this: an agent row
shows its scopes, and refuses to average them into one score. This is also the
right call statistically — see §4, principle 3.

---

## 3. What the research says

Four sources. Humanloop is treated as the primary benchmark: its team was hired by
Anthropic in August 2025 and the product sunset on 8 September 2025, but the
entire v5 documentation set and the 2023–2025 changelog remain live, which is
where the design history actually is. Label Studio Enterprise was added because
none of the three briefed products measures reviewer agreement, and that is
RateLoop's core asset.

No screenshots were obtainable; every layout claim below rests on prose,
changelog text or API schemas.

### Humanloop — the architectural lesson

**"Human" is not a subsystem. It is one of three _sources_ of one `Evaluator`
object** — Code, AI, and Human — sharing one judgment-type vocabulary (Boolean,
Number, Select, Multi-select, Text) and therefore one statistics pipeline. A human
rating and a model judgement are the same row in the same table.

Their evaluation UI has three strict zoom levels: a **Runs table** (one row per
version, aggregate encoded _in the cell by judgment type_ — % true for boolean,
mean for numeric, an inline bar distribution for categorical), a **Stats** view
(radar across evaluators, then per-evaluator bars), and a **Review** matrix
(datapoint × version, side-by-side, with the annotation control). The Runs table
doubles as the selection control for everything below it.

A November 2024 redesign flattened per-file navigation to four fixed tabs —
Dashboard, Editor, Logs, Evaluations — with the stated rationale of "a more stable
sense of where you are in the app."

Online and offline evaluation are kept physically separate: **online lives on the
Dashboard and Logs tabs with a time x-axis**; **offline lives in Evaluations with
a version x-axis**. Same metrics, different home, never mixed.

Their **spot-check pattern** is the best workflow idea found: sample production
logs by filter, attach them to a Run of a standing Evaluation, review, and repeat
each period as successive Runs of the _same_ Evaluation. Periods become comparable
by construction.

**Their gap is exactly RateLoop's opportunity.** Across their multi-reviewer,
human-evaluator and stats documentation there is _no_ inter-rater agreement, no
consensus or adjudication model, and no reviewer dimension in statistics.
Reviewer assignment was "filter the dataset on a column and send each expert a
URL." Humans are called "gold standard" by assertion, never by measured agreement.

They also published an EU AI Act guide in April 2024 mapping "Enable Human
Oversight" and "Automate Record-Keeping" to product features — and then shipped an
observability page that mentions neither. **The best team in this space identified
the ground and walked off it.**

### Confident AI / DeepEval — the most developed human-review model

Annotation queues with four assignment strategies (unassigned, single user, round
robin by fewest-assignments, random for statistical coverage). An annotation is a
rating plus an optional explanation plus an expected output. The review interface
"strips away all information except the input, output, metadata, and turns."

**Eval Alignment** compares human annotations against metric scores with confusion
matrices, publishing precision/recall/F1 and **Cohen's κ**, with per-metric
agreement rates and a stated bar of keeping false positives plus false negatives
below 5% before a judge may gate releases. **Error Analysis** auto-clusters
annotations into a failure taxonomy and then recommends which metrics would catch
each mode.

Their framing is on-thesis: "Without real humans giving feedback to an LLM system,
evals are no better than vibe-coding."

Regression handling is worth copying: the **baseline is a view setting, not a
stored property** — you can switch which run is the control — and rows are
coloured by regression versus improvement with a filter for each.

The relevant limitation: human review exists to **calibrate the LLM judge**.
Humans are instrumentation for the automation. RateLoop inverts that.

### Promptfoo — the filter and rollup lessons

The **Display mode** dropdown — All, Failures, Passes, Errors, **Different**,
Highlights — is the sharpest control found anywhere. "Different" shows only cells
where variants disagree: a one-click disagreement filter. Filter state persists in
URL parameters, making a filtered view linkable.

**Risk rollup is worst-case-anchored, not averaged**: take the maximum individual
vulnerability score, then add +0.5 per additional critical and +0.25 per
additional high. Averages hide one catastrophic failure behind ninety passes.

Their enterprise tier separates **immutable point-in-time Reports that auto-flag
themselves "Outdated"** when a newer scan supersedes them, sitting above a
_mutable_ findings list with lifecycle statuses. That is exactly the shape of
auditable evidence.

Their human review is the anti-pattern: ratings and comments persist and export,
but never enter a score and never gate anything. Annotation theatre.

### Label Studio Enterprise — the human-first precedent

The only mature dashboard for multi-reviewer agreement.

Its **Data Quality** screen is the model for a disagreement view: an Average Task
Agreement KPI, a **Task Agreement Distribution histogram** whose low bands
"suggest ambiguous instructions, difficult examples, or labels that need
clarification", Agreement by Dimension bars, a Top Confusion Pairs table, and a
label-level **confusion heatmap**.

Its **Members** screen has a pairwise **agreement matrix heatmap**, traffic-light
banded at ≥66% / 33–66% / <33%, showing both the agreement percentage _and the
number of tasks where both members annotated_.

Two explicit agreement modes: **Consensus** (convergence of the full group) and
**Pairwise** (every unique pair, then averaged). And the statistical note that
matters for a rotating reviewer pool: **Cohen's κ handles two raters;
Krippendorff's α generalises to any number of annotators, tolerates missing data,
and supports nominal through ratio scales.** With partial overlap, α survives and
κ does not.

---

## 4. Design principles

1. **Overview answers four questions with four numbers.** How much, how good, how
   contested, how expensive. Everything else is one click away. Confident AI's
   "P50 latency / Avg quality / Alerts today" and Label Studio's throughput row
   both resolve to a small fixed set where each number answers a _different
   question type_.
2. **The overview table is the selection control.** Selecting rows filters the
   views below rather than navigating away (Humanloop).
3. **Never average heterogeneous outcomes into a headline.** A unanimous failure
   must not disappear into a pool of unanimous passes (Promptfoo's max-anchored
   rollup). This also happens to be what the immutability plan already requires by
   forbidding a global agent score.
4. **Online and offline never share a screen.** Time-axis monitoring and
   version-axis comparison are different questions (Humanloop).
5. **Encoding follows from the data type**, not a chart picker: a rate renders as
   a percentage, a distribution as an inline bar, a trend as a line.
6. **Filter and selection state lives in the URL.** For an evidence product a
   linkable filtered view is close to mandatory.
7. **Human judgement is the number, not an overlay.** The failure mode to avoid is
   Promptfoo's: ratings that persist but never count.
8. **Detail is a drawer, not a page** — so the user never loses the aggregate they
   drilled from.

---

## 5. Proposed information architecture

### Tabs

| Now              | Proposed                                             | Rationale                                               |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Overview (admin) | **Overview** — stats and agent performance           | the thing the name already promises                     |
| Connections      | Connections                                          | unchanged                                               |
| Approvals        | Approvals                                            | unchanged                                               |
| Review setup     | Review setup                                         | unchanged                                               |
| Results          | **Reviews**                                          | what it is: human review outcomes and decisions         |
| Evidence         | **Evidence**                                         | unchanged in job, narrowed in scope                     |
| —                | _(workspace admin moves off Overview into Settings)_ | Overview cannot be both a dashboard and a settings page |

Renaming Results to **Reviews** resolves the reported confusion directly: Reviews
is where you read outcomes and decide; Evidence is where you prove and export.
"Results" versus "Evidence" names two synonyms; "Reviews" versus "Evidence" names
a verb and a noun.

### Overview, top to bottom

**Row 1 — four headline numbers**, each with a period-over-period delta and a
sparkline. Period selector (7 / 30 / 90 days) applies to the whole page and
persists in the URL.

| Metric                                        | Source                                                                      | Status                  |
| --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| Decisions settled                             | `assuranceMetrics.reviewsCompleted`                                         | exists                  |
| Human agreement rate, with Wilson lower bound | `AgentAssuranceScopeSummary.humanAgreementBps` / `humanAgreementLower95Bps` | exists, unrendered      |
| Rejection rate — see the correction in §6     | `assuranceMetrics.scopes[].disagreements`                                   | exists, discarded in UI |
| Median time to decision                       | `assuranceMetrics.scopes[].latencyMilliseconds`                             | exists, summed away     |

Cost per decision joins this row once §7 lands.

**Row 2 — the agent performance table.** One row per agent version × scope, which
is the granularity the immutability plan mandates. Columns: agent and version,
workflow, risk tier, stage, review rate, comparable cases, **agreement with its
95% lower bound**, mean latency, mean tokens, last transition. Sortable; selecting
a row filters everything below; clicking opens the agent drawer.

Every column above already exists on `AgentAssuranceScopeSummary`. **This table is
the single highest-value change in the plan and requires no new computation.**

**Row 3 — two charts.**

- _Review volume and outcome over time_ — stacked bar of settled decisions by
  outcome, following Label Studio's Tasks-by-State reasoning that a pipeline
  stack beats an outcome line.
- _Agreement distribution_ — histogram of per-decision agreement bands. The low
  tail is simultaneously the work queue and the strongest evidence artifact: the
  decisions humans found genuinely contested.

**Row 4 — attention list.** Runs needing a decision, blocked runs, scopes whose
agreement lower bound has fallen below their policy floor, oversight alerts.
Capped at five with a link to the full list. This is the only place raw records
appear on Overview.

### Reviews tab

Keeps the decision workflow, gains what it currently lacks:

- a **filter bar** (agent, workflow, outcome, date, needs-decision) with URL
  persistence — Evidence has one today and Reviews does not
- **a link from every run to its evidence packet**, closing the gap identified in
  §1
- the per-case reviewer rationale view stays; it is the only place human reasoning
  is visible and is genuinely valuable
- the three charts move to Overview and to the agent drawer; "Operations and
  policy details" disappears as a container

### Evidence tab

Narrows to verify-and-export, and gains the reverse link back to the review. Adds
Promptfoo's report model: an evidence packet is an **immutable point-in-time
artifact that flags itself outdated** when a newer packet supersedes it — which is
what an auditor needs and what a mutable list cannot provide.

Surfaces the packet fields already computed and hidden: `judgmentCoverage` (the
nine expected/assigned/submitted/valid/invalid/pending/missing counts) and the
`p50`/`p95` response latencies.

### The agent drawer

Opened from any agent row, over the current context. Four sections: scope summary,
agreement trend, execution profile (latency, tokens, failure count), and recent
runs with links into Reviews. Detail without losing place, per principle 8.

---

## 6. Metric definitions

Precision matters here because these numbers will appear in evidence exports.

- **Reviewer endorsement rate** — renamed from "human agreement rate". The
  `agreement` column records whether the review panel judged the agent's output
  acceptable against an owner-fixed binary criterion. That is endorsement of the
  agent, not agreement between reviewers, and calling it "agreement" invites
  exactly the confusion corrected below. The reliability literature reserves
  *agreement* for rater-to-rater consistency; Label Studio names its three
  families separately (Agreement, GT Agreement, Prediction Agreement) and
  Confident AI avoids the word for this comparison entirely, calling it "Eval
  Alignment". Computed as `agreementCount / comparableCount` over comparable
  cases only, reported with the Wilson 95% lower bound already computed at
  [`agentRegistry.ts:1090`](../packages/nextjs/lib/tokenless/agentRegistry.ts:1090).
  Always display the lower bound beside the point estimate; a 100% rate over three
  cases and over three hundred are different claims.
- **Correction, 28 July 2026.** An earlier draft defined "disagreement rate" as
  reviewers failing to reach unanimity, and asserted it was distinct from
  `1 − agreement`. That is wrong.
  `assuranceMetrics.scopes[].disagreements`
  ([`assuranceMetrics.ts:342`](../packages/nextjs/lib/tokenless/assuranceMetrics.ts:342))
  and `agreementCount`
  ([`agentRegistry.ts:980`](../packages/nextjs/lib/tokenless/agentRegistry.ts:980))
  read the same `agreement` column of the same table over the same `comparable`
  denominator. They are exact complements. Putting both on the headline row would
  have shown one number twice — and at two different windows, 30-day against
  lifetime, so they would not even have summed to 100%.
- **Rejection rate** — `agreement = 'disagree'` over comparable cases, the
  complement of endorsement. It belongs in the attention list and in alerts,
  **never on the same row as the endorsement rate**.
- **Reviewer consensus** — the genuinely distinct measure: whether reviewers
  agreed with *each other*. Sourced from `mechanismHealth.unanimityRateBps` at
  workspace level and `OversightCase.disagreementBps` per case, not from the
  `agreement` column. It belongs in a separate "Review quality" block, because
  endorsement rates the agent while consensus rates the rubric and the panel.
- **Inter-reviewer agreement** — new, §7. Report **Krippendorff's α** at workspace
  level because the reviewer pool rotates and overlap is partial; report **pairwise
  percentage agreement** in the reviewer matrix because it is legible. Do not use
  Cohen's κ: it assumes exactly two fixed raters.
- **Time to decision** — median and p95, from review request to settled verdict,
  split by stage (request → claim → score → settle) so a queueing problem is
  distinguishable from a slow-reviewer problem.
- **Cost per decision** — `sum(cost_atomic) / count(decisions)` over the period,
  from the existing per-observation column.

Two rules for all of them: **never average across scopes into a single agent
score** (§4.3, and the immutability plan), and **suppress rather than mislead**
below the minimum aggregation size, which the existing mechanism-health code
already does.

---

## 7. What needs new work

Ordered by value per unit of effort.

| #   | Item                                                        | Effort | Notes                                                                                                                                                                                      |
| --- | ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Render `AgentAssuranceScopeSummary` as the agent table      | S      | data already on the wire                                                                                                                                                                   |
| 2   | Overview headline row + period selector                     | S      | all four metrics exist                                                                                                                                                                     |
| 3   | Surface per-scope assurance metrics instead of summing them | S      | stop discarding `scopes[]`                                                                                                                                                                 |
| 4   | Run → evidence and evidence → run links                     | S      | `run_id` is the key on both sides                                                                                                                                                          |
| 5   | Filter bar on Reviews, URL-persisted                        | S      | mirror the Evidence one                                                                                                                                                                    |
| 6   | Turn on run attribution                                     | M      | remove four literal types, add the one-hop join; no migration                                                                                                                              |
| 7   | Agreement distribution histogram                            | M      | needs per-decision agreement bucketed; source rows exist                                                                                                                                   |
| 8   | Cost per decision                                           | M      | `cost_atomic` exists per observation; needs aggregation and a period join                                                                                                                  |
| 9   | Agent drawer                                                | M      | composition of existing pieces                                                                                                                                                             |
| 10  | Inter-reviewer agreement (α + pairwise matrix)              | L      | genuinely new computation; the differentiator                                                                                                                                              |
| 11  | Reviewer calibration over time                              | L      | new; matters for a rotating network pool                                                                                                                                                   |
| 12  | Windowed rollups                                            | L      | `tokenless_agent_evaluation_rollups` is schema'd with **no production writer** — a pre-aggregated time series exists on paper only. Needed only if on-the-fly aggregation proves too slow. |

Charting: three hand-rolled SVG charts exist and work, with `role="img"` and
`<title>`/`<desc>`. Adding a library is a separate decision — it would be the
first dependency of its kind here, and the nonce-only CSP means anything injecting
styles at runtime needs checking. Recommendation: extend the hand-rolled
components for the four chart types in this plan, and revisit only if the set
grows.

---

## 8. Phasing

**Phase 1 — make the overview an overview.** Items 1–5. No new computation, no
migration. Ends with: four headline numbers, a per-agent performance table, the
charts out of the collapsed element, the two tabs linked, and Reviews filterable.
This alone resolves all three reported problems.

**Phase 2 — attribution and cost.** Items 6–9. Ends with runs attributed to agent
versions, the disclaimer removed from every card, cost per decision on the
headline row, and the agent drawer.

**Phase 3 — the differentiator.** Items 10–11. Inter-reviewer agreement,
disagreement hotspots by dimension, reviewer calibration trends.

Phase 3 is where the product does something no evaluation framework studied can
do. It is also the phase that should be treated most sceptically: reviewer-level
statistics are a surveillance surface as well as a quality surface, and the
existing design deliberately keeps reviewers pseudonymous. Any reviewer metric
must be justified against that, and probably belongs in aggregate form only.

---

## 9. What deliberately stays out

- **A single agent score.** Forbidden by the immutability plan, and statistically
  wrong. The agent table shows scopes and refuses to collapse them.
- **A widget builder or customisable dashboard.** Confident AI's changelog boasts
  "pretty much every chart shape known to humankind"; that is what ships when the
  team cannot decide what matters. A fixed, opinionated overview is worth more.
- **Time-axis and version-axis views on one screen** (§4.4).
- **Reviewer leaderboards.** Adjacent to §8 phase 3's concern and a different
  product.
- **Automated evaluators.** DeepEval and Promptfoo are worth learning IA from, not
  competing with. The point of interest is the opposite direction: whether
  RateLoop's human verdicts could serve as the alignment ground truth those tools
  need, which is a product question, not a dashboard one.

---

## 10. Open questions

1. **Is the per-scope agent table legible at scale?** A workspace with ten agents
   across three workflows and two risk tiers is sixty rows. Grouping by agent with
   expandable scopes may be needed; that is a design detail to settle against real
   data.
2. **Does "disagreement rate" mean reviewers disagreeing with each other, or with
   the agent?** Both are useful and they are different numbers. §6 defines them
   separately; the labels on screen must not blur them.
3. **What period does the overview default to?** The only existing windowed
   aggregate is fixed at 30 days
   ([`assuranceMetrics.ts:11`](../packages/nextjs/lib/tokenless/assuranceMetrics.ts:11));
   everything else is lifetime or a `LIMIT`. A 7/30/90 selector implies windowing
   several aggregates that currently have none.
4. **How much reviewer-level statistics is compatible with reviewer
   pseudonymity?** Needs an explicit answer before phase 3, not during it.

---

## Sources

Repository claims: verified by reading, references inline above.

Humanloop — [docs v5 index](https://humanloop.com/docs/v5/llms.txt),
[evaluators](https://humanloop.com/docs/explanation/evaluators.md),
[human evaluators](https://humanloop.com/docs/guides/evals/human-evaluators.md),
[run evaluation UI](https://humanloop.com/docs/guides/evals/run-evaluation-ui.md),
[monitoring](https://humanloop.com/docs/guides/observability/monitoring.md),
[spot-check logs](https://humanloop.com/docs/guides/evals/spot-check-logs.md),
[changelog Nov 2024](https://humanloop.com/docs/changelog/2024/11.md),
[changelog Jan 2025](https://humanloop.com/docs/changelog/2025/01.md),
[EU AI Act guide](https://humanloop.com/blog/eu-ai-act-guide),
[acquisition coverage](https://techcrunch.com/2025/08/13/anthropic-nabs-humanloop-team-as-competition-for-enterprise-ai-talent-heats-up).

DeepEval / Confident AI — [metrics introduction](https://deepeval.com/docs/metrics-introduction),
[evaluation datasets](https://deepeval.com/docs/evaluation-datasets),
[experiments](https://www.confident-ai.com/docs/llm-evaluation/experiments),
[annotation queues](https://www.confident-ai.com/docs/human-in-the-loop/annotation-queues),
[human-in-the-loop introduction](https://www.confident-ai.com/docs/human-in-the-loop/introduction).

Promptfoo — [expected outputs](https://www.promptfoo.dev/docs/configuration/expected-outputs/),
[web UI](https://www.promptfoo.dev/docs/usage/web-ui/),
[risk scoring](https://www.promptfoo.dev/docs/red-team/risk-scoring/),
[enterprise findings](https://www.promptfoo.dev/docs/enterprise/findings/).

Label Studio Enterprise — [dashboards](https://docs.humansignal.com/guide/dashboards),
[data quality](https://docs.humansignal.com/guide/dashboard_data_quality),
[members](https://docs.humansignal.com/guide/dashboard_members),
[agreement statistics](https://docs.humansignal.com/guide/stats),
[Krippendorff's alpha](https://labelstud.io/blog/how-to-use-krippendorff-s-alpha-to-measure-annotation-agreement/).
