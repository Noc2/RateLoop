import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { freezeDsaNamedPanelSelectionAtReservation } from "~~/lib/tokenless/dsaNamedPanelSelections";

const ACCEPTANCE_DEADLINE = new Date("2026-08-01T12:15:00.000Z");
const SELECTED_AT = new Date("2026-08-01T12:00:00.000Z");
const PANEL_DEADLINE = new Date("2026-08-04T12:00:00.000Z");

function selectedRow() {
  return {
    workspace_id: "workspace_selection",
    project_id: "project_selection",
    epoch_id: `rse_${"1".repeat(40)}`,
    unit_id: "rsu_abcdefghijklmnopqrstuv",
    run_id: "run_selection",
    case_id: "case_selection",
    mapping_commitment: `sha256:${"2".repeat(64)}`,
    assignment_id: "haas_selection",
    subpanel_id: "subpanel_selection",
    cohort_id: "cohort_selection",
    reviewer_account_address: "rlp_selected_reviewer_0001",
    source: "customer_invited",
    selection: "customer_named",
    status: "reserved",
    paid_assignment: false,
    response_window_ms: 72 * 60 * 60_000,
    assurance_snapshot_hash: `sha256:${"3".repeat(64)}`,
    reservation_expires_at: ACCEPTANCE_DEADLINE,
    created_at: SELECTED_AT,
  };
}

test("reservation freezes a canonical selected seat under the unit write lock", async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  let snapshotHash = "";
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push({ text, values });
      if (statements.length === 1) return { rows: [selectedRow()], rowCount: 1 };
      if (statements.length === 2) {
        const snapshot = JSON.parse(String(values?.[15])) as Record<string, unknown>;
        snapshotHash = String(values?.[16]);
        assert.equal(snapshotHash, sha256Rfc8785(snapshot));
        assert.equal(snapshot.statusAtSelection, "reserved");
        assert.equal(snapshot.acceptanceDeadline, ACCEPTANCE_DEADLINE.toISOString());
        assert.equal(snapshot.panelDeadline, PANEL_DEADLINE.toISOString());
        assert.equal(snapshot.responseWindowMs, 72 * 60 * 60_000);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [{ selection_snapshot_hash: snapshotHash }], rowCount: 1 };
    },
  } as unknown as PoolClient;

  const frozen = await freezeDsaNamedPanelSelectionAtReservation(client, "haas_selection");
  assert.equal(frozen?.panelDeadline, PANEL_DEADLINE.toISOString());
  assert.match(statements[0]!.text, /FOR UPDATE OF unit FOR SHARE OF assignment/u);
  assert.match(statements[1]!.text, /INSERT INTO tokenless_dsa_named_panel_selections/u);
});

test("non-customer-named reservations cannot become named-panel seats", async () => {
  const client = {
    async query() {
      return { rows: [{ ...selectedRow(), selection: "randomized" }], rowCount: 1 };
    },
  } as unknown as PoolClient;
  await assert.rejects(
    () => freezeDsaNamedPanelSelectionAtReservation(client, "haas_selection"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "dsa_named_panel_selection_invalid",
  );
});
