import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BenchmarkResearchApprovedExport,
  type BenchmarkResearchGrantAccessAudit,
  type BenchmarkResearchGrantAccessContext,
  type BenchmarkResearchGrantAccessSnapshot,
  type BenchmarkResearchGrantCommittedTransactionExecutor,
  type BenchmarkResearchGrantCreationContext,
  type BenchmarkResearchGrantDeniedAccessAudit,
  type BenchmarkResearchGrantDeniedAccessAuditReceipt,
  type BenchmarkResearchGrantEvidence,
  type BenchmarkResearchGrantReadTransaction,
  type BenchmarkResearchGrantTransactionCommitReceipt,
  type BenchmarkResearchGrantWriteTransaction,
  assertBenchmarkResearchPublicProjectionSafe,
  createBenchmarkResearchGrantInTransaction,
  createBenchmarkResearchGrantPersistenceFacade,
  verifyBenchmarkResearchGrantAuthorization,
} from "~~/lib/tokenless/benchmarkResearchGrants";
import {
  type ReferenceFrameSourceBinding,
  type ReferenceFrameUnit,
  createReferenceFrameCommitment,
  deriveReferenceSystemIdentity,
  freezeReferenceSample,
} from "~~/lib/tokenless/referenceSampling";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = `rlp_${"a".repeat(48)}`;
const ADMIN = `rlp_${"b".repeat(48)}`;
const RECIPIENT = `rlp_${"c".repeat(48)}`;
const OTHER_RECIPIENT = `rlp_${"d".repeat(48)}`;
const NOW = new Date("2023-07-15T12:00:00.000Z");
const KEY = { keyId: "binding_epoch_1", secret: new Uint8Array(32).fill(7) };
const chain = PINNED_DRAND_CHAINS["quicknet-t"];

function unit(character: string, outcome: "pass" | "fail", day: number): ReferenceFrameUnit {
  const systemId = "system_grant";
  const systemVersion = "1.0.0";
  return {
    unitId: `rsu_${character.repeat(22)}`,
    sourceDecisionBinding: `sha256:${character.repeat(64)}` as `sha256:${string}`,
    sourceEvaluationBinding: `sha256:${character.repeat(64)}`,
    sourceEvaluationHash: `sha256:${character.repeat(64)}`,
    decidedAt: `2023-06-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    automationProcessing: "solely_automated",
    systemIdentity: deriveReferenceSystemIdentity({ systemId, systemVersion }),
    systemId,
    systemVersion,
    machineClass: "text_classifier",
    publicDesignation: "Grant test classifier",
    automatedOutcome: outcome,
    referenceLabelState: "unlabeled",
  };
}

const units = [unit("a", "pass", 1), unit("b", "pass", 2), unit("c", "fail", 3)];
const referenceSource: ReferenceFrameSourceBinding = {
  workspaceId: "ws_reference",
  projectId: "project_reference",
  benchmarkId: "benchmark_public_safe_1",
  activationReference: "activation_public_safe_1",
  deploymentKey: "deployment_tokenless_1",
  contextAuthority: "workspace_manager_asserted_context",
  populationId: "population_reference_1",
  populationVersion: 1,
  populationContractHash: `sha256:${"0".repeat(64)}`,
  populationRoot: `sha256:${"1".repeat(64)}`,
  reportingWindow: { startInclusive: "2023-06-01T00:00:00.000Z", endExclusive: "2023-07-01T00:00:00.000Z" },
  populationFrozenAt: "2023-07-01T00:00:00.000Z",
  populationCount: 3,
  eligibleDrawUnitCount: 3,
  evaluatedDecisionCount: 3,
  notAutomatedDecisionCount: 0,
  excludedDecisionCount: 0,
};
const commitment = createReferenceFrameCommitment({
  frameId: "frame_public_benchmark_1",
  purpose: "public_safe_benchmark",
  source: referenceSource,
  witness: {
    kind: "database_transaction_and_attestation",
    witnessId: "witness_frame_commit_1",
    sourceFrozenAt: "2023-07-01T00:00:01.000Z",
    committedAt: "2023-07-01T00:00:01.000Z",
    auditHeadDigest: `sha256:${"2".repeat(64)}`,
  },
  units,
  sampleSizes: [{ systemId: "system_grant", systemVersion: "1.0.0", automatedPass: 1, automatedFail: 1 }],
  sampleSizePlanId: "sample_plan_pilot_1",
  sampleSizePlanVersion: 1,
  beaconNetwork: "quicknet-t",
  beaconRound: 1,
});
const frozen = freezeReferenceSample({
  commitment,
  units,
  beacon: {
    network: "quicknet-t",
    chainInfo: {
      public_key: chain.publicKey,
      period: chain.period,
      genesis_time: chain.genesisTime,
      hash: chain.chainHash,
      groupHash: chain.groupHash,
      schemeID: chain.schemeId,
      metadata: { beaconID: chain.beaconId },
    },
    evidence: {
      round: 1,
      randomness: "5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b",
      signature: "81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21",
    },
    expectedRound: 1,
  },
  frozenWitness: {
    kind: "database_transaction_and_attestation",
    witnessId: "witness_sample_freeze_1",
    frozenAt: "2023-07-14T00:00:00.000Z",
    auditHeadDigest: `sha256:${"3".repeat(64)}`,
  },
});

function approvedExport(overrides: Partial<BenchmarkResearchApprovedExport> = {}): BenchmarkResearchApprovedExport {
  const artifact = {
    schemaVersion: "rateloop.approved-public-safe-reference-export.v1" as const,
    exportId: "export_reference_1",
    workspaceId: referenceSource.workspaceId,
    projectId: referenceSource.projectId,
    benchmarkId: referenceSource.benchmarkId,
    activationReference: referenceSource.activationReference,
    referenceCommitment: commitment,
    frozenReferenceSample: frozen,
    referenceLabels: frozen.manifest
      .filter(row => row.selected)
      .map(row => ({ unitId: row.unitId, referenceLabel: row.automatedOutcome, agreement: true })) as readonly {
      unitId: string;
      referenceLabel: "pass" | "fail";
      agreement: true;
    }[],
  };
  const artifactDigest = sha256Rfc8785({ domain: "rateloop.approved-public-safe-reference-artifact.v1", ...artifact });
  const base = {
    ...artifact,
    approval: {
      status: "approved_immutable" as const,
      dataClassification: "public_safe" as const,
      derivation: "verified_committed_and_frozen_reference_sample" as const,
      commitmentDigest: commitment.commitmentDigest,
      sampleDigest: frozen.sampleDigest,
      approvalId: "approval_reference_1",
      approvedBy: OWNER,
      approvedAt: "2023-07-14T01:00:00.000Z",
      auditBinding: {
        eventId: "audit_event_reference_1",
        eventDigest: `sha256:${"4".repeat(64)}` as const,
        artifactDigest,
      },
      attestationBinding: {
        jobId: "attestation_job_reference_1",
        kind: "audit_export_head" as const,
        artifactDigest: `sha256:${"4".repeat(64)}` as const,
      },
    },
  };
  const merged = { ...base, ...overrides };
  const digestPayload = { ...merged } as typeof merged & { exportDigest?: string };
  delete digestPayload.exportDigest;
  return { ...merged, exportDigest: sha256Rfc8785(digestPayload) };
}

type Purpose = "methodology_validation" | "sample_reproduction" | "reference_label_analysis";

function creationContext(
  purpose: Purpose,
  overrides: Partial<BenchmarkResearchGrantCreationContext> = {},
): BenchmarkResearchGrantCreationContext {
  return {
    transactionTime: NOW,
    manager: { principalId: OWNER, workspaceId: referenceSource.workspaceId, status: "active", role: "owner" },
    recipient: {
      principalId: RECIPIENT,
      status: "active",
      agreement: {
        agreementId: "agreement_public_safe_research_1",
        version: 1,
        status: "accepted",
        acceptedAt: "2023-07-14T12:00:00.000Z",
        workspaceId: referenceSource.workspaceId,
        projectId: referenceSource.projectId,
        benchmarkId: referenceSource.benchmarkId,
        purpose,
        dataClassification: "public_safe",
      },
    },
    workspace: { workspaceId: referenceSource.workspaceId, status: "active" },
    project: { projectId: referenceSource.projectId, workspaceId: referenceSource.workspaceId, status: "active" },
    activation: {
      activationReference: referenceSource.activationReference,
      workspaceId: referenceSource.workspaceId,
      projectId: referenceSource.projectId,
      benchmarkId: referenceSource.benchmarkId,
      deploymentKey: referenceSource.deploymentKey,
      status: "active",
      publicSafeOnly: true,
    },
    export: approvedExport(),
    ...overrides,
  };
}

function transaction(
  context?: (purpose: Purpose) => BenchmarkResearchGrantCreationContext,
): BenchmarkResearchGrantWriteTransaction {
  return {
    async authorizeGrantCreationForUpdate(input) {
      return context ? context(input.purpose) : creationContext(input.purpose);
    },
    async appendGrant() {},
    async authorizeGrantRevocationForUpdate() {
      return null;
    },
    async appendRevocation() {},
  };
}

async function issue(purpose: Purpose = "reference_label_analysis") {
  return createBenchmarkResearchGrantInTransaction({
    transaction: transaction(),
    authenticatedManagerPrincipalId: OWNER,
    recipientPrincipalId: RECIPIENT,
    exportId: "export_reference_1",
    grantId: "brg_AAAAAAAAAAAAAAAAAAAAAA",
    purpose,
    durationMs: 86_400_000,
    recipientBindingKey: KEY,
  });
}

function redigest(grant: BenchmarkResearchGrantEvidence): BenchmarkResearchGrantEvidence {
  const payload = Object.fromEntries(Object.entries(grant).filter(([key]) => key !== "eventDigest")) as Omit<
    BenchmarkResearchGrantEvidence,
    "eventDigest"
  >;
  return { ...payload, eventDigest: sha256Rfc8785(payload) };
}

function accessContext(
  grant: BenchmarkResearchGrantEvidence,
  overrides: Partial<BenchmarkResearchGrantAccessContext> = {},
): BenchmarkResearchGrantAccessContext {
  const active = creationContext(grant.purpose);
  return {
    transactionTime: new Date(NOW.getTime() + 60_000),
    recipient: active.recipient,
    workspace: active.workspace,
    project: active.project,
    activation: active.activation,
    export: active.export,
    state: { grant, revocation: null },
    ...overrides,
  };
}

function fakePersistence(input: {
  context: BenchmarkResearchGrantAccessContext | null;
  recheck?: BenchmarkResearchGrantAccessContext | null;
  failCommit?: boolean;
  corruptSuccessReceipt?: boolean;
}) {
  const audits: BenchmarkResearchGrantAccessAudit[] = [];
  const denials: BenchmarkResearchGrantDeniedAccessAudit[] = [];
  const snapshots: BenchmarkResearchGrantAccessSnapshot[] = [];
  const events: string[] = [];
  let pendingSnapshot: BenchmarkResearchGrantAccessSnapshot | null = null;
  let pendingEventDigest: `sha256:${string}` | null = null;
  let transactionNumber = 0;

  const transaction: BenchmarkResearchGrantReadTransaction = {
    async loadCommittedAccessReplayForUpdate(request) {
      const existing = snapshots.find(
        snapshot =>
          snapshot.binding.accessId === request.accessId || snapshot.binding.idempotencyKey === request.idempotencyKey,
      );
      if (!existing) return null;
      const exact =
        existing.binding.accessId === request.accessId &&
        existing.binding.idempotencyKey === request.idempotencyKey &&
        existing.binding.grantId === request.grantId &&
        existing.binding.recipientLookupDigest === request.recipientLookupDigest &&
        JSON.stringify(existing.binding.page) === JSON.stringify(request.page);
      return exact
        ? { result: "exact_replay", snapshot: structuredClone(existing) }
        : { result: "conflict", existingRequestBindingDigest: existing.requestBindingDigest };
    },
    async loadActiveGrantAccessContext() {
      return input.context === null ? null : structuredClone(input.context);
    },
    async recheckActiveGrantAccessContextForUpdate() {
      events.push("active_recheck");
      const value = input.recheck === undefined ? input.context : input.recheck;
      return value === null ? null : structuredClone(value);
    },
    async appendSuccessfulAccessAudit(audit, snapshot) {
      events.push("append_success");
      audits.push(structuredClone(audit));
      const auditEventDigest = sha256Rfc8785({
        domain: "test.research-access-event.v1",
        auditDigest: audit.auditDigest,
      });
      const receipt = {
        schemaVersion: "rateloop.benchmark-research-access-audit-receipt.v1" as const,
        persistenceState: "staged_not_committed" as const,
        accessId: audit.accessId,
        idempotencyKey: audit.idempotencyKey,
        auditDigest: input.corruptSuccessReceipt ? (`sha256:${"f".repeat(64)}` as const) : audit.auditDigest,
        auditEventId: "access_audit_event_1",
        auditEventDigest,
        previousEventDigest: null,
        chainHeadDigest: auditEventDigest,
      };
      pendingSnapshot = structuredClone({ ...snapshot, auditReceipt: receipt });
      pendingEventDigest = auditEventDigest;
      return receipt;
    },
    async appendDeniedAccessAudit(audit): Promise<BenchmarkResearchGrantDeniedAccessAuditReceipt> {
      events.push("append_denial");
      denials.push(structuredClone(audit));
      const denialEventDigest = sha256Rfc8785({
        domain: "test.research-denial-event.v1",
        denialDigest: audit.denialDigest,
      });
      pendingEventDigest = denialEventDigest;
      return {
        schemaVersion: "rateloop.benchmark-research-denied-access-audit-receipt.v1",
        persistenceState: "staged_not_committed",
        accessId: audit.accessId,
        idempotencyKey: audit.idempotencyKey,
        denialDigest: audit.denialDigest,
        denialEventId: "denied_access_audit_event_1",
        denialEventDigest,
        previousEventDigest: null,
        chainHeadDigest: denialEventDigest,
      };
    },
  };

  const executor: BenchmarkResearchGrantCommittedTransactionExecutor = {
    async withCommittedTransaction<T>(work: (value: BenchmarkResearchGrantReadTransaction) => Promise<T>) {
      transactionNumber += 1;
      pendingSnapshot = null;
      pendingEventDigest = null;
      events.push("transaction_begin");
      const value = await work(transaction);
      events.push("commit_attempt");
      if (input.failCommit) {
        events.push("commit_failure");
        throw new Error("commit failed");
      }
      if (pendingSnapshot) snapshots.push(structuredClone(pendingSnapshot));
      events.push("commit_success");
      const commitReceipt: BenchmarkResearchGrantTransactionCommitReceipt = {
        schemaVersion: "rateloop.benchmark-research-transaction-commit-receipt.v1",
        status: "committed",
        transactionId: `research_access_transaction_${transactionNumber}`,
        committedAt: new Date(NOW.getTime() + 120_000 + transactionNumber).toISOString(),
        stagedEventDigest: pendingEventDigest,
      };
      return { value, commitReceipt };
    },
  };
  return { executor, audits, denials, snapshots, events };
}

function accessRequest(
  overrides: Partial<
    Parameters<ReturnType<typeof createBenchmarkResearchGrantPersistenceFacade>["readAfterCommittedAudit"]>[0]
  > = {},
) {
  return {
    accessId: "bra_AAAAAAAAAAAAAAAAAAAAAA",
    idempotencyKey: "benchmark-access-request-1",
    grantId: "brg_AAAAAAAAAAAAAAAAAAAAAA",
    authenticatedRecipientPrincipalId: RECIPIENT,
    page: { offset: 0, limit: 2 },
    ...overrides,
  };
}

test("creation binds tenant, agreement, export evidence and all authorization fields with a domain-separated MAC", async () => {
  const grant = await issue();
  assert.equal(grant.workspaceId, referenceSource.workspaceId);
  assert.equal(grant.deploymentKey, referenceSource.deploymentKey);
  assert.equal(grant.recipientAgreement.workspaceId, referenceSource.workspaceId);
  assert.equal(grant.recipientAgreement.purpose, grant.purpose);
  assert.deepEqual(grant.referenceEvidence, {
    methodVersion: commitment.methodVersion,
    frameRoot: commitment.frameRoot,
    commitmentDigest: commitment.commitmentDigest,
    manifestRoot: frozen.manifestRoot,
    sampleDigest: frozen.sampleDigest,
  });
  verifyBenchmarkResearchGrantAuthorization({ grant, recipientPrincipalId: RECIPIENT, bindingKey: KEY });

  const tampered = [
    redigest({ ...grant, authorizedBy: ADMIN }),
    redigest({ ...grant, activationReference: "activation_public_safe_2" }),
    redigest({ ...grant, expiresAt: new Date(Date.parse(grant.expiresAt) + 1_000).toISOString() }),
    redigest({ ...grant, deploymentKey: "deployment_tokenless_2" }),
    redigest({ ...grant, exportDigest: `sha256:${"9".repeat(64)}` }),
    redigest({ ...grant, referenceEvidence: { ...grant.referenceEvidence, frameRoot: `sha256:${"8".repeat(64)}` } }),
    redigest({
      ...grant,
      recipientAgreement: { ...grant.recipientAgreement, agreementId: "agreement_public_safe_research_2" },
    }),
    redigest({
      ...grant,
      purpose: "methodology_validation",
      scopes: ["methodology_summary"],
      recipientAgreement: { ...grant.recipientAgreement, purpose: "methodology_validation" },
      disclosure: { ...grant.disclosure, publicSamplingPseudonyms: "excluded" },
    }),
  ];
  for (const candidate of tampered) {
    assert.throws(
      () =>
        verifyBenchmarkResearchGrantAuthorization({
          grant: candidate,
          recipientPrincipalId: RECIPIENT,
          bindingKey: KEY,
        }),
      /authorization is invalid/iu,
    );
  }
  assert.throws(
    () => verifyBenchmarkResearchGrantAuthorization({ grant, recipientPrincipalId: OTHER_RECIPIENT, bindingKey: KEY }),
    /authorization is invalid/iu,
  );
});

test("manager tenancy and agreement purpose are authoritative transaction facts", async () => {
  const wrongManagerTenant = transaction(purpose =>
    creationContext(purpose, {
      manager: { principalId: OWNER, workspaceId: "ws_other", status: "active", role: "owner" },
    }),
  );
  await assert.rejects(
    () =>
      createBenchmarkResearchGrantInTransaction({
        transaction: wrongManagerTenant,
        authenticatedManagerPrincipalId: OWNER,
        recipientPrincipalId: RECIPIENT,
        exportId: "export_reference_1",
        grantId: "brg_AAAAAAAAAAAAAAAAAAAAAA",
        purpose: "sample_reproduction",
        durationMs: 86_400_000,
        recipientBindingKey: KEY,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
  );

  const wrongAgreementPurpose = transaction(purpose => {
    const active = creationContext(purpose);
    return creationContext(purpose, {
      recipient: {
        ...active.recipient,
        agreement: { ...active.recipient.agreement, purpose: "methodology_validation" },
      },
    });
  });
  await assert.rejects(
    () =>
      createBenchmarkResearchGrantInTransaction({
        transaction: wrongAgreementPurpose,
        authenticatedManagerPrincipalId: OWNER,
        recipientPrincipalId: RECIPIENT,
        exportId: "export_reference_1",
        grantId: "brg_AAAAAAAAAAAAAAAAAAAAAA",
        purpose: "reference_label_analysis",
        durationMs: 86_400_000,
        recipientBindingKey: KEY,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
  );
});

test("approval audit and attestation bindings must identify the exact immutable artifact", async () => {
  const valid = approvedExport();
  const staleArtifact = approvedExport({
    approval: {
      ...valid.approval,
      auditBinding: { ...valid.approval.auditBinding, artifactDigest: `sha256:${"7".repeat(64)}` },
    },
  });
  const staleAuditHead = approvedExport({
    approval: {
      ...valid.approval,
      attestationBinding: { ...valid.approval.attestationBinding, artifactDigest: `sha256:${"7".repeat(64)}` },
    },
  });
  for (const source of [staleArtifact, staleAuditHead]) {
    await assert.rejects(
      () =>
        createBenchmarkResearchGrantInTransaction({
          transaction: transaction(purpose => creationContext(purpose, { export: source })),
          authenticatedManagerPrincipalId: OWNER,
          recipientPrincipalId: RECIPIENT,
          exportId: "export_reference_1",
          grantId: "brg_AAAAAAAAAAAAAAAAAAAAAA",
          purpose: "methodology_validation",
          durationMs: 86_400_000,
          recipientBindingKey: KEY,
        }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
    );
  }
});

test("public projection guard rejects stable source bindings and the transaction primitive is not exported", async () => {
  const safe = {
    schemaVersion: "rateloop.benchmark-research-view.v2",
    purpose: "sample_reproduction",
    methodology: { methodVersion: "reference_stratified_v1", methodologyDigest: `sha256:${"6".repeat(64)}` },
    referenceSample: {
      commitmentDigest: commitment.commitmentDigest,
      beacon: frozen.beacon,
      seedDigest: frozen.seedDigest,
      manifestPage: { rows: [{ unitId: frozen.manifest[0]!.unitId, selected: true }] },
    },
  };
  assert.doesNotThrow(() => assertBenchmarkResearchPublicProjectionSafe(safe));
  for (const field of [
    "workspaceId",
    "projectId",
    "activationReference",
    "deploymentKey",
    "populationId",
    "sourceDecisionBinding",
    "sourceEvaluationBinding",
    "sourceEvaluationHash",
    "auditHeadDigest",
    "exportDigest",
  ]) {
    assert.throws(
      () => assertBenchmarkResearchPublicProjectionSafe({ ...safe, [field]: "stable-binding" }),
      /forbidden field/iu,
    );
  }
  const grantModule = await import("~~/lib/tokenless/benchmarkResearchGrants");
  assert.equal("loadBenchmarkResearchViewForAuthenticatedRecipientInTransaction" in grantModule, false);
});

test("successful access stages matching audit and snapshot evidence before committed bytes are exposed", async () => {
  const grant = await issue("sample_reproduction");
  const persistence = fakePersistence({ context: accessContext(grant) });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  const result = await facade.readAfterCommittedAudit(accessRequest());
  const decoded = JSON.parse(new TextDecoder().decode(result.bytes)) as Record<string, unknown>;
  assert.equal(result.replayed, false);
  assert.equal(result.accessedAt, new Date(NOW.getTime() + 60_000).toISOString());
  assert.equal(decoded.accessedAt, result.accessedAt);
  assert.equal(persistence.audits.length, 1);
  assert.equal(persistence.snapshots.length, 1);
  assert.equal(persistence.audits[0]!.requestBindingDigest, persistence.snapshots[0]!.requestBindingDigest);
  assert.equal(persistence.audits[0]!.viewDigest, persistence.snapshots[0]!.viewDigest);
  assert.equal(result.commitReceipt.auditEventId, persistence.snapshots[0]!.auditReceipt.auditEventId);
  assert.equal(result.commitReceipt.auditEventDigest, persistence.snapshots[0]!.auditReceipt.auditEventDigest);
  assert.deepEqual(persistence.events, [
    "transaction_begin",
    "active_recheck",
    "append_success",
    "commit_attempt",
    "commit_success",
  ]);
  assert.doesNotMatch(
    new TextDecoder().decode(result.bytes),
    /workspaceId|projectId|benchmarkId|activationReference|deploymentKey|populationId|sourceDecisionBinding|automatedOutcome|auditHeadDigest|frozenWitness|manifestRoot|sampleDigest/u,
  );
});

test("denial is staged and committed before the facade maps it to the uniform not-found response", async () => {
  const persistence = fakePersistence({ context: null });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  await assert.rejects(
    () => facade.readAfterCommittedAudit(accessRequest()),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.status === 404 &&
      error.code === "benchmark_research_grant_not_found",
  );
  assert.equal(persistence.denials.length, 1);
  const { denialDigest, ...denialPayload } = persistence.denials[0]!;
  assert.equal(denialDigest, sha256Rfc8785(denialPayload));
  assert.deepEqual(persistence.events, ["transaction_begin", "append_denial", "commit_attempt", "commit_success"]);
});

test("commit failure exposes neither bytes nor a durable replay snapshot", async () => {
  const grant = await issue("sample_reproduction");
  const persistence = fakePersistence({ context: accessContext(grant), failCommit: true });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  await assert.rejects(() => facade.readAfterCommittedAudit(accessRequest()), /commit failed/u);
  assert.equal(persistence.audits.length, 1);
  assert.equal(persistence.snapshots.length, 0);
  assert.deepEqual(persistence.events.slice(-3), ["append_success", "commit_attempt", "commit_failure"]);
});

test("a concurrent revocation at the locked recheck stages denial instead of success", async () => {
  const grant = await issue("sample_reproduction");
  const persistence = fakePersistence({ context: accessContext(grant), recheck: null });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  await assert.rejects(
    () => facade.readAfterCommittedAudit(accessRequest()),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 404,
  );
  assert.equal(persistence.audits.length, 0);
  assert.equal(persistence.denials[0]!.reason, "inactive");
  assert.ok(persistence.events.indexOf("active_recheck") < persistence.events.indexOf("append_denial"));
});

test("an exact retry reuses the first accessedAt and identical canonical bytes without a second success audit", async () => {
  const grant = await issue("reference_label_analysis");
  const persistence = fakePersistence({ context: accessContext(grant) });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  const request = accessRequest();
  const first = await facade.readAfterCommittedAudit(request);
  const retry = await facade.readAfterCommittedAudit(request);
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.accessedAt, first.accessedAt);
  assert.deepEqual(retry.bytes, first.bytes);
  assert.equal(persistence.audits.length, 1);
  assert.equal(persistence.denials.length, 0);
});

test("reuse of an access identity for a different page commits an idempotency-conflict denial", async () => {
  const grant = await issue("sample_reproduction");
  const persistence = fakePersistence({ context: accessContext(grant) });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  await facade.readAfterCommittedAudit(accessRequest());
  await assert.rejects(
    () => facade.readAfterCommittedAudit(accessRequest({ page: { offset: 1, limit: 2 } })),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.status === 409 &&
      error.code === "benchmark_research_access_idempotency_conflict",
  );
  assert.equal(persistence.denials.at(-1)!.reason, "idempotency_conflict");
  assert.deepEqual(persistence.events.slice(-4), [
    "transaction_begin",
    "append_denial",
    "commit_attempt",
    "commit_success",
  ]);
});

test("approval substitution is denied and audited before projection", async () => {
  const grant = await issue("sample_reproduction");
  const valid = approvedExport();
  const substituted = approvedExport({
    approval: {
      ...valid.approval,
      attestationBinding: { ...valid.approval.attestationBinding, artifactDigest: `sha256:${"e".repeat(64)}` },
    },
  });
  const persistence = fakePersistence({ context: accessContext(grant, { export: substituted }) });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  await assert.rejects(
    () => facade.readAfterCommittedAudit(accessRequest()),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 404,
  );
  assert.equal(persistence.audits.length, 0);
  assert.equal(persistence.denials.length, 1);
});

test("mismatched staged success receipt fails before commit", async () => {
  const grant = await issue("sample_reproduction");
  const persistence = fakePersistence({ context: accessContext(grant), corruptSuccessReceipt: true });
  const facade = createBenchmarkResearchGrantPersistenceFacade({
    executor: persistence.executor,
    resolveRecipientBindingKey: () => KEY.secret,
  });
  await assert.rejects(() => facade.readAfterCommittedAudit(accessRequest()), /does not bind the staged audit/u);
  assert.equal(persistence.snapshots.length, 0);
  assert.equal(persistence.events.includes("commit_attempt"), false);
});
