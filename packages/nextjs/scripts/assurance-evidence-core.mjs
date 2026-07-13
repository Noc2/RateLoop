import { createHash, createPublicKey, verify } from "node:crypto";

export const EVIDENCE_SCHEMA_VERSION = "rateloop.human-assurance.evidence.v1";
export const EVIDENCE_AGGREGATION_VERSION = "rateloop.preference-wilson.v1";

export function canonicalizeEvidenceValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeEvidenceValue).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeEvidenceValue(entry)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Evidence must be JSON serializable.");
  return encoded;
}

export function sha256EvidenceValue(value) {
  return `sha256:${createHash("sha256").update(canonicalizeEvidenceValue(value)).digest("hex")}`;
}

export function evidenceSigningKeyId(publicKey) {
  return `ed25519:${createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 24)}`;
}

export function evidenceMerkleRoot(leaves) {
  let level = [...leaves].sort();
  if (level.length === 0) return sha256EvidenceValue([]);
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(sha256EvidenceValue([level[index], level[index + 1] ?? level[index]]));
    }
    level = next;
  }
  return level[0];
}

export function wilsonIntervalBps(successes, sampleSize) {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(sampleSize) || successes < 0 || sampleSize < 1) {
    return null;
  }
  const boundedSuccesses = Math.min(successes, sampleSize);
  const z = 1.959963984540054;
  const proportion = boundedSuccesses / sampleSize;
  const zSquared = z * z;
  const denominator = 1 + zSquared / sampleSize;
  const center = (proportion + zSquared / (2 * sampleSize)) / denominator;
  const margin =
    (z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * sampleSize)) / sampleSize)) / denominator;
  return {
    lowerBps: Math.max(0, Math.round((center - margin) * 10_000)),
    upperBps: Math.min(10_000, Math.round((center + margin) * 10_000)),
  };
}

function normalizedCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

export function computeEvidenceAggregation(sourceCounts, minimumAggregationSize, passRule) {
  if (!Number.isSafeInteger(minimumAggregationSize) || minimumAggregationSize < 1) {
    throw new Error("minimumAggregationSize must be a positive integer.");
  }
  const sources = sourceCounts.map(entry => {
    const targetCount = normalizedCount(entry.targetCount, "targetCount");
    const assignedCount = normalizedCount(entry.assignedCount, "assignedCount");
    const candidate = normalizedCount(entry.candidate, "candidate");
    const baseline = normalizedCount(entry.baseline, "baseline");
    const tie = normalizedCount(entry.tie, "tie");
    const invalidCount = normalizedCount(entry.invalidCount, "invalidCount");
    const pendingCount = normalizedCount(entry.pendingCount, "pendingCount");
    const sampleSize = candidate + baseline + tie;
    const submittedCount = sampleSize + invalidCount + pendingCount;
    const missingCount = Math.max(0, targetCount - submittedCount);
    const suppressed = sampleSize < minimumAggregationSize;
    return {
      source: entry.source,
      targetCount,
      assignedCount,
      submittedCount,
      sampleSize,
      invalidCount,
      pendingCount,
      missingCount,
      suppressed,
      preference: suppressed
        ? null
        : {
            candidate,
            baseline,
            tie,
            candidateShareBps: Math.round((candidate * 10_000) / sampleSize),
            wilson95Bps: wilsonIntervalBps(candidate, sampleSize),
          },
      disagreement: suppressed
        ? null
        : {
            nonCandidateCount: baseline + tie,
            rateBps: Math.round(((baseline + tie) * 10_000) / sampleSize),
          },
    };
  });
  const totals = sourceCounts.reduce(
    (result, entry) => ({
      targetCount: result.targetCount + normalizedCount(entry.targetCount, "targetCount"),
      assignedCount: result.assignedCount + normalizedCount(entry.assignedCount, "assignedCount"),
      candidate: result.candidate + normalizedCount(entry.candidate, "candidate"),
      baseline: result.baseline + normalizedCount(entry.baseline, "baseline"),
      tie: result.tie + normalizedCount(entry.tie, "tie"),
      invalidCount: result.invalidCount + normalizedCount(entry.invalidCount, "invalidCount"),
      pendingCount: result.pendingCount + normalizedCount(entry.pendingCount, "pendingCount"),
    }),
    { targetCount: 0, assignedCount: 0, candidate: 0, baseline: 0, tie: 0, invalidCount: 0, pendingCount: 0 },
  );
  const sampleSize = totals.candidate + totals.baseline + totals.tie;
  const submittedCount = sampleSize + totals.invalidCount + totals.pendingCount;
  const missingCount = Math.max(0, totals.targetCount - submittedCount);
  const suppressed = sampleSize < minimumAggregationSize;
  const candidateShareBps = suppressed ? null : Math.round((totals.candidate * 10_000) / sampleSize);
  const outcome =
    candidateShareBps === null || sampleSize < passRule.minimumValidResponses
      ? "insufficient"
      : candidateShareBps >= passRule.thresholdBps
        ? "pass"
        : "fail";
  return {
    aggregationVersion: EVIDENCE_AGGREGATION_VERSION,
    minimumAggregationSize,
    targetCount: totals.targetCount,
    assignedCount: totals.assignedCount,
    submittedCount,
    sampleSize,
    invalidCount: totals.invalidCount,
    pendingCount: totals.pendingCount,
    missingCount,
    suppressed,
    preference: suppressed
      ? null
      : {
          candidate: totals.candidate,
          baseline: totals.baseline,
          tie: totals.tie,
          candidateShareBps,
          wilson95Bps: wilsonIntervalBps(totals.candidate, sampleSize),
        },
    disagreement: suppressed
      ? null
      : {
          nonCandidateCount: totals.baseline + totals.tie,
          rateBps: Math.round(((totals.baseline + totals.tie) * 10_000) / sampleSize),
        },
    passRule,
    outcome,
    sourceSubpanels: sources,
  };
}

function panelFromPrivacySafeCounts(entry, minimumAggregationSize) {
  const targetCount = normalizedCount(entry.targetCount, "targetCount");
  const assignedCount = normalizedCount(entry.assignedCount, "assignedCount");
  const sampleSize = normalizedCount(entry.sampleSize, "sampleSize");
  const invalidCount = normalizedCount(entry.invalidCount, "invalidCount");
  const pendingCount = normalizedCount(entry.pendingCount, "pendingCount");
  const submittedCount = sampleSize + invalidCount + pendingCount;
  const missingCount = Math.max(0, targetCount - submittedCount);
  if (entry.suppressed) {
    if (sampleSize >= minimumAggregationSize || entry.candidate !== undefined) {
      throw new Error("Suppressed recomputation counts expose an invalid small cell.");
    }
    return {
      source: entry.source,
      targetCount,
      assignedCount,
      submittedCount,
      sampleSize,
      invalidCount,
      pendingCount,
      missingCount,
      suppressed: true,
      preference: null,
      disagreement: null,
    };
  }
  const computed = computeEvidenceAggregation(
    [
      {
        source: entry.source,
        targetCount,
        assignedCount,
        candidate: normalizedCount(entry.candidate, "candidate"),
        baseline: normalizedCount(entry.baseline, "baseline"),
        tie: normalizedCount(entry.tie, "tie"),
        invalidCount,
        pendingCount,
      },
    ],
    minimumAggregationSize,
    { metric: "candidate_preference_share_bps", operator: "gte", thresholdBps: 0, minimumValidResponses: 0 },
  );
  if (computed.sampleSize !== sampleSize) throw new Error("Recomputation sample size does not match its choices.");
  return computed.sourceSubpanels[0];
}

function aggregationFromPrivacySafeCounts(recomputation, minimumAggregationSize, passRule) {
  const overallPanel = panelFromPrivacySafeCounts(recomputation.overallCounts, minimumAggregationSize);
  const candidateShareBps = overallPanel.preference?.candidateShareBps ?? null;
  const outcome =
    candidateShareBps === null || overallPanel.sampleSize < passRule.minimumValidResponses
      ? "insufficient"
      : candidateShareBps >= passRule.thresholdBps
        ? "pass"
        : "fail";
  return {
    aggregationVersion: EVIDENCE_AGGREGATION_VERSION,
    minimumAggregationSize,
    targetCount: overallPanel.targetCount,
    assignedCount: overallPanel.assignedCount,
    submittedCount: overallPanel.submittedCount,
    sampleSize: overallPanel.sampleSize,
    invalidCount: overallPanel.invalidCount,
    pendingCount: overallPanel.pendingCount,
    missingCount: overallPanel.missingCount,
    suppressed: overallPanel.suppressed,
    preference: overallPanel.preference,
    disagreement: overallPanel.disagreement,
    passRule,
    outcome,
    sourceSubpanels: recomputation.sourceCounts.map(entry => panelFromPrivacySafeCounts(entry, minimumAggregationSize)),
  };
}

export function verifyEvidenceExport(packet, trust = {}) {
  try {
    if (!packet || typeof packet !== "object" || !packet.payload || !packet.signing) {
      return { valid: false, errors: ["invalid_packet_shape"] };
    }
    const errors = [];
    if (packet.payload.schemaVersion !== EVIDENCE_SCHEMA_VERSION) errors.push("unsupported_schema_version");
    if (packet.signing.algorithm !== "Ed25519") errors.push("unsupported_signature_algorithm");
    const derivedKeyId = evidenceSigningKeyId(packet.signing.publicKey);
    if (!trust.expectedPublicKey && !trust.expectedKeyId) errors.push("missing_trust_anchor");
    if (trust.expectedPublicKey && trust.expectedPublicKey !== packet.signing.publicKey) {
      errors.push("untrusted_signing_key");
    }
    if (trust.expectedKeyId) {
      if (trust.expectedKeyId !== packet.signing.keyId) errors.push("signing_key_id_mismatch");
      if (
        !/^ed25519:[0-9a-f]{24}$/.test(trust.expectedKeyId) ||
        trust.expectedKeyId !== packet.signing.keyId ||
        trust.expectedKeyId !== derivedKeyId
      ) {
        errors.push("untrusted_signing_key");
      }
    }
    const signedDocument = { payload: packet.payload, signing: packet.signing };
    const canonicalDocument = canonicalizeEvidenceValue(signedDocument);
    const packetDigest = sha256EvidenceValue(signedDocument);
    if (packet.packetDigest !== packetDigest) errors.push("packet_digest_mismatch");
    if (evidenceMerkleRoot(packet.payload.recomputation.caseLeaves) !== packet.payload.roots.caseRoot) {
      errors.push("case_root_mismatch");
    }
    if (evidenceMerkleRoot(packet.payload.recomputation.responseLeaves) !== packet.payload.roots.responseRoot) {
      errors.push("response_root_mismatch");
    }
    const aggregation = aggregationFromPrivacySafeCounts(
      packet.payload.recomputation,
      packet.payload.aggregation.minimumAggregationSize,
      packet.payload.aggregation.passRule,
    );
    if (canonicalizeEvidenceValue(aggregation) !== canonicalizeEvidenceValue(packet.payload.aggregation)) {
      errors.push("aggregation_mismatch");
    }
    const publicKey = createPublicKey({
      key: Buffer.from(packet.signing.publicKey, "base64url"),
      format: "der",
      type: "spki",
    });
    if (!verify(null, Buffer.from(canonicalDocument), publicKey, Buffer.from(packet.signature, "base64url"))) {
      errors.push("signature_invalid");
    }
    return { valid: errors.length === 0, errors, packetDigest };
  } catch {
    return { valid: false, errors: ["verification_failed"] };
  }
}
