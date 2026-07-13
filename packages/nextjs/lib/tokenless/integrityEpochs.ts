import {
  type KeyObject,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import "server-only";

export const INTEGRITY_EPOCH_SCHEMA_VERSION = "rateloop-integrity-epoch-v1" as const;
export const INTEGRITY_PRIVATE_LEAF_SCHEMA_VERSION = "rateloop-integrity-private-leaf-v1" as const;
export const INTEGRITY_FEATURE_VECTOR_SCHEMA_VERSION = "rateloop-integrity-feature-vector-v1" as const;

export const INTEGRITY_HARD_LINK_KINDS = [
  "provider_subject_conflict",
  "payout_ownership_conflict",
  "account_recovery_binding",
  "explicit_control_relationship",
] as const;

export type IntegrityHardLinkKind = (typeof INTEGRITY_HARD_LINK_KINDS)[number];
export type IntegrityRiskBand = "low" | "medium" | "high";
export type IntegrityEligibilityStatus = "eligible" | "excluded";

export const INTEGRITY_FEATURE_SPEC = {
  schemaVersion: "rateloop-integrity-feature-spec-v1",
  hardLinkKinds: INTEGRITY_HARD_LINK_KINDS,
  hardLinksMergeClusters: true,
  behavioralSimilarityMergesClusters: false,
  protectedAttributesExcluded: true,
  rawDeviceAndNetworkHistoryCollected: false,
} as const;

export type IntegrityEpochParameters = {
  mediumBehaviorRiskBps: number;
  highBehaviorRiskBps: number;
};

export const DEFAULT_INTEGRITY_EPOCH_PARAMETERS: IntegrityEpochParameters = {
  mediumBehaviorRiskBps: 4_000,
  highBehaviorRiskBps: 7_500,
};

export type IntegrityEpochObservation = {
  reviewerId: string;
  observedAt: string;
  sourceRecordCommitments: string[];
  eligible: boolean;
  exclusionReasonCodes?: string[];
  hardLinks?: Array<{ kind: IntegrityHardLinkKind; valueCommitment: string }>;
  behavioralRiskBps?: number;
  behaviorReasonCodes?: string[];
};

export type IntegrityPrivateFeatureVector = {
  schemaVersion: typeof INTEGRITY_FEATURE_VECTOR_SCHEMA_VERSION;
  observedAt: string;
  sourceRecordCommitments: string[];
  hardLinks: Array<{ kind: IntegrityHardLinkKind; valueCommitment: string }>;
  behavioralRiskBps: number;
  behaviorReasonCodes: string[];
  eligible: boolean;
  exclusionReasonCodes: string[];
};

export type IntegrityEpochPrivateLeaf = {
  epochId: string;
  reviewerLookup: string;
  reviewerPseudonym: string;
  clusterPseudonym: string;
  riskBand: IntegrityRiskBand;
  eligibilityStatus: IntegrityEligibilityStatus;
  reasonCodes: string[];
  featureCommitment: string;
  privateLeafHash: string;
  vaultCiphertext: string;
  vaultKeyVersion: string;
};

export type IntegrityEpochManifest = {
  schemaVersion: typeof INTEGRITY_EPOCH_SCHEMA_VERSION;
  epochId: string;
  cutoffAt: string;
  sourceWindow: { startedAt: string; endedAt: string };
  privateFeaturesExpireAt: string;
  featureSpecHash: string;
  parameterHash: string;
  scorerBuildHash: string;
  privateLeafRoot: string;
  aggregateClusterCounts: {
    totalClusters: number;
    singletonClusters: number;
    twoToThreeMemberClusters: number;
    fourToNineMemberClusters: number;
    tenPlusMemberClusters: number;
  };
  eligibleReviewerCount: number;
  excludedReviewerCount: number;
  signerKeyId: string;
  privateKeyVersions: {
    lookup: string;
    pseudonym: string;
    vault: string;
  };
  limitationCodes: string[];
  createdAt: string;
};

export type IntegrityEpochSnapshot = {
  parameters: IntegrityEpochParameters;
  manifest: IntegrityEpochManifest;
  manifestHash: string;
  signing: { algorithm: "Ed25519"; keyId: string; publicKey: string };
  signature: string;
  privateLeaves: IntegrityEpochPrivateLeaf[];
};

export type IntegrityEpochKeys = {
  lookupKey: Buffer;
  lookupKeyVersion: string;
  pseudonymKey: Buffer;
  pseudonymKeyVersion: string;
  vaultKey: Buffer;
  vaultKeyVersion: string;
  signingPrivateKey: KeyObject;
  signingKeyId?: string;
};

type NormalizedObservation = IntegrityEpochObservation & {
  observedAt: string;
  sourceRecordCommitments: string[];
  exclusionReasonCodes: string[];
  hardLinks: Array<{ kind: IntegrityHardLinkKind; valueCommitment: string }>;
  behavioralRiskBps: number;
  behaviorReasonCodes: string[];
  reviewerLookup: string;
  reviewerPseudonym: string;
};

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const HMAC_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/u;
const EPOCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/u;
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{1,119}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/u;
const OBSERVATION_KEYS = new Set([
  "reviewerId",
  "observedAt",
  "sourceRecordCommitments",
  "eligible",
  "exclusionReasonCodes",
  "hardLinks",
  "behavioralRiskBps",
  "behaviorReasonCodes",
]);
const HARD_LINK_KIND_SET = new Set<string>(INTEGRITY_HARD_LINK_KINDS);
const DEFAULT_LIMITATION_CODES = [
  "behavioral_similarity_does_not_merge_clusters",
  "device_network_signals_disabled_pending_dpia",
];

export function canonicalizeIntegrityValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeIntegrityValue).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeIntegrityValue(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Integrity evidence must be JSON serializable.");
  return encoded;
}

export function hashIntegrityValue(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalizeIntegrityValue(value)).digest("hex")}`;
}

function hmacIntegrityValue(key: Buffer, domain: string, value: string) {
  if (key.byteLength < 32) throw new Error(`${domain} key must contain at least 32 bytes.`);
  return `hmac-sha256:${createHmac("sha256", key).update(`${domain}:${value}`).digest("hex")}`;
}

export function integrityValueCommitment(input: { key: Buffer; kind: IntegrityHardLinkKind; value: string }) {
  if (!HARD_LINK_KIND_SET.has(input.kind)) throw new Error("Integrity hard-link kind is unsupported.");
  if (!input.value.trim() || input.value.length > 1_000) throw new Error("Integrity link value is invalid.");
  return hmacIntegrityValue(input.key, `integrity-link:${input.kind}`, input.value);
}

export function integritySigningKeyId(publicKey: string) {
  return `ed25519:${createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 24)}`;
}

function isoDate(value: string, field: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO timestamp.`);
  return parsed.toISOString();
}

function version(value: string, field: string) {
  if (!VERSION_PATTERN.test(value)) throw new Error(`${field} is invalid.`);
  return value;
}

function reasonCodes(values: string[] | undefined, field: string) {
  if (!Array.isArray(values ?? []) || (values?.length ?? 0) > 50) throw new Error(`${field} is invalid.`);
  const result = [...new Set(values ?? [])].sort();
  if (result.some(value => !REASON_CODE_PATTERN.test(value))) throw new Error(`${field} is invalid.`);
  return result;
}

function parameters(value: IntegrityEpochParameters) {
  if (
    !Number.isSafeInteger(value.mediumBehaviorRiskBps) ||
    !Number.isSafeInteger(value.highBehaviorRiskBps) ||
    value.mediumBehaviorRiskBps < 0 ||
    value.highBehaviorRiskBps > 10_000 ||
    value.mediumBehaviorRiskBps >= value.highBehaviorRiskBps
  ) {
    throw new Error("Integrity epoch risk thresholds are invalid.");
  }
  return { ...value };
}

function normalizeObservation(
  value: IntegrityEpochObservation,
  input: { cutoffAt: string; sourceWindowStartedAt: string; epochId: string; lookupKey: Buffer; pseudonymKey: Buffer },
): NormalizedObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Integrity observation is invalid.");
  const unknown = Object.keys(value).filter(key => !OBSERVATION_KEYS.has(key));
  if (unknown.length) throw new Error(`Integrity observation contains unsupported fields: ${unknown.join(", ")}.`);
  if (!value.reviewerId.trim() || value.reviewerId.length > 320)
    throw new Error("Integrity reviewer identifier is invalid.");
  const observedAt = isoDate(value.observedAt, "observation.observedAt");
  if (observedAt < input.sourceWindowStartedAt || observedAt > input.cutoffAt) {
    throw new Error("Integrity observation is outside the frozen source window.");
  }
  if (!Array.isArray(value.sourceRecordCommitments) || value.sourceRecordCommitments.length < 1) {
    throw new Error("Integrity observation requires source-record commitments.");
  }
  const sourceRecordCommitments = [...new Set(value.sourceRecordCommitments)].sort();
  if (sourceRecordCommitments.length > 100 || sourceRecordCommitments.some(item => !SHA256_PATTERN.test(item))) {
    throw new Error("Integrity source-record commitments are invalid.");
  }
  if (typeof value.eligible !== "boolean") throw new Error("Integrity eligibility status is invalid.");
  if (!Array.isArray(value.hardLinks ?? []) || (value.hardLinks?.length ?? 0) > 50) {
    throw new Error("Integrity hard links are invalid.");
  }
  const hardLinks = (value.hardLinks ?? [])
    .map(link => {
      if (!HARD_LINK_KIND_SET.has(link.kind) || !HMAC_PATTERN.test(link.valueCommitment)) {
        throw new Error("Integrity hard link is invalid.");
      }
      return { kind: link.kind, valueCommitment: link.valueCommitment };
    })
    .sort((left, right) =>
      `${left.kind}:${left.valueCommitment}`.localeCompare(`${right.kind}:${right.valueCommitment}`),
    );
  if (new Set(hardLinks.map(link => `${link.kind}:${link.valueCommitment}`)).size !== hardLinks.length) {
    throw new Error("Integrity hard links must be unique per reviewer.");
  }
  const behavioralRiskBps = value.behavioralRiskBps ?? 0;
  if (!Number.isSafeInteger(behavioralRiskBps) || behavioralRiskBps < 0 || behavioralRiskBps > 10_000) {
    throw new Error("Integrity behavioral risk must be an integer from 0 to 10000.");
  }
  const reviewerLookup = hmacIntegrityValue(input.lookupKey, "integrity-reviewer-lookup", value.reviewerId);
  return {
    ...value,
    observedAt,
    sourceRecordCommitments,
    exclusionReasonCodes: reasonCodes(value.exclusionReasonCodes, "observation.exclusionReasonCodes"),
    hardLinks,
    behavioralRiskBps,
    behaviorReasonCodes: reasonCodes(value.behaviorReasonCodes, "observation.behaviorReasonCodes"),
    reviewerLookup,
    reviewerPseudonym: hmacIntegrityValue(
      input.pseudonymKey,
      `integrity-reviewer-pseudonym:${input.epochId}`,
      reviewerLookup,
    ),
  };
}

class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index]!;
    if (parent !== index) this.parent[index] = this.find(parent);
    return this.parent[index]!;
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    this.parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  }
}

function clusterObservations(observations: NormalizedObservation[]) {
  const sets = new DisjointSet(observations.length);
  const linkGroups = new Map<string, number[]>();
  for (let index = 0; index < observations.length; index += 1) {
    for (const link of observations[index]!.hardLinks) {
      const key = `${link.kind}:${link.valueCommitment}`;
      const group = linkGroups.get(key) ?? [];
      group.push(index);
      linkGroups.set(key, group);
    }
  }
  const hardReasons = new Map<number, Set<string>>();
  for (const [key, indexes] of [...linkGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (indexes.length < 2) continue;
    for (let index = 1; index < indexes.length; index += 1) sets.union(indexes[0]!, indexes[index]!);
    const kind = key.slice(0, key.indexOf(":"));
    for (const index of indexes) {
      const reasons = hardReasons.get(index) ?? new Set<string>();
      reasons.add(`hard_link_${kind}`);
      hardReasons.set(index, reasons);
    }
  }
  const components = new Map<number, number[]>();
  for (let index = 0; index < observations.length; index += 1) {
    const root = sets.find(index);
    const component = components.get(root) ?? [];
    component.push(index);
    components.set(root, component);
  }
  return { components, hardReasons };
}

function aggregateClusterCounts(leaves: Array<Pick<IntegrityEpochPrivateLeaf, "clusterPseudonym">>) {
  const sizes = new Map<string, number>();
  for (const leaf of leaves) sizes.set(leaf.clusterPseudonym, (sizes.get(leaf.clusterPseudonym) ?? 0) + 1);
  const values = [...sizes.values()];
  return {
    totalClusters: values.length,
    singletonClusters: values.filter(size => size === 1).length,
    twoToThreeMemberClusters: values.filter(size => size >= 2 && size <= 3).length,
    fourToNineMemberClusters: values.filter(size => size >= 4 && size <= 9).length,
    tenPlusMemberClusters: values.filter(size => size >= 10).length,
  };
}

function merkleRoot(leaves: string[]) {
  let level = [...leaves].sort();
  if (level.length === 0) return hashIntegrityValue([]);
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(hashIntegrityValue([level[index], level[index + 1] ?? level[index]]));
    }
    level = next;
  }
  return level[0]!;
}

function leafMetadata(leaf: Omit<IntegrityEpochPrivateLeaf, "privateLeafHash" | "vaultCiphertext">) {
  return { schemaVersion: INTEGRITY_PRIVATE_LEAF_SCHEMA_VERSION, ...leaf };
}

function metadataFromPrivateLeaf(leaf: IntegrityEpochPrivateLeaf) {
  return leafMetadata({
    epochId: leaf.epochId,
    reviewerLookup: leaf.reviewerLookup,
    reviewerPseudonym: leaf.reviewerPseudonym,
    clusterPseudonym: leaf.clusterPseudonym,
    riskBand: leaf.riskBand,
    eligibilityStatus: leaf.eligibilityStatus,
    reasonCodes: leaf.reasonCodes,
    featureCommitment: leaf.featureCommitment,
    vaultKeyVersion: leaf.vaultKeyVersion,
  });
}

function featureAad(
  leaf: Pick<IntegrityEpochPrivateLeaf, "epochId" | "reviewerPseudonym" | "featureCommitment" | "privateLeafHash">,
) {
  return canonicalizeIntegrityValue({
    schemaVersion: INTEGRITY_FEATURE_VECTOR_SCHEMA_VERSION,
    epochId: leaf.epochId,
    reviewerPseudonym: leaf.reviewerPseudonym,
    featureCommitment: leaf.featureCommitment,
    privateLeafHash: leaf.privateLeafHash,
  });
}

function encryptFeatureVector(feature: IntegrityPrivateFeatureVector, leaf: IntegrityEpochPrivateLeaf, key: Buffer) {
  if (key.byteLength !== 32) throw new Error("Integrity feature vault key must contain exactly 32 bytes.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(featureAad(leaf)));
  const ciphertext = Buffer.concat([cipher.update(canonicalizeIntegrityValue(feature), "utf8"), cipher.final()]);
  return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString(
    "base64url",
  )}`;
}

function decryptFeatureVector(leaf: IntegrityEpochPrivateLeaf, key: Buffer): IntegrityPrivateFeatureVector {
  if (key.byteLength !== 32) throw new Error("Integrity feature vault key must contain exactly 32 bytes.");
  const [versionValue, nonceValue, tagValue, ciphertextValue, ...extra] = leaf.vaultCiphertext.split(".");
  if (versionValue !== "v1" || !nonceValue || !tagValue || !ciphertextValue || extra.length) {
    throw new Error("Integrity feature ciphertext is malformed.");
  }
  const nonce = Buffer.from(nonceValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (nonce.byteLength !== 12 || tag.byteLength !== 16) throw new Error("Integrity feature ciphertext is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(featureAad(leaf)));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as IntegrityPrivateFeatureVector;
}

function riskBand(
  componentSize: number,
  behavioralRiskBps: number,
  value: IntegrityEpochParameters,
): IntegrityRiskBand {
  if (componentSize > 1 || behavioralRiskBps >= value.highBehaviorRiskBps) return "high";
  if (behavioralRiskBps >= value.mediumBehaviorRiskBps) return "medium";
  return "low";
}

function signingMetadata(privateKey: KeyObject, expectedKeyId?: string) {
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("Integrity manifests require an Ed25519 signing key.");
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const keyId = integritySigningKeyId(publicKey);
  if (expectedKeyId && expectedKeyId !== keyId)
    throw new Error("Integrity signing key ID does not match its public key.");
  return { algorithm: "Ed25519" as const, keyId, publicKey };
}

export function buildIntegrityEpoch(input: {
  epochId: string;
  cutoffAt: string;
  sourceWindowStartedAt: string;
  privateFeaturesExpireAt: string;
  createdAt: string;
  scorerBuildHash: string;
  observations: IntegrityEpochObservation[];
  parameters?: IntegrityEpochParameters;
  limitationCodes?: string[];
  keys: IntegrityEpochKeys;
}): IntegrityEpochSnapshot {
  if (!EPOCH_ID_PATTERN.test(input.epochId)) throw new Error("Integrity epoch ID is invalid.");
  const cutoffAt = isoDate(input.cutoffAt, "cutoffAt");
  const sourceWindowStartedAt = isoDate(input.sourceWindowStartedAt, "sourceWindowStartedAt");
  const privateFeaturesExpireAt = isoDate(input.privateFeaturesExpireAt, "privateFeaturesExpireAt");
  const createdAt = isoDate(input.createdAt, "createdAt");
  if (sourceWindowStartedAt > cutoffAt) throw new Error("Integrity source window is invalid.");
  if (privateFeaturesExpireAt <= cutoffAt) throw new Error("Integrity private-feature retention is invalid.");
  if (createdAt < cutoffAt) throw new Error("Integrity epoch cannot be created before its cutoff.");
  if (!SHA256_PATTERN.test(input.scorerBuildHash)) throw new Error("Integrity scorer build hash is invalid.");
  if (!Array.isArray(input.observations) || input.observations.length < 1 || input.observations.length > 100_000) {
    throw new Error("Integrity epoch requires 1-100000 observations.");
  }
  const normalizedParameters = parameters(input.parameters ?? DEFAULT_INTEGRITY_EPOCH_PARAMETERS);
  const signing = signingMetadata(input.keys.signingPrivateKey, input.keys.signingKeyId);
  const keyVersions = {
    lookup: version(input.keys.lookupKeyVersion, "lookupKeyVersion"),
    pseudonym: version(input.keys.pseudonymKeyVersion, "pseudonymKeyVersion"),
    vault: version(input.keys.vaultKeyVersion, "vaultKeyVersion"),
  };
  const observations = input.observations
    .map(observation =>
      normalizeObservation(observation, {
        cutoffAt,
        sourceWindowStartedAt,
        epochId: input.epochId,
        lookupKey: input.keys.lookupKey,
        pseudonymKey: input.keys.pseudonymKey,
      }),
    )
    .sort((left, right) => left.reviewerLookup.localeCompare(right.reviewerLookup));
  if (new Set(observations.map(value => value.reviewerLookup)).size !== observations.length) {
    throw new Error("Integrity epoch contains duplicate reviewers.");
  }

  const clustered = clusterObservations(observations);
  const componentByIndex = new Map<number, number[]>();
  for (const component of clustered.components.values()) {
    const sorted = [...component].sort((left, right) =>
      observations[left]!.reviewerPseudonym.localeCompare(observations[right]!.reviewerPseudonym),
    );
    for (const index of sorted) componentByIndex.set(index, sorted);
  }

  const privateLeaves = observations.map((observation, index) => {
    const component = componentByIndex.get(index)!;
    const clusterPseudonym = hmacIntegrityValue(
      input.keys.pseudonymKey,
      `integrity-cluster-pseudonym:${input.epochId}`,
      component.map(item => observations[item]!.reviewerPseudonym).join(":"),
    );
    const reasonCodesValue = [
      ...new Set([
        ...observation.exclusionReasonCodes,
        ...observation.behaviorReasonCodes,
        ...(clustered.hardReasons.get(index) ?? []),
      ]),
    ].sort();
    const feature: IntegrityPrivateFeatureVector = {
      schemaVersion: INTEGRITY_FEATURE_VECTOR_SCHEMA_VERSION,
      observedAt: observation.observedAt,
      sourceRecordCommitments: observation.sourceRecordCommitments,
      hardLinks: observation.hardLinks,
      behavioralRiskBps: observation.behavioralRiskBps,
      behaviorReasonCodes: observation.behaviorReasonCodes,
      eligible: observation.eligible,
      exclusionReasonCodes: observation.exclusionReasonCodes,
    };
    const leafWithoutHash = {
      epochId: input.epochId,
      reviewerLookup: observation.reviewerLookup,
      reviewerPseudonym: observation.reviewerPseudonym,
      clusterPseudonym,
      riskBand: riskBand(component.length, observation.behavioralRiskBps, normalizedParameters),
      eligibilityStatus: observation.eligible ? ("eligible" as const) : ("excluded" as const),
      reasonCodes: reasonCodesValue,
      featureCommitment: hashIntegrityValue(feature),
      vaultKeyVersion: keyVersions.vault,
    };
    const leaf: IntegrityEpochPrivateLeaf = {
      ...leafWithoutHash,
      privateLeafHash: hashIntegrityValue(leafMetadata(leafWithoutHash)),
      vaultCiphertext: "",
    };
    leaf.vaultCiphertext = encryptFeatureVector(feature, leaf, input.keys.vaultKey);
    return leaf;
  });

  const manifest: IntegrityEpochManifest = {
    schemaVersion: INTEGRITY_EPOCH_SCHEMA_VERSION,
    epochId: input.epochId,
    cutoffAt,
    sourceWindow: { startedAt: sourceWindowStartedAt, endedAt: cutoffAt },
    privateFeaturesExpireAt,
    featureSpecHash: hashIntegrityValue(INTEGRITY_FEATURE_SPEC),
    parameterHash: hashIntegrityValue(normalizedParameters),
    scorerBuildHash: input.scorerBuildHash,
    privateLeafRoot: merkleRoot(privateLeaves.map(leaf => leaf.privateLeafHash)),
    aggregateClusterCounts: aggregateClusterCounts(privateLeaves),
    eligibleReviewerCount: privateLeaves.filter(leaf => leaf.eligibilityStatus === "eligible").length,
    excludedReviewerCount: privateLeaves.filter(leaf => leaf.eligibilityStatus === "excluded").length,
    signerKeyId: signing.keyId,
    privateKeyVersions: keyVersions,
    limitationCodes: reasonCodes([...DEFAULT_LIMITATION_CODES, ...(input.limitationCodes ?? [])], "limitationCodes"),
    createdAt,
  };
  const manifestHash = hashIntegrityValue(manifest);
  return {
    parameters: normalizedParameters,
    manifest,
    manifestHash,
    signing,
    signature: sign(null, Buffer.from(canonicalizeIntegrityValue(manifest)), input.keys.signingPrivateKey).toString(
      "base64url",
    ),
    privateLeaves,
  };
}

function clusterPseudonymForComponent(input: {
  epochId: string;
  indexes: number[];
  leaves: IntegrityEpochPrivateLeaf[];
  pseudonymKey: Buffer;
}) {
  return hmacIntegrityValue(
    input.pseudonymKey,
    `integrity-cluster-pseudonym:${input.epochId}`,
    input.indexes
      .map(index => input.leaves[index]!.reviewerPseudonym)
      .sort()
      .join(":"),
  );
}

export function verifyIntegrityEpochSnapshot(
  snapshot: IntegrityEpochSnapshot,
  secrets?: { vaultKey?: Buffer; pseudonymKey?: Buffer },
) {
  const errors: string[] = [];
  try {
    if (snapshot.manifestHash !== hashIntegrityValue(snapshot.manifest)) errors.push("manifest_hash_mismatch");
    if (snapshot.manifest.featureSpecHash !== hashIntegrityValue(INTEGRITY_FEATURE_SPEC)) {
      errors.push("feature_spec_hash_mismatch");
    }
    if (snapshot.manifest.parameterHash !== hashIntegrityValue(parameters(snapshot.parameters))) {
      errors.push("parameter_hash_mismatch");
    }
    const derivedKeyId = integritySigningKeyId(snapshot.signing.publicKey);
    if (
      snapshot.signing.algorithm !== "Ed25519" ||
      snapshot.signing.keyId !== derivedKeyId ||
      snapshot.manifest.signerKeyId !== derivedKeyId
    ) {
      errors.push("signing_identity_mismatch");
    } else {
      const publicKey = createPublicKey({
        key: Buffer.from(snapshot.signing.publicKey, "base64url"),
        format: "der",
        type: "spki",
      });
      if (
        !verify(
          null,
          Buffer.from(canonicalizeIntegrityValue(snapshot.manifest)),
          publicKey,
          Buffer.from(snapshot.signature, "base64url"),
        )
      ) {
        errors.push("signature_invalid");
      }
    }
    if (new Set(snapshot.privateLeaves.map(leaf => leaf.reviewerLookup)).size !== snapshot.privateLeaves.length) {
      errors.push("duplicate_reviewer_lookup");
    }
    for (const leaf of snapshot.privateLeaves) {
      if (leaf.privateLeafHash !== hashIntegrityValue(metadataFromPrivateLeaf(leaf))) {
        errors.push("private_leaf_hash_mismatch");
      }
    }
    if (snapshot.manifest.privateLeafRoot !== merkleRoot(snapshot.privateLeaves.map(leaf => leaf.privateLeafHash))) {
      errors.push("private_leaf_root_mismatch");
    }
    if (
      snapshot.manifest.eligibleReviewerCount !==
        snapshot.privateLeaves.filter(leaf => leaf.eligibilityStatus === "eligible").length ||
      snapshot.manifest.excludedReviewerCount !==
        snapshot.privateLeaves.filter(leaf => leaf.eligibilityStatus === "excluded").length
    ) {
      errors.push("eligibility_count_mismatch");
    }
    if (
      canonicalizeIntegrityValue(snapshot.manifest.aggregateClusterCounts) !==
      canonicalizeIntegrityValue(aggregateClusterCounts(snapshot.privateLeaves))
    ) {
      errors.push("cluster_count_mismatch");
    }

    if (secrets?.vaultKey) {
      const features: IntegrityPrivateFeatureVector[] = [];
      for (const leaf of snapshot.privateLeaves) {
        try {
          const feature = decryptFeatureVector(leaf, secrets.vaultKey);
          features.push(feature);
          if (hashIntegrityValue(feature) !== leaf.featureCommitment) errors.push("feature_commitment_mismatch");
          if ((feature.eligible ? "eligible" : "excluded") !== leaf.eligibilityStatus) {
            errors.push("feature_eligibility_mismatch");
          }
        } catch {
          errors.push("feature_decryption_failed");
        }
      }
      if (features.length === snapshot.privateLeaves.length && secrets.pseudonymKey) {
        const observations = features.map((feature, index) => ({
          ...feature,
          reviewerId: snapshot.privateLeaves[index]!.reviewerLookup,
          reviewerLookup: snapshot.privateLeaves[index]!.reviewerLookup,
          reviewerPseudonym: snapshot.privateLeaves[index]!.reviewerPseudonym,
        })) as NormalizedObservation[];
        const clustered = clusterObservations(observations);
        for (const component of clustered.components.values()) {
          const expected = clusterPseudonymForComponent({
            epochId: snapshot.manifest.epochId,
            indexes: component,
            leaves: snapshot.privateLeaves,
            pseudonymKey: secrets.pseudonymKey,
          });
          for (const index of component) {
            const leaf = snapshot.privateLeaves[index]!;
            if (leaf.clusterPseudonym !== expected) errors.push("cluster_recomputation_mismatch");
            if (leaf.riskBand !== riskBand(component.length, features[index]!.behavioralRiskBps, snapshot.parameters)) {
              errors.push("risk_band_recomputation_mismatch");
            }
          }
        }
      }
    }
  } catch {
    errors.push("snapshot_malformed");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
