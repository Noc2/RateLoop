import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertFoundryAccountName,
  listFoundryAccounts,
  readStoredFoundryAccountAddress,
  requireFoundryAccount,
  resolveFoundryAccountSelection,
} from "./foundryAccounts.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "rateloop-foundry-accounts-"));
  const keystoreDirectory = join(root, ".foundry", "keystores");
  mkdirSync(keystoreDirectory, { recursive: true });
  return { root, keystoreDirectory };
}

test("lists only safe deployable Foundry account files in stable order", () => {
  const { root, keystoreDirectory } = fixture();
  try {
    writeFileSync(join(keystoreDirectory, "zeta"), "{}");
    writeFileSync(join(keystoreDirectory, "alpha-1"), "{}");
    writeFileSync(join(keystoreDirectory, "scaffold-eth-default"), "{}");
    writeFileSync(join(keystoreDirectory, "unsafe account"), "{}");
    mkdirSync(join(keystoreDirectory, "directory-account"));
    symlinkSync(join(keystoreDirectory, "zeta"), join(keystoreDirectory, "linked-account"));

    assert.deepEqual(listFoundryAccounts({ keystoreDirectory }), [
      "alpha-1",
      "linked-account",
      "zeta",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires an existing safe account and rejects the local Anvil account", () => {
  const { root, keystoreDirectory } = fixture();
  try {
    writeFileSync(join(keystoreDirectory, "tokenless-deployer"), "{}");
    mkdirSync(join(keystoreDirectory, "directory-account"));
    assert.equal(
      requireFoundryAccount("tokenless-deployer", { keystoreDirectory }),
      "tokenless-deployer"
    );
    assert.throws(
      () => requireFoundryAccount("missing", { keystoreDirectory }),
      /does not exist/
    );
    assert.throws(
      () => requireFoundryAccount("directory-account", { keystoreDirectory }),
      /not a keystore file/
    );
    assert.throws(() => assertFoundryAccountName("../escape"), /must use only/);
    assert.throws(
      () => assertFoundryAccountName("scaffold-eth-default"),
      /reserved for local Anvil/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolves a numbered account selection and rejects invalid input", () => {
  const accounts = ["alpha", "beta"];
  assert.equal(resolveFoundryAccountSelection("2", accounts), "beta");
  assert.throws(() => resolveFoundryAccountSelection("0", accounts), /outside/);
  assert.throws(() => resolveFoundryAccountSelection("three", accounts), /must be a number/);
});

test("reads the public address without decrypting the Foundry keystore", () => {
  const { root, keystoreDirectory } = fixture();
  try {
    writeFileSync(
      join(keystoreDirectory, "tokenless-deployer"),
      JSON.stringify({
        address: "1111111111111111111111111111111111111111",
        crypto: { ciphertext: "secret" },
      })
    );
    assert.equal(
      readStoredFoundryAccountAddress("tokenless-deployer", { keystoreDirectory }),
      "0x1111111111111111111111111111111111111111"
    );

    writeFileSync(
      join(keystoreDirectory, "legacy"),
      JSON.stringify({ crypto: { ciphertext: "secret" } })
    );
    assert.equal(
      readStoredFoundryAccountAddress("legacy", { keystoreDirectory }),
      null
    );

    writeFileSync(
      join(keystoreDirectory, "invalid"),
      JSON.stringify({ address: "not-an-address" })
    );
    assert.throws(
      () => readStoredFoundryAccountAddress("invalid", { keystoreDirectory }),
      /invalid public address/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
