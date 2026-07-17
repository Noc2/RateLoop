import "server-only";
import { dbPool } from "~~/lib/db";
import { decryptWorkspaceOwnedRationale } from "~~/lib/tokenless/assuranceResponses";
import {
  type AssuranceOverrideDecision,
  listAssuranceOverrideDecisions,
  loadRunAccess,
} from "~~/lib/tokenless/evidencePackets";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export type OversightCaseArtifact = {
  artifactId: string;
  role: "baseline" | "candidate" | "context";
  label: string | null;
  contentType: string | null;
  digest: string | null;
};

export type OversightCaseResponse = {
  reviewerPseudonym: string;
  reviewerSource: string;
  choice: "baseline" | "candidate";
  failureTagKeys: string[];
  /** Plaintext only for invited-lane responses — the workspace owns them. */
  rationale: string | null;
  submittedAt: string;
};

export type OversightCase = {
  caseId: string;
  position: number;
  title: string;
  instructions: string;
  isCalibration: boolean;
  artifacts: OversightCaseArtifact[];
  responses: OversightCaseResponse[];
  choiceCounts: { baseline: number; candidate: number };
  /** Share of valid responses that dissent from the case majority, in bps. */
  disagreementBps: number | null;
};

export type OversightRunCaseView = {
  runId: string;
  projectId: string;
  lane: string;
  detailAvailable: boolean;
  note: string | null;
  cases: OversightCase[];
  overrideDecisions: AssuranceOverrideDecision[];
};

const NETWORK_AGGREGATE_NOTE =
  "This run used the RateLoop network lane. Reviewer submissions there are not workspace-owned material, so the " +
  "case view stays aggregate-only: use the run result, evidence packet, and metrics above.";

const HYBRID_NOTE =
  "This run mixed invited reviewers with the RateLoop network. Rationales appear only for invited-lane responses; " +
  "network responses stay aggregate.";

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Stored case-view timestamp is invalid.");
  return parsed.toISOString();
}

function stringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function reviewerPseudonym(reviewerKey: string) {
  // The stored reviewer key is already a keyed pseudonym; showing a short
  // suffix keeps rows distinguishable without widening what the key reveals.
  return `reviewer-${reviewerKey.slice(-8)}`;
}

/**
 * Oversight case detail for a completed run. Access uses the existing
 * decision gate (owner, admin, or designated decision_owner). Invited-lane
 * (workspace-internal) runs expose the reviewed material: case instructions,
 * the blinded artifacts, per-response choices, failure tags, and plaintext
 * rationales, plus per-case disagreement. Public-network runs stay
 * aggregate-only with an explanatory note. Artifact bytes stay behind the
 * existing lease/encryption artifact routes — this view returns references.
 */
export async function getOversightRunCaseView(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
}): Promise<OversightRunCaseView> {
  const client = await dbPool.connect();
  let view: Omit<OversightRunCaseView, "overrideDecisions">;
  try {
    const access = await loadRunAccess(client, input, { decision: true });
    if (text(access.row, "status") !== "completed") {
      throw new TokenlessServiceError(
        "The oversight case view covers completed runs only.",
        409,
        "assurance_run_not_completed",
      );
    }
    const projectId = text(access.row, "project_id")!;
    const laneResult = await client.query(
      `SELECT ap.reviewer_source
       FROM tokenless_assurance_runs r
       JOIN tokenless_assurance_audience_policies ap
         ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
       WHERE r.run_id = $1 LIMIT 1`,
      [input.runId],
    );
    const lane = text(laneResult.rows[0] as Row | undefined, "reviewer_source") ?? "unknown";
    if (lane === "rateloop_network") {
      view = {
        runId: input.runId,
        projectId,
        lane,
        detailAvailable: false,
        note: NETWORK_AGGREGATE_NOTE,
        cases: [],
      };
    } else {
      const [caseRows, artifactRows, responseRows, goldRows] = await Promise.all([
        client.query(
          `SELECT rc.case_id, rc.position, rc.variant_a_artifact_id, rc.variant_b_artifact_id,
                  c.title, c.instructions, c.baseline_artifact_id, c.candidate_artifact_id,
                  c.context_artifact_ids_json
           FROM tokenless_assurance_run_cases rc
           JOIN tokenless_assurance_cases c ON c.case_id = rc.case_id
           WHERE rc.run_id = $1 ORDER BY rc.position ASC`,
          [input.runId],
        ),
        client.query(
          `SELECT artifact_id, role, label, content_type, digest
           FROM tokenless_assurance_artifacts WHERE project_id = $1`,
          [projectId],
        ),
        client.query(
          `SELECT case_id, reviewer_key, reviewer_source, choice, failure_tag_keys_json,
                  rationale_ciphertext, rationale_key_ref, rationale_digest, run_id, submitted_at
           FROM tokenless_assurance_responses
           WHERE run_id = $1 AND validity = 'valid'
           ORDER BY submitted_at ASC, response_id ASC`,
          [input.runId],
        ),
        client.query("SELECT case_id FROM tokenless_assurance_run_gold_items WHERE run_id = $1", [input.runId]),
      ]);
      const artifacts = new Map(
        (artifactRows.rows as Row[]).map(row => [
          text(row, "artifact_id")!,
          {
            label: text(row, "label"),
            contentType: text(row, "content_type"),
            digest: text(row, "digest"),
          },
        ]),
      );
      const goldCases = new Set((goldRows.rows as Row[]).map(row => text(row, "case_id")));
      const responsesByCase = new Map<string, Row[]>();
      for (const row of responseRows.rows as Row[]) {
        const caseId = text(row, "case_id")!;
        responsesByCase.set(caseId, [...(responsesByCase.get(caseId) ?? []), row]);
      }
      const artifactReference = (artifactId: string | null, role: OversightCaseArtifact["role"]) => {
        if (!artifactId) return [];
        const metadata = artifacts.get(artifactId);
        return [
          {
            artifactId,
            role,
            label: metadata?.label ?? null,
            contentType: metadata?.contentType ?? null,
            digest: metadata?.digest ?? null,
          },
        ];
      };
      view = {
        runId: input.runId,
        projectId,
        lane,
        detailAvailable: true,
        note: lane === "hybrid" ? HYBRID_NOTE : null,
        cases: (caseRows.rows as Row[]).map(row => {
          const caseId = text(row, "case_id")!;
          const responses = (responsesByCase.get(caseId) ?? []).map(response => {
            const invited = text(response, "reviewer_source") === "customer_invited";
            const encrypted = text(response, "rationale_ciphertext");
            return {
              reviewerPseudonym: reviewerPseudonym(text(response, "reviewer_key")!),
              reviewerSource: text(response, "reviewer_source")!,
              choice: text(response, "choice") as "baseline" | "candidate",
              failureTagKeys: stringArray(response.failure_tag_keys_json),
              rationale: invited && encrypted ? decryptWorkspaceOwnedRationale(response) : null,
              submittedAt: iso(response.submitted_at),
            } satisfies OversightCaseResponse;
          });
          const baseline = responses.filter(response => response.choice === "baseline").length;
          const candidate = responses.filter(response => response.choice === "candidate").length;
          const total = baseline + candidate;
          return {
            caseId,
            position: Number(row.position ?? 0),
            title: text(row, "title") ?? "",
            instructions: text(row, "instructions") ?? "",
            isCalibration: goldCases.has(caseId),
            artifacts: [
              ...artifactReference(text(row, "baseline_artifact_id"), "baseline"),
              ...artifactReference(text(row, "candidate_artifact_id"), "candidate"),
              ...stringArray(row.context_artifact_ids_json).flatMap(artifactId =>
                artifactReference(artifactId, "context"),
              ),
            ],
            responses,
            choiceCounts: { baseline, candidate },
            disagreementBps: total > 0 ? 10_000 - Math.floor((Math.max(baseline, candidate) * 10_000) / total) : null,
          } satisfies OversightCase;
        }),
      };
    }
  } finally {
    client.release();
  }
  // Reuses the existing (access-checked) override-decision listing so the
  // case view always shows the run's override history alongside the material.
  const overrideDecisions = await listAssuranceOverrideDecisions(input);
  return { ...view, overrideDecisions };
}
