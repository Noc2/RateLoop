import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  type IntegrityEpochSnapshot,
  canonicalizeIntegrityValue,
  verifyIntegrityEpochSnapshot,
} from "~~/lib/tokenless/integrityEpochs";

export async function persistIntegrityEpochSnapshotWithClient(client: PoolClient, snapshot: IntegrityEpochSnapshot) {
  const verification = verifyIntegrityEpochSnapshot(snapshot);
  if (!verification.valid) {
    throw new Error(`Integrity epoch snapshot is invalid: ${verification.errors.join(",")}.`);
  }
  const manifest = snapshot.manifest;
  await client.query(
    `INSERT INTO tokenless_integrity_epochs
     (epoch_id, schema_version, cutoff_at, source_window_started_at, source_window_ended_at,
      private_features_expire_at, feature_spec_hash, parameter_hash, scorer_build_hash,
      private_leaf_root, aggregate_cluster_counts_json, eligible_reviewer_count,
      excluded_reviewer_count, manifest_hash, manifest_json, signature_algorithm, signer_key_id,
      signing_public_key, signature, lookup_key_version, pseudonym_key_version, vault_key_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23)`,
    [
      manifest.epochId,
      manifest.schemaVersion,
      manifest.cutoffAt,
      manifest.sourceWindow.startedAt,
      manifest.sourceWindow.endedAt,
      manifest.privateFeaturesExpireAt,
      manifest.featureSpecHash,
      manifest.parameterHash,
      manifest.scorerBuildHash,
      manifest.privateLeafRoot,
      canonicalizeIntegrityValue(manifest.aggregateClusterCounts),
      manifest.eligibleReviewerCount,
      manifest.excludedReviewerCount,
      snapshot.manifestHash,
      canonicalizeIntegrityValue(manifest),
      snapshot.signing.algorithm,
      snapshot.signing.keyId,
      snapshot.signing.publicKey,
      snapshot.signature,
      manifest.privateKeyVersions.lookup,
      manifest.privateKeyVersions.pseudonym,
      manifest.privateKeyVersions.vault,
      manifest.createdAt,
    ],
  );
  for (const leaf of snapshot.privateLeaves) {
    await client.query(
      `INSERT INTO tokenless_integrity_epoch_members
       (epoch_id, reviewer_lookup, reviewer_pseudonym, cluster_pseudonym, risk_band,
        eligibility_status, reason_codes_json, feature_commitment, private_leaf_hash,
        vault_ciphertext, vault_key_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        leaf.epochId,
        leaf.reviewerLookup,
        leaf.reviewerPseudonym,
        leaf.clusterPseudonym,
        leaf.riskBand,
        leaf.eligibilityStatus,
        canonicalizeIntegrityValue(leaf.reasonCodes),
        leaf.featureCommitment,
        leaf.privateLeafHash,
        leaf.vaultCiphertext,
        leaf.vaultKeyVersion,
        manifest.createdAt,
      ],
    );
  }
}

export async function persistIntegrityEpochSnapshot(snapshot: IntegrityEpochSnapshot) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await persistIntegrityEpochSnapshotWithClient(client, snapshot);
    await client.query("COMMIT");
    return { epochId: snapshot.manifest.epochId, manifestHash: snapshot.manifestHash };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
