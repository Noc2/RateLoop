#!/usr/bin/env node
import {
  EVIDENCE_SCHEMA_VERSION,
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceMerkleRoot,
  evidenceSigningKeyId,
  sha256EvidenceValue,
  sha256LegacyEvidenceValue,
} from "./assurance-evidence-core.mjs";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_OUTPUT_DIRECTORY = fileURLToPath(new URL("../public/docs/examples", import.meta.url));
const PACKET_FILENAME = "synthetic-evidence-v4.json";
const PUBLIC_KEY_FILENAME = "synthetic-evidence-v4.spki.txt";

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function syntheticPayload() {
  const caseId = "case_synthetic_release_check";
  const contentId = `0x${"12".repeat(32)}`;
  const admissionPolicyHash = `0x${"34".repeat(32)}`;
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 6_000,
    minimumValidResponses: 2,
  };
  const rubric = {
    prompt: "Is the proposed answer supported by the supplied evidence?",
    failureTags: ["unsupported_claim"],
    rationale: { mode: "optional" },
    passRule,
  };
  const suiteManifest = {
    kind: "suite_manifest",
    projectId: "project_synthetic_example",
    suiteId: "suite_synthetic_release_check",
    version: 1,
    rubric,
    cases: [{ caseId }],
  };
  const suiteManifestHash = await sha256LegacyEvidenceValue(suiteManifest);
  const policy = {
    schemaVersion: "human-assurance-v1",
    policyId: "policy_synthetic_invited_reviewers",
    version: 1,
    reviewerSource: "customer_invited",
    compensation: "unpaid",
    selection: "customer_named",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: { requirements: [] },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: 2,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: false,
  };
  const policyHash = await sha256LegacyEvidenceValue(policy);
  const runManifest = {
    schemaVersion: "human-assurance-run-orchestration-v1",
    kind: "run_orchestration_manifest",
    runId: "run_synthetic_release_check",
    projectId: "project_synthetic_example",
    suite: { suiteId: suiteManifest.suiteId, version: 1, manifestHash: suiteManifestHash },
    rubric: { rubricId: "rubric_synthetic_release_check", version: 1, passRule },
    audiencePolicy: {
      policyId: policy.policyId,
      version: 1,
      manifestHash: policyHash,
      admissionPolicyHash,
    },
  };
  const runManifestHash = await sha256LegacyEvidenceValue(runManifest);
  const linkedAdmissionPolicies = [
    {
      admissionPolicyHash,
      derivedFrom: {
        kind: "assurance_audience_policy",
        id: policy.policyId,
        version: 1,
        hash: policyHash,
      },
    },
  ];
  const reviewerSource = {
    source: "customer_invited",
    targetReviewerCount: 3,
    assignedReviewerCount: 3,
    paidReviewerCount: 0,
    respondingReviewerCount: 3,
    completeJudgmentSetReviewerCount: 3,
  };
  const caseCounts = {
    targetReviewerCount: 3,
    assignedReviewerCount: 3,
    validReviewerCount: 3,
    invalidJudgmentCount: 0,
    pendingJudgmentCount: 0,
    candidate: 2,
    baseline: 1,
    tie: 0,
  };
  const caseLeaves = [
    await sha256EvidenceValue({
      admissionPolicyHash,
      caseId,
      contentId,
      deterministicChecksHash: `sha256:${"56".repeat(32)}`,
      deterministicChecksStatus: "passed",
      position: 1,
      roundId: null,
      roundStatus: null,
    }),
  ];
  const responseLeaves = await Promise.all(
    ["candidate", "candidate", "baseline"].map(
      async (choice, index) =>
        await sha256EvidenceValue({
          caseId,
          choice,
          failureTagKeys: [],
          qualificationKeys: [],
          responseDigest: `sha256:${String(index + 7)
            .padStart(2, "0")
            .repeat(32)}`,
          reviewerSource: "customer_invited",
          settlementReference: null,
          validity: "valid",
        }),
    ),
  );
  const recomputation = {
    caseLeaves: caseLeaves.sort(),
    responseLeaves: responseLeaves.sort(),
    reviewerSources: [reviewerSource],
    cases: [
      {
        caseId,
        overall: caseCounts,
        sourceCounts: [{ source: "customer_invited", ...caseCounts }],
      },
    ],
  };
  const aggregation = computeEvidenceAggregation(recomputation, 2, passRule);

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    packetId: "haep_synthetic_example_v4",
    runId: runManifest.runId,
    tenantCommitment: `hmac-sha256:${"78".repeat(32)}`,
    generatedAt: "2026-08-04T08:00:00.000Z",
    privacy: {
      classification: "synthetic",
      minimumAggregationSize: 2,
      reviewerIdentitiesIncluded: false,
      rawRationaleIncluded: false,
      calibrationItemsIncludedInVerdict: false,
    },
    frozen: {
      runManifestHash,
      runManifest,
      suiteManifestHash,
      suiteManifest,
      policyHash,
      policy,
      admissionPolicyHashes: [admissionPolicyHash],
      admissionPolicies: linkedAdmissionPolicies,
    },
    reviewContext: {
      selectionTrigger: {
        kind: "owner_required",
        source: "explicit_workspace_assurance_run",
        reasonCodes: ["explicit_workspace_assurance_run"],
      },
      deliveryAuthority: { mode: "workspace_authorized_member", callerSupplied: false },
      gate: {
        type: "not_applicable",
        policyReference: null,
        stopGateEvidenceReference: null,
        statement: "This workspace-started assurance run was not bound to an agent output stop gate.",
      },
      versions: {
        runManifest: { hash: runManifestHash },
        suite: { id: suiteManifest.suiteId, version: 1, hash: suiteManifestHash },
        audiencePolicy: { id: policy.policyId, version: 1, hash: policyHash },
        admissionPolicies: linkedAdmissionPolicies,
        selectionPolicy: null,
        requestProfile: null,
      },
      reviewerQualifications: {
        taxonomy: "explicit_qualification_categories",
        orderedTiers: false,
        minimumAggregationSize: 2,
        categories: [],
        unqualified: { suppressed: false, reviewerCount: 3 },
      },
      period: {
        startInclusive: "2026-08-04T07:55:00.000Z",
        endInclusive: "2026-08-04T08:00:00.000Z",
        durationMs: 300_000,
        coverage: {
          caseCount: 1,
          targetExpectedJudgmentCount: 3,
          submittedJudgmentCount: 3,
          respondingReviewerCount: 3,
          targetReviewerCount: 3,
        },
        responseSubmissionLatencyFromPeriodStartMs: {
          count: 3,
          minimum: 60_000,
          median: 120_000,
          p95: 180_000,
          maximum: 180_000,
        },
      },
    },
    roots: {
      caseRoot: await evidenceMerkleRoot(recomputation.caseLeaves),
      responseRoot: await evidenceMerkleRoot(recomputation.responseLeaves),
    },
    aggregation,
    calibration: { itemCount: 0, statusDisclosedOnlyInAggregate: true },
    overrideDecisions: {
      atGeneration: { go: 0, revise: 0, stop: 0, total: 0 },
      recordedSeparately: true,
    },
    failureTagCounts: [],
    rationaleDigests: [],
    settlement: {
      mode: "no_onchain_settlement_unpaid_invited",
      statement: "This invited panel was unpaid; there is no on-chain settlement for this evidence packet.",
      links: [],
    },
    chainEvidence: [
      {
        caseId,
        contentId,
        admissionPolicyHash,
        roundId: null,
        roundStatus: null,
        execution: null,
        indexedEvents: [],
      },
    ],
    limitations: [
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
      {
        code: "no_onchain_settlement",
        message: "This invited panel was unpaid; there is no on-chain settlement for this evidence packet.",
      },
    ],
    recomputation,
  };
}

export async function generateSyntheticEvidenceExample(outputDirectory = DEFAULT_OUTPUT_DIRECTORY) {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = createPublicKey(keys.privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const signing = {
    algorithm: "Ed25519",
    keyId: await evidenceSigningKeyId(publicKey),
    publicKey,
  };
  const signedDocument = { payload: await syntheticPayload(), signing };
  const packet = {
    ...signedDocument,
    packetDigest: await sha256EvidenceValue(signedDocument),
    signature: sign(null, Buffer.from(canonicalizeEvidenceValue(signedDocument)), keys.privateKey).toString(
      "base64url",
    ),
  };
  const destination = resolve(outputDirectory);
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(resolve(destination, PACKET_FILENAME), `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o644 }),
    writeFile(resolve(destination, PUBLIC_KEY_FILENAME), `${publicKey}\n`, { mode: 0o644 }),
  ]);
  return {
    keyId: signing.keyId,
    packetPath: resolve(destination, PACKET_FILENAME),
    publicKeyPath: resolve(destination, PUBLIC_KEY_FILENAME),
  };
}

async function main() {
  const outputDirectory = argumentValue(process.argv.slice(2), "--output-directory") ?? DEFAULT_OUTPUT_DIRECTORY;
  const result = await generateSyntheticEvidenceExample(outputDirectory);
  process.stdout.write(`Generated synthetic v4 evidence example (${result.keyId}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Example generation failed."}\n`);
    process.exitCode = 1;
  });
}
