import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function frontendRegistrySlots() {
  const layout = JSON.parse(
    readFileSync(
      join(
        __dirname,
        "..",
        "scripts",
        "expected-storage-layouts",
        "FrontendRegistry.json"
      ),
      "utf8"
    )
  );

  return new Map(layout.storage.map((entry) => [entry.label, entry]));
}

test("FrontendRegistry keeps fee accounting slots stable across upgrades", () => {
  const slots = frontendRegistrySlots();

  assert.deepEqual(
    {
      initialFeeCreditorConfigured: slots.get("initialFeeCreditorConfigured"),
      feeCreditor: slots.get("feeCreditor"),
      authorizedFeeCreditors: slots.get("authorizedFeeCreditors"),
      feeCreditorForEngine: slots.get("feeCreditorForEngine"),
      feeCreditorVotingEngine: slots.get("feeCreditorVotingEngine"),
      pendingFeeWithdrawalAmount: slots.get("pendingFeeWithdrawalAmount"),
      pendingFeeWithdrawalReleaseAt: slots.get("pendingFeeWithdrawalReleaseAt"),
    },
    {
      initialFeeCreditorConfigured: {
        slot: 9,
        offset: 0,
        label: "initialFeeCreditorConfigured",
        type: "t_bool",
      },
      feeCreditor: {
        slot: 9,
        offset: 1,
        label: "feeCreditor",
        type: "t_address",
      },
      authorizedFeeCreditors: {
        slot: 10,
        offset: 0,
        label: "authorizedFeeCreditors",
        type: "t_mapping(t_address,t_bool)",
      },
      feeCreditorForEngine: {
        slot: 11,
        offset: 0,
        label: "feeCreditorForEngine",
        type: "t_mapping(t_address,t_address)",
      },
      feeCreditorVotingEngine: {
        slot: 12,
        offset: 0,
        label: "feeCreditorVotingEngine",
        type: "t_mapping(t_address,t_address)",
      },
      pendingFeeWithdrawalAmount: {
        slot: 13,
        offset: 0,
        label: "pendingFeeWithdrawalAmount",
        type: "t_mapping(t_address,t_uint256)",
      },
      pendingFeeWithdrawalReleaseAt: {
        slot: 14,
        offset: 0,
        label: "pendingFeeWithdrawalReleaseAt",
        type: "t_mapping(t_address,t_uint256)",
      },
    }
  );
});

test("FrontendRegistry appends access-recorder state into the reserved gap", () => {
  const slots = frontendRegistrySlots();

  assert.deepEqual(
    {
      accessRecorderForFrontend: slots.get("accessRecorderForFrontend"),
      frontendForAccessRecorder: slots.get("frontendForAccessRecorder"),
      openSnapshotDisputeCount: slots.get("openSnapshotDisputeCount"),
      openSnapshotDisputeCountByRecorder: slots.get(
        "openSnapshotDisputeCountByRecorder"
      ),
      openSnapshotDisputeCountByRecorderAndFrontend: slots.get(
        "openSnapshotDisputeCountByRecorderAndFrontend"
      ),
      gap: slots.get("__gap"),
    },
    {
      accessRecorderForFrontend: {
        slot: 15,
        offset: 0,
        label: "accessRecorderForFrontend",
        type: "t_mapping(t_address,t_address)",
      },
      frontendForAccessRecorder: {
        slot: 16,
        offset: 0,
        label: "frontendForAccessRecorder",
        type: "t_mapping(t_address,t_address)",
      },
      openSnapshotDisputeCount: {
        slot: 17,
        offset: 0,
        label: "openSnapshotDisputeCount",
        type: "t_mapping(t_address,t_uint256)",
      },
      openSnapshotDisputeCountByRecorder: {
        slot: 18,
        offset: 0,
        label: "openSnapshotDisputeCountByRecorder",
        type: "t_mapping(t_address,t_uint256)",
      },
      openSnapshotDisputeCountByRecorderAndFrontend: {
        slot: 19,
        offset: 0,
        label: "openSnapshotDisputeCountByRecorderAndFrontend",
        type: "t_mapping(t_address,t_mapping(t_address,t_uint256))",
      },
      gap: {
        slot: 20,
        offset: 0,
        label: "__gap",
        type: "t_array(t_uint256)",
      },
    }
  );
});
