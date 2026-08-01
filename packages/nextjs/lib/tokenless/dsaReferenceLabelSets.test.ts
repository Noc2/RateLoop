import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION,
  type DsaReferenceLabelInput,
  type DsaSelectedEvaluationUnit,
  type ImmutableDsaReferenceLabel,
  buildDsaReferenceLabelSetEvidence,
  verifyDsaReferenceLabelSetEvidence,
} from "~~/lib/tokenless/dsaReferenceLabelSets";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const CREATED_AT = "2026-07-31T12:00:01.000Z";
const SOURCE_FROZEN_AT = "2026-07-31T12:00:00.000Z";
const WORKSPACE_ID = "workspace_reference_labels";
const EPOCH_ID = `rse_${"1".repeat(40)}`;

function selectedUnit(input: {
  unitCharacter: string;
  evaluationSuffix: string;
  systemId: string;
  systemVersion: string;
  hashCharacter: string;
  outcome: "pass" | "fail";
}): DsaSelectedEvaluationUnit {
  const sourceEvaluationHash = digest(input.hashCharacter);
  return {
    unitId: `rsu_${input.unitCharacter.repeat(22)}`,
    evaluationId: `evaluation_shared_${input.evaluationSuffix}`,
    providerDecisionId: "shared.provider.decision",
    decisionVersion: 1,
    sourceDecisionBinding: digest("a"),
    sourceEvaluationBinding: digest(input.unitCharacter.toLowerCase()),
    sourceEvaluationHash,
    systemIdentity: sha256Rfc8785({ systemId: input.systemId, systemVersion: input.systemVersion }),
    systemId: input.systemId,
    systemVersion: input.systemVersion,
    automatedOutcome: input.outcome,
    evaluationHash: sourceEvaluationHash,
    evaluationProjectionHash: digest(input.hashCharacter === "b" ? "d" : "e"),
    manifestRowHash: digest(input.hashCharacter === "b" ? "f" : "9"),
  };
}

const units = [
  selectedUnit({
    unitCharacter: "B",
    evaluationSuffix: "alpha",
    systemId: "system_alpha",
    systemVersion: "1.0.0",
    hashCharacter: "b",
    outcome: "pass",
  }),
  selectedUnit({
    unitCharacter: "C",
    evaluationSuffix: "beta",
    systemId: "system_beta",
    systemVersion: "2.0.0",
    hashCharacter: "c",
    outcome: "fail",
  }),
] as const;

const labels: readonly DsaReferenceLabelInput[] = [
  {
    unitId: units[0].unitId,
    referenceLabel: "pass",
    agreementState: "agreed",
    adjudicationEvidenceDigest: digest("1"),
  },
  {
    unitId: units[1].unitId,
    referenceLabel: "fail",
    agreementState: "adjudicated",
    adjudicationEvidenceDigest: digest("2"),
  },
];

function build(overrides: Partial<Parameters<typeof buildDsaReferenceLabelSetEvidence>[0]> = {}) {
  return buildDsaReferenceLabelSetEvidence({
    workspaceId: WORKSPACE_ID,
    epochId: EPOCH_ID,
    commitmentDigest: digest("3"),
    sampleDigest: digest("4"),
    manifestRoot: digest("5"),
    referenceDefinitionVersion: "human-reference-v1",
    referenceDefinitionHash: digest("6"),
    selectedUnits: units,
    labels,
    sourceFrozenAt: SOURCE_FROZEN_AT,
    frozenAt: CREATED_AT,
    createdBy: "account:test-manager",
    ...overrides,
  });
}

test("labels remain bound to distinct systems evaluated on the same decision", () => {
  const evidence = build();
  assert.equal(evidence.set.expectedSelectedCount, 2);
  assert.equal(evidence.set.passLabelCount, 1);
  assert.equal(evidence.set.failLabelCount, 1);
  assert.equal(evidence.set.uncertainLabelCount, 0);
  assert.equal(evidence.set.coverageGap, null);
  assert.notEqual(evidence.labels[0]?.evaluationId, evidence.labels[1]?.evaluationId);
  assert.notEqual(evidence.labels[0]?.systemIdentity, evidence.labels[1]?.systemIdentity);
  assert.equal(
    verifyDsaReferenceLabelSetEvidence({ ...evidence, selectedUnits: units }).set.setHash,
    evidence.set.setHash,
  );
});

test("two systems on one decision cannot exchange their selected labels", () => {
  const evidence = build();
  const alpha = evidence.labels[0]!;
  const beta = evidence.labels[1]!;
  const tamperedPayload = {
    ...alpha,
    evaluationId: beta.evaluationId,
    sourceEvaluationBinding: beta.sourceEvaluationBinding,
    sourceEvaluationHash: beta.sourceEvaluationHash,
    systemIdentity: beta.systemIdentity,
    systemId: beta.systemId,
    systemVersion: beta.systemVersion,
    automatedOutcome: beta.automatedOutcome,
    evaluationHash: beta.evaluationHash,
    evaluationProjectionHash: beta.evaluationProjectionHash,
    manifestRowHash: beta.manifestRowHash,
  };
  const payload: Record<string, unknown> = { ...tamperedPayload };
  delete payload.labelJson;
  delete payload.labelHash;
  const tampered: ImmutableDsaReferenceLabel = {
    ...tamperedPayload,
    labelJson: canonicalizeRfc8785(payload),
    labelHash: sha256Rfc8785(payload),
  };
  assert.throws(
    () => verifyDsaReferenceLabelSetEvidence({ set: evidence.set, labels: [tampered, beta], selectedUnits: units }),
    /Stored DSA reference-label evidence is invalid/u,
  );
});

test("unselected, duplicate, and missing labels fail closed", () => {
  assert.throws(
    () => build({ labels: [{ ...labels[0]!, unitId: `rsu_${"Z".repeat(22)}` }, labels[1]!] }),
    /Each label must bind one selected unit/u,
  );
  assert.throws(() => build({ labels: [labels[0]!, labels[0]!] }), /A selected unit may be labeled only once/u);
  assert.throws(() => build({ labels: [labels[0]!] }), /exactly cover/u);
});

test("substituted evaluation evidence fails offline replay", () => {
  const evidence = build();
  const substitutedUnits = [
    units[0],
    {
      ...units[1],
      evaluationProjectionHash: digest("7"),
    },
  ];
  assert.throws(
    () => verifyDsaReferenceLabelSetEvidence({ ...evidence, selectedUnits: substitutedUnits }),
    /Stored DSA reference-label evidence is invalid/u,
  );
});

test("uncertain is retained as a coverage gap and requires adjudication", () => {
  const uncertainLabels: readonly DsaReferenceLabelInput[] = [
    labels[0]!,
    { ...labels[1]!, referenceLabel: "uncertain", agreementState: "adjudicated" },
  ];
  const evidence = build({ labels: uncertainLabels });
  assert.equal(evidence.set.uncertainLabelCount, 1);
  assert.equal(evidence.set.failLabelCount, 0);
  assert.equal(evidence.set.coverageGap, "uncertain_reference_labels");
  assert.throws(
    () => build({ labels: [labels[0]!, { ...uncertainLabels[1]!, agreementState: "agreed" }] }),
    /valid adjudication evidence/u,
  );
});

test("label evidence has no adaptive promotion or operational use state", () => {
  const serialized = canonicalizeRfc8785(build()).toLowerCase();
  assert.doesNotMatch(serialized, /adaptive|promotion|operational[_-]?(?:use|state)/u);
  assert.equal(build().set.schemaVersion, DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION);
});
