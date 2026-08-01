import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { dsaEvidenceCommitTimestamp, dsaEvidenceTransactionTimestamp } from "~~/lib/tokenless/dsaEvidenceClock";
import {
  DSA_PART8_AUTOMATION_PROCESSING,
  DSA_PART8_CLASSIFIER_MACHINE_CLASSES,
  DSA_PART8_NOTIFIER_CLASSES,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_PART8_CLASSIFIER_INVENTORY_SCHEMA_VERSION = "rateloop.dsa-part8-classifier-inventory.v1" as const;
export const DSA_PART8_CLASSIFIER_INVENTORY_ENTRY_SCHEMA_VERSION =
  "rateloop.dsa-part8-classifier-inventory-entry.v1" as const;
export const DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION = "rateloop.dsa-part8-notice-processing-fact.v3" as const;
export const DSA_PART8_MAX_CLASSIFIER_INVENTORY_ENTRIES = 64 as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const NOTICE_IDENTIFIER = /^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FORMULA_PREFIX = /^[=+@-]/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

type Row = Record<string, unknown>;
type MachineClass = (typeof DSA_PART8_CLASSIFIER_MACHINE_CLASSES)[number];
type AutomationProcessing = (typeof DSA_PART8_AUTOMATION_PROCESSING)[number];
type NotifierClass = (typeof DSA_PART8_NOTIFIER_CLASSES)[number];

export type DsaPart8ClassifierInventorySystemInput = Readonly<{
  systemId: string;
  systemVersion: string;
  machineClass: MachineClass;
  publicDesignation: string;
}>;

export type DsaPart8DeclaredClassifierSystem = DsaPart8ClassifierInventorySystemInput;

export type DsaPart8ClassifierInventoryEntry = DsaPart8ClassifierInventorySystemInput &
  Readonly<{
    schemaVersion: typeof DSA_PART8_CLASSIFIER_INVENTORY_ENTRY_SCHEMA_VERSION;
    observedEvaluationCount: number;
    observationState: "observed" | "unobserved";
    gapCode: null | "zero_observations";
    entryHash: `sha256:${string}`;
  }>;

export type DsaPart8FrozenClassifierInventoryEntry = DsaPart8ClassifierInventoryEntry;

export type FrozenDsaPart8ClassifierInventory = Readonly<{
  schemaVersion: typeof DSA_PART8_CLASSIFIER_INVENTORY_SCHEMA_VERSION;
  inventoryId: string;
  population: Readonly<{
    populationId: string;
    populationVersion: number;
    populationRoot: `sha256:${string}`;
    populationFrozenAt: string;
  }>;
  serviceId: string;
  sourceRegistryDigest: `sha256:${string}`;
  sourceFrozenAt: string;
  frozenAt: string;
  expectedSystemCount: number;
  inventoryRoot: `sha256:${string}`;
  systems: readonly DsaPart8ClassifierInventoryEntry[];
  inventoryDigest: `sha256:${string}`;
}>;

export type DsaPart8FrozenClassifierInventory = FrozenDsaPart8ClassifierInventory;

export type DsaPart8NoticeProcessingFactInput = Readonly<{
  noticeId: string;
  factVersion: number;
  serviceId: string;
  receivedAt: Date;
  sourceNoticeBinding: `sha256:${string}`;
  processingStatus: "processed_final" | "processing_incomplete";
  automationProcessing: AutomationProcessing | null;
  notifierClass: NotifierClass;
  supersedesFactVersion: number | null;
  correctionReason: string | null;
}>;

export type ImmutableDsaPart8NoticeProcessingFact = Readonly<{
  schemaVersion: typeof DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION;
  noticeId: string;
  factVersion: number;
  serviceId: string;
  receivedAt: string;
  sourceNoticeBinding: `sha256:${string}`;
  processingStatus: DsaPart8NoticeProcessingFactInput["processingStatus"];
  automationProcessing: AutomationProcessing | null;
  notifierClass: NotifierClass;
  supersedesFactVersion: number | null;
  correctionReason: string | null;
  factHash: `sha256:${string}`;
}>;

export type DsaPart8NoticeProcessingFact = ImmutableDsaPart8NoticeProcessingFact;

type ObservedClassifier = DsaPart8ClassifierInventorySystemInput & Readonly<{ observedEvaluationCount: number }>;

function invalidInventory(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_part8_classifier_inventory", false, field);
}

function invalidNotice(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_part8_notice_processing_fact", false, field);
}

function exactKeys(value: unknown, expected: readonly string[], field: string, invalid: (message: string) => never) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`);
  const actual = Object.keys(value as object).sort(comparePortableAscii);
  const normalized = [...expected].sort(comparePortableAscii);
  if (actual.length !== normalized.length || actual.some((key, index) => key !== normalized[index])) {
    invalid(`${field} contains missing or unsupported fields.`);
  }
}

function comparePortableAscii(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveInteger(value: unknown, field: string, invalid: (message: string, field?: string) => never) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${field} must be a positive integer.`, field);
  return Number(value);
}

function canonicalDate(value: unknown, field: string, invalid: (message: string, field?: string) => never) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) invalid(`${field} must be a valid timestamp.`, field);
  return parsed;
}

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function count(row: Row, field: string) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${field} is invalid.`);
  return value;
}

function normalizeActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

function normalizeSystem(input: unknown, field: string): DsaPart8ClassifierInventorySystemInput {
  exactKeys(input, ["machineClass", "publicDesignation", "systemId", "systemVersion"], field, message =>
    invalidInventory(message, field),
  );
  const system = input as DsaPart8ClassifierInventorySystemInput;
  if (!IDENTIFIER.test(system.systemId)) invalidInventory(`${field}.systemId is invalid.`, `${field}.systemId`);
  if (!IDENTIFIER.test(system.systemVersion)) {
    invalidInventory(`${field}.systemVersion is invalid.`, `${field}.systemVersion`);
  }
  if (!DSA_PART8_CLASSIFIER_MACHINE_CLASSES.includes(system.machineClass)) {
    invalidInventory(`${field}.machineClass is invalid.`, `${field}.machineClass`);
  }
  if (
    typeof system.publicDesignation !== "string" ||
    system.publicDesignation !== system.publicDesignation.trim() ||
    system.publicDesignation.length === 0 ||
    system.publicDesignation.length > 160 ||
    CONTROL_CHARACTER.test(system.publicDesignation) ||
    FORMULA_PREFIX.test(system.publicDesignation)
  ) {
    invalidInventory(`${field}.publicDesignation is invalid or spreadsheet-unsafe.`, `${field}.publicDesignation`);
  }
  return { ...system };
}

function systemKey(system: Pick<DsaPart8ClassifierInventorySystemInput, "systemId" | "systemVersion">) {
  return `${system.systemId}\u0000${system.systemVersion}`;
}

export function normalizeDsaPart8ClassifierInventorySystems(
  systems: readonly DsaPart8ClassifierInventorySystemInput[],
) {
  if (!Array.isArray(systems) || systems.length > DSA_PART8_MAX_CLASSIFIER_INVENTORY_ENTRIES) {
    invalidInventory(`systems must contain at most ${DSA_PART8_MAX_CLASSIFIER_INVENTORY_ENTRIES} entries.`, "systems");
  }
  const normalized = systems.map((system, index) => normalizeSystem(system, `systems[${index}]`));
  normalized.sort(
    (left, right) =>
      comparePortableAscii(left.systemId, right.systemId) ||
      comparePortableAscii(left.systemVersion, right.systemVersion),
  );
  if (new Set(normalized.map(systemKey)).size !== normalized.length) {
    invalidInventory("systems must have unique system/version identities.", "systems");
  }
  if (
    new Set(normalized.map(system => system.publicDesignation.toLocaleLowerCase("en-US"))).size !== normalized.length
  ) {
    invalidInventory("systems must have unique public designations.", "systems");
  }
  return normalized;
}

export function computeDsaPart8ClassifierInventoryRoot(systems: readonly DsaPart8ClassifierInventorySystemInput[]) {
  return sha256Rfc8785({
    schemaVersion: DSA_PART8_CLASSIFIER_INVENTORY_SCHEMA_VERSION,
    systems: normalizeDsaPart8ClassifierInventorySystems(systems),
  });
}

function inventoryId(input: {
  workspaceId: string;
  populationId: string;
  populationVersion: number;
  serviceId: string;
}) {
  const digest = createHash("sha256")
    .update(
      canonicalizeRfc8785({
        domain: "rateloop.dsa-part8-classifier-inventory-id.v1",
        ...input,
      }),
    )
    .digest("hex");
  return `dci_${digest.slice(0, 40)}`;
}

function buildInventoryEntries(
  declaredSystems: readonly DsaPart8ClassifierInventorySystemInput[],
  observedSystems: readonly ObservedClassifier[],
) {
  const declared = normalizeDsaPart8ClassifierInventorySystems(declaredSystems);
  const observedByIdentity = new Map<string, ObservedClassifier>();
  for (const [index, raw] of observedSystems.entries()) {
    const { observedEvaluationCount, ...rawSystem } = raw;
    const observed = {
      ...normalizeSystem(rawSystem, `observedSystems[${index}]`),
      observedEvaluationCount,
    };
    if (!Number.isSafeInteger(observed.observedEvaluationCount) || observed.observedEvaluationCount <= 0) {
      throw new Error("Observed classifier counts must be positive safe integers.");
    }
    const key = systemKey(observed);
    const previous = observedByIdentity.get(key);
    if (
      previous &&
      (previous.machineClass !== observed.machineClass || previous.publicDesignation !== observed.publicDesignation)
    ) {
      invalidInventory("A system/version identity has conflicting observed metadata.", "systems");
    }
    if (previous) {
      observedByIdentity.set(key, {
        ...previous,
        observedEvaluationCount: previous.observedEvaluationCount + observed.observedEvaluationCount,
      });
    } else {
      observedByIdentity.set(key, observed);
    }
  }
  const declaredByIdentity = new Map(declared.map(system => [systemKey(system), system]));
  for (const observed of observedByIdentity.values()) {
    const expected = declaredByIdentity.get(systemKey(observed));
    if (
      !expected ||
      expected.machineClass !== observed.machineClass ||
      expected.publicDesignation !== observed.publicDesignation
    ) {
      invalidInventory("Every observed evaluation system must match the independently declared inventory.", "systems");
    }
  }
  return declared.map(system => {
    const observedEvaluationCount = observedByIdentity.get(systemKey(system))?.observedEvaluationCount ?? 0;
    const payload = {
      schemaVersion: DSA_PART8_CLASSIFIER_INVENTORY_ENTRY_SCHEMA_VERSION,
      ...system,
      observedEvaluationCount,
      observationState: observedEvaluationCount > 0 ? ("observed" as const) : ("unobserved" as const),
      gapCode: observedEvaluationCount > 0 ? null : ("zero_observations" as const),
    };
    return { ...payload, entryHash: sha256Rfc8785(payload) };
  });
}

function buildFrozenInventory(input: {
  workspaceId: string;
  populationId: string;
  populationVersion: number;
  populationRoot: `sha256:${string}`;
  populationFrozenAt: Date;
  serviceId: string;
  sourceRegistryDigest: `sha256:${string}`;
  sourceFrozenAt: Date;
  frozenAt: Date;
  declaredSystems: readonly DsaPart8ClassifierInventorySystemInput[];
  observedSystems: readonly ObservedClassifier[];
}): FrozenDsaPart8ClassifierInventory {
  const systems = buildInventoryEntries(input.declaredSystems, input.observedSystems);
  const inventoryRoot = computeDsaPart8ClassifierInventoryRoot(input.declaredSystems);
  const payload = {
    schemaVersion: DSA_PART8_CLASSIFIER_INVENTORY_SCHEMA_VERSION,
    inventoryId: inventoryId({
      workspaceId: input.workspaceId,
      populationId: input.populationId,
      populationVersion: input.populationVersion,
      serviceId: input.serviceId,
    }),
    population: {
      populationId: input.populationId,
      populationVersion: input.populationVersion,
      populationRoot: input.populationRoot,
      populationFrozenAt: input.populationFrozenAt.toISOString(),
    },
    serviceId: input.serviceId,
    sourceRegistryDigest: input.sourceRegistryDigest,
    sourceFrozenAt: input.sourceFrozenAt.toISOString(),
    frozenAt: input.frozenAt.toISOString(),
    expectedSystemCount: systems.length,
    inventoryRoot,
    systems,
  };
  return { ...payload, inventoryDigest: sha256Rfc8785(payload) };
}

function parseStoredInventory(row: Row): FrozenDsaPart8ClassifierInventory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(row, "inventory_json") ?? "");
  } catch {
    throw new Error("Stored DSA classifier inventory JSON is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored DSA classifier inventory binding is invalid.");
  }
  const inventory = parsed as FrozenDsaPart8ClassifierInventory;
  const { inventoryDigest, ...payload } = inventory;
  if (
    !SHA256.test(inventoryDigest) ||
    inventoryDigest !== text(row, "inventory_digest") ||
    inventoryDigest !== sha256Rfc8785(payload)
  ) {
    throw new Error("Stored DSA classifier inventory binding is invalid.");
  }
  return inventory;
}

function noticeIdentityMatches(
  fact: Pick<
    ImmutableDsaPart8NoticeProcessingFact,
    "serviceId" | "receivedAt" | "sourceNoticeBinding" | "notifierClass"
  >,
  predecessor: {
    serviceId: string | null;
    receivedAt: unknown;
    sourceNoticeBinding: string | null;
    notifierClass: string | null;
  },
) {
  return (
    predecessor.serviceId === fact.serviceId &&
    canonicalDate(predecessor.receivedAt, "storedNotice.receivedAt", invalidNotice).getTime() ===
      new Date(fact.receivedAt).getTime() &&
    predecessor.sourceNoticeBinding === fact.sourceNoticeBinding &&
    predecessor.notifierClass === fact.notifierClass
  );
}

async function requireManager(client: PoolClient, accountAddress: string, workspaceId: string) {
  const actor = normalizeActor(accountAddress);
  const membership = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return actor;
}

async function inRepeatableRead<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function freezeDsaPart8ClassifierInventory(input: {
  accountAddress: string;
  workspaceId: string;
  populationId: string;
  populationVersion: number;
  serviceId: string;
  sourceRegistryDigest: `sha256:${string}`;
  systems: readonly DsaPart8ClassifierInventorySystemInput[];
}) {
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !SIMPLE_IDENTIFIER.test(input.populationId)) {
    invalidInventory("Population scope is invalid.");
  }
  const populationVersion = positiveInteger(input.populationVersion, "populationVersion", invalidInventory);
  if (!IDENTIFIER.test(input.serviceId)) invalidInventory("serviceId is invalid.", "serviceId");
  if (!SHA256.test(input.sourceRegistryDigest)) {
    invalidInventory("sourceRegistryDigest must be a canonical SHA-256 digest.", "sourceRegistryDigest");
  }
  const declaredSystems = normalizeDsaPart8ClassifierInventorySystems(input.systems);
  const declaredRoot = computeDsaPart8ClassifierInventoryRoot(declaredSystems);

  return inRepeatableRead(async client => {
    const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const populationResult = await client.query(
      `SELECT status,frozen_root,frozen_at,period_end
       FROM tokenless_dsa_population_versions
       WHERE workspace_id=$1 AND population_id=$2 AND version=$3 FOR SHARE`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    const population = populationResult.rows[0] as Row | undefined;
    if (populationResult.rowCount !== 1) {
      throw new TokenlessServiceError("Frozen population not found.", 404, "dsa_frozen_population_not_found");
    }
    const populationFrozenAt = canonicalDate(population?.frozen_at, "population.frozenAt", invalidInventory);
    const periodEnd = canonicalDate(population?.period_end, "population.periodEnd", invalidInventory);
    const populationRoot = text(population, "frozen_root");
    if (
      text(population, "status") !== "frozen" ||
      !populationRoot ||
      !SHA256.test(populationRoot) ||
      populationFrozenAt > sourceFrozenAt ||
      periodEnd > sourceFrozenAt
    ) {
      throw new TokenlessServiceError("Frozen population not found.", 404, "dsa_frozen_population_not_found");
    }

    const existingResult = await client.query(
      `SELECT inventory_json,inventory_digest,inventory_root,source_registry_digest
       FROM tokenless_dsa_classifier_inventories
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3 AND service_id=$4
       FOR UPDATE`,
      [input.workspaceId, input.populationId, populationVersion, input.serviceId],
    );
    if (existingResult.rowCount === 1) {
      const existing = existingResult.rows[0] as Row;
      if (
        text(existing, "inventory_root") !== declaredRoot ||
        text(existing, "source_registry_digest") !== input.sourceRegistryDigest
      ) {
        throw new TokenlessServiceError(
          "This population and service already have a different immutable classifier inventory.",
          409,
          "dsa_part8_classifier_inventory_conflict",
        );
      }
      return { inventory: parseStoredInventory(existing), idempotent: true };
    }

    const observedResult = await client.query(
      `SELECT evaluation.system_id,evaluation.system_version,evaluation.machine_class,
              evaluation.public_designation,count(*)::integer AS observed_evaluation_count
       FROM tokenless_dsa_engagement_versions engagement
       JOIN tokenless_dsa_source_engagement_versions source_engagement
         ON source_engagement.workspace_id=engagement.workspace_id
        AND source_engagement.engagement_id=engagement.engagement_id
        AND source_engagement.engagement_version=engagement.engagement_version
       JOIN tokenless_dsa_automated_means_evaluations evaluation
         ON evaluation.workspace_id=engagement.workspace_id
        AND evaluation.provider_decision_id=engagement.provider_decision_id
        AND evaluation.decision_version=engagement.decision_version
       WHERE engagement.workspace_id=$1 AND engagement.population_id=$2
         AND engagement.population_version=$3
         AND source_engagement.engagement_json::jsonb ->> 'service'=$4
         AND source_engagement.created_at<=$5 AND evaluation.created_at<=$5
       GROUP BY evaluation.system_id,evaluation.system_version,evaluation.machine_class,evaluation.public_designation
       ORDER BY evaluation.system_id,evaluation.system_version,evaluation.machine_class,evaluation.public_designation`,
      [input.workspaceId, input.populationId, populationVersion, input.serviceId, sourceFrozenAt],
    );
    const observedSystems = (observedResult.rows as Row[]).map(row => ({
      systemId: text(row, "system_id") ?? "",
      systemVersion: text(row, "system_version") ?? "",
      machineClass: text(row, "machine_class") as MachineClass,
      publicDesignation: text(row, "public_designation") ?? "",
      observedEvaluationCount: count(row, "observed_evaluation_count"),
    }));
    const frozenAt = await dsaEvidenceCommitTimestamp(client);
    if (frozenAt < sourceFrozenAt) throw new Error("The DSA inventory commit clock moved backwards.");
    const inventory = buildFrozenInventory({
      workspaceId: input.workspaceId,
      populationId: input.populationId,
      populationVersion,
      populationRoot: populationRoot as `sha256:${string}`,
      populationFrozenAt,
      serviceId: input.serviceId,
      sourceRegistryDigest: input.sourceRegistryDigest,
      sourceFrozenAt,
      frozenAt,
      declaredSystems,
      observedSystems,
    });
    await client.query(
      `INSERT INTO tokenless_dsa_classifier_inventories
       (workspace_id,inventory_id,population_id,population_version,service_id,schema_version,
        expected_system_count,source_registry_digest,inventory_root,inventory_json,inventory_digest,
        source_frozen_at,frozen_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.workspaceId,
        inventory.inventoryId,
        input.populationId,
        populationVersion,
        input.serviceId,
        inventory.schemaVersion,
        inventory.expectedSystemCount,
        inventory.sourceRegistryDigest,
        inventory.inventoryRoot,
        canonicalizeRfc8785(inventory),
        inventory.inventoryDigest,
        sourceFrozenAt,
        frozenAt,
        actor,
      ],
    );
    for (const system of inventory.systems) {
      const { entryHash, ...entryPayload } = system;
      await client.query(
        `INSERT INTO tokenless_dsa_classifier_inventory_entries
         (workspace_id,inventory_id,system_id,system_version,schema_version,machine_class,public_designation,
          observed_evaluation_count,observation_state,gap_code,entry_json,entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          input.workspaceId,
          inventory.inventoryId,
          system.systemId,
          system.systemVersion,
          system.schemaVersion,
          system.machineClass,
          system.publicDesignation,
          system.observedEvaluationCount,
          system.observationState,
          system.gapCode,
          canonicalizeRfc8785(entryPayload),
          entryHash,
        ],
      );
    }
    return { inventory, idempotent: false };
  });
}

export function sealDsaPart8NoticeProcessingFact(
  input: DsaPart8NoticeProcessingFactInput,
): ImmutableDsaPart8NoticeProcessingFact {
  exactKeys(
    input,
    [
      "automationProcessing",
      "correctionReason",
      "factVersion",
      "noticeId",
      "notifierClass",
      "processingStatus",
      "receivedAt",
      "serviceId",
      "sourceNoticeBinding",
      "supersedesFactVersion",
    ],
    "noticeFact",
    message => invalidNotice(message),
  );
  if (!NOTICE_IDENTIFIER.test(input.noticeId)) invalidNotice("noticeId is invalid.", "noticeId");
  const factVersion = positiveInteger(input.factVersion, "factVersion", invalidNotice);
  if (!IDENTIFIER.test(input.serviceId)) invalidNotice("serviceId is invalid.", "serviceId");
  const receivedAt = canonicalDate(input.receivedAt, "receivedAt", invalidNotice);
  if (!SHA256.test(input.sourceNoticeBinding)) {
    invalidNotice("sourceNoticeBinding must be a canonical SHA-256 digest.", "sourceNoticeBinding");
  }
  if (!DSA_PART8_NOTIFIER_CLASSES.includes(input.notifierClass)) {
    invalidNotice("notifierClass is invalid.", "notifierClass");
  }
  if (
    (input.processingStatus === "processed_final" &&
      (input.automationProcessing === null || !DSA_PART8_AUTOMATION_PROCESSING.includes(input.automationProcessing))) ||
    (input.processingStatus === "processing_incomplete" && input.automationProcessing !== null) ||
    (input.processingStatus !== "processed_final" && input.processingStatus !== "processing_incomplete")
  ) {
    invalidNotice("Notice processing state is invalid.", "processingStatus");
  }
  const correctionReason = input.correctionReason?.trim() ?? null;
  if (
    (factVersion === 1 && (input.supersedesFactVersion !== null || input.correctionReason !== null)) ||
    (factVersion > 1 &&
      (input.supersedesFactVersion !== factVersion - 1 ||
        correctionReason === null ||
        correctionReason.length === 0 ||
        correctionReason.length > 500))
  ) {
    invalidNotice("Notice correction lineage is invalid.", "supersedesFactVersion");
  }
  const payload = {
    schemaVersion: DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
    noticeId: input.noticeId,
    factVersion,
    serviceId: input.serviceId,
    receivedAt: receivedAt.toISOString(),
    sourceNoticeBinding: input.sourceNoticeBinding,
    processingStatus: input.processingStatus,
    automationProcessing: input.automationProcessing,
    notifierClass: input.notifierClass,
    supersedesFactVersion: input.supersedesFactVersion,
    correctionReason,
  };
  return { ...payload, factHash: sha256Rfc8785(payload) };
}

export async function recordDsaPart8NoticeProcessingFact(input: {
  accountAddress: string;
  workspaceId: string;
  fact: DsaPart8NoticeProcessingFactInput;
}) {
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId)) invalidNotice("workspaceId is invalid.", "workspaceId");
  const fact = sealDsaPart8NoticeProcessingFact(input.fact);
  return inRepeatableRead(async client => {
    const createdAt = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    if (new Date(fact.receivedAt) > createdAt) invalidNotice("receivedAt cannot be in the future.", "receivedAt");
    const existing = await client.query(
      `SELECT fact_hash FROM tokenless_dsa_notice_processing_fact_versions
       WHERE workspace_id=$1 AND notice_id=$2 AND fact_version=$3 FOR UPDATE`,
      [input.workspaceId, fact.noticeId, fact.factVersion],
    );
    if (existing.rowCount === 1) {
      if (text(existing.rows[0] as Row, "fact_hash") !== fact.factHash) {
        throw new TokenlessServiceError(
          "This notice fact version already contains different immutable evidence.",
          409,
          "dsa_part8_notice_processing_fact_conflict",
        );
      }
      return { fact, idempotent: true };
    }
    if (fact.factVersion > 1) {
      const previous = await client.query(
        `SELECT service_id,received_at,source_notice_binding,notifier_class
         FROM tokenless_dsa_notice_processing_fact_versions
         WHERE workspace_id=$1 AND notice_id=$2 AND fact_version=$3 FOR SHARE`,
        [input.workspaceId, fact.noticeId, fact.supersedesFactVersion],
      );
      const predecessor = previous.rows[0] as Row | undefined;
      if (
        previous.rowCount !== 1 ||
        !noticeIdentityMatches(fact, {
          serviceId: text(predecessor, "service_id"),
          receivedAt: predecessor?.received_at,
          sourceNoticeBinding: text(predecessor, "source_notice_binding"),
          notifierClass: text(predecessor, "notifier_class"),
        })
      ) {
        throw new TokenlessServiceError(
          "The exact prior notice fact version was not found.",
          409,
          "dsa_part8_notice_correction_predecessor_missing",
        );
      }
    }
    const { factHash, ...factPayload } = fact;
    await client.query(
      `INSERT INTO tokenless_dsa_notice_processing_fact_versions
       (workspace_id,notice_id,fact_version,schema_version,service_id,received_at,source_notice_binding,
        processing_status,automation_processing,notifier_class,supersedes_fact_version,correction_reason,
        fact_json,fact_hash,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.workspaceId,
        fact.noticeId,
        fact.factVersion,
        fact.schemaVersion,
        fact.serviceId,
        new Date(fact.receivedAt),
        fact.sourceNoticeBinding,
        fact.processingStatus,
        fact.automationProcessing,
        fact.notifierClass,
        fact.supersedesFactVersion,
        fact.correctionReason,
        canonicalizeRfc8785(factPayload),
        factHash,
        actor,
        createdAt,
      ],
    );
    return { fact, idempotent: false };
  });
}

export const __dsaPart8InventoryAndNoticesTestUtils = {
  buildInventoryEntries,
  buildFrozenInventory,
  inventoryId,
  noticeIdentityMatches,
};
