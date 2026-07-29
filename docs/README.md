# Documentation

## Start here

| Document                                       | What it answers                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [rateloop-tokenless.md](rateloop-tokenless.md) | What the tokenless version is and how it works — identity, review policy, evidence, settlement, and what is switched off.                     |
| [target-audience.md](target-audience.md)       | Who it is for. What the quotas and pricing imply about the assumed customer, and which segment the evidence actually supports.                |
| [legal-position.md](legal-position.md)         | Where it sits under the EU AI Act, the DSA, data-protection law and the US regimes landing in 2027 — including which obligations do not bite. |
| [design-assessment.md](design-assessment.md)   | Strengths and weaknesses, and the three strategic questions the assessment cannot settle.                                                     |
| [remediation-plan.md](remediation-plan.md)     | What to do about the weaknesses, in commit-sized items, ordered by what is urgent rather than by what is large.                               |

The first four were written on 29 July 2026 to replace twenty-five documents that
had drifted from the code. Read them as a set: the first is descriptive, the next
three are arguments built on it, and the plan acts on the last of those.

The assessment was revised the same day after a second research pass checked each
weakness against the code. Six of eight were wrong in some respect and the
corrections are recorded in place, because the pattern of error — describing a survey
instead of the code — is itself the finding.

## Working references

These predate the set above and are asserted by tests, so a claim in them cannot
silently drift from the implementation.

| Document                                                                                                 | Purpose                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tokenless-immutable-implementation-plan-2026-07.md](tokenless-immutable-implementation-plan-2026-07.md) | The implementation boundaries for the `tokenless` branch. Read before changing contracts, deployment artifacts, Ponder, the keeper, the app, the SDK, agents, MCP or E2E. |
| [tokenless-legal-revenue-reference-2026-07.md](tokenless-legal-revenue-reference-2026-07.md)             | The revenue and legal reference the billing surfaces are written against.                                                                                                 |
| [tokenless-agent-human-review-owner-guide.md](tokenless-agent-human-review-owner-guide.md)               | Operating the review loop as an agent owner.                                                                                                                              |
| [tokenless-environment-parity.md](tokenless-environment-parity.md)                                       | The isolated tokenless environments and what must match between them.                                                                                                     |

## A note on drift

Of the twenty-nine documents that existed before this rewrite, the four asserted by
tests were accurate and the rest were not — a scope documented at five dimensions
where the schema has twelve, a sampling floor documented at 10% where the code uses
25%, a CLI command that does not exist.

Keep this directory small, and prefer asserting a claim in a test over restating it
in prose.
