# Certora Round 3 Plan

Round 3 keeps the fast, deterministic `certora-check` lane as the required-gate candidate and treats cloud proofs as informational until the matrix is stable.

## Tracks

- Track A: keep all `.conf` files compiling and CVL type-checking on PRs.
- Track B: keep lightweight cloud proofs green for math, `ClusterPayoutOracle`, `LoopReputation`, `ProtocolConfig`, and lemma-only specs.
- Track C: expand lifecycle and conservation coverage only where the harness can model state transitions without hiding the contract guard being proved.
- Track G: promote stable fast cloud proofs to required CI after repeated clean runs and acceptable runtime.

## Promotion Criteria

A proof is a required-gate candidate only when it has deterministic local compilation, stable prover results, and no known tooling false positive for the modeled property.
