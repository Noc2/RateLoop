# Tokenless RBTS v1 Scoring Specification

**Status:** frozen for the next disposable tokenless test deployment  
**Scoring version:** `2`  
**Mechanism identifier:** `tokenless-rbts-v1`  
**Fund core:** immutable and adminless; no LREP, stake, governance, payout oracle, or operator scoring input

This specification freezes deterministic contract behavior. It does not claim that RBTS guarantees truth. The attack
fixture demonstrates that unanimous constant-report equilibria can score highly; World ID, hidden assignment, integrity
epochs, qualification, gold tasks, and verdict gates remain independent controls.

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

`beginSettlement` is permissionless after the reveal deadline and fixes `entropyBlock = block.number + 1`. After the
order-independent reveal-set commitment is complete, anyone finalizes the seed from that exact future block:

```text
entropy = blockhash(entropyBlock)
```

The seed cannot be finalized until `block.number > entropyBlock`. If the exact hash is unavailable after the EVM
block-hash retention window, the round takes the deterministic base-only fallback and refunds every unused bonus. The
public evidence names `base-future-blockhash-v1`; the Base sequencer can still influence block production, so it must
not be called unbiasable. Before mainnet or material-value use, replace it with a reviewed verifiable beacon.

Aggregation builds an order-independent reveal-set commitment from both the XOR and modular sum of
`keccak256(commitKey)`. After aggregation:

```text
scoringSeed = keccak256(
  "rateloop-tokenless-rbts-v1",
  chainId,
  panelAddress,
  roundId,
  frozenRevealCount,
  revealSetXor,
  revealSetSum,
  entropy
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
report exactly once in each role, and is directly recomputable. Solidity finds the two successors by scanning the
frozen set. The path is quadratic in panel size but outer processing remains paginated; deployment limits and gas
benchmarks must cap the maximum panel size.

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

Any disagreement between JavaScript and Solidity blocks deployment. The public verifier must use this version and the
exact on-chain evidence rather than accepting a server-computed score.
