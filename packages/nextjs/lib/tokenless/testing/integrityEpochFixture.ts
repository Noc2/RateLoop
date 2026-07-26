import { generateKeyPairSync } from "node:crypto";
import { dbClient } from "~~/lib/db";
import { persistIntegrityEpochSnapshot } from "~~/lib/tokenless/integrityEpochPersistence";
import { buildIntegrityEpoch, hashIntegrityValue } from "~~/lib/tokenless/integrityEpochs";

export async function persistCurrentIntegrityEpochFixture(epochId: string, now = new Date()) {
  const existing = await dbClient.execute({
    sql: "SELECT epoch_id FROM tokenless_integrity_epochs WHERE epoch_id = ? LIMIT 1",
    args: [epochId],
  });
  if (existing.rows.length > 0) return null;
  const snapshot = buildIntegrityEpoch({
    epochId,
    cutoffAt: new Date(now.getTime() - 60_000).toISOString(),
    sourceWindowStartedAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    privateFeaturesExpireAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    scorerBuildHash: hashIntegrityValue({ build: "test-current-integrity-epoch" }),
    observations: [
      {
        reviewerId: `rater_${epochId.replace(/[^a-z0-9]/giu, "_").toLowerCase()}`,
        observedAt: new Date(now.getTime() - 60_000).toISOString(),
        sourceRecordCommitments: [hashIntegrityValue({ source: epochId })],
        eligible: true,
      },
    ],
    keys: {
      lookupKey: Buffer.alloc(32, 1),
      lookupKeyVersion: "lookup-test",
      pseudonymKey: Buffer.alloc(32, 2),
      pseudonymKeyVersion: "pseudonym-test",
      vaultKey: Buffer.alloc(32, 3),
      vaultKeyVersion: "vault-test",
      signingPrivateKey: generateKeyPairSync("ed25519").privateKey,
    },
  });
  await persistIntegrityEpochSnapshot(snapshot);
  return snapshot;
}
