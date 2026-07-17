import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import {
  REVIEWER_EXPERTISE,
  type ReviewerExpertiseDefinition,
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
  suggestReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type HumanReviewAudience = "private_invited" | "public_network" | "hybrid";
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DEFINITION_ID_PATTERN = /^expd_[a-z0-9_]{3,120}$/u;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Expertise definition is not JSON serializable.");
  return encoded;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function requiredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} is required.`, 400, "invalid_reviewer_expertise_definition");
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum) {
    throw new TokenlessServiceError(
      `${field} must contain 1-${maximum} characters.`,
      400,
      "invalid_reviewer_expertise_definition",
    );
  }
  return normalized;
}

async function requireWorkspaceManager(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const access = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
          WHERE m.workspace_id=? AND m.account_address=? AND m.role IN ('owner','admin') LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (!access.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function definitionFromRow(row: Row): ReviewerExpertiseDefinition {
  const hash = text(row, "definition_hash");
  const scope = text(row, "scope");
  const definitionId = text(row, "definition_id");
  if (
    !definitionId ||
    !DEFINITION_ID_PATTERN.test(definitionId) ||
    !hash ||
    !HASH_PATTERN.test(hash) ||
    (scope !== "global" && scope !== "workspace")
  ) {
    throw new Error("Stored reviewer expertise definition is invalid.");
  }
  return {
    definitionId,
    version: integer(row, "version"),
    hash: hash as `sha256:${string}`,
    scope,
    workspaceId: text(row, "workspace_id"),
    key: text(row, "slug")!,
    label: text(row, "label")!,
    description: text(row, "description")!,
    networkEligible: row.network_eligible === true || row.network_eligible === "t",
  };
}

export async function listReviewerExpertiseDefinitions(input: {
  accountAddress: string;
  workspaceId: string;
  context?: string;
}) {
  await requireWorkspaceManager(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT definition_id,version,scope,workspace_id,slug,label,description,network_eligible,definition_hash
          FROM tokenless_reviewer_expertise_definitions
          WHERE status='active' AND superseded_at IS NULL AND (scope='global' OR workspace_id=?)
          ORDER BY CASE WHEN scope='global' THEN 0 ELSE 1 END,label,definition_id`,
    args: [input.workspaceId],
  });
  const definitions = result.rows.map(value => definitionFromRow(value as Row));
  const suggestedKeys = new Set(suggestReviewerExpertiseKeys(input.context ?? ""));
  const globalIdByKey = new Map(REVIEWER_EXPERTISE.map(option => [option.key, option.definitionId] as const));
  const suggestedDefinitionIds = [...suggestedKeys].flatMap(key => {
    const definitionId = globalIdByKey.get(key);
    return definitionId ? [definitionId] : [];
  });
  return { definitions, suggestedDefinitionIds };
}

export async function createWorkspaceReviewerExpertiseDefinition(input: {
  accountAddress: string;
  workspaceId: string;
  label: unknown;
  description: unknown;
}) {
  const actor = await requireWorkspaceManager(input.accountAddress, input.workspaceId);
  const label = requiredText(input.label, "Specialist area name", 80);
  const description = requiredText(input.description, "Qualification guidance", 320);
  const definitionId = `expd_workspace_${randomUUID().replaceAll("-", "")}`;
  const version = 1;
  const slugBase = label
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const slug = `workspace:${slugBase || "specialist"}:${definitionId.slice(-12)}`;
  const document = {
    schemaVersion: "rateloop.reviewer-expertise-definition.v1",
    definitionId,
    version,
    scope: "workspace",
    workspaceId: input.workspaceId,
    slug,
    label,
    description,
    networkEligible: false,
  } as const;
  const definitionHash = sha256(document);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_reviewer_expertise_definitions
          (definition_id,version,scope,workspace_id,slug,label,description,network_eligible,
           definition_hash,status,created_by,created_at,superseded_at)
          VALUES (?,?, 'workspace',?,?,?,?,false,?,'active',?,?,NULL)`,
    args: [definitionId, version, input.workspaceId, slug, label, description, definitionHash, actor, now],
  });
  return {
    definition: {
      definitionId,
      version,
      hash: definitionHash,
      scope: "workspace",
      workspaceId: input.workspaceId,
      key: slug,
      label,
      description,
      networkEligible: false,
    } satisfies ReviewerExpertiseDefinition,
  };
}

export async function validateReviewerExpertiseRequirementsForWorkspace(input: {
  accountAddress: string;
  workspaceId: string;
  audience: HumanReviewAudience;
  panelSize: number;
  requirements: unknown;
}) {
  await requireWorkspaceManager(input.accountAddress, input.workspaceId);
  const client = await dbPool.connect();
  try {
    return await validateReviewerExpertiseRequirementsWithClient(client, input);
  } finally {
    client.release();
  }
}

export async function validateReviewerExpertiseRequirementsWithClient(
  client: Pick<PoolClient, "query">,
  input: {
    workspaceId: string;
    audience: HumanReviewAudience;
    panelSize: number;
    requirements: unknown;
  },
) {
  let requirements: ReviewerExpertiseRequirement[];
  try {
    requirements = normalizeReviewerExpertiseRequirementsSelection(input.requirements, input.panelSize);
  } catch (error) {
    throw new TokenlessServiceError(
      error instanceof Error ? error.message : "Specialist requirements are invalid.",
      400,
      "invalid_reviewer_expertise",
    );
  }
  if (input.audience === "hybrid" && requirements.length > 0) {
    throw new TokenlessServiceError(
      "Specialist requirements for hybrid panels require separately frozen invited and network seat classes.",
      400,
      "unsupported_hybrid_expertise_coverage",
    );
  }
  const definitions: ReviewerExpertiseDefinition[] = [];
  for (const requirement of requirements) {
    const result = await client.query(
      `SELECT definition_id,version,scope,workspace_id,slug,label,description,network_eligible,definition_hash
            FROM tokenless_reviewer_expertise_definitions
            WHERE definition_id=$1 AND version=$2 AND definition_hash=$3 AND status='active'
              AND superseded_at IS NULL AND (scope='global' OR workspace_id=$4)
            LIMIT 1 FOR SHARE`,
      [requirement.definitionId, requirement.definitionVersion, requirement.definitionHash, input.workspaceId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      throw new TokenlessServiceError(
        "A selected specialist area is unavailable.",
        409,
        "reviewer_expertise_definition_unavailable",
      );
    }
    const definition = definitionFromRow(row);
    if (input.audience === "private_invited") {
      if (requirement.sourceScope !== "customer_invited") {
        throw new TokenlessServiceError(
          "Private specialist requirements must be fulfilled by invited reviewers.",
          400,
          "invalid_reviewer_expertise",
        );
      }
    } else if (
      !definition.networkEligible ||
      definition.scope !== "global" ||
      requirement.minimumSeats !== input.panelSize ||
      requirement.sourceScope !== "rateloop_network"
    ) {
      throw new TokenlessServiceError(
        "Public-network specialist requirements must use a RateLoop-verified area for every reviewer.",
        400,
        "unsupported_network_expertise_coverage",
      );
    }
    definitions.push(definition);
  }
  return { requirements, definitions };
}

export const __reviewerExpertiseDefinitionsTestUtils = { canonicalJson, sha256 };
