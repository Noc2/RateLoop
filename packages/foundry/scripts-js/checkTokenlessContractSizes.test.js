import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertWithinDeploymentSizeLimits,
  EIP170_RUNTIME_CODE_SIZE_LIMIT,
  EIP3860_INITCODE_SIZE_LIMIT,
  inspectTokenlessDeploymentSizes,
  measureDeploymentSize,
  TOKENLESS_DEPLOYMENT_CONTRACTS,
} from "./checkTokenlessContractSizes.js";

function bytecode(size) {
  return `0x${"00".repeat(size)}`;
}

test("measures exact initcode including constructor arguments", () => {
  const rawCreationSize = 10;
  const report = measureDeploymentSize({
    label: "Fixture",
    abi: [{ type: "constructor", inputs: [{ name: "value", type: "string" }] }],
    bytecode: bytecode(rawCreationSize),
    deployedBytecode: bytecode(5),
    args: ["RateLoop"],
  });

  assert.equal(report.runtimeSize, 5);
  assert.ok(report.initcodeSize > rawCreationSize);
});

test("accepts contracts exactly at both protocol limits", () => {
  assert.doesNotThrow(() =>
    assertWithinDeploymentSizeLimits([
      {
        label: "AtLimit",
        runtimeSize: EIP170_RUNTIME_CODE_SIZE_LIMIT,
        initcodeSize: EIP3860_INITCODE_SIZE_LIMIT,
      },
    ])
  );
});

test("blocks deployment when either protocol limit is exceeded", () => {
  assert.throws(
    () =>
      assertWithinDeploymentSizeLimits([
        {
          label: "TooLarge",
          runtimeSize: EIP170_RUNTIME_CODE_SIZE_LIMIT + 1,
          initcodeSize: EIP3860_INITCODE_SIZE_LIMIT + 1,
        },
      ]),
    /Tokenless deployment blocked.*TooLarge runtime.*TooLarge initcode/s
  );
});

test("the checked deployment manifest covers the exact five script targets", () => {
  assert.deepEqual(
    TOKENLESS_DEPLOYMENT_CONTRACTS.map(({ label }) => label),
    [
      "TokenlessTestUSDC",
      "CredentialIssuer",
      "TokenlessPanel",
      "TokenlessFeedbackBonus",
      "X402PanelSubmitter",
    ]
  );
});

test("current compiled deployment artifacts pass the hard size gate", () => {
  const report = inspectTokenlessDeploymentSizes();
  assert.equal(report.length, 5);
  assert.doesNotThrow(() => assertWithinDeploymentSizeLimits(report));
});
