#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Build the legacy-contributor manifest (merkle root + per-entry proofs) for
// `LaunchDistributionPool.claimLegacyContributorAllocation`.
//
// Flow:
//   1. Read `scripts/legacy-claim/snapshot.json` — the curated list of legacy contributors with
//      `legacyWeight = oldClaimAmount + oldReferrerRewardsEarned`. The `oldReferrerRewardsEarned`
//      column is what makes this distribution "referral-aware": claimants who referred others on
//      the previous curyo.xyz/self.xyz deployment receive a proportionally larger share of the
//      9M LREP pool, exactly matching the methodology applied to the prior 4M distribution
//      (commit b9183134 on this repo).
//   2. Allocate the pool pro-rata by `legacyWeight`, floor each share to 6-decimal LREP units,
//      and assign the leftover atomic units to the entries with the largest fractional remainder
//      (ties broken by original-manifest index order). Total allocation is bit-for-bit equal to
//      `legacyPoolAmount`.
//   3. Compute each merkle leaf as `keccak256(bytes.concat(keccak256(abi.encode(account, allocation))))`
//      — matches `LaunchDistributionPool._legacyContributorLeaf` exactly.
//   4. Build the OpenZeppelin Standard Merkle Tree (sorted leaves, sibling-sorted pairs). For
//      each leaf, walk up the tree collecting sibling hashes — that's the proof.
//   5. Emit `packages/nextjs/lib/legacy-claim/manifest.ts` with the merkle root, per-entry
//      `(address, allocation, proof[])`, and the snapshot's provenance metadata.
//
// Re-run from the repo root with:
//   node packages/nextjs/scripts/legacy-claim/build-manifest.mjs
//
// The output is deterministic given a fixed snapshot input. Commit both the snapshot and the
// generated manifest so reviewers can re-derive the merkle root.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { concat, encodeAbiParameters, getAddress, keccak256 } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "snapshot.json");
const MANIFEST_TS_PATH = resolve(__dirname, "..", "..", "lib", "legacy-claim", "manifest.ts");

function loadSnapshot() {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const pool = BigInt(raw.legacyPoolAmount);
  const totalWeight = BigInt(raw.totalLegacyWeight);
  const sumOfWeights = raw.claims.reduce((acc, claim) => acc + BigInt(claim.legacyWeight), 0n);
  if (sumOfWeights !== totalWeight) {
    throw new Error(`Snapshot totalLegacyWeight (${totalWeight}) != sum of per-entry weights (${sumOfWeights}).`);
  }
  return { pool, totalWeight, raw };
}

/**
 * Pro-rata allocator: returns `BigInt[]` of per-entry allocations summing exactly to `pool`.
 * Floor each share, then distribute the leftover atomic units one-by-one to the largest
 * fractional remainder. Ties broken by original-manifest order.
 */
function allocate(pool, totalWeight, claims) {
  const shares = claims.map(claim => {
    const weight = BigInt(claim.legacyWeight);
    const numerator = pool * weight; // exact
    const floorShare = numerator / totalWeight;
    const remainder = numerator - floorShare * totalWeight; // 0 <= remainder < totalWeight
    return { floorShare, remainder, index: claim.index };
  });

  let assigned = shares.reduce((acc, s) => acc + s.floorShare, 0n);
  let leftover = pool - assigned;

  // Largest remainder first, ties by original index ascending.
  const order = [...shares.keys()].sort((a, b) => {
    if (shares[b].remainder !== shares[a].remainder) {
      return shares[b].remainder > shares[a].remainder ? 1 : -1;
    }
    return shares[a].index - shares[b].index;
  });

  for (let i = 0; leftover > 0n && i < order.length; i++) {
    shares[order[i]].floorShare += 1n;
    leftover -= 1n;
  }

  return shares.map(s => s.floorShare);
}

/** Matches `LaunchDistributionPool._legacyContributorLeaf`. */
function leafHash(account, allocation) {
  const inner = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(account), allocation]),
  );
  return keccak256(inner);
}

/**
 * OpenZeppelin StandardMerkleTree algorithm.
 *
 * Layout: a complete binary tree stored as an array. Internal nodes occupy indices
 * `[0, n-2]`, leaves occupy `[n-1, 2n-2]`. Children of node `i` are at `2i+1` and `2i+2`;
 * parent of node `i` is at `(i-1) / 2`. Leaves are sorted ascending. Each parent is the
 * keccak256 of the two sibling-sorted children (lower hash first).
 *
 * Reference: https://github.com/OpenZeppelin/merkle-tree (single-node leaf already double-hashed).
 */
function buildTree(leaves) {
  const n = leaves.length;
  const sortedLeaves = [...leaves]
    .map((hash, originalIndex) => ({ hash, originalIndex }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const tree = new Array(2 * n - 1);
  for (let i = 0; i < n; i++) {
    tree[2 * n - 2 - i] = sortedLeaves[i].hash; // leaves go at the END of the array, reversed
  }
  for (let i = n - 2; i >= 0; i--) {
    tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);
  }
  // Build originalIndex → tree-position map so we can compute proofs.
  const leafTreeIndexByOriginal = new Array(n);
  sortedLeaves.forEach((leaf, sortedIdx) => {
    leafTreeIndexByOriginal[leaf.originalIndex] = 2 * n - 2 - sortedIdx;
  });
  return { tree, leafTreeIndexByOriginal };
}

function hashPair(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return keccak256(concat([lo, hi]));
}

function proofForLeaf(tree, leafTreeIndex) {
  const proof = [];
  let idx = leafTreeIndex;
  while (idx > 0) {
    const siblingIdx = idx % 2 === 1 ? idx + 1 : idx - 1;
    if (siblingIdx < tree.length) {
      proof.push(tree[siblingIdx]);
    }
    idx = Math.floor((idx - 1) / 2);
  }
  return proof;
}

function main() {
  const { pool, totalWeight, raw } = loadSnapshot();
  const allocations = allocate(pool, totalWeight, raw.claims);

  // Sanity check
  const allocationTotal = allocations.reduce((acc, a) => acc + a, 0n);
  if (allocationTotal !== pool) {
    throw new Error(`Allocation total ${allocationTotal} != pool ${pool}.`);
  }

  const entries = raw.claims.map((claim, i) => ({
    index: claim.index,
    account: getAddress(claim.account),
    allocation: allocations[i],
  }));

  const leaves = entries.map(entry => leafHash(entry.account, entry.allocation));
  const { tree, leafTreeIndexByOriginal } = buildTree(leaves);
  const merkleRoot = tree[0];

  const manifestEntries = entries.map((entry, originalIdx) => ({
    account: entry.account,
    allocation: entry.allocation.toString(),
    proof: proofForLeaf(tree, leafTreeIndexByOriginal[originalIdx]),
  }));

  // Emit a deterministic TypeScript module so reviewers can diff the manifest cleanly.
  const generatedAt = new Date().toISOString();
  const ts = renderManifestModule({
    merkleRoot,
    allocationTotal: pool,
    generatedAt,
    sourceHumanFaucet: raw.sourceHumanFaucet,
    weightRule: raw.weightRule,
    roundingRule: raw.roundingRule,
    entries: manifestEntries,
  });
  writeFileSync(MANIFEST_TS_PATH, ts);

  // Echo to stdout for the operator runbook.
  console.log("Merkle root:", merkleRoot);
  console.log("Allocation total:", pool.toString(), "(=", Number(pool) / 1e6, "LREP)");
  console.log("Generated entries:", manifestEntries.length);
  for (const e of manifestEntries) {
    const lrep = (Number(BigInt(e.allocation)) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
    console.log(`  ${e.account}: ${e.allocation} (${lrep} LREP, proof depth ${e.proof.length})`);
  }
}

function renderManifestModule({
  merkleRoot,
  allocationTotal,
  generatedAt,
  sourceHumanFaucet,
  weightRule,
  roundingRule,
  entries,
}) {
  const header = `// Auto-generated by scripts/legacy-claim/build-manifest.mjs. Do not edit by hand.
// Source: scripts/legacy-claim/snapshot.json (curated list of legacy contributors).
// Re-run the script to regenerate after editing the snapshot.
//
// Methodology: ${weightRule}
// Rounding:    ${roundingRule}
// Source human faucet: ${sourceHumanFaucet}
// Generated at: ${generatedAt}

`;

  const types = `export type LegacyClaimEntry = {
  /** Checksummed EOA address. */
  address: \`0x\${string}\`;
  /** Raw uint256 allocation, denominated in LREP atomic units (6 decimals). 1 LREP = 1_000_000. */
  allocation: string;
  /** OZ StandardMerkleTree proof. Matches the leaf format used by
   *  \`LaunchDistributionPool._legacyContributorLeaf\`:
   *  \`keccak256(bytes.concat(keccak256(abi.encode(account, allocation))))\`. */
  proof: \`0x\${string}\`[];
};

export type LegacyClaimManifest = {
  merkleRoot: \`0x\${string}\` | null;
  /** Sum of all entry allocations, denominated in LREP atomic units. */
  allocationTotal: string;
  generatedAt: string | null;
  entries: readonly LegacyClaimEntry[];
};

`;

  const entriesBlock = entries
    .map(
      entry => `  {
    address: "${entry.account}",
    allocation: "${entry.allocation}",
    proof: [
${entry.proof.map(p => `      "${p}",`).join("\n")}
    ],
  },`,
    )
    .join("\n");

  const manifest = `export const legacyClaimManifest: LegacyClaimManifest = {
  merkleRoot: "${merkleRoot}",
  allocationTotal: "${allocationTotal.toString()}",
  generatedAt: "${generatedAt}",
  entries: [
${entriesBlock}
  ],
};
`;

  return header + types + manifest;
}

main();
