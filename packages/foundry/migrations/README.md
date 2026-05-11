# HumanFaucet Redeploy Bootstrap

Use this when a fresh deployment must preserve already verified humans from a prior deployment.
The deploy script can replay those claims before the public faucet opens, then closes the migration
window before `HumanFaucet` ownership moves to governance.

## What Gets Replayed

Each migrated row:

- marks the old identity nullifier as used in the new `HumanFaucet`
- marks the holder address as claimed in the new `HumanFaucet`
- transfers the recorded HREP amount from the new faucet allocation
- mints a new Voter ID in the new `VoterIdNFT` with the old nullifier
- preserves referral stats when referrer fields are present

This is deliberately different from a plain token transfer plus NFT mint. Plain transfers would leave
`addressClaimed` and `nullifierUsed` empty and allow duplicate faucet claims after redeploy.

## Manifest

Copy `faucet-bootstrap.example.json` to `faucet-bootstrap.json`, set `sourceHumanFaucet`
to the previous deployed faucet, and replace every array with the snapshot data. All arrays must
be the same length and in the original claim order. Numeric fields are quoted strings so large
Self nullifiers and 6-decimal HREP amounts are parsed exactly.

Amounts use HREP's 6 decimals:

- `10000000000` = 10,000 HREP
- `15000000000` = 15,000 HREP, for a 10,000 HREP claim plus 5,000 HREP claimant referral bonus

For non-referral claims, set `referrers` to the zero address and both bonus arrays to `0`.
For referral claims, `amounts[i]` is the amount sent to the claimant, including the claimant bonus,
while `referrerRewards[i]` is the additional amount sent to the referrer.

## Snapshot Inputs

For the first 9 current verified humans, capture:

- holder address and nullifier from old `VoterIdNFT.VoterIdMinted` logs
- claimant amount from old `HumanFaucet.TokensClaimed` logs
- referral details, if any, from old `HumanFaucet.ReferralRewardPaid` logs

Production deploys also verify the manifest against `sourceHumanFaucet` before broadcasting:

- `totalClaimants()` must equal the manifest row count
- `totalClaimed()` must equal the manifest payout total
- every holder must be claimed on the source faucet
- every holder's `claimNullifier` and every `nullifierUsed` entry must match the manifest

The deploy script does not pause the source faucet or require it to already be paused. Treat the
manifest as the final migration snapshot: if new claims are possible on the source faucet after the
snapshot, regenerate the manifest before redeploying.

If token IDs must remain `1..9`, keep the rows ordered by the old token ID and run the bootstrap
before anyone can claim on the new deployment.

## Deploy

Set the manifest path before deploying:

```bash
MIGRATION_BOOTSTRAP_FILE=./migrations/faucet-bootstrap.json yarn deploy --network celo --keystore <name>
```

If a supported live-chain deployment intentionally starts with no migrated faucet claims, set an
explicit skip flag instead:

```bash
MIGRATION_BOOTSTRAP_SKIP=true yarn deploy --network celo --keystore <name>
```

The deploy script validates the manifest before broadcasting, replays the claims in batches after
the new faucet is funded, then calls `closeMigrationBootstrap()` before governance handoff. The
default batch size is 20 migrated claims per transaction to keep Celo bootstrap transactions below
the chain block gas limit with headroom after the deploy flow's gas-estimate multiplier. Override it
only if simulation shows the target chain has enough headroom:

```bash
MIGRATION_BOOTSTRAP_FILE=./migrations/faucet-bootstrap.json MIGRATION_BOOTSTRAP_BATCH_SIZE=10 yarn deploy --network celo --keystore <name>
```

## Post-Deploy Checks

For every migrated holder, verify:

- `HumanReputation.balanceOf(holder)` matches the manifest amount plus any migrated referrer rewards
- `HumanFaucet.hasClaimed(holder)` is true
- `HumanFaucet.isNullifierUsed(nullifier)` is true
- `VoterIdNFT.hasVoterId(holder)` is true
- Ponder indexes the expected `voter_id` rows from the new deployment start block

## Legacy LREP Claim

`legacy-lrep-claims.json` converts the same 9 migrated verified humans into the
fixed `4,000,000 LREP` legacy claim for the RateLoop redeployment.

The allocation intentionally preserves the old referral economics instead of
splitting the pool equally:

```text
legacyWeight = old migrated claimant amount + old referrer rewards earned
```

That means claimant-side referral bonuses remain in each claimant's old amount,
and the first verified user also receives credit for the five old referrer
rewards recorded in `faucet-bootstrap.json`.

Snapshot totals:

- Old claimant amounts: `115,000 HREP`
- Old referrer rewards: `25,000 HREP`
- Total legacy weight: `140,000 HREP`
- New fixed legacy pool: `4,000,000 LREP`

The resulting claim weights are:

| Old manifest index | Address | Legacy weight | LREP claim |
| --- | --- | ---: | ---: |
| 1 | `0x63cada40e8acf7a1d47229af5be35b78b16035fa` | 35,000 | 1,000,000.000000 |
| 2 | `0x7c6425827bb8d848808cbb8fe2bd55fd2f2fa41a` | 15,000 | 428,571.428572 |
| 3 | `0xc1cd80c7cd37b5499560c362b164cba1cff71b44` | 15,000 | 428,571.428572 |
| 4 | `0x455ee797cea79a936ba8e8ed888e0b20ca1a1ba3` | 10,000 | 285,714.285714 |
| 5 | `0x5a5148e7963c732e4c0991726793a726ce28046a` | 15,000 | 428,571.428572 |
| 6 | `0x3ea207780415e2ab68b97eb3b02addd70020ac4c` | 10,000 | 285,714.285714 |
| 7 | `0xe6722d1fdca78552eae5ea12ea3a8b7d6eec7aa8` | 15,000 | 428,571.428571 |
| 8 | `0x74cc77fda426225470351f93c6ce4382b4b51aa8` | 15,000 | 428,571.428571 |
| 9 | `0x4b98406f108d1a19dbbbe22216d432a5b1a5e22b` | 10,000 | 285,714.285714 |

The JSON amounts are 6-decimal atomic LREP units. They sum exactly to
`4,000,000e6`. The tiny rounding remainder is assigned by largest fractional
remainder with old manifest order as the tiebreaker. The legacy Merkle tree
should use the `LaunchDistributionPool` leaf shape:

```text
keccak256(abi.encode(account, amount))
```
