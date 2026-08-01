import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DSA_PART8_CLASSIFIER_INVENTORY_ENTRY_SCHEMA_VERSION,
  DSA_PART8_CLASSIFIER_INVENTORY_SCHEMA_VERSION,
  DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
  type DsaPart8ClassifierInventorySystemInput,
  type DsaPart8NoticeProcessingFactInput,
  __dsaPart8InventoryAndNoticesTestUtils,
  computeDsaPart8ClassifierInventoryRoot,
  normalizeDsaPart8ClassifierInventorySystems,
  sealDsaPart8NoticeProcessingFact,
} from "~~/lib/tokenless/dsaPart8InventoryAndNotices";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;
const SOURCE_FROZEN_AT = new Date("2026-07-31T23:59:59.000Z");
const FROZEN_AT = new Date("2026-08-01T00:00:00.000Z");

const TEXT_SYSTEM: DsaPart8ClassifierInventorySystemInput = {
  systemId: "classifier.text",
  systemVersion: "2026.07",
  machineClass: "text_classifier",
  publicDesignation: "Text safety classifier",
};
const IMAGE_SYSTEM: DsaPart8ClassifierInventorySystemInput = {
  systemId: "classifier.image",
  systemVersion: "2026.06",
  machineClass: "image_classifier",
  publicDesignation: "Image safety classifier",
};

function noticeFact(overrides: Partial<DsaPart8NoticeProcessingFactInput> = {}): DsaPart8NoticeProcessingFactInput {
  return {
    noticeId: "notice_00000001",
    factVersion: 1,
    serviceId: "content-moderation",
    receivedAt: new Date("2026-07-30T10:00:00.000Z"),
    sourceNoticeBinding: SHA_A,
    processingStatus: "processed_final",
    automationProcessing: "partially_automated",
    notifierClass: "trusted_flagger",
    supersedesFactVersion: null,
    correctionReason: null,
    ...overrides,
  };
}

function isInvalidInventory(error: unknown) {
  return error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_classifier_inventory";
}

function isInvalidNotice(error: unknown) {
  return error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_notice_processing_fact";
}

test("freezes a portable classifier inventory with an explicit zero-observation gap", () => {
  const inventory = __dsaPart8InventoryAndNoticesTestUtils.buildFrozenInventory({
    workspaceId: "workspace_1",
    populationId: "population_1",
    populationVersion: 2,
    populationRoot: SHA_A,
    populationFrozenAt: new Date("2026-07-31T20:00:00.000Z"),
    serviceId: "content-moderation",
    sourceRegistryDigest: SHA_B,
    sourceFrozenAt: SOURCE_FROZEN_AT,
    frozenAt: FROZEN_AT,
    declaredSystems: [TEXT_SYSTEM, IMAGE_SYSTEM],
    observedSystems: [{ ...TEXT_SYSTEM, observedEvaluationCount: 3 }],
  });

  assert.equal(inventory.schemaVersion, DSA_PART8_CLASSIFIER_INVENTORY_SCHEMA_VERSION);
  assert.match(inventory.inventoryId, /^dci_[0-9a-f]{40}$/u);
  assert.equal(inventory.sourceFrozenAt, SOURCE_FROZEN_AT.toISOString());
  assert.equal(inventory.frozenAt, FROZEN_AT.toISOString());
  assert.equal(inventory.expectedSystemCount, 2);
  assert.deepEqual(
    inventory.systems.map(system => ({
      systemId: system.systemId,
      count: system.observedEvaluationCount,
      state: system.observationState,
      gap: system.gapCode,
    })),
    [
      { systemId: "classifier.image", count: 0, state: "unobserved", gap: "zero_observations" },
      { systemId: "classifier.text", count: 3, state: "observed", gap: null },
    ],
  );
  assert.ok(
    inventory.systems.every(
      system =>
        system.schemaVersion === DSA_PART8_CLASSIFIER_INVENTORY_ENTRY_SCHEMA_VERSION &&
        /^sha256:[0-9a-f]{64}$/u.test(system.entryHash),
    ),
  );
  assert.match(inventory.inventoryDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("accepts an authoritative empty classifier registry for a zero-decision period", () => {
  const inventory = __dsaPart8InventoryAndNoticesTestUtils.buildFrozenInventory({
    workspaceId: "workspace_1",
    populationId: "population_empty",
    populationVersion: 1,
    populationRoot: SHA_A,
    populationFrozenAt: new Date("2026-07-31T20:00:00.000Z"),
    serviceId: "empty-service",
    sourceRegistryDigest: SHA_B,
    sourceFrozenAt: SOURCE_FROZEN_AT,
    frozenAt: FROZEN_AT,
    declaredSystems: [],
    observedSystems: [],
  });
  assert.equal(inventory.expectedSystemCount, 0);
  assert.deepEqual(inventory.systems, []);
});

test("canonical inventory ordering, roots, and scoped IDs do not depend on caller order", () => {
  assert.deepEqual(normalizeDsaPart8ClassifierInventorySystems([TEXT_SYSTEM, IMAGE_SYSTEM]), [
    IMAGE_SYSTEM,
    TEXT_SYSTEM,
  ]);
  assert.equal(
    computeDsaPart8ClassifierInventoryRoot([TEXT_SYSTEM, IMAGE_SYSTEM]),
    computeDsaPart8ClassifierInventoryRoot([IMAGE_SYSTEM, TEXT_SYSTEM]),
  );
  assert.equal(
    __dsaPart8InventoryAndNoticesTestUtils.inventoryId({
      workspaceId: "workspace_1",
      populationId: "population_1",
      populationVersion: 1,
      serviceId: "content-moderation",
    }),
    __dsaPart8InventoryAndNoticesTestUtils.inventoryId({
      workspaceId: "workspace_1",
      populationId: "population_1",
      populationVersion: 1,
      serviceId: "content-moderation",
    }),
  );
});

test("rejects inventory omissions, observed metadata conflicts, duplicate designations, and unsafe designations", () => {
  assert.throws(
    () =>
      __dsaPart8InventoryAndNoticesTestUtils.buildInventoryEntries(
        [],
        [{ ...TEXT_SYSTEM, observedEvaluationCount: 1 }],
      ),
    isInvalidInventory,
  );
  assert.throws(
    () =>
      normalizeDsaPart8ClassifierInventorySystems([
        { ...TEXT_SYSTEM, publicDesignation: "Safety" },
        { ...IMAGE_SYSTEM, publicDesignation: "safety" },
      ]),
    isInvalidInventory,
  );
  assert.throws(
    () =>
      __dsaPart8InventoryAndNoticesTestUtils.buildInventoryEntries(
        [TEXT_SYSTEM],
        [{ ...TEXT_SYSTEM, publicDesignation: "Changed designation", observedEvaluationCount: 1 }],
      ),
    isInvalidInventory,
  );
  assert.throws(
    () =>
      normalizeDsaPart8ClassifierInventorySystems([
        TEXT_SYSTEM,
        { ...IMAGE_SYSTEM, publicDesignation: TEXT_SYSTEM.publicDesignation },
      ]),
    isInvalidInventory,
  );
  for (const publicDesignation of ["=1+1", "+cmd", "-2", "@lookup", "contains\u0000control"]) {
    assert.throws(
      () => normalizeDsaPart8ClassifierInventorySystems([{ ...TEXT_SYSTEM, publicDesignation }]),
      isInvalidInventory,
      publicDesignation,
    );
  }
});

test("seals final and incomplete notice-processing facts with typed, immutable state", () => {
  for (const automationProcessing of ["solely_automated", "partially_automated", "not_automated"] as const) {
    const sealed = sealDsaPart8NoticeProcessingFact(noticeFact({ automationProcessing }));
    assert.equal(sealed.schemaVersion, DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION);
    assert.equal(sealed.automationProcessing, automationProcessing);
    assert.match(sealed.factHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(sealed.factHash, sealDsaPart8NoticeProcessingFact(noticeFact({ automationProcessing })).factHash);
  }
  const incomplete = sealDsaPart8NoticeProcessingFact(
    noticeFact({ processingStatus: "processing_incomplete", automationProcessing: null }),
  );
  assert.equal(incomplete.automationProcessing, null);
});

test("requires exact notice state and correction lineage without caller prose fields", () => {
  for (const input of [
    noticeFact({ processingStatus: "processed_final", automationProcessing: null }),
    noticeFact({ processingStatus: "processing_incomplete", automationProcessing: "not_automated" }),
    noticeFact({ factVersion: 2, supersedesFactVersion: null, correctionReason: "correct classification" }),
    noticeFact({ factVersion: 2, supersedesFactVersion: 1, correctionReason: " " }),
    { ...noticeFact(), freeText: "unsupported prose" },
  ]) {
    assert.throws(() => sealDsaPart8NoticeProcessingFact(input as DsaPart8NoticeProcessingFactInput), isInvalidNotice);
  }

  const correction = sealDsaPart8NoticeProcessingFact(
    noticeFact({
      factVersion: 2,
      sourceNoticeBinding: SHA_B,
      supersedesFactVersion: 1,
      correctionReason: "  Correct notifier class  ",
    }),
  );
  assert.equal(correction.supersedesFactVersion, 1);
  assert.equal(correction.correctionReason, "Correct notifier class");
});

test("corrections preserve every immutable notice identity field", () => {
  const original = sealDsaPart8NoticeProcessingFact(noticeFact());
  const identity = {
    serviceId: original.serviceId,
    receivedAt: original.receivedAt,
    sourceNoticeBinding: original.sourceNoticeBinding,
    notifierClass: original.notifierClass,
  };
  assert.equal(__dsaPart8InventoryAndNoticesTestUtils.noticeIdentityMatches(original, identity), true);
  for (const substituted of [
    { ...identity, serviceId: "other-service" },
    { ...identity, receivedAt: "2026-07-30T10:00:01.000Z" },
    { ...identity, sourceNoticeBinding: SHA_B },
    { ...identity, notifierClass: "other" },
  ]) {
    assert.equal(__dsaPart8InventoryAndNoticesTestUtils.noticeIdentityMatches(original, substituted), false);
  }
});
