# Human-oversight positioning and capability plan (July 2026)

**Status:** implementation record. RateLoop is repositioned from "evidence layer that disclaims oversight" to
**the instrument a deployer's own people use to perform EU AI Act human oversight**, with the product gaps
closed before the website said it. The negative-first "What this is not" box on
[/docs/evidence](../packages/nextjs/app/(public)/docs/evidence/page.tsx) (and its machine mirror) is replaced
by the shared-responsibility model, `/docs/human-oversight` maps each Article 14(4) measure to its capability,
and the landing page leads with the oversight card and FAQ — all shipped on this branch for the tokenless
preview. This refines, not contradicts, the
[assurance-evidence plan](tokenless-assurance-evidence-plan-2026-07.md): the claims-match discipline stays;
what changed is which claims became true and how they are framed. Research inputs current as of 2026-07-17;
repository facts re-verified on this branch.

## 1. Why the repositioning is legitimate

- **The Act contemplates exactly this shape.** Article 14(3)(b) covers oversight measures "identified by the
  provider … and that are appropriate to be implemented by the deployer"; nothing in the Act or EC guidance
  prohibits a deployer from implementing those measures through a third-party platform
  ([Article 14](https://artificialintelligenceact.eu/article/14/)). What cannot be delegated is the
  *responsibility* and Article 26(2)'s requirement that oversight be assigned to **natural persons with
  competence, training and authority** ([Article 26](https://artificialintelligenceact.eu/article/26/)).
- **In invited-reviewer mode, those natural persons are the customer's own personnel** — RateLoop is the
  instrument they use to monitor, interpret, override, and stop. That is an oversight *platform*, truthfully.
  The old blanket disclaimer was written for the anonymous public network, and for that lane it stays: a
  marketplace of strangers does not discharge 26(2), so the public network is marketed one rung lower
  (supplementary review capacity and quality signal), while the invited lane carries the Article 14/26 story.
- **The market norm supports enablement language.** Credo AI ("operationalize the requirements"), IBM
  watsonx.governance ("helps drive… documentation"), OneTrust ("producing enforcement-ready evidence") all
  claim capabilities and evidence, never conferred compliance; "makes you compliant" is AI-washing territory
  under active FTC/SEC/UCPD enforcement
  ([FTC Operation AI Comply](https://www.ftc.gov/news-events/news/press-releases/2024/09/ftc-announces-crackdown-deceptive-ai-claims-schemes)).
- **The stop-gate story is unusually strong.** 14(4)(e) requires intervention or interruption "through a
  'stop' button **or a similar procedure** that allows the system to come to a halt in a safe state."
  RateLoop's host output gate is *pre-emptive*: output is held in a safe state — undelivered — by default
  until a human decision. That is arguably stronger than a reactive stop button, and it is concrete and
  testable.
- **Two guardrails carried forward:** RateLoop sits *around* the AI system (gating outputs), not inside it —
  worth stating explicitly to avoid any Article 25 "you modified the system" reclassification confusion; and
  one visible line stays on every surface, matching the user-responsibility principle: *"Whether a specific
  deployment meets a legal requirement depends on your system, context, and organization — you configure and
  operate RateLoop for your purpose; RateLoop provides the capabilities and the evidence."*

## 2. Capability status against Article 14(4) and 26 (pre-implementation baseline)

This table records the state before workstream O1; the O1 commits on this branch (`oversight: attest oversight
designations` through `compliance: map incidents to the Article 73 template`) closed the listed gaps.

| Requirement | Status today | Biggest gap |
| --- | --- | --- |
| 14(4)(a) understand capacities & monitor | Partial — 30-day metrics dashboard (sampling, latency, disagreement, blocked), per-scope coverage/agreement; `gate.blocked`/`review.completed` webhooks | Polled dashboard, no in-app alerts; capacities are self-declared/host-reported with no oversight-oriented capability/limitations card |
| 14(4)(b) automation-bias awareness | Absent for the oversight person (commit-reveal blinding, 10% floor, gold calibration all protect the *panel*) | Nothing counters the deployer's own rubber-stamping |
| 14(4)(c) correctly interpret output | Partial — approval inbox shows criterion, labels, policy, commitments | Owner sees hashes and privacy-safe counts, not the actual output/context for their own workspace's cases |
| 14(4)(d) disregard/override/reverse | Partial — `go/revise/stop` client decision exists (schema v1, `decision_owner`-gated) but is API-only with read-only dashboard display | No write UI; no per-output override record with reasons |
| 14(4)(e) intervene/interrupt | Partial — fail-closed host output gate + signed gate evidence; per-agent kill switch, deactivate, grant/token/continuation revocation | No workspace-wide stop; no UI-driven halt of everything at once |
| 26(2) assign competent/trained/authorized persons | Partial — governance roles incl. `decision_owner` (wired to sign-off); invited-reviewer expertise attestation with provenance/expiry | Role assignment not audited; no competence/training/authority record for the oversight person |
| 26(5) monitor | Partial — same surfaces as 14(4)(a) | Same gaps |
| 26(6) retain logs ≥6 months | **Exists** — 6-month floor with basis reason `eu_ai_act_article_26_6_deployer_log_minimum`, retention export, enforcement, legal hold, WORM | Scope note in copy already correct |
| Art 4 AI literacy (in force since Feb 2025, not deferred) | Partial — reviewer training/calibration data exists in qualification records | No exportable training-record view framed as literacy evidence |

## 3. Workstream O1 — make the positive claims true (commit-sized)

1. `oversight: designate oversight persons with competence records` — extend `decision_owner` (or add
   `oversight_person`) with attestation fields: competence basis, training completed (date, scope), authority
   granted (override, stop, or both); exportable as an assignment record. Emit audit events on every
   governance/access role assignment and change (currently none — the single most glaring 26(2) gap).
2. `oversight: add a workspace stop control` — one audited action that suspends all automatic grants,
   revokes active continuations, and blocks new review-triggered releases workspace-wide (composing the
   existing per-agent kill switch, `disableManagedReviewPolicy`, and revocation paths); prominent UI with
   confirm, state banner while stopped, and one-click per-agent resume. Document the output gate's safe-state
   semantics (fail-closed, undelivered by default) in the same commit.
3. `oversight: record per-output override decisions` — a write UI for `go/revise/stop` (the API exists), plus
   a per-case "disregarded / overridden / reversed" record with a required reasons field, immutable and
   audit-chained; override-rate becomes a first-class metric on the dashboard and in coverage exports.
4. `oversight: in-app alerting` — a notification surface fed by the existing event stream (`gate.blocked`,
   `review.completed`, plus a new `review.failed`/`review.expired` event), with per-workspace thresholds
   (e.g. disagreement spike, coverage floor hit); closes the "monitoring is a polled 30-day snapshot" gap.
5. `oversight: agent capability card` — per agent: declared provider/model/purpose, observed workflows and
   risk tiers, evaluation-profile summary, known limitations and owner-stated do-not-use conditions, with the
   existing "host-reported, not independently verified" labeling. This is the 14(4)(a) "understand capacities
   and limitations" artifact.
6. `oversight: owner case view` — for workspace-internal (invited-lane) cases, show the oversight person the
   actual output, source context, reviewer rationales, and disagreement before their decision — the workspace
   owns this data; privacy machinery (leases, encryption) already scopes access. Public-network cases keep
   the aggregate-only view.
7. `oversight: anti-rubber-stamping defaults` — decision UI ships with no preselected choice, disagreement
   and gold-failure signals displayed above the decision buttons, an occasional "explain this decision"
   prompt at a low sampled rate, and the oversight person's own override-rate trend visible to them.
8. `compliance: literacy and training export` — reviewer and oversight-person training/calibration records
   exportable as an Article 4 literacy record ("record of trainings" per the
   [EC Q&A](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers)).
9. `compliance: incident export mapped to the Article 73 template` — map audit/evidence exports to the
   Commission's draft serious-incident template fields (dates, description, oversight actions taken); mark
   as draft-aligned until the template is final. Add the FRIA hook: export the workspace's oversight
   configuration as the "description of the implementation of human oversight measures" input for an
   Article 27 assessment.
10. `docs: track prEN 18229-1` — standing item: align log/export formats to the harmonized
    logging/transparency/human-oversight standard when its enquiry draft publishes.

## 4. Workstream O2 — messaging rewrite (capability-first, shared responsibility)

Ordering rule: each copy change ships in the same release as, never before, its O1 capability.

1. `docs-ui: replace "What this is not" with a shared-responsibility matrix` — on `/docs/evidence` (and the
   machine mirror + copy tests): a three-column table, one row per duty:
   **Requirement → RateLoop provides → You remain responsible for.** Example row (26(2)): *"RateLoop enforces
   that gated outputs cannot ship without a decision by a person you authorized, and records who decided"* →
   *"You choose those people and ensure they are competent and trained."* The same legal boundary as today,
   opposite valence. Keep the single responsibility line from §1 and the "RateLoop sits around your AI
   system, not inside it" clarification.
2. `docs-ui: add /docs/human-oversight` — a capability-first page mapping features to 14(4)(a)–(e) one by
   one (monitor → dashboard/alerts; bias → independent blinded panels + override metrics; interpret → case
   view; override → recorded decisions with reasons; stop → fail-closed gate + workspace stop), each section
   ending with the deployer-side responsibility. Cross-link from `/docs/evidence` and the docs index.
3. `landing: lead with oversight` — update the evidence card (or add a section) to Rung-3 language:
   *"Operate EU AI Act-ready human oversight — your people provide the oversight; RateLoop provides the
   instrument and the proof."* One FAQ entry: "Does RateLoop help with EU AI Act human oversight?" answered
   with the matrix logic (yes-for-your-personnel, evidence included, configuration is yours).
4. `copy: adopt the claim ladder` — codify in the copy-gate table (§5): Rungs 1–2 (category/relevance) may
   ship immediately; Rung 3 (helps implement and evidence Articles 14(3)(b)/26 measures) ships with O1 items
   1–3; Rung 4 per-article capability claims ship item-by-item; Rung 5 ("case-level evidence that oversight
   occurred, before the output shipped") ships once WORM delivery is exercised. Refused rungs are permanent:
   "makes you compliant", "satisfies Article 14", "presumption of conformity", and any claim that the public
   network fulfills 26(2).
5. `copy: correct article citations everywhere` — oversight assignment is **26(2)** (not 26(1)); the
   compliance table's EU AI Act row gains Articles 14(3)(b)/14(4) and 26(2) references once the matching
   capabilities exist; keep 12/26(5)-(6)/72/73 as today.

## 5. Claims gate table

| Public phrase | May ship when | Status |
| --- | --- | --- |
| "Human-oversight platform for AI agent outputs" (Rung 1) | Now | Shipped on this branch (tokenless preview) |
| "Designed for teams preparing for EU AI Act Articles 14/26" (Rung 2) | With the /docs/human-oversight mapping page | Shipped on this branch (tokenless preview) |
| "Helps deployers implement and evidence Article 14(3)(b)/26 oversight measures" (Rung 3) | O1 items 1–3 deployed (oversight persons + stop control + override records) | Shipped on this branch (tokenless preview) |
| "Independent blinded panels and override metrics counter automation bias" (Rung 4b) | O1 item 7 | Shipped on this branch (tokenless preview) |
| "Every override is recorded with reasons" (Rung 4d) | O1 item 3 | Shipped on this branch (tokenless preview) |
| "Output held in a safe state until a human decides; workspace stop interrupts everything" (Rung 4e) | O1 item 2 + gate semantics doc | Shipped on this branch (tokenless preview) |
| "Exportable assignment, training, and literacy records" (Rung 4·26(2)/Art 4) | O1 items 1, 8 | Shipped on this branch (tokenless preview) |
| "Case-level proof that oversight occurred before the output shipped" (Rung 5) | WORM delivery exercised end-to-end | Still gated — WORM delivery not yet exercised |
| "Compliant / certifies / satisfies Article 14 / presumption of conformity" | Never | Unchanged — permanent refusal |

## 6. Decisions and human tasks

1. **Legal review before Rung 3+ copy publishes** — the phrasing above follows the market norm and avoids
   outcome claims, but article-specific marketing language should pass counsel review (human task, one
   round). **Decision:** deferred by owner decision for this test deployment; counsel review remains
   required before any production publication of Rung 3+ copy.
2. **Marketing tense** — with the Digital Omnibus deferring Annex III high-risk obligations to 2027-12-02,
   frame as "get oversight-ready" rather than deadline pressure; Article 4 literacy (in force, not deferred)
   is the honest near-term hook.
3. **Naming** — whether the oversight designation reuses `decision_owner` or introduces `oversight_person`
   (one-line owner decision; the plan works either way). **Decision:** `decision_owner` is reused as the
   oversight designation, extended with the attestation fields; no separate `oversight_person` role is
   introduced.

## 7. Sequencing

O1 items 1–3 are the critical path (they unlock Rung 3, the tier the user asked for); items 4–7 follow in
any order; items 8–10 are independent. O2.1 (the matrix rewrite) can ship at Rung 2 immediately — replacing
the negative box with shared-responsibility framing does not depend on new capabilities, only on accurate
rows — then rows strengthen as O1 lands. All standing rules apply: claims match deployed reality, no
fund-core changes (everything here is off-chain), tokenless/`main` isolation, proportionate tests per commit,
and coordination with the parallel implementation stream working through the
[remaining-improvements plan](tokenless-remaining-improvements-plan-2026-07.md) (the oversight-person and
audit-event work touches the same governance modules as its W4/W6).
