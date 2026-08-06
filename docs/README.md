# Documentation

## Start here

| Document                                                                                                                             | What it answers                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [rateloop-tokenless.md](rateloop-tokenless.md)                                                                                       | What the tokenless version is and how it works — identity, review policy, evidence, settlement, and what is switched off.                     |
| [target-audience.md](target-audience.md)                                                                                             | Who it is for. What the plan limits and pricing imply about the assumed customer, and which segment the evidence actually supports.           |
| [legal-position.md](legal-position.md)                                                                                               | Where it sits under the EU AI Act, the DSA, data-protection law and the US regimes landing in 2027 — including which obligations do not bite. |
| [evaluation-platform-gaps.md](evaluation-platform-gaps.md)                                                                           | What the product lacks as an evaluation platform, and the one feature that would regulate RateLoop itself.                                    |
| [business-plan.md](business-plan.md)                                                                                                 | How the product could make money: what is shippable, why the meter runs backwards, and the ninety-day test.                                   |
| [product-opportunities.md](product-opportunities.md)                                                                                 | What to build next to make it worth paying for, ordered so revenue mechanics come first.                                                      |
| [implementation-plan.md](implementation-plan.md)                                                                                     | How to execute the plan and the build list: phases, effort in days, dependencies, and what not to build.                                      |
| [tokenless-commercial-product-expansion-research-2026-08.md](tokenless-commercial-product-expansion-research-2026-08.md)             | Pre-customer readiness: which scoped changes are implemented and locally verified, and what hosted release proof is still pending.            |
| [tokenless-pre-outreach-operations-2026-08.md](tokenless-pre-outreach-operations-2026-08.md)                                         | The operator's answers before contacting anyone — what evidence exists, what a prospect can verify, and what is not claimed.                  |
| [documentation-update-plan-2026-08.md](documentation-update-plan-2026-08.md)                                                         | What is still wrong in this directory, checked against the code: the contradictions first, then the drift, then the duplication.              |

The first set was written on 29 July 2026 to replace twenty-five documents that had
drifted from the code. Read them as a set: the first is descriptive and the rest are
arguments built on it.

## Working references

These predate the set above. Each is read by at least one test, but those tests are
targeted guards over specific disclosure sentences — the trust, privacy and
enforcement-boundary claims — not over the whole document. Treat the guarded claims as
pinned and everything else as prose that can drift.

| Document                                                                                                 | Purpose                                                                                                                                                                   | What the tests actually pin                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [tokenless-immutable-implementation-plan-2026-07.md](tokenless-immutable-implementation-plan-2026-07.md) | The implementation boundaries for the `tokenless` branch. Read before changing contracts, deployment artifacts, Ponder, the keeper, the app, the SDK, agents, MCP or E2E. | Artifact-key authority, commit-time disclosure, issuer blast radius, framework-integration and public-evidence claims.              |
| [tokenless-legal-revenue-reference-2026-07.md](tokenless-legal-revenue-reference-2026-07.md)             | The revenue and legal reference the billing surfaces are written against.                                                                                                 | Only the artifact-key, commit-time-disclosure and issuer/Circle sentences. The revenue, tax, DAC7 and platform-law sections are not. |
| [tokenless-agent-human-review-owner-guide.md](tokenless-agent-human-review-owner-guide.md)               | Operating the review loop as an agent owner.                                                                                                                              | Only the advisory-versus-host-enforced boundary and the Feedback Bonus governance gate. Audience, timing and question modes are not. |
| [tokenless-environment-parity.md](tokenless-environment-parity.md)                                       | The isolated tokenless environments and what must match between them.                                                                                                     | Public API boundary, framework-integration and public-evidence claims.                                                             |

## Generated and non-markdown material

- `evidence/population-estimate-validation-2026-07.json` — generated by
  [`packages/nextjs/scripts/population-estimate-validation.ts`](../packages/nextjs/scripts/population-estimate-validation.ts).
  Do not edit by hand. Its generator is tested, but nothing yet asserts that the
  checked-in file matches a fresh run.
- `sales/` — German customer-facing pitch, sales guide and pricing recommendation
  (August 2026). Binary Office files, outside every claim gate in this repository: the
  source of truth for what may be claimed is
  [`publicEvidenceClaims.ts`](../packages/nextjs/lib/tokenless/publicEvidenceClaims.ts)
  and the deployed configuration, not the deck.

## A note on drift

Of the twenty-nine documents that existed before the 29 July rewrite, the four carrying
test guards were the four that had not drifted on the guarded claims; the rest had — a
scope documented at five dimensions where the schema has twelve, one adaptive sampling
rule re-derived inconsistently across runtime and reporting modules, and a CLI command
that does not exist.

Two documents were removed on 6 August 2026 once their work was done: a remediation plan
whose items had all shipped, and the design assessment it was built from, whose
hand-counted numbers had drifted across 299 commits. Both remain in history.

Keep this directory small, and prefer asserting a claim in a test over restating it in
prose.
