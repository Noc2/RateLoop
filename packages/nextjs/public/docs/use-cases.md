# Human assurance use cases

Use RateLoop when automated checks can verify the rules, but a person still has to judge whether an AI output is
appropriate for this situation. These examples describe workflows, not customer results or outcome claims.

A useful check has one bounded artifact, one concrete criterion, an authorized reviewer audience, and a clear action for
the accountable owner. It can tolerate a human response window.

## Customer replies

- **Problem:** A grounded, correctly formatted reply can still confuse or frustrate the customer.
- **Trigger:** Check the draft before it is sent, especially after an agent change or when policy forces review.
- **Human check:** `Would you send this response to the customer as written?`
- **Reviewers:** Invite support experts when policy correctness matters. Use general-human judgment only for clarity or
  tone.
- **Material:** Private cases stay with authorized invited reviewers. A network or hybrid panel receives only public,
  synthetic, or safely redacted material.
- **Decision:** The owner sends, revises, or escalates after reading the result, reasons, and disagreement.

## Research and client work

- **Problem:** Citations do not prevent an agent from overstating a conclusion or omitting a decision-critical point.
- **Trigger:** Check a report before client delivery or an important internal decision.
- **Human check:** `Is this conclusion supported by the supplied sources?`
- **Reviewers:** Invite domain experts for specialist correctness. General readers can judge clarity or source
  credibility only when that is the frozen criterion.
- **Material:** Keep private client work with invited reviewers. Send a network or hybrid panel only public, synthetic,
  or safely redacted sources and conclusions.
- **Decision:** The owner delivers, revises, or escalates.

## Product experiences

- **Problem:** A screen or public asset can pass automated checks while leaving its audience unsure what to do.
- **Trigger:** Check a screenshot, image set, or video before release, or compare two public-safe versions.
- **Human check:** `Is the intended next action clear from this screen?`
- **Reviewers:** Invite representative target users when that qualification matters. A general-human panel can judge
  broadly legible public experiences.
- **Material:** Keep private prototypes invited-only. Use screenshots, images, or YouTube video for public, synthetic,
  or safely redacted context.
- **Decision:** The owner publishes, revises, or compares again.

## Agent-version calibration

- **Problem:** A model, prompt, tool, or workflow change means earlier evidence no longer describes the current agent.
- **Trigger:** Start the new scope at full review and keep version, policy, workflow, risk tier, and audience comparable.
- **Human check:** `Based on the supplied source, should this agent suggestion be accepted?`
- **Reviewers:** The same qualified reviewer audience throughout the evidence scope.
- **Material:** The exact source and suggestion payloads under the policy's separate data boundary.
- **Decision:** The owner keeps full review or allows scoped coverage to decrease when the evidence supports it.

## Extraction and triage exceptions

- **Problem:** An agent classifies a request or extracts a record, but ambiguity or low confidence makes the structured
  result unreliable.
- **Trigger:** Route the exception when policy detects low confidence, missing context, higher risk, or a maximum
  unreviewed gap.
- **Human check:** `Does the suggested classification or extracted record match the supplied source?`
- **Reviewers:** Invite operations or domain reviewers who understand the source and target schema.
- **Material:** Keep private records invited-only. A network or hybrid panel receives only public, synthetic, or safely
  redacted examples.
- **Decision:** The owner accepts, corrects, or escalates.

## Combine people with automated evaluation

Keep unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators. Route the contextual
question they cannot settle—clarity, appropriateness, usefulness, or support for a conclusion—to people. Human results
can calibrate automated evaluators; they do not turn a subjective judgment into an objective fact.

Reviewer qualifications determine who can answer the criterion. Data sensitivity independently determines what each
configured audience may receive. Private material belongs with authorized invited reviewers. A RateLoop network or
hybrid panel receives only public, synthetic, or safely redacted material. Proof of Human can provide a provider-scoped
uniqueness signal; it does not prove professional expertise.

Do not use RateLoop when deterministic automation can settle the question, the decision is time-critical, the material
cannot be shared with the selected audience, reviewers cannot judge from the supplied evidence, or the panel would be
treated as the sole medical, legal, financial, security, or safety approval.
