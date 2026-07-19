import { createHash, createPublicKey, verify } from "node:crypto";

export const EVIDENCE_SCHEMA_VERSION = "rateloop.human-assurance.evidence.v3";
export const LEGACY_EVIDENCE_SCHEMA_VERSIONS = ["rateloop.human-assurance.evidence.v2"];
export const EVIDENCE_AGGREGATION_VERSION = "rateloop.descriptive-case-quorum.v2";

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

export function evidenceSigningKeyId(publicKey, algorithm = "Ed25519") {
  const prefix = algorithm === "Ed25519" ? "ed25519" : algorithm === "ECDSA-SHA256" ? "p256" : null;
  if (!prefix) throw new Error("Unsupported evidence signature algorithm.");
  return `${prefix}:${createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 24)}`;
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

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function reviewerPanel(entry) {
  return {
    source: entry.source,
    targetReviewerCount: count(entry.targetReviewerCount, "targetReviewerCount"),
    assignedReviewerCount: count(entry.assignedReviewerCount, "assignedReviewerCount"),
    paidReviewerCount: count(entry.paidReviewerCount, "paidReviewerCount"),
    respondingReviewerCount: count(entry.respondingReviewerCount, "respondingReviewerCount"),
    completeJudgmentSetReviewerCount: count(entry.completeJudgmentSetReviewerCount, "completeJudgmentSetReviewerCount"),
  };
}

function descriptiveCasePanel(entry, minimumAggregationSize, passRule) {
  const targetReviewerCount = count(entry.targetReviewerCount, "targetReviewerCount");
  const assignedReviewerCount = count(entry.assignedReviewerCount, "assignedReviewerCount");
  const validReviewerCount = count(entry.validReviewerCount, "validReviewerCount");
  const invalidJudgmentCount = count(entry.invalidJudgmentCount, "invalidJudgmentCount");
  const pendingJudgmentCount = count(entry.pendingJudgmentCount, "pendingJudgmentCount");
  const submittedJudgmentCount = validReviewerCount + invalidJudgmentCount + pendingJudgmentCount;
  const suppressed = validReviewerCount < minimumAggregationSize;
  let preference = null;
  let disagreement = null;
  if (suppressed) {
    if (entry.candidate !== undefined || entry.baseline !== undefined || entry.tie !== undefined) {
      throw new Error("Suppressed per-case recomputation counts expose a small-cell preference.");
    }
  } else {
    const candidate = count(entry.candidate, "candidate");
    const baseline = count(entry.baseline, "baseline");
    const tie = count(entry.tie, "tie");
    if (candidate + baseline + tie !== validReviewerCount) {
      throw new Error("Per-case valid reviewer count does not match its choices.");
    }
    preference = {
      candidate,
      baseline,
      tie,
      candidateShareBps: Math.round((candidate * 10_000) / validReviewerCount),
      method: "descriptive_case_share",
    };
    disagreement = {
      nonCandidateCount: baseline + tie,
      rateBps: Math.round(((baseline + tie) * 10_000) / validReviewerCount),
      method: "descriptive_case_share",
    };
  }
  const quorumMet = validReviewerCount >= passRule.minimumValidResponses;
  const outcome =
    suppressed || !quorumMet || !preference
      ? "insufficient"
      : preference.candidateShareBps >= passRule.thresholdBps
        ? "pass"
        : "fail";
  return {
    ...(entry.source ? { source: entry.source } : {}),
    targetReviewerCount,
    assignedReviewerCount,
    submittedJudgmentCount,
    validReviewerCount,
    invalidJudgmentCount,
    pendingJudgmentCount,
    missingTargetJudgmentCount: Math.max(0, targetReviewerCount - submittedJudgmentCount),
    missingAssignedJudgmentCount: Math.max(0, assignedReviewerCount - submittedJudgmentCount),
    suppressed,
    quorum: { requiredValidReviewers: passRule.minimumValidResponses, met: quorumMet },
    preference,
    disagreement,
    outcome,
  };
}

export function computeEvidenceAggregation(recomputation, minimumAggregationSize, passRule) {
  if (!Number.isSafeInteger(minimumAggregationSize) || minimumAggregationSize < 1) {
    throw new Error("minimumAggregationSize must be a positive integer.");
  }
  if (!Array.isArray(recomputation.reviewerSources) || !Array.isArray(recomputation.cases)) {
    throw new Error("Evidence recomputation inputs are incomplete.");
  }
  const sourceReviewerPanels = recomputation.reviewerSources.map(reviewerPanel);
  const reviewerCoverage = sourceReviewerPanels.reduce(
    (result, panel) => ({
      targetReviewerCount: result.targetReviewerCount + panel.targetReviewerCount,
      assignedReviewerCount: result.assignedReviewerCount + panel.assignedReviewerCount,
      paidReviewerCount: result.paidReviewerCount + panel.paidReviewerCount,
      respondingReviewerCount: result.respondingReviewerCount + panel.respondingReviewerCount,
      completeJudgmentSetReviewerCount:
        result.completeJudgmentSetReviewerCount + panel.completeJudgmentSetReviewerCount,
      sourceSubpanels: result.sourceSubpanels,
    }),
    {
      targetReviewerCount: 0,
      assignedReviewerCount: 0,
      paidReviewerCount: 0,
      respondingReviewerCount: 0,
      completeJudgmentSetReviewerCount: 0,
      sourceSubpanels: sourceReviewerPanels,
    },
  );
  const cases = recomputation.cases.map(entry => {
    const overall = descriptiveCasePanel(entry.overall, minimumAggregationSize, passRule);
    const sourceSubpanels = entry.sourceCounts.map(source =>
      descriptiveCasePanel(source, minimumAggregationSize, passRule),
    );
    const sourceTotals = sourceSubpanels.reduce(
      (result, panel) => ({
        target: result.target + panel.targetReviewerCount,
        assigned: result.assigned + panel.assignedReviewerCount,
        submitted: result.submitted + panel.submittedJudgmentCount,
        valid: result.valid + panel.validReviewerCount,
        invalid: result.invalid + panel.invalidJudgmentCount,
        pending: result.pending + panel.pendingJudgmentCount,
      }),
      { target: 0, assigned: 0, submitted: 0, valid: 0, invalid: 0, pending: 0 },
    );
    if (
      sourceTotals.target !== overall.targetReviewerCount ||
      sourceTotals.assigned !== overall.assignedReviewerCount ||
      sourceTotals.submitted !== overall.submittedJudgmentCount ||
      sourceTotals.valid !== overall.validReviewerCount ||
      sourceTotals.invalid !== overall.invalidJudgmentCount ||
      sourceTotals.pending !== overall.pendingJudgmentCount
    ) {
      throw new Error("Per-case source counts do not reconcile to the case total.");
    }
    return { caseId: entry.caseId, ...overall, sourceSubpanels };
  });
  const judgmentCoverage = cases.reduce(
    (result, entry) => ({
      caseCount: result.caseCount + 1,
      targetExpectedJudgmentCount: result.targetExpectedJudgmentCount + entry.targetReviewerCount,
      assignedExpectedJudgmentCount: result.assignedExpectedJudgmentCount + entry.assignedReviewerCount,
      submittedJudgmentCount: result.submittedJudgmentCount + entry.submittedJudgmentCount,
      validJudgmentCount: result.validJudgmentCount + entry.validReviewerCount,
      invalidJudgmentCount: result.invalidJudgmentCount + entry.invalidJudgmentCount,
      pendingJudgmentCount: result.pendingJudgmentCount + entry.pendingJudgmentCount,
      missingTargetJudgmentCount: result.missingTargetJudgmentCount + entry.missingTargetJudgmentCount,
      missingAssignedJudgmentCount: result.missingAssignedJudgmentCount + entry.missingAssignedJudgmentCount,
    }),
    {
      caseCount: 0,
      targetExpectedJudgmentCount: 0,
      assignedExpectedJudgmentCount: 0,
      submittedJudgmentCount: 0,
      validJudgmentCount: 0,
      invalidJudgmentCount: 0,
      pendingJudgmentCount: 0,
      missingTargetJudgmentCount: 0,
      missingAssignedJudgmentCount: 0,
    },
  );
  if (
    judgmentCoverage.targetExpectedJudgmentCount !== reviewerCoverage.targetReviewerCount * cases.length ||
    judgmentCoverage.assignedExpectedJudgmentCount !== reviewerCoverage.assignedReviewerCount * cases.length
  ) {
    throw new Error("Expected case judgments do not reconcile to reviewer coverage.");
  }
  const passCaseCount = cases.filter(entry => entry.outcome === "pass").length;
  const failCaseCount = cases.filter(entry => entry.outcome === "fail").length;
  const insufficientCaseCount = cases.filter(entry => entry.outcome === "insufficient").length;
  const suiteOutcome =
    failCaseCount > 0
      ? "fail"
      : insufficientCaseCount > 0
        ? "insufficient"
        : cases.length > 0
          ? "pass"
          : "insufficient";
  return {
    aggregationVersion: EVIDENCE_AGGREGATION_VERSION,
    method: "descriptive_per_case",
    minimumAggregationSize,
    reviewerCoverage,
    judgmentCoverage,
    passRule,
    cases,
    suite: {
      method: "all_cases_must_pass",
      evaluatedCaseCount: passCaseCount + failCaseCount,
      passCaseCount,
      failCaseCount,
      insufficientCaseCount,
      outcome: suiteOutcome,
    },
  };
}

function validEvidenceReviewContext(payload) {
  const context = payload.reviewContext;
  const frozen = payload.frozen;
  if (!context || typeof context !== "object" || !frozen || typeof frozen !== "object") return false;
  const trigger = context.selectionTrigger;
  const gate = context.gate;
  const versions = context.versions;
  if (!trigger || typeof trigger !== "object" || !gate || typeof gate !== "object" || !versions) return false;
  if (
    !Array.isArray(trigger.reasonCodes) ||
    trigger.reasonCodes.length === 0 ||
    trigger.reasonCodes.some(reason => typeof reason !== "string")
  ) {
    return false;
  }
  const manual = trigger.source === "explicit_workspace_assurance_run";
  if (manual) {
    if (
      trigger.kind !== "owner_required" ||
      gate.type !== "not_applicable" ||
      gate.policyReference !== null ||
      gate.stopGateEvidenceReference !== null ||
      versions.selectionPolicy !== null ||
      versions.requestProfile !== null
    ) {
      return false;
    }
  } else {
    const selectionPolicy = versions.selectionPolicy;
    const requestProfile = versions.requestProfile;
    const reference = gate.stopGateEvidenceReference;
    const gatePolicy = gate.policyReference;
    if (
      trigger.source !== "persisted_agent_review_opportunity" ||
      ![
        "adaptive_sample",
        "critical_risk",
        "guardrail_escalation",
        "maximum_gap",
        "owner_required",
        "policy_rule",
      ].includes(trigger.kind) ||
      typeof trigger.opportunityId !== "string" ||
      !Number.isSafeInteger(trigger.selectionProbabilityBps) ||
      trigger.selectionProbabilityBps < 0 ||
      trigger.selectionProbabilityBps > 10_000 ||
      !Number.isSafeInteger(trigger.sampleBucket) ||
      trigger.sampleBucket < 0 ||
      trigger.sampleBucket > 9_999 ||
      (gate.type !== "blocking" && gate.type !== "advisory") ||
      !gatePolicy ||
      gatePolicy.id !== selectionPolicy?.id ||
      gatePolicy.version !== selectionPolicy?.version ||
      (gatePolicy.enforcementMode !== "advisory" && gatePolicy.enforcementMode !== "host_enforced") ||
      (gate.type === "blocking") !== (gatePolicy.enforcementMode === "host_enforced") ||
      !selectionPolicy ||
      typeof selectionPolicy.id !== "string" ||
      !Number.isSafeInteger(selectionPolicy.version) ||
      selectionPolicy.version < 1 ||
      !["manual", "always", "fixed", "rules", "adaptive"].includes(selectionPolicy.mode) ||
      !requestProfile ||
      typeof requestProfile.id !== "string" ||
      !Number.isSafeInteger(requestProfile.version) ||
      requestProfile.version < 1 ||
      !/^sha256:[0-9a-f]{64}$/.test(requestProfile.hash) ||
      !reference ||
      reference.kind !== "human_review_lifecycle_transition" ||
      reference.opportunityId !== trigger.opportunityId ||
      !["completed", "inconclusive", "failed_terminal", "cancelled_before_commit"].includes(reference.lifecycleState) ||
      !Number.isSafeInteger(reference.lifecycleRevision) ||
      reference.lifecycleRevision < 1 ||
      typeof reference.transitionEventId !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(reference.transitionCommitment)
    ) {
      return false;
    }
  }
  const admissionPolicies = versions.admissionPolicies;
  if (
    !Array.isArray(admissionPolicies) ||
    admissionPolicies.length !== 1 ||
    canonicalizeEvidenceValue(admissionPolicies) !== canonicalizeEvidenceValue(frozen.admissionPolicies) ||
    !Array.isArray(frozen.admissionPolicyHashes) ||
    frozen.admissionPolicyHashes.length !== 1
  ) {
    return false;
  }
  const admission = admissionPolicies[0];
  const audience = versions.audiencePolicy;
  return Boolean(
    admission &&
      /^0x[0-9a-f]{64}$/.test(admission.admissionPolicyHash) &&
      admission.admissionPolicyHash === frozen.admissionPolicyHashes[0] &&
      admission.derivedFrom?.kind === "assurance_audience_policy" &&
      admission.derivedFrom.id === audience?.id &&
      admission.derivedFrom.version === audience?.version &&
      admission.derivedFrom.hash === audience?.hash &&
      audience?.hash === frozen.policyHash,
  );
}

export function verifyEvidenceExport(packet, trust = {}) {
  try {
    if (!packet || typeof packet !== "object" || !packet.payload || !packet.signing) {
      return { valid: false, errors: ["invalid_packet_shape"] };
    }
    const errors = [];
    if (
      packet.payload.schemaVersion !== EVIDENCE_SCHEMA_VERSION &&
      !LEGACY_EVIDENCE_SCHEMA_VERSIONS.includes(packet.payload.schemaVersion)
    ) {
      errors.push("unsupported_schema_version");
    }
    if (packet.payload.schemaVersion === EVIDENCE_SCHEMA_VERSION && !validEvidenceReviewContext(packet.payload)) {
      errors.push("review_context_invalid");
    }
    if (packet.signing.algorithm !== "Ed25519" && packet.signing.algorithm !== "ECDSA-SHA256") {
      errors.push("unsupported_signature_algorithm");
    }
    const derivedKeyId = evidenceSigningKeyId(packet.signing.publicKey, packet.signing.algorithm);
    if (!trust.expectedPublicKey && !trust.expectedKeyId) errors.push("missing_trust_anchor");
    if (trust.expectedPublicKey && trust.expectedPublicKey !== packet.signing.publicKey) {
      errors.push("untrusted_signing_key");
    }
    if (trust.expectedKeyId) {
      if (trust.expectedKeyId !== packet.signing.keyId) errors.push("signing_key_id_mismatch");
      if (
        !/^(?:ed25519|p256):[0-9a-f]{24}$/.test(trust.expectedKeyId) ||
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
    const aggregation = computeEvidenceAggregation(
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
    const verificationAlgorithm = packet.signing.algorithm === "ECDSA-SHA256" ? "sha256" : null;
    if (
      !verify(
        verificationAlgorithm,
        Buffer.from(canonicalDocument),
        publicKey,
        Buffer.from(packet.signature, "base64url"),
      )
    ) {
      errors.push("signature_invalid");
    }
    return { valid: errors.length === 0, errors, packetDigest };
  } catch {
    return { valid: false, errors: ["verification_failed"] };
  }
}
