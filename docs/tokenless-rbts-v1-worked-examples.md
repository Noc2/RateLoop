# Tokenless RBTS v1 worked examples

**Status:** Executable reference vectors for the current RBTS v1 source. The scoring specification and contract tests
control if an example diverges.
**Simulator:** `packages/foundry/scripts-js/tokenlessRbts.js`

The candidate uses integer basis points. A user prediction must be between 100 and 9,900. For each rater a seeded
permutation selects a distinct reference and peer after the reveal set is frozen.

For a rater reporting `up`, predicting 70%, with a reference prediction of 70% and an `up` peer:

```text
shadow prediction  = 100%
information score  = 10,000 bps
prediction score   =  9,100 bps
combined score     =  9,550 bps
```

Holding both predictions and the peer fixed but reporting `down` changes the shadow prediction to 40%, the information
score to 6,400 bps, and the combined score to 7,750 bps. This is the vote-linked property missing from the disposable
prediction-only implementation.

Run the deterministic attack matrix with:

```sh
node packages/foundry/scripts-js/tokenlessRbts.js
```

The matrix covers continuous honest reports, nearest-bucket reports, random clicks, constant-report equilibria,
coordinated minority and majority reports, selective reveal, heterogeneous priors, and a seeded correlation ring.
These simulations are regression and review tools, not empirical proof that the mechanism produces truth. The release
gate still requires preregistered human experiments against equal pay and the disposable prediction-only baseline.

The checked-in benchmark fixture also makes an important limitation explicit: unanimous constant-up and constant-down
reports score very highly even though they are only about 50% correct in the seeded world. RBTS therefore cannot replace
proof-of-human admission, hidden assignment, correlation analysis, gold tasks, or an inconclusive/rerun verdict gate.
