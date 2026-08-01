import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { DatabaseClient } from "~~/lib/db";
import { readDsaReferencePanelPilot } from "~~/lib/tokenless/dsaReferencePanelPilot";
import { DSA_REFERENCE_PANEL_RULES } from "~~/lib/tokenless/dsaReferencePanelPilotTypes";

const HASH = `sha256:${"a".repeat(64)}` as const;
const DEFINITION_HASH = `sha256:${"b".repeat(64)}` as const;
const NOW = new Date("2026-07-01T00:00:00.000Z");

function result(rows: Record<string, unknown>[]) {
  return { rows } as unknown as Awaited<ReturnType<DatabaseClient["execute"]>>;
}

test("read projection separates auditor authority from manager readiness", async () => {
  const statements: string[] = [];
  const client: DatabaseClient = {
    async execute(input) {
      const sql = typeof input === "string" ? input : input.sql;
      statements.push(sql);
      if (sql.includes("dsa-reference-panel:epochs")) {
        return result([
          {
            workspace_id: "workspace_auditor",
            workspace_name: "External review",
            project_id: "project_auditor",
            project_name: "Policy sample",
            epoch_id: `rse_${"1".repeat(40)}`,
            reporting_window_start: NOW,
            reporting_window_end: new Date("2026-07-31T00:00:00.000Z"),
            access_role: "auditor",
            definition_version: null,
            definition_question: null,
            standard_id: null,
            standard_version: null,
            standard_hash: null,
            definition_hash: null,
            definition_created_at: null,
            label_set_frozen: false,
          },
          {
            workspace_id: "workspace_manager",
            workspace_name: "Operations",
            project_id: "project_manager",
            project_name: "Selected cases",
            epoch_id: `rse_${"2".repeat(40)}`,
            reporting_window_start: NOW,
            reporting_window_end: new Date("2026-07-31T00:00:00.000Z"),
            access_role: "manager",
            definition_version: 1,
            definition_question: "Does this decision match the frozen policy?",
            standard_id: "policy.standard",
            standard_version: "2026-07",
            standard_hash: HASH,
            definition_hash: DEFINITION_HASH,
            definition_created_at: NOW,
            label_set_frozen: false,
          },
        ]);
      }
      if (sql.includes("dsa-reference-panel:candidates")) {
        return result([
          {
            workspace_id: "workspace_manager",
            project_id: "project_manager",
            epoch_id: `rse_${"2".repeat(40)}`,
            unit_id: "rsu_abcdefghijklmnopqrstuv",
            public_designation: "Text policy classifier",
            decision_at: NOW,
            source_records_ready: true,
            registered: false,
          },
        ]);
      }
      if (sql.includes("dsa-reference-panel:runs")) {
        return result([
          {
            workspace_id: "workspace_manager",
            project_id: "project_manager",
            epoch_id: `rse_${"2".repeat(40)}`,
            unit_id: "rsu_abcdefghijklmnopqrstuv",
            run_id: "run_named_panel",
            case_id: "case_named_panel",
            suite_name: "Named review",
            case_title: "Selected decision",
            reviewer_count: 3,
          },
        ]);
      }
      if (sql.includes("dsa-reference-panel:unit-statuses")) {
        return result([
          {
            workspace_id: "workspace_auditor",
            project_id: "project_auditor",
            epoch_id: `rse_${"1".repeat(40)}`,
            unit_id: "rsu_zyxwvutsrqponmlkjihgfe",
            public_designation: "Audio policy classifier",
            required_reviewer_count: 2,
            access_role: "auditor",
            assignment_count: 2,
            assigned_reviewer_count: 2,
            assignment_deadline: new Date("2026-06-30T00:00:00.000Z"),
            response_count: 1,
            response_choice_count: 1,
            access_count: 1,
            content_self_identification_report_count: 0,
            terminal: false,
            adjudicated: false,
            adjudicator_principal_id: null,
            adjudication_deadline: null,
            response_materialization_state: "cooldown",
            response_materialization_failure_count: 8,
            response_materialization_next_retry_at: new Date("2026-07-01T00:15:00.000Z"),
            projection_now: NOW,
          },
          {
            workspace_id: "workspace_manager",
            project_id: "project_manager",
            epoch_id: `rse_${"2".repeat(40)}`,
            unit_id: "rsu_abcdefghijklmnopqrstuv",
            public_designation: "Text policy classifier",
            required_reviewer_count: 3,
            access_role: "manager",
            assignment_count: 3,
            assigned_reviewer_count: 3,
            assignment_deadline: new Date("2026-07-10T00:00:00.000Z"),
            response_count: 3,
            response_choice_count: 1,
            access_count: 3,
            content_self_identification_report_count: 0,
            terminal: false,
            adjudicated: false,
            adjudicator_principal_id: null,
            adjudication_deadline: null,
            response_materialization_state: "retrying",
            response_materialization_failure_count: 2,
            response_materialization_next_retry_at: NOW,
            projection_now: NOW,
          },
        ]);
      }
      return result([
        {
          workspace_id: "workspace_adjudication",
          project_id: "project_adjudication",
          epoch_id: `rse_${"3".repeat(40)}`,
          unit_id: "rsu_vutsrqponmlkjihgfedcba",
          question: "Does the decision match the policy?",
          adjudication_deadline: new Date("2026-07-15T00:00:00.000Z"),
          language_tag: "de",
          required_cefr_level: "B2",
          policy_category_code: "illegal_content",
          qualification_provenance_json: JSON.stringify([
            {
              key: "language:de:reading:cefr",
              value: "C1",
              verifiedAt: "2026-06-01T00:00:00.000Z",
              expiresAt: "2026-08-01T00:00:00.000Z",
              source: "verified-language",
              assertedBy: "qualification-provider",
              evidenceVersion: "v1",
              evidenceReferenceHash: HASH,
            },
            {
              key: "dsa-policy-category:illegal_content",
              value: true,
              verifiedAt: "2026-06-01T00:00:00.000Z",
              expiresAt: "2026-08-01T00:00:00.000Z",
              source: "verified-category",
              assertedBy: "qualification-provider",
              evidenceVersion: "v1",
              evidenceReferenceHash: HASH,
            },
          ]),
          projection_now: NOW,
        },
      ]);
    },
  };

  const pilot = await readDsaReferencePanelPilot({ accountAddress: "rlp_abcdefghijklmnopqrstuvwxyz" }, client);
  const epochs = pilot.epochs;

  assert.equal(epochs.length, 2);
  assert.equal(epochs[0]?.role, "auditor");
  assert.equal("managerReadiness" in epochs[0]!, false);
  if (epochs[0]?.role !== "auditor") assert.fail("Expected auditor projection.");
  assert.equal(epochs[0].auditorReadiness.units[0]?.canDeclareGap, true);
  assert.equal(epochs[0].auditorReadiness.units[0]?.responseMaterializationState, "cooldown");
  assert.equal(epochs[0].auditorReadiness.units[0]?.responseMaterializationFailureCount, 8);
  assert.equal(epochs[0].auditorReadiness.units[0]?.responseMaterializationNextRetryAt, "2026-07-01T00:15:00.000Z");
  assert.equal("canFreezeOutcome" in epochs[0].auditorReadiness.units[0]!, false);
  assert.equal(epochs[1]?.role, "manager");
  if (epochs[1]?.role !== "manager") assert.fail("Expected manager projection.");
  assert.equal(epochs[1].managerReadiness.sourceReadyUnitCount, 1);
  assert.equal(epochs[1].managerReadiness.preparedRuns[0]?.reviewerCount, 3);
  assert.deepEqual(epochs[1].managerReadiness.preparedRuns[0]?.compatibleUnitIds, ["rsu_abcdefghijklmnopqrstuv"]);
  assert.equal(epochs[1].managerReadiness.registeredUnits[0]?.canFreezeOutcome, true);
  assert.equal(epochs[1].managerReadiness.registeredUnits[0]?.responseMaterializationState, "ready");
  assert.equal(epochs[1].managerReadiness.registeredUnits[0]?.responseMaterializationFailureCount, 2);
  assert.equal("canDeclareGap" in epochs[1].managerReadiness.registeredUnits[0]!, false);
  assert.equal(pilot.adjudications.length, 1);
  assert.deepEqual(pilot.adjudications[0], {
    workspaceId: "workspace_adjudication",
    epochId: `rse_${"3".repeat(40)}`,
    unitId: "rsu_vutsrqponmlkjihgfedcba",
    question: "Does the decision match the policy?",
    adjudicationDeadline: "2026-07-15T00:00:00.000Z",
  });

  assert.match(statements[0]!, /manager\.role IN \('owner','admin'\)/u);
  assert.match(statements[0]!, /NOT EXISTS \([\s\S]*tokenless_workspace_members member/u);
  assert.match(statements[0]!, /access\.subject_kind='principal'[\s\S]*access\.role='auditor'/u);
  assert.match(statements[1]!, /manager\.role IN \('owner','admin'\)/u);
  assert.doesNotMatch(statements[1]!, /tokenless_project_access_assignments/u);
  assert.match(statements[2]!, /artifact\.digest=source\.engagement_json::jsonb->>'contentHash'/u);
  assert.match(statements[2]!, /artifact\.content_type=source\.engagement_json::jsonb->>'contentFormat'/u);
  assert.match(statements[3]!, /tokenless_dsa_named_panel_selections/u);
  assert.match(statements[3]!, /max\(assignment\.panel_deadline\)/u);
  assert.match(statements[3]!, /tokenless_dsa_named_panel_materialization_retries materialization/u);
  assert.doesNotMatch(statements[3]!, /failure_code/u);
  assert.match(statements[4]!, /count\(DISTINCT response\.derived_label\)[\s\S]*>=2/u);
  assert.match(statements[4]!, /tokenless_dsa_named_panel_selections panel/u);
  assert.match(statements[4]!, /NOT EXISTS \([\s\S]*tokenless_workspace_members member/u);
  assert.match(statements[4]!, /NOT EXISTS \([\s\S]*tokenless_project_access_assignments access/u);
  assert.match(
    statements[4]!,
    /access\.status='active'[\s\S]*access\.expires_at IS NULL OR access\.expires_at>CURRENT_TIMESTAMP/u,
  );
});

test("pilot rule projection stays bound to the frozen backend definition", async () => {
  const source = await readFile(new URL("./dsaNamedReferencePanel.ts", import.meta.url), "utf8");
  assert.match(
    source,
    new RegExp(
      `policyMatches: "${DSA_REFERENCE_PANEL_RULES.responsePolarity.policyMatches}"[\\s\\S]*policyDoesNotMatch: "${DSA_REFERENCE_PANEL_RULES.responsePolarity.policyDoesNotMatch}"`,
      "u",
    ),
  );
  assert.match(source, new RegExp(`uncertaintyRule: "${DSA_REFERENCE_PANEL_RULES.uncertaintyRule}"`, "u"));
  assert.match(source, new RegExp(`adjudicationRule: "${DSA_REFERENCE_PANEL_RULES.adjudicationRule}"`, "u"));
});
