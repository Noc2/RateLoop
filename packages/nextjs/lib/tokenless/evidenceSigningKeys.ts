import "server-only";
import { dbClient } from "~~/lib/db";
import { parseAttestationVerificationKeyring } from "~~/lib/tokenless/assuranceAttestationConfiguration.mjs";
import { requireAssuranceAttestationManagement } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { parseDecisionPacketVerificationKeyring } from "~~/lib/tokenless/evidenceTrustConfiguration.mjs";
import { encodeEd25519SpkiDerBase64url } from "~~/lib/tokenless/evidenceVerificationKey";
import { projectHumanReviewGateTrustedKeyHistory } from "~~/lib/tokenless/humanReviewGateEvidence";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError("Stored evidence key history is invalid.", 500, "stored_evidence_key_invalid");
  }
  return parsed.toISOString();
}

function keyIdentity(keyId: string, publicKeySpki: string) {
  return JSON.stringify([keyId, publicKeySpki]);
}

type DecisionPacketVerificationKey = {
  algorithm: "ECDSA-SHA256" | "Ed25519";
  keyId: string;
  publicKey: string;
  publicKeyJwk: JsonWebKey;
  status: "current" | "retired";
};

type EvidenceTrustUse = "decision_packet" | "external_attestation" | "human_review_gate";

type EvidenceTrustedKey = {
  algorithm: "ECDSA-SHA256" | "Ed25519";
  keyId: string;
  publicKeyJwk: JsonWebKey;
  publicKeySpki: string;
  status: "current" | "retired";
  uses: EvidenceTrustUse[];
};

type HumanReviewGateTrustedKey = ReturnType<typeof projectHumanReviewGateTrustedKeyHistory>["keys"][number];

function mergeEvidenceTrustedKey(
  byIdentity: Map<string, EvidenceTrustedKey>,
  key: Omit<EvidenceTrustedKey, "uses">,
  use: EvidenceTrustUse,
) {
  const identity = keyIdentity(key.keyId, key.publicKeySpki);
  const existing = byIdentity.get(identity);
  if (existing) {
    if (!existing.uses.includes(use)) existing.uses.push(use);
    if (key.status === "current") existing.status = "current";
    return;
  }
  byIdentity.set(identity, { ...key, uses: [use] });
}

type EvidenceSigningEnvironment = {
  TOKENLESS_ATTESTATION_VERIFICATION_KEYS?: string;
  TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS?: string;
  TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?: string;
};

function configuredAttestationVerificationKeys(env?: EvidenceSigningEnvironment) {
  const encoded = (
    env === undefined
      ? process.env.TOKENLESS_ATTESTATION_VERIFICATION_KEYS
      : env.TOKENLESS_ATTESTATION_VERIFICATION_KEYS
  )?.trim();
  if (!encoded) return [];
  try {
    return parseAttestationVerificationKeyring(encoded).map(key => ({
      algorithm: "Ed25519" as const,
      keyId: key.keyId,
      publicKey: key.publicKeyDer.toString("base64url"),
      publicKeyJwk: key.publicKey.export({ format: "jwk" }),
      status: key.status,
    }));
  } catch {
    throw new TokenlessServiceError("Attestation verification keys are invalid.", 503, "invalid_attestation_keyring");
  }
}

function parseDecisionPacketVerificationKeysWithOptions(encoded: string, options: { allowEmpty?: boolean }) {
  let keys;
  try {
    keys = parseDecisionPacketVerificationKeyring(encoded, { allowEmpty: options.allowEmpty });
  } catch {
    let empty = false;
    try {
      const entries = JSON.parse(encoded);
      empty = Array.isArray(entries) && entries.length === 0;
    } catch {
      // The shared parser supplies the canonical structural validation.
    }
    if (!options.allowEmpty && empty) {
      throw new TokenlessServiceError(
        "Decision-packet verification keys are unavailable.",
        503,
        "invalid_evidence_keyring",
      );
    }
    throw new TokenlessServiceError("Decision-packet verification keys are invalid.", 503, "invalid_evidence_keyring");
  }
  return keys.map(key => {
    return {
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKey: key.publicKey,
      publicKeyJwk: key.publicKeyObject.export({ format: "jwk" }),
      status: key.status,
    } as DecisionPacketVerificationKey;
  });
}

export function parseDecisionPacketVerificationKeys(encoded: string): DecisionPacketVerificationKey[] {
  return parseDecisionPacketVerificationKeysWithOptions(encoded, {});
}

export function configuredDecisionPacketVerificationKeys(
  env?: EvidenceSigningEnvironment,
): DecisionPacketVerificationKey[] {
  const configuration = env ?? {
    TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS: process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS,
    TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY: process.env.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY,
  };
  const encoded = configuration.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS?.trim();
  const usesPlatformSecretSigner = Boolean(configuration.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?.trim());
  const allowEmpty = usesPlatformSecretSigner;
  if (!encoded) {
    if (allowEmpty) return [];
    throw new TokenlessServiceError(
      "Decision-packet verification keys are unavailable.",
      503,
      "invalid_evidence_keyring",
    );
  }
  return parseDecisionPacketVerificationKeysWithOptions(encoded, { allowEmpty });
}

export function projectPublicEvidenceTrustedKeyHistory(env?: EvidenceSigningEnvironment) {
  const byIdentity = new Map<string, EvidenceTrustedKey>();
  for (const key of projectHumanReviewGateTrustedKeyHistory().keys) {
    const publicKeySpki = encodeEd25519SpkiDerBase64url(key.publicKeyJwk);
    mergeEvidenceTrustedKey(byIdentity, { ...key, publicKeySpki }, "human_review_gate");
  }
  for (const key of configuredDecisionPacketVerificationKeys(env)) {
    mergeEvidenceTrustedKey(
      byIdentity,
      {
        algorithm: key.algorithm,
        keyId: key.keyId,
        publicKeyJwk: key.publicKeyJwk,
        publicKeySpki: key.publicKey,
        status: key.status,
      },
      "decision_packet",
    );
  }
  for (const key of configuredAttestationVerificationKeys(env)) {
    const identity = keyIdentity(key.keyId, key.publicKey);
    if (byIdentity.has(identity)) {
      throw new TokenlessServiceError(
        "Attestation verification keys must remain purpose-bound.",
        503,
        "attestation_key_purpose_conflict",
      );
    }
    byIdentity.set(identity, {
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKeyJwk: key.publicKeyJwk,
      publicKeySpki: key.publicKey,
      status: key.status,
      uses: ["external_attestation"],
    });
  }
  return {
    schemaVersion: "rateloop.evidence-public-trusted-keys.v1" as const,
    keys: [...byIdentity.values()],
  };
}

export function projectWorkspaceEvidenceSigningKeyHistory(input: {
  workspaceId: string;
  gateKeys: HumanReviewGateTrustedKey[];
  decisionKeys: DecisionPacketVerificationKey[];
  packetRows: Row[];
}) {
  const packetByKey = new Map(
    input.packetRows.map(row => {
      return [keyIdentity(text(row, "signing_key_id")!, text(row, "signing_public_key")!), row] as const;
    }),
  );
  const byIdentity = new Map<string, EvidenceTrustedKey>();
  for (const key of input.gateKeys) {
    const publicKeySpki = encodeEd25519SpkiDerBase64url(key.publicKeyJwk);
    mergeEvidenceTrustedKey(byIdentity, { ...key, publicKeySpki }, "human_review_gate");
  }
  for (const key of input.decisionKeys) {
    mergeEvidenceTrustedKey(
      byIdentity,
      {
        algorithm: key.algorithm,
        keyId: key.keyId,
        publicKeyJwk: key.publicKeyJwk,
        publicKeySpki: key.publicKey,
        status: key.status,
      },
      "decision_packet",
    );
  }
  const keys = [...byIdentity.entries()].map(([identity, key]) => {
    const packet = packetByKey.get(identity);
    if (packet) packetByKey.delete(identity);
    return {
      ...key,
      firstPacketAt: packet ? iso(packet.first_seen_at) : null,
      lastPacketAt: packet ? iso(packet.last_seen_at) : null,
      packetCount: packet ? Number(packet.packet_count) : 0,
    };
  });
  return {
    schemaVersion: "rateloop.evidence-trusted-key-history.v1" as const,
    workspaceId: input.workspaceId,
    keys,
    untrustedPacketKeyCount: packetByKey.size,
  };
}

export async function listWorkspaceEvidenceSigningKeys(input: { accountAddress: string; workspaceId: string }) {
  await requireAssuranceAttestationManagement(input.accountAddress, input.workspaceId);
  const gateKeyring = projectHumanReviewGateTrustedKeyHistory();
  const packets = await dbClient.execute({
    sql: `SELECT ep.signing_key_id,ep.signing_public_key,
                 MIN(ep.generated_at) AS first_seen_at,MAX(ep.generated_at) AS last_seen_at,
                 COUNT(*) AS packet_count
          FROM tokenless_assurance_evidence_packets ep
          JOIN tokenless_assurance_runs r ON r.run_id=ep.run_id
          JOIN tokenless_assurance_projects p ON p.project_id=r.project_id
          WHERE p.workspace_id=? AND ep.signing_key_id IS NOT NULL AND ep.signing_public_key IS NOT NULL
          GROUP BY ep.signing_key_id,ep.signing_public_key
          ORDER BY last_seen_at DESC,ep.signing_key_id ASC`,
    args: [input.workspaceId],
  });
  let packetKeys: DecisionPacketVerificationKey[];
  try {
    packetKeys = configuredDecisionPacketVerificationKeys();
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    throw new TokenlessServiceError("Decision-packet verification keys are invalid.", 503, "invalid_evidence_keyring");
  }
  return projectWorkspaceEvidenceSigningKeyHistory({
    workspaceId: input.workspaceId,
    gateKeys: gateKeyring.keys,
    decisionKeys: packetKeys,
    packetRows: packets.rows as Row[],
  });
}
