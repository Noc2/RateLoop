import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

type Row = Record<string, unknown>;

export const GOLD_ITEM_PROVENANCES = ["owner_adjudicated", "platform_synthetic"] as const;
export type GoldItemProvenance = (typeof GOLD_ITEM_PROVENANCES)[number];

export const MINIMUM_GOLD_SAMPLE_SIZE = 5;
export const GOLD_CALIBRATED_ACCURACY_BPS = 8_000;
export const MAXIMUM_GOLD_INJECTION_RATE_BPS = 2_000;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GOLD_INJECTION_KEY_DOMAIN = "rateloop:gold-injection:v1";

type GoldInjectionKeyring = { currentVersion: string; keys: Map<string, Buffer> };
let goldInjectionKeyringOverride: GoldInjectionKeyring | null = null;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function selectionSeedCommitment(seed: Buffer) {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function goldInjectionKeyring(): GoldInjectionKeyring {
  if (goldInjectionKeyringOverride) return goldInjectionKeyringOverride;
  if (
    process.env.NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEYS ||
    process.env.NEXT_PUBLIC_TOKENLESS_GOLD_INJECTION_KEY_VERSION
  ) {
    throw new Error("Gold injection keys must never use NEXT_PUBLIC variables.");
  }
  const currentVersion = process.env.TOKENLESS_GOLD_INJECTION_KEY_VERSION?.trim();
  const encoded = process.env.TOKENLESS_GOLD_INJECTION_KEYS?.trim();
  if (!currentVersion || !encoded) {
    throw new TokenlessServiceError(
      "Gold injection is enabled but its server selection key is unavailable.",
      503,
      "gold_injection_key_unavailable",
    );
  }
  let source: Record<string, string>;
  try {
    source = JSON.parse(encoded) as Record<string, string>;
  } catch {
    throw new Error("TOKENLESS_GOLD_INJECTION_KEYS must be a JSON object of base64url keys.");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, value] of Object.entries(source)) {
    const key = Buffer.from(value, "base64url");
    if (key.length !== 32) throw new Error(`Gold injection key ${version} must contain exactly 32 bytes.`);
    keys.set(version, key);
  }
  if (!keys.has(currentVersion)) throw new Error("The current gold injection key version is missing.");
  return { currentVersion, keys };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Gold-quality value is not JSON serializable.");
  return encoded;
}

function requireHash(value: unknown, field: string) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_gold_quality");
  }
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TokenlessServiceError(
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      400,
      "invalid_gold_quality",
    );
  }
  return parsed;
}

function goldInjectionCount(baseCaseCount: number, rateBps: number, maximum: number, fractionalDrawBps: number) {
  const scaledCount = baseCaseCount * rateBps;
  const wholeItems = Math.floor(scaledCount / 10_000);
  const fractionalBps = scaledCount % 10_000;
  return Math.min(maximum, wholeItems + (fractionalDrawBps < fractionalBps ? 1 : 0));
}

function goldProvenanceForSource(source: "customer_invited" | "rateloop_network" | "hybrid") {
  return source === "customer_invited" ? "owner_adjudicated" : "platform_synthetic";
}

async function requireProjectManager(accountAddress: string, workspaceId: string, projectId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_assurance_projects p
          JOIN tokenless_workspace_members m ON m.workspace_id = p.workspace_id
          JOIN tokenless_workspaces w ON w.workspace_id = p.workspace_id
          WHERE p.project_id = ? AND p.workspace_id = ? AND p.status = 'active'
            AND w.status = 'active' AND m.account_address = ? AND m.role IN ('owner','admin') LIMIT 1`,
    args: [projectId, workspaceId, actor],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Project not found.", 404, "project_not_found");
  return actor;
}

export async function getProjectGoldQuality(input: { accountAddress: string; workspaceId: string; projectId: string }) {
  await requireProjectManager(input.accountAddress, input.workspaceId, input.projectId);
  const [items, settings] = await Promise.all([
    dbClient.execute({
      sql: `SELECT gold_item_id,case_id,rubric_id,rubric_version,content_commitment,expected_choice,
                   provenance,status,created_at,retired_at
            FROM tokenless_assurance_gold_items
            WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC`,
      args: [input.workspaceId, input.projectId],
    }),
    dbClient.execute({
      sql: `SELECT invited_injection_enabled,injection_rate_bps,maximum_items_per_run,updated_at
            FROM tokenless_assurance_gold_settings WHERE workspace_id=? AND project_id=? LIMIT 1`,
      args: [input.workspaceId, input.projectId],
    }),
  ]);
  return {
    items: (items.rows as Row[]).map(row => ({
      goldItemId: text(row, "gold_item_id")!,
      caseId: text(row, "case_id")!,
      rubricId: text(row, "rubric_id")!,
      rubricVersion: integer(row, "rubric_version"),
      contentCommitment: text(row, "content_commitment")!,
      expectedChoice: text(row, "expected_choice"),
      provenance: text(row, "provenance"),
      status: text(row, "status"),
      createdAt: new Date(String(row.created_at)).toISOString(),
      retiredAt: row.retired_at ? new Date(String(row.retired_at)).toISOString() : null,
    })),
    settings: settings.rows[0]
      ? {
          invitedInjectionEnabled: settings.rows[0].invited_injection_enabled === true,
          injectionRateBps: integer(settings.rows[0] as Row, "injection_rate_bps"),
          maximumItemsPerRun: integer(settings.rows[0] as Row, "maximum_items_per_run"),
        }
      : { invitedInjectionEnabled: false, injectionRateBps: 500, maximumItemsPerRun: 1 },
  };
}

export async function createOwnerGoldItem(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  caseId: string;
  expectedChoice: "baseline" | "candidate";
  provenance?: GoldItemProvenance;
  now?: Date;
}) {
  const actor = await requireProjectManager(input.accountAddress, input.workspaceId, input.projectId);
  const provenance = input.provenance ?? "owner_adjudicated";
  if (provenance !== "owner_adjudicated") {
    throw new TokenlessServiceError(
      "Platform-synthetic gold is readiness-gated and cannot be created by a workspace owner.",
      409,
      "platform_gold_unavailable",
    );
  }
  if (input.expectedChoice !== "baseline" && input.expectedChoice !== "candidate") {
    throw new TokenlessServiceError("Gold answer is invalid.", 400, "invalid_gold_quality");
  }
  const result = await dbClient.execute({
    sql: `SELECT c.case_id, c.baseline_artifact_id, c.candidate_artifact_id,
                 baseline.digest AS baseline_digest, candidate.digest AS candidate_digest,
                 s.rubric_id, s.rubric_version
          FROM tokenless_assurance_cases c
          JOIN tokenless_assurance_suites s ON s.suite_id = c.suite_id AND s.version = c.suite_version
          JOIN tokenless_assurance_artifacts baseline ON baseline.artifact_id = c.baseline_artifact_id
          JOIN tokenless_assurance_artifacts candidate ON candidate.artifact_id = c.candidate_artifact_id
          WHERE c.project_id = ? AND c.case_id = ? AND c.status = 'ready' AND s.status = 'frozen' LIMIT 1`,
    args: [input.projectId, input.caseId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError(
      "Only a ready case from a frozen suite can become a gold item.",
      409,
      "gold_case_not_ready",
    );
  }
  const contentCommitment = sha256(
    stableJson({
      caseId: input.caseId,
      baselineArtifactId: text(row, "baseline_artifact_id"),
      baselineDigest: text(row, "baseline_digest"),
      candidateArtifactId: text(row, "candidate_artifact_id"),
      candidateDigest: text(row, "candidate_digest"),
      expectedChoice: input.expectedChoice,
      rubricId: text(row, "rubric_id"),
      rubricVersion: integer(row, "rubric_version"),
    }),
  );
  const goldItemId = `hagi_${randomUUID().replaceAll("-", "")}`;
  const now = input.now ?? new Date();
  try {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_gold_items
            (gold_item_id,workspace_id,project_id,case_id,rubric_id,rubric_version,content_commitment,
             expected_choice,provenance,status,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`,
      args: [
        goldItemId,
        input.workspaceId,
        input.projectId,
        input.caseId,
        text(row, "rubric_id"),
        integer(row, "rubric_version"),
        contentCommitment,
        input.expectedChoice,
        provenance,
        actor,
        now,
      ],
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new TokenlessServiceError("This case is already a gold item.", 409, "gold_item_exists");
    }
    throw error;
  }
  return { goldItemId, contentCommitment, provenance, status: "active" as const };
}

export async function configureProjectGoldInjection(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  invitedInjectionEnabled: boolean;
  injectionRateBps: number;
  maximumItemsPerRun: number;
  now?: Date;
}) {
  const actor = await requireProjectManager(input.accountAddress, input.workspaceId, input.projectId);
  if (typeof input.invitedInjectionEnabled !== "boolean") {
    throw new TokenlessServiceError("Invited gold setting is invalid.", 400, "invalid_gold_quality");
  }
  const rate = boundedInteger(input.injectionRateBps, "injectionRateBps", 100, MAXIMUM_GOLD_INJECTION_RATE_BPS);
  const maximum = boundedInteger(input.maximumItemsPerRun, "maximumItemsPerRun", 1, 5);
  const now = input.now ?? new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_gold_settings
          (project_id,workspace_id,invited_injection_enabled,injection_rate_bps,maximum_items_per_run,
           updated_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT (project_id) DO UPDATE SET
            invited_injection_enabled=EXCLUDED.invited_injection_enabled,
            injection_rate_bps=EXCLUDED.injection_rate_bps,
            maximum_items_per_run=EXCLUDED.maximum_items_per_run,
            updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
    args: [input.projectId, input.workspaceId, input.invitedInjectionEnabled, rate, maximum, actor, now, now],
  });
  return {
    projectId: input.projectId,
    invitedInjectionEnabled: input.invitedInjectionEnabled,
    injectionRateBps: rate,
    maximumItemsPerRun: maximum,
  };
}

export type GoldCaseCandidate = Row & {
  gold_item_id: string;
  expected_choice: "baseline" | "candidate";
  selection_seed_hash: string;
};

export async function selectGoldCasesForFrozenRun(
  client: PoolClient,
  input: {
    runId: string;
    workspaceId: string;
    projectId: string;
    rubricId: string;
    rubricVersion: number;
    reviewerSource: "customer_invited" | "rateloop_network" | "hybrid";
    baseCaseIds: string[];
    policyHash: string;
  },
): Promise<GoldCaseCandidate[]> {
  const settingsResult = await client.query(
    `SELECT invited_injection_enabled,injection_rate_bps,maximum_items_per_run
     FROM tokenless_assurance_gold_settings
     WHERE workspace_id=$1 AND project_id=$2 LIMIT 1 FOR SHARE`,
    [input.workspaceId, input.projectId],
  );
  const settings = settingsResult.rows[0] as Row | undefined;
  if (!settings) return [];
  if (input.reviewerSource === "customer_invited" && settings.invited_injection_enabled !== true) return [];
  if (input.reviewerSource !== "customer_invited" && !isWorldIdAssuranceEnabled()) return [];
  if (input.baseCaseIds.length === 0) return [];

  const rate = Math.min(integer(settings, "injection_rate_bps"), MAXIMUM_GOLD_INJECTION_RATE_BPS);
  const maximum = Math.min(integer(settings, "maximum_items_per_run"), 5);
  const keyring = goldInjectionKeyring();
  const key = keyring.keys.get(keyring.currentVersion)!;
  const seed = createHmac("sha256", key)
    .update(
      `${GOLD_INJECTION_KEY_DOMAIN}\0${keyring.currentVersion}\0${input.workspaceId}\0${input.runId}\0${input.policyHash}`,
    )
    .digest();
  const fractionalDraw = seed.readUInt32BE(0) % 10_000;
  const count = goldInjectionCount(input.baseCaseIds.length, rate, maximum, fractionalDraw);
  if (count === 0) return [];
  const seedHash = selectionSeedCommitment(seed);
  const requiredProvenance = goldProvenanceForSource(input.reviewerSource);
  const candidates = await client.query(
    `SELECT gi.gold_item_id,gi.expected_choice,gi.content_commitment,
            c.case_id,c.position,c.baseline_artifact_id,c.candidate_artifact_id,c.deterministic_checks_json
     FROM tokenless_assurance_gold_items gi
     JOIN tokenless_assurance_cases c ON c.case_id=gi.case_id AND c.project_id=gi.project_id
     JOIN tokenless_assurance_projects p ON p.project_id=gi.project_id AND p.workspace_id=gi.workspace_id
     WHERE gi.workspace_id=$1 AND gi.project_id=$2 AND gi.rubric_id=$3 AND gi.rubric_version=$4
       AND gi.status='active' AND gi.provenance=$5 AND c.status='ready'
       AND ($5='owner_adjudicated' OR p.data_classification='public')
       AND NOT (c.case_id = ANY($6::text[]))`,
    [input.workspaceId, input.projectId, input.rubricId, input.rubricVersion, requiredProvenance, input.baseCaseIds],
  );
  return (candidates.rows as Row[])
    .map(row => ({
      ...row,
      gold_item_id: text(row, "gold_item_id")!,
      expected_choice: text(row, "expected_choice") as "baseline" | "candidate",
      selection_seed_hash: seedHash,
      rank: createHmac("sha256", key)
        .update(`${GOLD_INJECTION_KEY_DOMAIN}:rank\0${seed.toString("hex")}\0${text(row, "gold_item_id")}`)
        .digest("hex"),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .slice(0, count)
    .map(({ rank, ...row }) => {
      void rank;
      return row;
    });
}

export async function recordGoldOutcomesForResponseBatch(
  client: PoolClient,
  input: {
    runId: string;
    reviewerKey: string;
    reviewerPrincipalId: string;
    assignmentId: string;
    workspaceId: string;
    projectId: string;
    reviewerSource: "customer_invited" | "rateloop_network";
    responses: Array<{ caseId: string; canonicalChoice: string }>;
    now: Date;
  },
) {
  const gold = await client.query(
    `SELECT rg.case_id,rg.gold_item_id,gi.expected_choice,gi.provenance
     FROM tokenless_assurance_run_gold_items rg
     JOIN tokenless_assurance_gold_items gi
       ON gi.gold_item_id=rg.gold_item_id AND gi.case_id=rg.case_id
     WHERE rg.run_id=$1`,
    [input.runId],
  );
  if (!gold.rowCount) return { scored: 0 };
  const rater = await client.query("SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id=$1 LIMIT 1", [
    input.reviewerPrincipalId,
  ]);
  const raterId = text(rater.rows[0] as Row | undefined, "rater_id");
  const answers = new Map(input.responses.map(value => [value.caseId, value.canonicalChoice] as const));
  let scored = 0;
  for (const raw of gold.rows as Row[]) {
    const caseId = text(raw, "case_id")!;
    const choice = answers.get(caseId);
    if (choice !== "baseline" && choice !== "candidate") continue;
    const inserted = await client.query(
      `INSERT INTO tokenless_assurance_gold_outcomes
       (outcome_id,workspace_id,project_id,run_id,case_id,gold_item_id,assignment_id,
        reviewer_key_lineage,rater_id,reviewer_source,gold_provenance,choice,correct,
        qualification_state,scored_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)
       ON CONFLICT (run_id,case_id,reviewer_key_lineage) DO NOTHING`,
      [
        `hago_${randomUUID().replaceAll("-", "")}`,
        input.workspaceId,
        input.projectId,
        input.runId,
        caseId,
        text(raw, "gold_item_id"),
        input.assignmentId,
        input.reviewerKey,
        raterId,
        input.reviewerSource,
        text(raw, "provenance"),
        choice,
        choice === text(raw, "expected_choice"),
        input.now,
      ],
    );
    scored += inserted.rowCount ?? 0;
  }
  return { scored };
}

export async function promoteCompletedRunGoldQualifications(client: PoolClient, runId: string, now: Date) {
  const run = await client.query("SELECT status FROM tokenless_assurance_runs WHERE run_id=$1 FOR UPDATE", [runId]);
  if (text(run.rows[0] as Row | undefined, "status") !== "completed") {
    throw new Error("Gold qualifications may be promoted only after the run is completed.");
  }
  const affected = await client.query(
    `SELECT DISTINCT o.assignment_id,a.workspace_id,a.project_id,a.cohort_id,a.reviewer_account_address
     FROM tokenless_assurance_gold_outcomes o
     JOIN tokenless_assurance_assignments a ON a.assignment_id=o.assignment_id AND a.run_id=o.run_id
     WHERE o.run_id=$1 AND o.qualification_state='pending'
       AND o.gold_provenance='owner_adjudicated' AND o.reviewer_source='customer_invited'`,
    [runId],
  );
  for (const raw of affected.rows as Row[]) {
    const workspaceId = text(raw, "workspace_id")!;
    const projectId = text(raw, "project_id")!;
    const cohortId = text(raw, "cohort_id")!;
    const reviewerAccountAddress = text(raw, "reviewer_account_address")!;
    const aggregate = await client.query(
      `SELECT COUNT(*) AS sample_size,
              COALESCE(SUM(CASE WHEN o.correct=true THEN 1 ELSE 0 END),0) AS correct_count
       FROM tokenless_assurance_gold_outcomes o
       JOIN tokenless_assurance_runs r ON r.run_id=o.run_id
       JOIN tokenless_assurance_assignments a ON a.assignment_id=o.assignment_id AND a.run_id=o.run_id
       WHERE o.workspace_id=$1 AND o.project_id=$2 AND a.cohort_id=$3
         AND a.reviewer_account_address=$4 AND o.gold_provenance='owner_adjudicated'
         AND o.reviewer_source='customer_invited' AND r.status='completed'`,
      [workspaceId, projectId, cohortId, reviewerAccountAddress],
    );
    const sampleSize = integer(aggregate.rows[0] as Row, "sample_size");
    const correctCount = integer(aggregate.rows[0] as Row, "correct_count");
    if (sampleSize < MINIMUM_GOLD_SAMPLE_SIZE) continue;
    const accuracyBps = Math.floor((correctCount * 10_000) / sampleSize);
    const reviewer = await client.query(
      `SELECT qualification_provenance_json,qualification_expires_at FROM tokenless_assurance_cohort_reviewers
       WHERE project_id=$1 AND cohort_id=$2 AND reviewer_account_address=$3 FOR UPDATE`,
      [projectId, cohortId, reviewerAccountAddress],
    );
    const reviewerRow = reviewer.rows[0] as Row | undefined;
    if (!reviewerRow) continue;
    const existing = JSON.parse(text(reviewerRow, "qualification_provenance_json") ?? "[]") as Array<{
      key?: unknown;
      [key: string]: unknown;
    }>;
    const withoutGold = existing.filter(value => value.key !== "gold:calibrated");
    const qualificationId = `qual_gold_${createHash("sha256")
      .update(`${workspaceId}\0${projectId}\0${cohortId}\0${reviewerAccountAddress}`)
      .digest("hex")
      .slice(0, 32)}`;
    const reviewerExpiry = reviewerRow.qualification_expires_at
      ? new Date(String(reviewerRow.qualification_expires_at))
      : null;
    const expiresAt = new Date(
      Math.min(now.getTime() + 365 * 86_400_000, reviewerExpiry?.getTime() ?? Number.POSITIVE_INFINITY),
    );
    const evidenceReferenceHash = sha256(
      stableJson({ workspaceId, projectId, cohortId, reviewerAccountAddress, sampleSize, correctCount, accuracyBps }),
    );
    if (accuracyBps >= GOLD_CALIBRATED_ACCURACY_BPS && expiresAt > now) {
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers
         SET qualification_provenance_json=$1,updated_at=$2
         WHERE project_id=$3 AND cohort_id=$4 AND reviewer_account_address=$5`,
        [
          stableJson([
            ...withoutGold,
            {
              key: "gold:calibrated",
              value: true,
              source: "owner_gold",
              assertedBy: workspaceId,
              verifiedAt: now.toISOString(),
            },
          ]),
          now,
          projectId,
          cohortId,
          reviewerAccountAddress,
        ],
      );
      await client.query(
        `INSERT INTO tokenless_reviewer_qualifications
         (qualification_id,rater_id,reviewer_account_address,reviewer_source,qualification_kind,
          cohort_ids_json,qualification_keys_json,evidence_kind,workspace_id,evidence_reference_hash,
          qualification_value_json,verified_at,expires_at,status,created_at,updated_at)
         VALUES ($1,NULL,$2,'customer_invited','gold',$3,$4,'gold_derived',$5,$6,$7,$8,$9,'active',$8,$8)
         ON CONFLICT (qualification_id) DO UPDATE SET
           qualification_keys_json=EXCLUDED.qualification_keys_json,
           evidence_reference_hash=EXCLUDED.evidence_reference_hash,
           qualification_value_json=EXCLUDED.qualification_value_json,
           verified_at=EXCLUDED.verified_at,expires_at=EXCLUDED.expires_at,
           status='active',revoked_at=NULL,updated_at=EXCLUDED.updated_at`,
        [
          qualificationId,
          reviewerAccountAddress,
          stableJson([cohortId]),
          stableJson(["gold:calibrated"]),
          workspaceId,
          evidenceReferenceHash,
          stableJson({ projectId, cohortId, sampleSize, correctCount, accuracyBps }),
          now,
          expiresAt,
        ],
      );
      await client.query(
        `UPDATE tokenless_assurance_gold_outcomes
         SET qualification_state='promoted',promoted_at=$1
         WHERE run_id=$2 AND assignment_id=$3 AND qualification_state='pending'`,
        [now, runId, text(raw, "assignment_id")],
      );
    } else {
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers
         SET qualification_provenance_json=$1,updated_at=$2
         WHERE project_id=$3 AND cohort_id=$4 AND reviewer_account_address=$5`,
        [stableJson(withoutGold), now, projectId, cohortId, reviewerAccountAddress],
      );
      await client.query(
        `UPDATE tokenless_reviewer_qualifications
         SET status='revoked',revoked_at=$1,updated_at=$1
         WHERE qualification_id=$2 AND workspace_id=$3 AND reviewer_account_address=$4 AND status='active'`,
        [now, qualificationId, workspaceId, reviewerAccountAddress],
      );
      await client.query(
        `UPDATE tokenless_assurance_gold_outcomes
         SET qualification_state='ineligible',promoted_at=$1
         WHERE run_id=$2 AND assignment_id=$3 AND qualification_state='pending'`,
        [now, runId, text(raw, "assignment_id")],
      );
    }
  }
}

export async function retireOwnerGoldItem(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  goldItemId: string;
  now?: Date;
}) {
  await requireProjectManager(input.accountAddress, input.workspaceId, input.projectId);
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_gold_items SET status='retired',retired_at=?
          WHERE workspace_id=? AND project_id=? AND gold_item_id=? AND status='active'`,
    args: [input.now ?? new Date(), input.workspaceId, input.projectId, input.goldItemId],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Gold item not found.", 404, "gold_item_not_found");
  return { goldItemId: input.goldItemId, status: "retired" as const };
}

export const __goldQualityTestUtils = {
  setInjectionKeyring(value: GoldInjectionKeyring | null) {
    goldInjectionKeyringOverride = value;
  },
  sha256,
  selectionSeedCommitment,
  stableJson,
  requireHash,
  goldInjectionCount,
  goldProvenanceForSource,
};
