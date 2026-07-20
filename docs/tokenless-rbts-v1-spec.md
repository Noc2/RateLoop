# Tokenless RBTS v1 Scoring Specification

**Status:** Current mechanism specification for the undeployed tokenless v4 source. The historical disposable v3
deployment still uses the superseded future-blockhash entropy path. Real-money use remains gated by a fresh atomic
deployment, an independent security review of the experimental beacon verifier, and the production-readiness register.
**Scoring version:** `2`  
**Mechanism identifier:** `tokenless-rbts-v1`  
**Fund core:** immutable and adminless; no LREP, stake, governance, payout oracle, or operator scoring input

This specification freezes deterministic contract behavior. It does not claim that RBTS guarantees truth. The attack
fixture demonstrates that unanimous constant-report equilibria can score highly; World ID, hidden assignment, integrity
epochs, qualification, gold tasks, and verdict gates remain independent controls.

The fixture also separates unilateral from coordinated laziness. In the frozen 2,000-trial, 15-seat diagnostic, one
constant-up reporter among honest reporters earns a mean score of 6,251 bps versus 7,136 bps for the honest
population. Honest reporting is therefore the local best response in that seeded model, while the 9,950-bps
unanimous constant-report equilibrium remains collectively more lucrative than the 7,238-bps honest baseline. This
diagnostic does not establish incentive compatibility outside its stated signal model.

## Inputs and minimum panel

Each accepted reveal contains a binary `vote` and integer `predictedUpBps` from 100 through 9,900 inclusive. The
contract accepts 1%-step predictions rather than the disposable five-bucket input. A scoring-v2 round requires
`minimumReveals >= 3`. Fewer than three valid reveals use the disclosed under-quorum compensation path, receive the
same fixed base as a healthy-round reveal, and do not receive an RBTS bonus.

The exact report commitment and EIP-712 reveal type remain:

```text
Reveal(uint256 roundId,address voteKey,uint8 vote,uint16 predictedUpBps,
       bytes32 responseHash,address payoutAddress,bytes32 salt)
```

## Post-closure entropy and set binding

Round terms freeze the quicknet-t `beaconNetworkHash`, a tlock disclosure `beaconRound`, and an independent
`scoringBeaconRound` before any commit. The disclosure round is the first quicknet-t round strictly after the commit
deadline. The scoring round is the first quicknet-t round strictly after the reveal deadline, so its entropy cannot be
known while the scored reveal set is still open. After the order-independent reveal-set commitment is complete, anyone
submits the exact scoring-beacon randomness and proof:

```text
verifyBeacon(beaconNetworkHash, scoringBeaconRound, randomness, proof) = true
```

`TokenlessPanel` holds an immutable verifier address. A verifier revert, false result, zero randomness, or malformed
proof leaves the round unchanged; the disclosure round can never feed scoring, and caller-selected or operator-signed
entropy is never accepted. The contract pins quicknet-t network hash
`0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5`, genesis `1689232296`, and three-second
period, validates both round timestamps arithmetically, and requires `beaconFailureDeadline` to be at least
`MIN_BEACON_GRACE` after the scoring-beacon timestamp. If verified randomness remains unavailable after that deadline,
anyone may invoke the deterministic base-only fallback. Every
revealer then earns the fixed base and every unused bonus returns to the funder. A deployment must bind the panel to a
reviewed verifier for the exact drand network; the test-only mock verifier is forbidden outside local tests.

### Quicknet-t proof format

The v4 reference verifier accepts only drand `quicknet-t` (`bls-unchained-g1-rfc9380`) with chain hash
`cc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5`. `proof` is exactly the raw 48-byte
compressed-G1 drand signature: no ABI wrapper, round prefix, length prefix, JSON, or relay metadata is included.
`randomness` must equal `SHA-256(proof)`.

The signed message is `SHA-256(uint64be(scoringBeaconRound))`, where `uint64be` is exactly eight big-endian bytes. The
hash-to-curve domain separation tag is `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`. The pinned quicknet-t public key
is `b15b65b46fb29104f6a4b5d1e11a8da6344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66072f6d84ee791a3382bfb055afab1e6a375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da`.
Verification uses the Prague EIP-2537 BLS12-381 precompiles.

Pinned relay vectors used by both Solidity and keeper tests are:

| Round | Raw 48-byte proof | Randomness (`SHA-256(proof)`) |
| ---: | --- | --- |
| 1 | `81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21` | `5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b` |
| 12,345,678 | `b40845f2ae971025215f599b8af346bf329129d1d5ee416665472f91050acb3ecd31ee878033ba14842d4367010e1964` | `c8788d522aa63a9fd2e715499097597dc94f33ee2bd0f78c5367e11ce825227b` |

`QuicknetTBeaconVerifier` vendors the minimum required `BLS2`/precompile code from Randamu `bls-solidity` commit
`11af179a8287d978659aae07adb66aa60f64b8a6`. That code and this adapter are experimental and unaudited. The provenance
pin and passing vectors are not a security audit; real-money use remains gated on independent review of the exact
compiled runtime hash.

Aggregation builds an order-independent reveal-set commitment from both the XOR and modular sum of
`keccak256(abi.encode(commitKey))`. After aggregation:

```text
scoringSeed = keccak256(
  "rateloop-tokenless-rbts-v1",
  chainId,
  panelAddress,
  roundId,
  frozenRevealCount,
  revealSetXor,
  revealSetSum,
  randomness
)
```

Distinct commit keys and the paired accumulators make order changes irrelevant. The evidence includes all commit keys,
so an independent verifier can recompute both accumulators and the seed.

## Reference and peer selection

Create a canonical circular permutation by ranking every revealed commit key by:

```text
rank(candidate) = (keccak256(scoringSeed, candidateCommitKey), candidateCommitKey)
```

Sort ascending by the tuple. A rater's next entry, wrapping at the end, is the reference; the next-next entry is the
peer. This canonical hash-rank permutation is order-independent, excludes self, keeps the two roles distinct, uses each
report exactly once in each role, and is directly recomputable. After beacon verification, Solidity heap-sorts the
frozen set once in deterministic O(n log n) time and persists the canonical order. Paginated scoring then resolves both
successors in O(1) per report, making the full assignment and scoring path O(n log n).

### Maximum-panel settlement gas budget

`TokenlessPanelGasBenchmark.t.sol` runs the complete settlement lifecycle with 500 committed and revealed seats. It
uses 25-seat aggregate and scoring pages, matching the configured keeper page size at the time of measurement. Each
measured contract call receives a conservative additional 100,000 gas transaction-envelope allowance; L1 data fees
are priced separately and are not EVM execution gas.

With Solidity 0.8.35, Prague EVM, `via_ir`, optimizer runs 100, the in-repo quicknet-t verifier, and the checked-in
contracts, the benchmark measured:

| Settlement transaction | Count | Maximum execution gas | Asserted gas ceiling including allowance |
| --- | ---: | ---: | ---: |
| `beginSettlement` | 1 | 7,743 | 200,000 |
| `processAggregate` | 20 | 82,819 | 250,000 per page |
| `finalizeScoringSeed` (BLS verification and canonical heap sort) | 1 | 7,978,742 | 10,000,000 |
| `processScores` | 20 | 1,871,941 | 2,500,000 per page |
| `finalizeSettlement` | 1 | 99,852 | 250,000 |

The measured scoring-page total is 36,695,463 gas and the measured lifecycle total is 49,975,101 gas after the
100,000-gas allowance for each of 43 transactions. CI caps the total at 60,000,000 gas. Every individual call remains
below its transaction ceiling. Any compiler, page-size, verifier, or contract change must rerun and deliberately
reapprove the benchmark; L1 data fees remain separate.

## Score

All operations use integer basis points and floor division.

```text
delta(p)              = min(p, 10_000 - p)
shadow(p, up)         = p + delta(p)
shadow(p, down)       = p - delta(p)
quadratic(p, up)      = floor((20_000*p - p*p) / 10_000)
quadratic(p, down)    = 10_000 - floor(p*p / 10_000)
information           = quadratic(shadow(referencePrediction, ownVote), peerVote)
prediction            = quadratic(ownPrediction, peerVote)
rbtsScoreBps          = floor((information + prediction) / 2)
```

`rbtsScoreBps` is bounded from 0 through 10,000. The contract stores the reference key, peer key, information score,
prediction score, and combined score for recomputation.

## Fixed funding and refund

At round creation:

```text
maximumSeatPay = floor(bountyAmount / maximumCommits)
fixedBasePay   = floor(maximumSeatPay * 8_000 / 10_000)
maximumBonus   = maximumSeatPay - fixedBasePay
```

`attemptCompensation` must equal `fixedBasePay`, and `attemptReserve` must be at least
`fixedBasePay * maximumCommits`. This makes the accepted-work guarantee identical in healthy, under-quorum, and
beacon-failure paths instead of quietly substituting a smaller consolation payment. A healthy round returns the unused
attempt reserve to the funder.

For each valid reveal in a finalized round:

```text
payout = fixedBasePay + floor(maximumBonus * rbtsScoreBps / 10_000)
```

Pay is independent of other raters' total score. There is no normalized pool, loss, debt, stake, or clawback. While
weights are processed, the contract accumulates the exact total finalized payout liability. At finalization it credits
`bountyAmount - liability` to the funder immediately. After the claim window, only `liability - totalPaid` is returned
as stale claims. Attempt reserve and fee accounting remain separate.

## Liveness and failure behavior

- A valid reveal always reaches fixed base pay after a successful scoring-v2 settlement.
- Under-quorum and beacon-failure compensation pay the same fixed base from the separately funded attempt reserve.
- Round terms reserve at least six hours between the reveal and beacon-failure deadlines. Verified-beacon scoring is
  available through the failure deadline; base-only fallback is available only after it.
- No integrity epoch, World/Self provider, operator, keeper, verdict, takedown, or moderation decision can change the
  contract score, payout address, liability, or claimability after commit acceptance.
- If future verifiable randomness is unavailable, the permitted fallback is fixed base with the maximum bonus refunded;
  an operator-supplied seed is forbidden.
- Every deployed scoring rule is immutable for that panel address. A scoring change requires a fresh deployment key.

## Verification vectors

The normative executable vectors are:

- `packages/foundry/scripts-js/tokenlessRbts.test.js`;
- `packages/foundry/scripts-js/fixtures/tokenless-rbts-v1-attack-benchmark.json`; and
- the Solidity library, panel, invariant, and state-machine tests committed with scoring version 2.

The attack fixture includes a focal unilateral constant reporter and a separate manufactured-surprise diagnostic.
The latter is not part of RBTS settlement and must not be interpreted as changing the fund core.

Any disagreement between JavaScript and Solidity blocks deployment. The public verifier must use this version and the
exact on-chain evidence rather than accepting a server-computed score.
