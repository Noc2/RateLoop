# Legacy-claim manifest

The 9M LREP `LEGACY_CONTRIBUTOR_POOL` on `LaunchDistributionPool` is distributed via a merkle airdrop. This directory holds the inputs and the builder script that turn a curated list of legacy contributors into the on-chain root + the per-entry proofs the frontend serves.

## Files

- **`snapshot.json`** — curated source-of-truth list of legacy contributors. Each entry carries `oldClaimAmount` (their migrated balance from the previous curyo.xyz / RateLoop snapshot, already inclusive of any claimant-side referral bonus they received) and `oldReferrerRewardsEarned` (the referrer rewards they accrued on curyo.xyz by inviting others). The sum is `legacyWeight`, which drives the pro-rata distribution.
- **`build-manifest.mjs`** — deterministic builder. Reads `snapshot.json`, allocates the pool pro-rata, computes the OZ StandardMerkleTree (with the exact double-hashed leaf format that `LaunchDistributionPool._legacyContributorLeaf` uses), and emits `packages/nextjs/lib/legacy-claim/manifest.ts`.

## Methodology

The 9M pool distribution re-uses the methodology applied to the prior 4M RateLoop distribution (commit `b9183134`, `packages/foundry/migrations/legacy-lrep-claims.json`):

1. **Weight = old claim + curyo referrer rewards.** A claimant who referred others on the previous curyo.xyz deployment is credited proportionally for that effort. The single user whose `legacyWeight` is dominated by `oldReferrerRewardsEarned` (account `0x63cada40…`) receives ~25 % of the new pool, exactly as they did on the prior 4M distribution (1 M LREP out of 4 M, scaling to 2.25 M LREP out of 9 M).
2. **Pro-rata floor with largest-fractional-remainder.** `floor(pool * weight / totalWeight)` per entry, then the leftover atomic units go to the entries with the largest fractional remainder, breaking ties by original-manifest index. This makes the allocation sum exactly to `pool` (atomic-unit conservation).
3. **OZ StandardMerkleTree leaves.** Each leaf is `keccak256(bytes.concat(keccak256(abi.encode(account, allocation))))` — matches `LaunchDistributionPool._legacyContributorLeaf` exactly. Pairs are sibling-sorted before hashing.

The merkle vesting allocation is intentionally separate from the on-chain `VERIFIED_REFERRAL_POOL` (42 M LREP). Deployments also seed the same legacy contributor addresses into `RaterRegistry` as `SeededHuman` credentials for the standard human-credential TTL, so active legacy credentials count as verified humans everywhere. That means a legacy contributor can claim both their legacy vesting via the merkle proof here and `claimVerifiedBonus(referrer)` for the base + referral bonus on the verified-human pool.

## To regenerate the manifest

After editing `snapshot.json`:

```bash
node packages/nextjs/scripts/legacy-claim/build-manifest.mjs
```

The script emits:

- the merkle root (must match `Deploy.s.sol`'s `LEGACY_CONTRIBUTOR_ROOT`)
- the allocation total (must equal the snapshot's `legacyPoolAmount`)
- the full per-entry table

The generated `manifest.ts` is committed. Reviewers can re-run the script and confirm the output matches what is in `manifest.ts` byte-for-byte.

## On-chain activation

Fresh deployments automatically call:

```solidity
launchDistributionPool.setLegacyContributorRoot(
  0xcaa28d15e6c6c1bb47d347a413cb808e40c38a7e43171ce9a131983a92b97d18,
  9_000_000_000_000  // 9,000,000 LREP in 6-decimal atomic units
);
```

from `Deploy.s.sol` after the launch pool is funded and before ownership is transferred to governance. This sets `legacyContributorVestingStart = block.timestamp`. The vesting curve is hard-coded on the contract (24-month linear vest with 1 % instant unlock on day 0; see `LaunchDistributionPool.LEGACY_VESTING_DURATION`).

Re-running `setLegacyContributorRoot` after any allocation has been claimed reverts (`AlreadyClaimed`), so the root is effectively immutable post-launch. Get it right the first time. If a re-vest is ever needed, the only path is `recoverSurplus` + a fresh deploy.

## Verification checklist

Before deploying or proposing a manual activation for an already-deployed pool:

1. `node packages/nextjs/scripts/legacy-claim/build-manifest.mjs` and confirm the printed merkle root matches `packages/nextjs/lib/legacy-claim/manifest.ts`.
2. `cd packages/nextjs && node ../../scripts/run-node-tests.mjs lib/legacy-claim app/api/legacy-claim` — the test `every manifest entry's leaf hashes back to the merkle root via its proof` re-derives the root from every proof using the same algorithm the contract uses on-chain. If it passes, the proofs are sound.
3. Sum the printed allocations — must equal exactly `9_000_000_000_000` (no atomic-unit drift).
4. Cross-check at least one address's allocation against the prior 4M distribution (`git show b9183134:packages/foundry/migrations/legacy-lrep-claims.json`): the ratios should match exactly (e.g. the 35-weight account is 25 % of total on both, scaled to 1 M of 4 M and 2.25 M of 9 M).
5. Eye-ball that none of the 9 addresses look like a typo / address-poisoning lookalike.
