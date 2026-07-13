import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTokenlessDeployArgs } from "./tokenlessDeployArgs.js";

test("allows an interactive Base Sepolia deployment without --keystore", () => {
  assert.deepEqual(parseTokenlessDeployArgs(["--network", "baseSepolia"]), {
    keystore: undefined,
    network: "baseSepolia",
    resume: false,
    showHelp: false,
  });
});

test("preserves explicit keystore and resume arguments for automation", () => {
  assert.deepEqual(
    parseTokenlessDeployArgs([
      "--network",
      "baseSepolia",
      "--keystore",
      "tokenless-deployer",
      "--resume",
    ]),
    {
      keystore: "tokenless-deployer",
      network: "baseSepolia",
      resume: true,
      showHelp: false,
    }
  );
});

test("rejects missing flag values and unsupported networks", () => {
  assert.throws(() => parseTokenlessDeployArgs(["--network"]), /requires a value/);
  assert.throws(
    () => parseTokenlessDeployArgs(["--network", "baseSepolia", "--keystore"]),
    /requires a value/
  );
  assert.throws(
    () => parseTokenlessDeployArgs(["--network", "base"]),
    /Only --network baseSepolia/
  );
});
