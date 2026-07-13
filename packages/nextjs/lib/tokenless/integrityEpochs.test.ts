import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import seededRings from "~~/lib/tokenless/fixtures/integrity-epoch-seeded-rings.json";
import {
  type IntegrityEpochObservation,
  type IntegrityHardLinkKind,
  buildIntegrityEpoch,
  hashIntegrityValue,
  integrityValueCommitment,
  verifyIntegrityEpochSnapshot,
} from "~~/lib/tokenless/integrityEpochs";

const LOOKUP_KEY = Buffer.alloc(32, 11);
const PSEUDONYM_KEY = Buffer.alloc(32, 12);
const VAULT_KEY = Buffer.alloc(32, 13);
const LINK_KEY = Buffer.alloc(32, 14);
const SIGNING_KEY = generateKeyPairSync("ed25519").privateKey;

type SeededObservation = {
  reviewerId: string;
  eligible: boolean;
  observedAt: string;
  hardLinks: Array<{ kind: string; value: string }>;
  behavioralRiskBps: number;
  behaviorReasonCodes: string[];
  exclusionReasonCodes?: string[];
};

function observations(): IntegrityEpochObservation[] {
  return (seededRings.observations as SeededObservation[]).map(value => ({
    reviewerId: value.reviewerId,
    observedAt: value.observedAt,
    sourceRecordCommitments: [hashIntegrityValue({ source: "seeded-fixture", reviewer: value.reviewerId })],
    eligible: value.eligible,
    exclusionReasonCodes: value.exclusionReasonCodes,
    hardLinks: value.hardLinks.map(link => ({
      kind: link.kind as IntegrityHardLinkKind,
      valueCommitment: integrityValueCommitment({
        key: LINK_KEY,
        kind: link.kind as IntegrityHardLinkKind,
        value: link.value,
      }),
    })),
    behavioralRiskBps: value.behavioralRiskBps,
    behaviorReasonCodes: value.behaviorReasonCodes,
  }));
}

function build(overrides: Partial<Parameters<typeof buildIntegrityEpoch>[0]> = {}) {
  return buildIntegrityEpoch({
    epochId: "integrity:2026-07-13:001",
    cutoffAt: "2026-07-13T00:00:00.000Z",
    sourceWindowStartedAt: "2026-06-13T00:00:00.000Z",
    privateFeaturesExpireAt: "2026-10-13T00:00:00.000Z",
    createdAt: "2026-07-13T00:05:00.000Z",
    scorerBuildHash: hashIntegrityValue("integrity-scorer-fixture-v1"),
    observations: observations(),
    keys: {
      lookupKey: LOOKUP_KEY,
      lookupKeyVersion: "lookup-2026-07",
      pseudonymKey: PSEUDONYM_KEY,
      pseudonymKeyVersion: "pseudonym-2026-07",
      vaultKey: VAULT_KEY,
      vaultKeyVersion: "vault-2026-07",
      signingPrivateKey: SIGNING_KEY,
    },
    ...overrides,
  });
}

test("integrity epochs deterministically merge only high-confidence hard-link components", () => {
  const first = build();
  const second = build();

  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(
    first.privateLeaves.map(leaf => leaf.privateLeafHash),
    second.privateLeaves.map(leaf => leaf.privateLeafHash),
  );
  assert.notDeepEqual(
    first.privateLeaves.map(leaf => leaf.vaultCiphertext),
    second.privateLeaves.map(leaf => leaf.vaultCiphertext),
  );
  assert.deepEqual(first.manifest.aggregateClusterCounts, {
    totalClusters: 4,
    singletonClusters: 3,
    twoToThreeMemberClusters: 1,
    fourToNineMemberClusters: 0,
    tenPlusMemberClusters: 0,
  });
  assert.equal(first.manifest.eligibleReviewerCount, 5);
  assert.equal(first.manifest.excludedReviewerCount, 1);

  const clusterSizes = new Map<string, number>();
  for (const leaf of first.privateLeaves) {
    clusterSizes.set(leaf.clusterPseudonym, (clusterSizes.get(leaf.clusterPseudonym) ?? 0) + 1);
  }
  assert.deepEqual(
    [...clusterSizes.values()].sort((left, right) => left - right),
    [1, 1, 1, 3],
  );
  assert.equal(first.privateLeaves.filter(leaf => leaf.riskBand === "medium").length, 2);
  assert.deepEqual(verifyIntegrityEpochSnapshot(first, { vaultKey: VAULT_KEY, pseudonymKey: PSEUDONYM_KEY }), {
    valid: true,
    errors: [],
  });
});

test("public manifest and private snapshot never serialize raw reviewer or link values", () => {
  const snapshot = build();
  const serialized = JSON.stringify(snapshot);
  for (const value of (seededRings.observations as SeededObservation[]).flatMap(observation => [
    observation.reviewerId,
    ...observation.hardLinks.map(link => link.value),
  ])) {
    assert.doesNotMatch(serialized, new RegExp(value));
  }
  const committedMetadata = JSON.stringify({
    manifest: snapshot.manifest,
    leaves: snapshot.privateLeaves.map(leaf =>
      Object.fromEntries(Object.entries(leaf).filter(([key]) => key !== "vaultCiphertext")),
    ),
  });
  assert.doesNotMatch(committedMetadata, /country|nationality|tax|sanctions/i);
  assert.deepEqual(snapshot.manifest.limitationCodes, [
    "behavioral_similarity_does_not_merge_clusters",
    "device_network_signals_disabled_pending_dpia",
  ]);
});

test("probabilistic behavioral risk changes a risk band but cannot create a cluster", () => {
  const snapshot = build({
    observations: [
      {
        reviewerId: "behavior-only-a",
        observedAt: "2026-07-12T10:00:00.000Z",
        sourceRecordCommitments: [hashIntegrityValue("behavior-only-a")],
        eligible: true,
        behavioralRiskBps: 9_000,
        behaviorReasonCodes: ["historical_agreement_residual_high"],
      },
      {
        reviewerId: "behavior-only-b",
        observedAt: "2026-07-12T10:00:01.000Z",
        sourceRecordCommitments: [hashIntegrityValue("behavior-only-b")],
        eligible: true,
        behavioralRiskBps: 9_000,
        behaviorReasonCodes: ["historical_agreement_residual_high"],
      },
    ],
  });

  assert.equal(snapshot.manifest.aggregateClusterCounts.totalClusters, 2);
  assert.equal(snapshot.manifest.aggregateClusterCounts.singletonClusters, 2);
  assert.ok(snapshot.privateLeaves.every(leaf => leaf.riskBand === "high"));
});

test("epoch generation rejects future records and unexpected protected-attribute inputs", () => {
  assert.throws(
    () =>
      build({
        observations: [
          {
            reviewerId: "future-reviewer",
            observedAt: "2026-07-13T00:00:01.000Z",
            sourceRecordCommitments: [hashIntegrityValue("future")],
            eligible: true,
          },
        ],
      }),
    /outside the frozen source window/,
  );
  assert.throws(
    () =>
      build({
        observations: [
          {
            reviewerId: "protected-input",
            observedAt: "2026-07-12T00:00:00.000Z",
            sourceRecordCommitments: [hashIntegrityValue("protected")],
            eligible: true,
            country: "DE",
          } as IntegrityEpochObservation,
        ],
      }),
    /unsupported fields: country/,
  );
});

test("epoch verification detects private metadata and encrypted feature tampering", () => {
  const metadataTamper = structuredClone(build());
  metadataTamper.privateLeaves[0]!.clusterPseudonym = `hmac-sha256:${"0".repeat(64)}`;
  const metadataVerification = verifyIntegrityEpochSnapshot(metadataTamper, {
    vaultKey: VAULT_KEY,
    pseudonymKey: PSEUDONYM_KEY,
  });
  assert.equal(metadataVerification.valid, false);
  assert.ok(metadataVerification.errors.includes("private_leaf_hash_mismatch"));

  const ciphertextTamper = structuredClone(build());
  ciphertextTamper.privateLeaves[0]!.vaultCiphertext = "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AA";
  const ciphertextVerification = verifyIntegrityEpochSnapshot(ciphertextTamper, {
    vaultKey: VAULT_KEY,
    pseudonymKey: PSEUDONYM_KEY,
  });
  assert.equal(ciphertextVerification.valid, false);
  assert.ok(ciphertextVerification.errors.includes("feature_decryption_failed"));
});
