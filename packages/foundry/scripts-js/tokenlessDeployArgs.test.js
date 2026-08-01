import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  parseTokenlessDeployArgs,
  requireTokenlessFeeRecipient,
} from "./tokenlessDeployArgs.js";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

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
    },
  );
});

test("rejects missing flag values and unsupported networks", () => {
  assert.throws(
    () => parseTokenlessDeployArgs(["--network"]),
    /requires a value/,
  );
  assert.throws(
    () => parseTokenlessDeployArgs(["--network", "baseSepolia", "--keystore"]),
    /requires a value/,
  );
  assert.throws(
    () => parseTokenlessDeployArgs(["--network", "base"]),
    /Only --network baseSepolia/,
  );
});

test("requires a valid non-zero fee recipient before deployment", () => {
  assert.equal(
    requireTokenlessFeeRecipient({
      TOKENLESS_FEE_RECIPIENT: "0x1111111111111111111111111111111111111111",
    }),
    "0x1111111111111111111111111111111111111111",
  );
  for (const feeRecipient of [
    undefined,
    "not-an-address",
    "0x0000000000000000000000000000000000000000",
  ]) {
    assert.throws(
      () =>
        requireTokenlessFeeRecipient({
          TOKENLESS_FEE_RECIPIENT: feeRecipient,
        }),
      /must be a non-zero address/u,
    );
  }
});

test("invalid fee recipient exits before any chain probe or deployment child process", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "rateloop-tokenless-deploy-preflight-"),
  );
  const binDirectory = join(fixtureRoot, "bin");
  const childMarker = join(fixtureRoot, "child-process-started");
  mkdirSync(binDirectory, { recursive: true });
  try {
    for (const command of ["cast", "make"]) {
      const executable = join(binDirectory, command);
      writeFileSync(
        executable,
        `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(
          childMarker,
        )}, ${JSON.stringify(`${command}\n`)});\nprocess.exit(0);\n`,
      );
      chmodSync(executable, 0o755);
    }

    for (const feeRecipient of [
      " ",
      "not-an-address",
      "0x0000000000000000000000000000000000000000",
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          join(scriptsDirectory, "parseArgs.js"),
          "--network",
          "baseSepolia",
          "--keystore",
          "unused",
        ],
        {
          cwd: join(scriptsDirectory, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
            TOKENLESS_FEE_RECIPIENT: feeRecipient,
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /TOKENLESS_FEE_RECIPIENT must be a non-zero address/u,
      );
      assert.equal(existsSync(childMarker), false);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
