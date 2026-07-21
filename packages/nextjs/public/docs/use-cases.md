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

## AI-assisted hiring

- **Scenario:** A recruiting system ranks applicants and recommends who should advance. A plausible recommendation can
  still overlook job-relevant evidence or reproduce discriminatory patterns.
- **EU AI Act context:** AI used to analyse applications or evaluate candidates is listed in
  [Annex III](https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3). For systems that qualify as high-risk under
  [Article 6](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-6),
  [Article 14](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14) requires effective human oversight and
  [Article 26](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26) requires deployers to assign people with
  the necessary competence, training, and authority. The Commission currently says the employment rules apply from
  2 December 2027 in its [current timeline](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems).
  RateLoop can support the review workflow and its evidence; it does not determine legal classification, perform the
  provider's [Article 43](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-43) conformity assessment, or make
  a system compliant.
- **When to check:** Before a recommendation materially influences who advances or is rejected, and after a material
  model, prompt, data, or workflow change.
- **Human check:** `Does the supplied application evidence support this recommendation under the approved job criteria?`
- **Worked example:** AI recommendation: "Do not advance — no team-lead experience." Panel result: Override — 4 of 5
  authorized reviewers (the CV shows two years leading six engineers; a relevant contract role was omitted). The hiring
  owner advances the candidate, records the override, and checks whether other applicants were affected.
- **Who reviews:** Authorized recruiting or employment specialists with the competence, training, and authority
  required for the workflow. Candidate data stays in a private invited-review lane.
- **What you get back:** A recorded human result, reasons, disagreement, timing, and any override or escalation. The
  designated hiring owner remains responsible for the decision.

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
