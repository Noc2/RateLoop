import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSafeKeystoreNames } from "./listKeystores.js";
import { normalizeImportAccountName } from "./importAccount.js";

test("getSafeKeystoreNames filters reserved and shell-unsafe names", () => {
  const directory = mkdtempSync(join(tmpdir(), "rateloop-keystores-"));

  try {
    for (const name of [
      "deployer",
      "keeper-prod_1.json",
      "scaffold-eth-default",
      "keeper;echo-pwned",
      "../outside",
      "-flag",
      "with space",
    ]) {
      if (!name.includes("/")) {
        writeFileSync(join(directory, name), "{}");
      }
    }

    assert.deepEqual(getSafeKeystoreNames(directory).sort(), [
      "deployer",
      "keeper-prod_1.json",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalizeImportAccountName accepts only deploy keystore account names", () => {
  assert.equal(normalizeImportAccountName(" deployer-1 "), "deployer-1");

  for (const value of [
    "scaffold-eth-default",
    "keeper;echo-pwned",
    "keeper profile",
    "../keeper",
    "-keeper",
  ]) {
    assert.throws(() => normalizeImportAccountName(value));
  }
});
