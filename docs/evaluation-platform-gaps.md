# Evaluation platform status and optional gaps

Reviewed 29 July 2026 against the current `tokenless` implementation. This replaces
the earlier Humanloop comparison, whose inventory predated much of RateLoop's
evaluation, telemetry, alerting, and deterministic-check implementation.

## Product boundary

RateLoop is a human-assurance product, not a prompt-development platform. Its current
target audience supplies the system under review and its evaluation material; teams
that need RateLoop to construct datasets or calibrate evaluators are outside the
documented target. The items below are therefore optional product expansions, not
remediation defects or release blockers.

The core decision boundary is also fixed: reviewer scoring, routing, triage, and
outcomes remain deterministic. An LLM evaluator must not be added to the core. Any
future inference feature requires a separate, off-by-default, separately licensed
module and an Article 3(1) assessment before implementation.

## Current inventory

| Area | Implemented now | Optional remainder |
| --- | --- | --- |
| Curated evaluation material | Versioned and frozen assurance suites, cases, baseline/candidate artifacts, owner-adjudicated gold items, expected choices, and immutable content commitments. | Customer-facing suite creation, case import, cloning, and new-version lifecycle. |
| Deterministic evaluators | Frozen checks for equality, membership, numeric bounds, and existence. Results bind observed values, fail the run deterministically, and can ingest separately labelled external automated-evaluation receipts. | More declarative operators such as schema, string, and citation checks, plus customer-facing configuration. Never execute arbitrary customer code in the service. |
| Version comparison | Every assurance case is a blinded baseline-versus-candidate comparison. Aggregate results include counts, candidate preference share, pass/fail, a Wilson interval, and previous-run drift. | Bind both artifacts to explicit baseline and candidate agent-version IDs and emit one signed comparison report. |
| CI integration | The Promptfoo adapter opens human review, returns CI-compatible pass/fail, and fails uncertainty closed. | A bounded asynchronous CLI command that waits for one immutable human-assurance run and returns distinct pass, fail, pending/timeout, and transport-error exit states. |
| Traces | Validated OTLP GenAI traces bind model identity, timing, token metadata, version, and parent relationships. | A privacy-filtered execution/tool tree in the reviewer case view. Show inputs, outputs, errors, timing, and sources—not hidden chain-of-thought. |
| Alerting | Gate-blocked, failure, expiry, workspace-stop, disagreement-spike, and coverage-floor events reach the notification inbox. Email is opt-in and browser notifications require permission. | Additional delivery destinations such as Slack or Teams, if demanded. |
| Live end-user feedback | Reviewer responses and Feedback Bonus records exist, but these are not customer end-user signals. | A purpose-bound thumbs-up/down/report capture contract for live executions. |

## Smallest safe expansion sequence

Do not begin this sequence without first reopening the target-audience decision about
dataset construction.

1. Productize the existing suite and deterministic-check foundation. Move check
   parsing and evaluation into one shared schema; add suite clone/version, case
   import, artifact, freeze, and run APIs; bind every consumer with cross-module
   invariant tests.
2. Freeze explicit baseline and candidate agent-version IDs into the suite and run
   manifest. Require the same workspace, agent, workflow, and evaluation profile, then
   sign the comparison built from the existing blinded responses and Wilson interval.
3. Add a human CI contract over an exact immutable run and comparison manifest.
   Never substitute an unbound "latest posture." Keep automated-evaluator receipts
   visibly separate from human evidence.
4. Add live end-user feedback independently. Use a short-lived capture token bound to
   workspace, agent version, execution, and output commitment; apply abuse controls
   and minimal privacy-safe fields; route negative signals to human review without
   turning them directly into a verdict.
5. Add reviewer-visible trace detail only after redaction and artifact-access rules
   are specified and tested.

UX remains staged around the current task. No dataset or evaluation configuration
appears before an agent exists. If this expansion is approved, the first direct action
is **Test a version**; case setup, freezing, execution, and comparison appear only
when their prerequisites are complete.

## Enterprise-readiness note

Enterprise identity and trusted SSO issuers are production release requirements, and
the DPA contains the explicit no-training commitment. External attestations and a
contracted qualified timestamp service are procurement work, not missing repository
code. Until procured and independently validated, their release capabilities remain
fail-closed and public copy must not claim them.
