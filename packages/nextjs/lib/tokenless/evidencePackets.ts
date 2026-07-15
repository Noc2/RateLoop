import {
  EVIDENCE_AGGREGATION_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceMerkleRoot,
  evidenceSigningKeyId,
  sha256EvidenceValue,
  verifyEvidenceExport as verifyEvidenceExportCore,
} from "../../scripts/assurance-evidence-core.mjs";
import { type KeyObject, createHmac, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type QueryRow = Record<string, unknown>;
type ReviewerSource = "customer_invited" | "rateloop_network";
type ClientDecision = "go" | "revise" | "stop";
type EvidenceSigner = { keyId?: string; privateKey: KeyObject };

type ReviewerSourceCount = {
  source: ReviewerSource;
  targetReviewerCount: number;
  assignedReviewerCount: number;
  paidReviewerCount: number;
  respondingReviewerCount: number;
  completeJudgmentSetReviewerCount: number;
};

type CaseJudgmentCount = {
  source?: ReviewerSource;
  targetReviewerCount: number;
  assignedReviewerCount: number;
  candidate: number;
  baseline: number;
  tie: number;
  invalidJudgmentCount: number;
  pendingJudgmentCount: number;
};

type EvidenceExport = {
  payload: Record<string, any>;
  signing: { algorithm: "Ed25519"; keyId: string; publicKey: string };
  packetDigest: string;
  signature: string;
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCES = new Set<ReviewerSource>(["customer_invited", "rateloop_network"]);
const WRITE_ROLES = new Set(["owner", "admin", "member"]);

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Database returned an invalid ${key}.`);
  return number;
}

function parseJson<T>(value: unknown, name: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new TokenlessServiceError(`${name} is invalid.`, 409, "assurance_evidence_source_invalid");
  }
}

function normalizeAddress(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 400, "invalid_account");
  }
}

function evidenceError(message: string, code = "assurance_evidence_unavailable", status = 409): never {
  throw new TokenlessServiceError(message, status, code);
}

function parseSigningKey(value: string) {
  try {
    if (value.includes("BEGIN PRIVATE KEY")) return createPrivateKey(value);
    return createPrivateKey({ key: Buffer.from(value, "base64url"), format: "der", type: "pkcs8" });
  } catch {
    throw new TokenlessServiceError(
      "The evidence signing key is invalid.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
}

function loadEvidenceSigner(): EvidenceSigner {
  const encoded = process.env.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?.trim();
  if (!encoded) {
    throw new TokenlessServiceError(
      "Evidence packet signing is unavailable.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  return {
    keyId: process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID?.trim() || undefined,
    privateKey: parseSigningKey(encoded),
  };
}

function signingMetadata(signer: EvidenceSigner) {
  if (signer.privateKey.asymmetricKeyType !== "ed25519") {
    throw new TokenlessServiceError(
      "Evidence packets require a dedicated Ed25519 signing key.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  const publicKey = createPublicKey(signer.privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const derivedKeyId = evidenceSigningKeyId(publicKey);
  if (signer.keyId && signer.keyId !== derivedKeyId) {
    throw new TokenlessServiceError(
      "Evidence signing key IDs must equal the public-key fingerprint.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  return { algorithm: "Ed25519" as const, keyId: derivedKeyId, publicKey };
}

function loadTenantCommitmentKey(value?: Buffer) {
  if (value && value.byteLength >= 32) return value;
  if (value) {
    evidenceError("The tenant commitment key is too short.", "assurance_evidence_signing_unavailable", 503);
  }
  const encoded = process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY?.trim();
  const key = encoded ? Buffer.from(encoded, "base64url") : Buffer.alloc(0);
  if (key.byteLength < 32) {
    evidenceError("Evidence tenant commitments are unavailable.", "assurance_evidence_signing_unavailable", 503);
  }
  return key;
}

function tenantCommitment(workspaceId: string, key: Buffer) {
  return `hmac-sha256:${createHmac("sha256", key).update(workspaceId).digest("hex")}`;
}

async function loadRunAccess(
  client: Queryable,
  input: { accountAddress: string; workspaceId: string; runId: string },
  options: { lock?: boolean; decision?: boolean } = {},
) {
  const address = normalizeAddress(input.accountAddress);
  const result = await client.query(
    `SELECT r.*, p.workspace_id, p.data_classification,
            m.role AS workspace_role, g.governance_role,
            s.manifest_hash AS suite_manifest_hash, s.manifest_json AS suite_manifest_json,
            ap.policy_hash AS frozen_policy_hash, ap.policy_json,
            rb.pass_rule_json
     FROM tokenless_assurance_runs r
     JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
     JOIN tokenless_workspaces w ON w.workspace_id = p.workspace_id AND w.status = 'active'
     JOIN tokenless_workspace_members m ON m.workspace_id = p.workspace_id AND m.account_address = $1
     LEFT JOIN tokenless_workspace_member_governance g
       ON g.workspace_id = m.workspace_id AND g.account_address = m.account_address
     JOIN tokenless_assurance_suites s ON s.suite_id = r.suite_id AND s.version = r.suite_version
     JOIN tokenless_assurance_audience_policies ap
       ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
     JOIN tokenless_assurance_rubrics rb ON rb.rubric_id = s.rubric_id AND rb.version = s.rubric_version
     WHERE r.run_id = $2 AND p.workspace_id = $3
     LIMIT 1${options.lock ? " FOR UPDATE" : ""}`,
    [address, input.runId, input.workspaceId],
  );
  const row = result.rows[0];
  if (!row) evidenceError("Assurance run not found.", "assurance_run_not_found", 404);
  const role = rowString(row, "workspace_role");
  if (!WRITE_ROLES.has(role ?? "")) {
    evidenceError("Assurance run not found.", "assurance_run_not_found", 404);
  }
  if (
    options.decision &&
    role !== "owner" &&
    role !== "admin" &&
    rowString(row, "governance_role") !== "decision_owner"
  ) {
    evidenceError("A decision owner must sign off on this packet.", "assurance_decision_forbidden", 403);
  }
  return { row, address };
}

function requireFrozenSource(row: QueryRow) {
  const runManifestHash = rowString(row, "manifest_hash");
  const suiteManifestHash = rowString(row, "suite_manifest_hash");
  const policyHash = rowString(row, "policy_hash");
  const frozenPolicyHash = rowString(row, "frozen_policy_hash");
  if (
    rowString(row, "status") !== "completed" ||
    !runManifestHash ||
    !suiteManifestHash ||
    !policyHash ||
    policyHash !== frozenPolicyHash ||
    !HASH_PATTERN.test(runManifestHash) ||
    !HASH_PATTERN.test(suiteManifestHash) ||
    !HASH_PATTERN.test(policyHash)
  ) {
    evidenceError("Only a completed run with exact frozen manifests can produce evidence.");
  }
  const runManifest = parseJson<Record<string, any>>(row.manifest_json, "Run manifest");
  const suiteManifest = parseJson<Record<string, any>>(row.suite_manifest_json, "Suite manifest");
  const policy = parseJson<Record<string, any>>(row.policy_json, "Audience policy");
  if (
    sha256EvidenceValue(runManifest) !== runManifestHash ||
    sha256EvidenceValue(suiteManifest) !== suiteManifestHash ||
    sha256EvidenceValue(policy) !== policyHash
  ) {
    evidenceError("A frozen evidence source no longer matches its hash.", "assurance_evidence_hash_mismatch");
  }
  return { runManifestHash, suiteManifestHash, policyHash, runManifest, suiteManifest, policy };
}

function reviewerSource(value: unknown): ReviewerSource {
  const source = String(value) as ReviewerSource;
  if (!SOURCES.has(source)) evidenceError("A reviewer source is invalid.", "assurance_evidence_source_invalid");
  return source;
}

function caseLeaf(row: QueryRow) {
  return sha256EvidenceValue({
    admissionPolicyHash: rowString(row, "admission_policy_hash"),
    caseId: rowString(row, "case_id"),
    contentId: rowString(row, "content_id"),
    deterministicChecksHash: rowString(row, "deterministic_checks_hash"),
    deterministicChecksStatus: rowString(row, "deterministic_checks_status"),
    position: rowNumber(row, "position"),
    roundId: rowString(row, "round_id"),
    roundStatus: rowString(row, "round_status"),
  });
}

function responseLeaf(row: QueryRow) {
  return sha256EvidenceValue({
    caseId: rowString(row, "case_id"),
    choice: rowString(row, "choice"),
    failureTagKeys: parseJson<string[]>(row.failure_tag_keys_json, "Failure tags"),
    qualificationKeys: parseJson<string[]>(row.qualification_keys_json, "Qualifications"),
    responseDigest: rowString(row, "response_digest"),
    reviewerSource: reviewerSource(row.reviewer_source),
    settlementReference: rowString(row, "settlement_reference"),
    validity: rowString(row, "validity"),
  });
}

function rationaleDigest(row: QueryRow) {
  const ciphertext = rowString(row, "rationale_ciphertext");
  if (!ciphertext) return null;
  return sha256EvidenceValue({
    ciphertext,
    keyRef: rowString(row, "rationale_key_ref"),
    responseDigest: rowString(row, "response_digest"),
  });
}

async function collectAggregationInputs(
  client: Queryable,
  runId: string,
  runCases: QueryRow[],
  responses: QueryRow[],
  policy: Record<string, any>,
) {
  const [subpanelResult, assignmentResult] = await Promise.all([
    client.query(
      `SELECT source, SUM(target_count) AS target_count
       FROM tokenless_assurance_run_subpanels WHERE run_id = $1 GROUP BY source ORDER BY source ASC`,
      [runId],
    ),
    client.query(
      `SELECT source, reviewer_account_address, paid_assignment
       FROM tokenless_assurance_assignments WHERE run_id = $1`,
      [runId],
    ),
  ]);
  const reviewerCounts = new Map<
    ReviewerSource,
    {
      source: ReviewerSource;
      targetReviewerCount: number;
      assignedReviewers: Set<string>;
      paidReviewers: Set<string>;
      respondingReviewers: Set<string>;
      responseCasesByReviewer: Map<string, Set<string>>;
    }
  >();
  for (const row of subpanelResult.rows) {
    const source = reviewerSource(row.source);
    reviewerCounts.set(source, {
      source,
      targetReviewerCount: rowNumber(row, "target_count"),
      assignedReviewers: new Set(),
      paidReviewers: new Set(),
      respondingReviewers: new Set(),
      responseCasesByReviewer: new Map(),
    });
  }
  if (reviewerCounts.size === 0) evidenceError("The run has no frozen source subpanels.");
  let paidAssignments = 0;
  for (const row of assignmentResult.rows) {
    const source = reviewerSource(row.source);
    const reviewerCount = reviewerCounts.get(source);
    if (!reviewerCount) evidenceError("An assignment is outside the frozen source subpanels.");
    const reviewer = rowString(row, "reviewer_account_address");
    if (!reviewer) evidenceError("An assignment has no reviewer.", "assurance_evidence_source_invalid");
    reviewerCount.assignedReviewers.add(reviewer);
    if (row.paid_assignment === true) {
      reviewerCount.paidReviewers.add(reviewer);
      paidAssignments += 1;
    }
  }
  const caseIds = new Set(runCases.map(runCase => rowString(runCase, "case_id")!));
  const emptyCaseCount = (source?: ReviewerSource): CaseJudgmentCount => ({
    ...(source ? { source } : {}),
    targetReviewerCount: source
      ? reviewerCounts.get(source)!.targetReviewerCount
      : [...reviewerCounts.values()].reduce((total, entry) => total + entry.targetReviewerCount, 0),
    assignedReviewerCount: source
      ? reviewerCounts.get(source)!.assignedReviewers.size
      : [...reviewerCounts.values()].reduce((total, entry) => total + entry.assignedReviewers.size, 0),
    candidate: 0,
    baseline: 0,
    tie: 0,
    invalidJudgmentCount: 0,
    pendingJudgmentCount: 0,
  });
  const caseCounts = new Map<
    string,
    { caseId: string; overall: CaseJudgmentCount; sourceCounts: Map<ReviewerSource, CaseJudgmentCount> }
  >();
  for (const caseId of caseIds) {
    caseCounts.set(caseId, {
      caseId,
      overall: emptyCaseCount(),
      sourceCounts: new Map([...reviewerCounts.keys()].map(source => [source, emptyCaseCount(source)])),
    });
  }
  const failureTags = new Map<string, number>();
  const rationaleDigests: string[] = [];
  for (const row of responses) {
    const caseId = rowString(row, "case_id");
    const reviewerKey = rowString(row, "reviewer_key");
    const caseCount = caseId ? caseCounts.get(caseId) : undefined;
    if (!caseId || !reviewerKey || !caseCount) {
      evidenceError("A response is outside the frozen run cases.", "assurance_evidence_source_invalid");
    }
    const source = reviewerSource(row.reviewer_source);
    const reviewerCount = reviewerCounts.get(source);
    const sourceCaseCount = caseCount.sourceCounts.get(source);
    if (!reviewerCount || !sourceCaseCount) evidenceError("A response is outside the frozen source subpanels.");
    reviewerCount.respondingReviewers.add(reviewerKey);
    const reviewerCases = reviewerCount.responseCasesByReviewer.get(reviewerKey) ?? new Set<string>();
    reviewerCases.add(caseId);
    reviewerCount.responseCasesByReviewer.set(reviewerKey, reviewerCases);
    const validity = rowString(row, "validity");
    if (validity === "valid") {
      const choice = rowString(row, "choice");
      if (choice !== "candidate" && choice !== "baseline" && choice !== "tie") {
        evidenceError("A valid response has an unsupported choice.", "assurance_evidence_source_invalid");
      }
      caseCount.overall[choice] += 1;
      sourceCaseCount[choice] += 1;
      for (const key of parseJson<string[]>(row.failure_tag_keys_json, "Failure tags")) {
        failureTags.set(key, (failureTags.get(key) ?? 0) + 1);
      }
    } else if (validity === "invalid" || validity === "withdrawn") {
      caseCount.overall.invalidJudgmentCount += 1;
      sourceCaseCount.invalidJudgmentCount += 1;
    } else if (validity === "pending") {
      caseCount.overall.pendingJudgmentCount += 1;
      sourceCaseCount.pendingJudgmentCount += 1;
    } else {
      evidenceError("A response has an unsupported validity state.", "assurance_evidence_source_invalid");
    }
    const digest = rationaleDigest(row);
    if (digest) rationaleDigests.push(digest);
  }
  const publicReviewerCounts: ReviewerSourceCount[] = [...reviewerCounts.values()]
    .sort((left, right) => left.source.localeCompare(right.source))
    .map(entry => ({
      source: entry.source,
      targetReviewerCount: entry.targetReviewerCount,
      assignedReviewerCount: entry.assignedReviewers.size,
      paidReviewerCount: entry.paidReviewers.size,
      respondingReviewerCount: entry.respondingReviewers.size,
      completeJudgmentSetReviewerCount: [...entry.responseCasesByReviewer.values()].filter(
        reviewerCases => reviewerCases.size === caseIds.size,
      ).length,
    }));
  const minimumAggregationSize = Number(policy.buyerPrivacy?.minimumAggregationSize);
  if (!Number.isSafeInteger(minimumAggregationSize) || minimumAggregationSize < 1 || minimumAggregationSize > 10_000) {
    evidenceError("The frozen minimum aggregation size is invalid.", "assurance_evidence_source_invalid");
  }
  return {
    reviewerCounts: publicReviewerCounts,
    caseCounts: [...caseCounts.values()].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    minimumAggregationSize,
    paidAssignments,
    failureTagCounts: [...failureTags.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => ({ key, count })),
    rationaleDigests: rationaleDigests.sort(),
  };
}

function privacySafeRecomputation(
  reviewerCounts: ReviewerSourceCount[],
  caseCounts: { caseId: string; overall: CaseJudgmentCount; sourceCounts: Map<ReviewerSource, CaseJudgmentCount> }[],
  minimumAggregationSize: number,
) {
  const safeCaseEntry = (entry: CaseJudgmentCount) => {
    const validReviewerCount = entry.candidate + entry.baseline + entry.tie;
    const common = {
      ...(entry.source ? { source: entry.source } : {}),
      targetReviewerCount: entry.targetReviewerCount,
      assignedReviewerCount: entry.assignedReviewerCount,
      validReviewerCount,
      invalidJudgmentCount: entry.invalidJudgmentCount,
      pendingJudgmentCount: entry.pendingJudgmentCount,
      suppressed: validReviewerCount < minimumAggregationSize,
    };
    return common.suppressed
      ? common
      : { ...common, candidate: entry.candidate, baseline: entry.baseline, tie: entry.tie };
  };
  return {
    reviewerSources: reviewerCounts,
    cases: caseCounts.map(entry => ({
      caseId: entry.caseId,
      overall: safeCaseEntry(entry.overall),
      sourceCounts: [...entry.sourceCounts.values()]
        .sort((left, right) => left.source!.localeCompare(right.source!))
        .map(safeCaseEntry),
    })),
  };
}

function passRuleFrom(row: QueryRow, runManifest: Record<string, any>) {
  const passRule = runManifest.rubric?.passRule ?? parseJson<Record<string, any>>(row.pass_rule_json, "Pass rule");
  if (
    passRule?.metric !== "candidate_preference_share_bps" ||
    passRule?.operator !== "gte" ||
    !Number.isSafeInteger(passRule.thresholdBps) ||
    !Number.isSafeInteger(passRule.minimumValidResponses)
  ) {
    evidenceError("The frozen pass rule is unsupported.", "assurance_evidence_source_invalid");
  }
  return {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: passRule.thresholdBps,
    minimumValidResponses: passRule.minimumValidResponses,
  };
}

async function collectChainEvidence(client: Queryable, runCases: QueryRow[]) {
  const rounds: Record<string, unknown>[] = [];
  for (const runCase of runCases) {
    const roundId = rowString(runCase, "round_id");
    const entry: Record<string, unknown> = {
      caseId: rowString(runCase, "case_id"),
      contentId: rowString(runCase, "content_id"),
      admissionPolicyHash: rowString(runCase, "admission_policy_hash"),
      roundId,
      roundStatus: rowString(runCase, "round_status"),
      execution: null,
      indexedEvents: [],
    };
    if (roundId) {
      const executionResult = await client.query(
        `SELECT operation_key, deployment_key, deployment_block, chain_id, panel_address,
                submission_transaction_hash, receipt_block_number, receipt_block_hash, state
         FROM tokenless_chain_executions
         WHERE content_id = $1 AND round_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [rowString(runCase, "content_id"), roundId],
      );
      const execution = executionResult.rows[0];
      if (execution) {
        const eventResult = await client.query(
          `SELECT sequence, event_type, evidence_hash, occurred_at
           FROM tokenless_transparency_events WHERE operation_key = $1 ORDER BY sequence ASC`,
          [rowString(execution, "operation_key")],
        );
        entry.execution = {
          operationKey: rowString(execution, "operation_key"),
          deploymentKey: rowString(execution, "deployment_key"),
          deploymentBlock: rowString(execution, "deployment_block"),
          chainId: rowNumber(execution, "chain_id"),
          panelAddress: rowString(execution, "panel_address"),
          roundCreationTransactionHash: rowString(execution, "submission_transaction_hash"),
          receiptBlockNumber: rowString(execution, "receipt_block_number"),
          receiptBlockHash: rowString(execution, "receipt_block_hash"),
          state: rowString(execution, "state"),
        };
        entry.indexedEvents = eventResult.rows.map(event => ({
          sequence: rowNumber(event, "sequence"),
          eventType: rowString(event, "event_type"),
          evidenceHash: rowString(event, "evidence_hash"),
          occurredAt: new Date(String(event.occurred_at)).toISOString(),
        }));
      }
    }
    rounds.push(entry);
  }
  return rounds;
}

function settlementSummary(input: {
  chainEvidence: Record<string, any>[];
  paidAssignments: number;
  policy: Record<string, any>;
  reviewerCounts: ReviewerSourceCount[];
  responses: QueryRow[];
}) {
  const paidSources = new Set(
    input.reviewerCounts.filter(entry => entry.paidReviewerCount > 0).map(entry => entry.source),
  );
  const links = new Set<string>();
  for (const response of input.responses) {
    const reference = rowString(response, "settlement_reference");
    if (reference && paidSources.has(reviewerSource(response.reviewer_source))) links.add(reference);
  }
  const unpaidInvited =
    input.paidAssignments === 0 &&
    input.policy.compensation === "unpaid" &&
    input.reviewerCounts.every(entry => entry.source === "customer_invited");
  if (unpaidInvited) {
    return {
      mode: "no_onchain_settlement_unpaid_invited",
      statement: "This invited panel was unpaid; there is no on-chain settlement for this evidence packet.",
      links: [],
    };
  }
  if (input.paidAssignments === 0) {
    return {
      mode: "no_onchain_settlement_unpaid",
      statement: "This run has no paid assignments and therefore no on-chain settlement.",
      links: [],
    };
  }
  return {
    mode: links.size > 0 ? "onchain_evidence_recorded" : "onchain_evidence_pending",
    statement:
      links.size > 0
        ? "Settlement references are linked to deployment-pinned chain evidence."
        : "Paid assignments exist, but settlement evidence has not reached a recorded terminal state.",
    links: [...links].sort(),
  };
}

function isTerminalIndexedEvent(eventType: unknown) {
  return eventType === "RoundTerminal" || eventType === "round.terminal" || eventType === "round.finalized";
}

function assertTerminalPacket(input: {
  aggregation: Record<string, any>;
  chainEvidence: Record<string, any>[];
  paidAssignments: number;
  policy: Record<string, any>;
  responses: QueryRow[];
  runCases: QueryRow[];
}) {
  const reviewerCoverage = input.aggregation.reviewerCoverage;
  if (
    reviewerCoverage.assignedReviewerCount !== reviewerCoverage.targetReviewerCount ||
    reviewerCoverage.respondingReviewerCount !== reviewerCoverage.targetReviewerCount ||
    reviewerCoverage.completeJudgmentSetReviewerCount !== reviewerCoverage.targetReviewerCount
  ) {
    evidenceError(
      "The frozen reviewer target and complete reviewer count must match before evidence is generated.",
      "assurance_run_not_terminal",
    );
  }
  const judgmentCoverage = input.aggregation.judgmentCoverage;
  if (
    judgmentCoverage.submittedJudgmentCount !== judgmentCoverage.targetExpectedJudgmentCount ||
    judgmentCoverage.validJudgmentCount !== judgmentCoverage.targetExpectedJudgmentCount ||
    judgmentCoverage.invalidJudgmentCount !== 0 ||
    judgmentCoverage.missingTargetJudgmentCount !== 0 ||
    judgmentCoverage.pendingJudgmentCount !== 0
  ) {
    evidenceError(
      "Every targeted reviewer must submit one valid terminal judgment for every frozen case.",
      "assurance_run_not_terminal",
    );
  }
  const sourceSubpanels = reviewerCoverage.sourceSubpanels as Record<string, any>[];
  const paidSourceSubpanels = sourceSubpanels.filter(entry => entry.paidReviewerCount > 0);
  const paidReviewerCount = sourceSubpanels.reduce((total, entry) => total + entry.paidReviewerCount, 0);
  if (
    paidReviewerCount !== input.paidAssignments ||
    paidSourceSubpanels.some(entry => entry.paidReviewerCount !== entry.assignedReviewerCount)
  ) {
    evidenceError(
      "A frozen reviewer source cannot mix paid and unpaid assignments.",
      "assurance_settlement_evidence_invalid",
    );
  }
  if (
    (input.policy.compensation === "unpaid" && paidSourceSubpanels.length !== 0) ||
    (input.policy.compensation === "paid" && paidSourceSubpanels.length !== sourceSubpanels.length) ||
    (input.policy.compensation === "mixed" &&
      (paidSourceSubpanels.length === 0 || paidSourceSubpanels.length === sourceSubpanels.length))
  ) {
    evidenceError("Assignment compensation does not match the frozen policy.", "assurance_settlement_evidence_invalid");
  }
  if (paidSourceSubpanels.length === 0) {
    if (
      input.runCases.some(
        runCase =>
          rowString(runCase, "round_status") !== "offchain_complete" || rowString(runCase, "round_id") !== null,
      )
    ) {
      evidenceError(
        "Unpaid cases require the explicit off-chain terminal state and no round ID.",
        "assurance_run_not_terminal",
      );
    }
    if (input.responses.some(response => rowString(response, "settlement_reference"))) {
      evidenceError("Unpaid evidence cannot claim an on-chain settlement.", "assurance_settlement_evidence_invalid");
    }
    return;
  }
  const onchainTerminalStates = new Set(["finalized", "terminal", "failed"]);
  if (
    input.runCases.some(
      runCase =>
        !onchainTerminalStates.has(rowString(runCase, "round_status") ?? "") || !rowString(runCase, "round_id"),
    )
  ) {
    evidenceError("Paid cases require a bound round in a terminal on-chain state.", "assurance_run_not_terminal");
  }
  const paidSources = new Set(paidSourceSubpanels.map(entry => entry.source));
  if (
    input.responses.some(response => {
      const paid = paidSources.has(reviewerSource(response.reviewer_source));
      const reference = rowString(response, "settlement_reference");
      return paid ? !reference : Boolean(reference);
    })
  ) {
    evidenceError(
      "Paid responses require terminal settlement references and unpaid responses must not claim them.",
      "assurance_settlement_evidence_pending",
    );
  }
  if (
    input.chainEvidence.some(
      round => !round.indexedEvents?.some((event: Record<string, unknown>) => isTerminalIndexedEvent(event.eventType)),
    )
  ) {
    evidenceError(
      "Paid evidence requires a stored terminal settlement event for every case.",
      "assurance_settlement_evidence_pending",
    );
  }
}

function buildLimitations(input: {
  aggregation: Record<string, any>;
  settlement: Record<string, any>;
  chainEvidence: Record<string, any>[];
}) {
  const limitations = [
    {
      code: "descriptive_case_results",
      message:
        "Preference shares are descriptive per-case reviewer results; judgments across cases are not treated as independent samples and no confidence interval is claimed.",
    },
    {
      code: "rationale_minimized",
      message: "The export contains rationale digests only; raw or decryptable rationale is excluded.",
    },
    {
      code: "decision_separate",
      message: "The measured packet is separate from the client's go, revise, or stop sign-off.",
    },
  ];
  if (input.aggregation.cases.some((entry: Record<string, any>) => entry.suppressed)) {
    limitations.push({
      code: "minimum_aggregation_not_met",
      message: "Preference and disagreement metrics are suppressed until the frozen minimum aggregate size is met.",
    });
  }
  if (
    input.aggregation.cases.some((entry: Record<string, any>) =>
      entry.sourceSubpanels.some((panel: Record<string, any>) => panel.suppressed),
    )
  ) {
    limitations.push({
      code: "small_source_cells_suppressed",
      message: "One or more source-separated panels are below the frozen minimum aggregate size.",
    });
  }
  if (
    input.aggregation.judgmentCoverage.missingTargetJudgmentCount > 0 ||
    input.aggregation.judgmentCoverage.invalidJudgmentCount > 0 ||
    input.aggregation.judgmentCoverage.pendingJudgmentCount > 0
  ) {
    limitations.push({
      code: "incomplete_or_invalid_work",
      message: "Missing, invalid, or pending responses are counted separately and excluded from preference statistics.",
    });
  }
  if (String(input.settlement.mode).startsWith("no_onchain")) {
    limitations.push({ code: "no_onchain_settlement", message: String(input.settlement.statement) });
  }
  if (input.chainEvidence.some(round => round.roundId && !round.execution)) {
    limitations.push({
      code: "chain_evidence_incomplete",
      message: "At least one bound round has no deployment-pinned execution record in this packet.",
    });
  }
  return limitations;
}

function signPacket(payload: Record<string, any>, signer: EvidenceSigner): EvidenceExport {
  const signing = signingMetadata(signer);
  const signedDocument = { payload, signing };
  const canonical = canonicalizeEvidenceValue(signedDocument);
  return {
    ...signedDocument,
    packetDigest: sha256EvidenceValue(signedDocument),
    signature: sign(null, Buffer.from(canonical), signer.privateKey).toString("base64url"),
  };
}

function parseStoredPacket(row: QueryRow | undefined): EvidenceExport {
  const packetJson = rowString(row, "packet_json");
  if (!packetJson) evidenceError("Evidence packet not found.", "assurance_evidence_not_found", 404);
  const packet = parseJson<EvidenceExport>(packetJson, "Evidence packet");
  const verification = verifyEvidenceExportCore(packet, {
    expectedPublicKey: rowString(row, "signing_public_key"),
    expectedKeyId: rowString(row, "signing_key_id"),
  });
  if (!verification.valid) evidenceError("Stored evidence packet verification failed.", "assurance_evidence_invalid");
  return packet;
}

export function assertEvidenceGenerationRequest(value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).length !== 0) {
    throw new TokenlessServiceError(
      "Evidence metrics are derived from stored records and cannot be supplied by the caller.",
      400,
      "caller_metrics_rejected",
    );
  }
}

export function verifyEvidenceExport(packet: unknown, trust?: { expectedPublicKey?: string; expectedKeyId?: string }) {
  return verifyEvidenceExportCore(packet, trust);
}

export async function generateAssuranceEvidencePacket(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  now?: Date;
  signer?: EvidenceSigner;
  tenantCommitmentKey?: Buffer;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { row } = await loadRunAccess(client, input, { lock: true });
    const existing = await client.query(
      `SELECT packet_json, signing_public_key, signing_key_id
       FROM tokenless_assurance_evidence_packets WHERE run_id = $1 LIMIT 1`,
      [input.runId],
    );
    if (existing.rows[0]) {
      const packet = parseStoredPacket(existing.rows[0]);
      await client.query("COMMIT");
      return packet;
    }
    const frozen = requireFrozenSource(row);
    const [caseResult, responseResult] = await Promise.all([
      client.query(
        `SELECT case_id, position, content_id, admission_policy_hash, deterministic_checks_hash,
                deterministic_checks_status, round_id, round_status
         FROM tokenless_assurance_run_cases WHERE run_id = $1 ORDER BY position ASC`,
        [input.runId],
      ),
      client.query(
        `SELECT case_id, reviewer_key, reviewer_source, choice, failure_tag_keys_json, rationale_ciphertext,
                rationale_key_ref, qualification_keys_json, response_digest, settlement_reference, validity
         FROM tokenless_assurance_responses WHERE run_id = $1 ORDER BY response_id ASC`,
        [input.runId],
      ),
    ]);
    if (caseResult.rows.length === 0) evidenceError("The completed run has no frozen cases.");
    const counts = await collectAggregationInputs(
      client,
      input.runId,
      caseResult.rows,
      responseResult.rows,
      frozen.policy,
    );
    const passRule = passRuleFrom(row, frozen.runManifest);
    const recomputation = privacySafeRecomputation(
      counts.reviewerCounts,
      counts.caseCounts,
      counts.minimumAggregationSize,
    );
    const aggregation = computeEvidenceAggregation(recomputation, counts.minimumAggregationSize, passRule);
    const caseLeaves = caseResult.rows.map(caseLeaf).sort();
    const responseLeaves = responseResult.rows.map(responseLeaf).sort();
    const chainEvidence = await collectChainEvidence(client, caseResult.rows);
    assertTerminalPacket({
      aggregation,
      chainEvidence,
      paidAssignments: counts.paidAssignments,
      policy: frozen.policy,
      responses: responseResult.rows,
      runCases: caseResult.rows,
    });
    const settlement = settlementSummary({
      chainEvidence,
      paidAssignments: counts.paidAssignments,
      policy: frozen.policy,
      reviewerCounts: counts.reviewerCounts,
      responses: responseResult.rows,
    });
    const limitations = buildLimitations({ aggregation, settlement, chainEvidence });
    const packetId = `haep_${randomUUID().replaceAll("-", "")}`;
    const generatedAt = input.now ?? new Date();
    const payload = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      packetId,
      runId: input.runId,
      tenantCommitment: tenantCommitment(input.workspaceId, loadTenantCommitmentKey(input.tenantCommitmentKey)),
      generatedAt: generatedAt.toISOString(),
      privacy: {
        classification: rowString(row, "data_classification"),
        minimumAggregationSize: counts.minimumAggregationSize,
        reviewerIdentitiesIncluded: false,
        rawRationaleIncluded: false,
      },
      frozen: {
        runManifestHash: frozen.runManifestHash,
        runManifest: frozen.runManifest,
        suiteManifestHash: frozen.suiteManifestHash,
        suiteManifest: frozen.suiteManifest,
        policyHash: frozen.policyHash,
        policy: frozen.policy,
        admissionPolicyHashes: [
          ...new Set(caseResult.rows.map(caseRow => rowString(caseRow, "admission_policy_hash"))),
        ].sort(),
      },
      roots: { caseRoot: evidenceMerkleRoot(caseLeaves), responseRoot: evidenceMerkleRoot(responseLeaves) },
      aggregation,
      failureTagCounts: counts.failureTagCounts.filter(
        (entry: { count: number }) => entry.count >= counts.minimumAggregationSize,
      ),
      rationaleDigests: counts.rationaleDigests,
      settlement,
      chainEvidence,
      limitations,
      recomputation: {
        caseLeaves,
        responseLeaves,
        ...recomputation,
      },
    };
    const packet = signPacket(payload, input.signer ?? loadEvidenceSigner());
    await client.query(
      `INSERT INTO tokenless_assurance_evidence_packets
       (packet_id, run_id, manifest_hash, case_root, response_root, aggregation_version,
        result_json, limitations_json, chain_references_json, signature, generated_at,
        packet_digest, packet_json, signature_algorithm, signing_key_id, signing_public_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        packetId,
        input.runId,
        frozen.runManifestHash,
        payload.roots.caseRoot,
        payload.roots.responseRoot,
        EVIDENCE_AGGREGATION_VERSION,
        JSON.stringify(aggregation),
        JSON.stringify(limitations),
        JSON.stringify({ settlement, chainEvidence }),
        packet.signature,
        generatedAt,
        packet.packetDigest,
        JSON.stringify(packet),
        packet.signing.algorithm,
        packet.signing.keyId,
        packet.signing.publicKey,
      ],
    );
    await client.query("COMMIT");
    return packet;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAssuranceEvidencePacket(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
}) {
  const client = await dbPool.connect();
  try {
    await loadRunAccess(client, input);
    const result = await client.query(
      `SELECT packet_json, signing_public_key, signing_key_id
       FROM tokenless_assurance_evidence_packets WHERE run_id = $1 LIMIT 1`,
      [input.runId],
    );
    return parseStoredPacket(result.rows[0]);
  } finally {
    client.release();
  }
}

function normalizeDecisionNote(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const note = value.trim();
  if (note.length > 2_000) {
    throw new TokenlessServiceError(
      "Decision note must not exceed 2000 characters.",
      400,
      "invalid_assurance_decision",
    );
  }
  return note || null;
}

function publicDecision(row: QueryRow) {
  const json = rowString(row, "decision_json");
  return json ? parseJson<Record<string, unknown>>(json, "Client decision") : null;
}

export async function recordAssuranceClientDecision(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  decision: ClientDecision;
  note?: string | null;
  now?: Date;
}) {
  if (input.decision !== "go" && input.decision !== "revise" && input.decision !== "stop") {
    throw new TokenlessServiceError("Decision must be go, revise, or stop.", 400, "invalid_assurance_decision");
  }
  const note = normalizeDecisionNote(input.note);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { address } = await loadRunAccess(client, input, { lock: true, decision: true });
    const packetResult = await client.query(
      `SELECT packet_id, packet_digest, packet_json, signing_public_key, signing_key_id
       FROM tokenless_assurance_evidence_packets
       WHERE run_id = $1 LIMIT 1`,
      [input.runId],
    );
    const packetRow = packetResult.rows[0];
    const packet = parseStoredPacket(packetRow);
    if (packet.packetDigest !== rowString(packetRow, "packet_digest")) {
      evidenceError("Evidence packet digest mismatch.", "assurance_evidence_invalid");
    }
    const existing = await client.query(
      "SELECT decision_json FROM tokenless_assurance_client_decisions WHERE run_id = $1 LIMIT 1",
      [input.runId],
    );
    if (existing.rows[0]) {
      const decision = publicDecision(existing.rows[0]);
      if (decision?.decision === input.decision && decision.note === note && decision.decidedBy === address) {
        await client.query("COMMIT");
        return decision;
      }
      evidenceError("This run already has a different client sign-off.", "assurance_decision_conflict");
    }
    const decisionId = `had_${randomUUID().replaceAll("-", "")}`;
    const decidedAt = input.now ?? new Date();
    const decisionPayload = {
      schemaVersion: "rateloop.human-assurance.client-decision.v1",
      decisionId,
      runId: input.runId,
      evidencePacketId: rowString(packetRow, "packet_id"),
      evidencePacketDigest: packet.packetDigest,
      decision: input.decision,
      note,
      decidedBy: address,
      decidedAt: decidedAt.toISOString(),
    };
    const decisionDigest = sha256EvidenceValue(decisionPayload);
    await client.query(
      `INSERT INTO tokenless_assurance_client_decisions
       (decision_id, run_id, evidence_packet_id, decision, note, decided_by, decided_at,
        evidence_packet_digest, decision_digest, decision_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        decisionId,
        input.runId,
        rowString(packetRow, "packet_id"),
        input.decision,
        note,
        address,
        decidedAt,
        packet.packetDigest,
        decisionDigest,
        JSON.stringify({ ...decisionPayload, decisionDigest }),
      ],
    );
    await client.query("COMMIT");
    return { ...decisionPayload, decisionDigest };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAssuranceClientDecision(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
}) {
  const client = await dbPool.connect();
  try {
    await loadRunAccess(client, input);
    const result = await client.query(
      "SELECT decision_json FROM tokenless_assurance_client_decisions WHERE run_id = $1 LIMIT 1",
      [input.runId],
    );
    return result.rows[0] ? publicDecision(result.rows[0]) : null;
  } finally {
    client.release();
  }
}
