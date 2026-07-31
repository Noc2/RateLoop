import {
  canonicalizeEvidenceValueForSchema,
  computeEvidenceAggregation,
  evidenceMerkleRootForSchema,
  sha256EvidenceValueForSchema,
  verifyEvidenceExport,
} from "../../scripts/assurance-evidence-core.mjs";

export const MAX_PUBLIC_EVIDENCE_PACKET_BYTES = 2_000_000;
export const PUBLIC_EVIDENCE_TRUSTED_KEYS_PATH = "/api/evidence/trusted-keys";

type EvidencePacket = {
  payload: {
    aggregation?: {
      minimumAggregationSize?: unknown;
      passRule?: unknown;
    } & Record<string, unknown>;
    recomputation?: {
      caseLeaves?: unknown;
      cases?: unknown;
      responseLeaves?: unknown;
      reviewerSources?: unknown;
    };
    roots?: {
      caseRoot?: unknown;
      responseRoot?: unknown;
    };
    schemaVersion?: unknown;
    [key: string]: unknown;
  };
  signing: {
    algorithm?: unknown;
    keyId?: unknown;
    publicKey?: unknown;
  };
  packetDigest?: unknown;
  signature?: unknown;
};

type TrustedKey = {
  algorithm: "ECDSA-SHA256" | "Ed25519";
  keyId: string;
  publicKeySpki: string;
  status: "current" | "retired";
  uses: string[];
};

export type PublicEvidenceCheck = {
  actual: string | null;
  detail: string;
  expected: string | null;
  id: "aggregation" | "case_root" | "digest" | "response_root" | "signature";
  label: string;
  status: "fail" | "pass";
};

export type PublicEvidenceVerificationResult = {
  checks: PublicEvidenceCheck[];
  errors: string[];
  key: Pick<TrustedKey, "algorithm" | "keyId" | "status">;
  valid: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function packetValue(value: unknown): EvidencePacket | null {
  const packet = objectValue(value);
  const payload = objectValue(packet?.payload);
  const signing = objectValue(packet?.signing);
  if (!packet || !payload || !signing) return null;
  return {
    ...packet,
    payload,
    signing,
  } as EvidencePacket;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function parsePublicEvidencePacketJson(value: string) {
  if (!value.trim()) throw new Error("Paste a packet or choose a JSON file.");
  if (textBytes(value) > MAX_PUBLIC_EVIDENCE_PACKET_BYTES) {
    throw new Error("Evidence packets must be 2 MB or smaller.");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("The packet is not valid JSON.");
  }
}

function trustedKeyValue(value: unknown): TrustedKey | null {
  const key = objectValue(value);
  if (
    !key ||
    (key.algorithm !== "Ed25519" && key.algorithm !== "ECDSA-SHA256") ||
    typeof key.keyId !== "string" ||
    typeof key.publicKeySpki !== "string" ||
    (key.status !== "current" && key.status !== "retired") ||
    !Array.isArray(key.uses) ||
    key.uses.some(use => typeof use !== "string")
  ) {
    return null;
  }
  return key as TrustedKey;
}

async function fetchTrustedDecisionKey(
  packet: EvidencePacket,
  fetchImpl: typeof fetch,
  trustedKeysPath: string,
): Promise<TrustedKey> {
  const response = await fetchImpl(trustedKeysPath, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("The public verification keys are unavailable. Try again.");

  const history = objectValue(await response.json());
  if (
    history?.schemaVersion !== "rateloop.evidence-public-trusted-keys.v1" ||
    !Array.isArray(history.keys) ||
    history.keys.length > 256
  ) {
    throw new Error("The public verification-key response is invalid.");
  }
  const keys: TrustedKey[] = [];
  for (const value of history.keys) {
    const key = trustedKeyValue(value);
    if (!key) throw new Error("The public verification-key response is invalid.");
    keys.push(key);
  }

  const key = keys.find(
    candidate =>
      candidate.keyId === packet.signing.keyId &&
      candidate.algorithm === packet.signing.algorithm &&
      candidate.uses.includes("decision_packet"),
  );
  if (!key) throw new Error("No public decision-packet key matches this packet.");
  return key;
}

async function digestCheck(packet: EvidencePacket): Promise<PublicEvidenceCheck> {
  const expected = typeof packet.packetDigest === "string" ? packet.packetDigest : null;
  try {
    const actual = await sha256EvidenceValueForSchema(
      { payload: packet.payload, signing: packet.signing },
      packet.payload.schemaVersion,
    );
    return {
      id: "digest",
      label: "Packet digest",
      status: expected === actual ? "pass" : "fail",
      expected,
      actual,
      detail: expected === actual ? "The canonical packet digest matches." : "The canonical packet digest differs.",
    };
  } catch {
    return {
      id: "digest",
      label: "Packet digest",
      status: "fail",
      expected,
      actual: null,
      detail: "The canonical packet digest could not be computed.",
    };
  }
}

async function merkleCheck(
  packet: EvidencePacket,
  input: {
    id: "case_root" | "response_root";
    label: string;
    leaves: "caseLeaves" | "responseLeaves";
    root: "caseRoot" | "responseRoot";
  },
): Promise<PublicEvidenceCheck> {
  const roots = objectValue(packet.payload.roots);
  const recomputation = objectValue(packet.payload.recomputation);
  const root = roots?.[input.root];
  const expected = typeof root === "string" ? root : null;
  try {
    if (!Array.isArray(recomputation?.[input.leaves])) throw new Error("Missing leaves.");
    const actual = await evidenceMerkleRootForSchema(
      recomputation[input.leaves] as unknown[],
      packet.payload.schemaVersion,
    );
    return {
      id: input.id,
      label: input.label,
      status: expected === actual ? "pass" : "fail",
      expected,
      actual,
      detail: expected === actual ? "The recomputed Merkle root matches." : "The recomputed Merkle root differs.",
    };
  } catch {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      expected,
      actual: null,
      detail: "The Merkle root could not be recomputed.",
    };
  }
}

function aggregationCheck(packet: EvidencePacket): PublicEvidenceCheck {
  try {
    const aggregation = objectValue(packet.payload.aggregation);
    const recomputation = objectValue(packet.payload.recomputation);
    if (
      !aggregation ||
      !recomputation ||
      typeof aggregation.minimumAggregationSize !== "number" ||
      !objectValue(aggregation.passRule)
    ) {
      throw new Error("Missing recomputation inputs.");
    }
    const actual = computeEvidenceAggregation(recomputation, aggregation.minimumAggregationSize, aggregation.passRule);
    const matches =
      canonicalizeEvidenceValueForSchema(actual, packet.payload.schemaVersion) ===
      canonicalizeEvidenceValueForSchema(aggregation, packet.payload.schemaVersion);
    return {
      id: "aggregation",
      label: "Aggregation",
      status: matches ? "pass" : "fail",
      expected: null,
      actual: null,
      detail: matches
        ? "The aggregation matches the privacy-safe recomputation inputs."
        : "The aggregation differs from the recomputation inputs.",
    };
  } catch {
    return {
      id: "aggregation",
      label: "Aggregation",
      status: "fail",
      expected: null,
      actual: null,
      detail: "The aggregation could not be recomputed.",
    };
  }
}

export async function verifyPublicEvidencePacket(
  value: unknown,
  options: {
    fetchImpl?: typeof fetch;
    trustedKeysPath?: string;
  } = {},
): Promise<PublicEvidenceVerificationResult> {
  const packet = packetValue(value);
  if (!packet) throw new Error("The JSON is not a RateLoop evidence packet.");
  const key = await fetchTrustedDecisionKey(
    packet,
    options.fetchImpl ?? fetch,
    options.trustedKeysPath ?? PUBLIC_EVIDENCE_TRUSTED_KEYS_PATH,
  );

  const [digest, caseRoot, responseRoot] = await Promise.all([
    digestCheck(packet),
    merkleCheck(packet, { id: "case_root", label: "Content / case root", leaves: "caseLeaves", root: "caseRoot" }),
    merkleCheck(packet, {
      id: "response_root",
      label: "Review / response root",
      leaves: "responseLeaves",
      root: "responseRoot",
    }),
  ]);
  const aggregation = aggregationCheck(packet);
  const verification = await verifyEvidenceExport(packet, {
    expectedKeyId: key.keyId,
    expectedPublicKey: key.publicKeySpki,
  });
  const signatureErrors = new Set([
    "missing_trust_anchor",
    "signing_key_id_mismatch",
    "signature_invalid",
    "unsupported_signature_algorithm",
    "untrusted_signing_key",
    "verification_failed",
  ]);
  const signatureValid = !verification.errors.some((error: string) => signatureErrors.has(error));
  const signature: PublicEvidenceCheck = {
    id: "signature",
    label: "Signature",
    status: signatureValid ? "pass" : "fail",
    expected: key.keyId,
    actual: typeof packet.signing.keyId === "string" ? packet.signing.keyId : null,
    detail: signatureValid
      ? `The signature matches the ${key.status} public key.`
      : "The signature or its public-key binding is invalid.",
  };
  const checks = [digest, caseRoot, responseRoot, aggregation, signature];

  return {
    checks,
    errors: [...new Set(verification.errors as string[])],
    key: {
      algorithm: key.algorithm,
      keyId: key.keyId,
      status: key.status,
    },
    valid: verification.valid && checks.every(check => check.status === "pass"),
  };
}
