import assert from "node:assert/strict";
import test from "node:test";
import { getMissingKeeperEnvVars } from "./dev-stack-keeper.mjs";

test("requires a keystore password when keystore auth is the only keeper wallet path", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "http://localhost:8545",
      CHAIN_ID: "31337",
      KEYSTORE_ACCOUNT: "keeper",
      KEYSTORE_PASSWORD: "",
      KEEPER_PRIVATE_KEY: "",
    }),
    ["KEYSTORE_PASSWORD"],
  );
});

test("allows private-key keeper startup even when KEYSTORE_ACCOUNT is still populated", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "http://localhost:8545",
      CHAIN_ID: "31337",
      KEYSTORE_ACCOUNT: "keeper",
      KEYSTORE_PASSWORD: "",
      KEEPER_PRIVATE_KEY: "0xabc",
    }),
    [],
  );
});

test("requires Ponder for automatic correlation snapshots", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "http://localhost:8545",
      CHAIN_ID: "31337",
      KEEPER_PRIVATE_KEY: "0xabc",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
    }),
    ["PONDER_BASE_URL"],
  );
});

test("allows local automatic correlation snapshots with data-uri artifacts", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "http://localhost:8545",
      CHAIN_ID: "31337",
      KEEPER_PRIVATE_KEY: "0xabc",
      PONDER_BASE_URL: "http://localhost:42069",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "data-uri",
    }),
    [],
  );
});

test("defaults local automatic correlation snapshots to data-uri artifacts", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "http://localhost:8545",
      CHAIN_ID: "31337",
      KEEPER_PRIVATE_KEY: "0xabc",
      PONDER_BASE_URL: "http://localhost:42069",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
    }),
    [],
  );
});

test("requires a public artifact base URL when automatic snapshots use file storage", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "http://localhost:8545",
      CHAIN_ID: "31337",
      KEEPER_PRIVATE_KEY: "0xabc",
      PONDER_BASE_URL: "http://localhost:42069",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
    }),
    ["KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL"],
  );
});

test("requires a valid HTTPS public artifact base URL when automatic snapshots use file storage", () => {
  for (const publicBaseUrl of ["http://artifacts.example.com/rateloop", "not a url"]) {
    assert.deepEqual(
      getMissingKeeperEnvVars({
        RPC_URL: "http://localhost:8545",
        CHAIN_ID: "31337",
        KEEPER_PRIVATE_KEY: "0xabc",
        PONDER_BASE_URL: "http://localhost:42069",
        KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
        KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
        KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
        KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: publicBaseUrl,
      }),
      ["KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL must be a valid HTTPS URL"],
    );
  }
});

test("defaults non-local automatic correlation snapshots to file artifacts", () => {
  assert.deepEqual(
    getMissingKeeperEnvVars({
      RPC_URL: "https://worldchain-sepolia.example",
      CHAIN_ID: "4801",
      KEEPER_PRIVATE_KEY: "0xabc",
      PONDER_BASE_URL: "https://ponder.example.com",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
    }),
    ["KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL"],
  );
});
