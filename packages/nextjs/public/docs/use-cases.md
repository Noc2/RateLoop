# Human assurance use cases

Use RateLoop when automated checks can verify the rules, but a person still has to judge whether an AI output is
appropriate for this situation. Three worked examples:

## Customer replies

- **Scenario:** A support reply can be grounded and correctly formatted yet still confuse, dismiss, or sound wrong for
  the situation.
- **When to check:** Before the draft is sent — especially after an agent change, or when risk, low confidence, or
  missing context forces review.
- **Human check:** `Would you send this response to the customer as written?`
- **Worked example:** Draft reply: "Your account was flagged correctly under our policy. There is nothing further we
  can do." Panel result: No — 4 of 5 reviewers (reads as dismissive; no next step offered). The owner revises the reply
  before it reaches the customer.
- **Who reviews:** Support experts when policy correctness matters; general-human judgment for clarity or tone.
- **What you get back:** The panel result with reasons and disagreement. The owner sends, revises, or escalates.

## Research and client work

- **Scenario:** An agent can cite sources and still overstate a conclusion or omit a decision-critical point.
- **When to check:** Before the deliverable reaches a client or informs an important internal decision.
- **Human check:** `Is this conclusion supported by the supplied sources?`
- **Worked example:** Draft conclusion: "Churn fell 18% because of the new onboarding flow (source: Q2 cohort
  dashboard)." Panel result: Not supported — 3 of 5 reviewers (pricing changed the same quarter; correlation only). The
  owner weakens the claim and adds the caveat before the report goes out.
- **Who reviews:** Domain experts for specialist correctness; general readers for clarity or source credibility when
  that is the agreed criterion.
- **What you get back:** The result with reasons and source-linked evidence. The owner delivers, revises, or escalates.

## Product experiences

- **Scenario:** A screen, campaign, or generated asset can pass automated checks while leaving its audience unsure what
  to do.
- **When to check:** Before release of a bounded screenshot, image set, or video — or to compare two public-safe
  versions.
- **Human check:** `Is the intended next action clear from this screen?`
- **Worked example:** Two checkout screens: version A pairs the Pay button with a promo banner; version B shows one
  action. Panel result: Version B — 4 of 5 reviewers (banner competes with Pay; B has one clear action). The owner
  ships version B and keeps the comparison as evidence.
- **Who reviews:** Representative target users when that qualification matters; a general-human panel for broadly
  legible public experiences.
- **What you get back:** The panel result with reasons and disagreement. The owner publishes, revises, or compares
  again.

## Combine people with automated evaluation

Keep unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators. Route the contextual
question they cannot settle—clarity, appropriateness, usefulness, or support for a conclusion—to people. The same
pattern covers classification and extraction exceptions: when ambiguous source material or low confidence makes a
structured result unreliable, route that case to reviewers who can read the source. Human results can calibrate
automated evaluators; they do not turn a subjective judgment into an objective fact.

Reviewer qualifications determine who can answer the criterion. Data sensitivity independently determines what each
configured audience may receive. Private material belongs with authorized invited reviewers. A RateLoop network or
hybrid panel receives only public, synthetic, or safely redacted material. Proof of Human can provide a provider-scoped
uniqueness signal; it does not prove professional expertise.

After a model, prompt, tool, or workflow change, review starts again at full coverage for the changed scope; see
`how-it-works.md` for that calibration and the review lifecycle.

Do not use RateLoop when deterministic automation can settle the question, the decision is time-critical, the material
cannot be shared with the selected audience, reviewers cannot judge from the supplied evidence, or the panel would be
treated as the sole medical, legal, financial, security, or safety approval.
