# Tokenless gold-quality and mechanism-health specification

Gold items are calibration cases with an adjudicated binary answer. At launch, only a workspace owner may
promote a ready case from that workspace's frozen suite to gold. Platform-synthetic gold is reserved for a
future public-safe corpus and cannot be created through a workspace API.

## Injection and disclosure

- Reviewers are told that panels may include calibration items. They are never told which item is gold.
- Invited-panel injection is off by default and requires an owner opt-in. The rate is bounded at 1–20%, with
  at most five items per run. Selection is deterministic from a server-only HMAC key and the frozen run.
- Public or hybrid injection uses only platform-synthetic items from a public project and remains behind
  `TOKENLESS_NETWORK_PANELS_ENABLED`. Owner gold can never enter the public lane.
- The frozen run manifest commits to every selected case. Usage is reserved from that same exact case set in
  the freeze transaction; gold is never appended after the manifest or reservation is written.
- A gold seat has the same economics as every other seat. Gold never changes settlement, earned payout, or
  Feedback Bonus eligibility.

## Scoring and privacy

Gold responses are stored separately under the run-scoped reviewer-key lineage. They are excluded from the
customer verdict, adaptive observations, evidence rationale/failure aggregates, and Feedback Bonus selection.
Packets reveal only an aggregate calibration count. An owner-adjudicated result can qualify only an invited
reviewer in the same workspace, project, and cohort after at least five completed items and 80% accuracy; it
can never create a global network qualification.

## Mechanism health

Completed runs persist the unanimity rate among non-gold cases that reached the privacy quorum, candidate
share, RBTS score mean and variance, gold failure rate, and comparable-scope drift. Finalized transparency
evidence carries only aggregate score sums and squared-score sums. Metrics are idempotently recomputed when
index evidence arrives late and are shown as diagnostic evidence, not as settlement inputs.

## Abuse boundaries and limitations

Gold detects disagreement with the seeded answer; it does not prove the answer is correct, prevent an owner
from mislabelling a case, establish reviewer identity, or establish broad domain competence. Repeated exposure
can leak a corpus, so selection is secret and bounded. Owner-derived calibration is tenant-scoped to prevent
one customer from poisoning another customer's reviewer pool. Platform-synthetic gold must complete a
separate public-safety and readiness review before activation.
