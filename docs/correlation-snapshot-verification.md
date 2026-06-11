# Correlation Snapshot Verification

RateLoop correlation payout snapshots are optimistic artifacts. A globally bonded
frontend operator publishes deterministic public JSON, challengers can recompute
it during the challenge window, and governance arbitrates challenged roots.

## Version Pinning

Every automatic artifact carries:

- `artifactVersion`: `rateloop-correlation-artifact-v2`
- `scorerVersion`: `rateloop-correlation-epoch-v2`
- `eligibilitySpecVersion`: `rateloop-correlation-eligibility-v1`
- `canonicalJsonVersion`: `rateloop-canonical-json-v1`
- `featureSpecVersion`: `rateloop-correlation-features-v1`
- `parameters`: the full scoring parameter object

`parameterHash` is the canonical-JSON hash of the scoring parameters, including
the spec-version fields above. Epoch proposals pin that hash on-chain.

## Eligibility Predicate

For `rateloop-correlation-eligibility-v1`, a round vote is eligible when the
Ponder `/correlation/round-votes` route selects it for the reward pool, content,
and round:

- the round is settled;
- the vote is revealed;
- `identityKey` and `identityHolder` are present and nonzero;
- the voter is not the reward-pool funder, funder identity key, or content submitter;
- the vote falls inside the configured bounty window when one exists;
- configured bounty credential requirements are satisfied.

The artifact stores the exact `eligibleVotes` used for scoring so the verifier can
rerun the scorer and compare payout roots, leaves, proofs, and epoch cluster roots.

## Verifier

Run:

```sh
yarn workspace @rateloop/keeper verify:correlation-artifact artifact.json
```

The verifier prints JSON with:

- `artifactHash`: canonical hash of the artifact;
- `parameterHash`: recomputed parameter hash;
- round and epoch counts;
- `errors`: nonempty on any mismatch.

It fails nonzero when:

- artifact parameters or spec versions are malformed;
- a round root, reason root, total claim weight, leaf, or proof does not match
  recomputation from `eligibleVotes`;
- an epoch `parameterHash` or `clusterRoot` does not match the artifact rounds.

## Availability

Ponder now maintains a durable `payout_artifact_cache` keyed by `artifactHash`.
When `ClusterPayoutOracle` proposal events are indexed, Ponder attempts to fetch
the artifact URI, verifies the canonical hash, and stores canonical JSON. Claim
proof resolution checks this cache before reading the proposer-hosted URI.

Operators should still mirror public artifacts to content-addressed storage and
allowlist the chosen gateway through `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST`. The
resolver supports `https://`, `ipfs://`, and `ar://` URIs through allowlisted
gateways.

## Fallback Policy

No keeper should bypass challenged snapshots automatically. Challenged roots stay
paused for governance judgment. When no operator publishes an unchallenged root,
any authorized frontend operator can publish the deterministic artifact; keepers
retry discovery every tick and perform a full chain reconciliation periodically.
