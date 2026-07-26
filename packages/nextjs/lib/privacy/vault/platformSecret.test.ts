import {
  createPlatformSecretKeyWrappingProvider,
  loadPlatformSecretKeyringConfiguration,
} from "./platformSecret";
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalKeyWrappingProvider } from "~~/lib/privacy/vault";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const AAD_V1 = Buffer.from("customer_artifact:workspace_1:project_1:artifact_1:artifact-v1");
const AAD_V2 = Buffer.from("customer_artifact:workspace_1:project_1:artifact_1:artifact-v2");

test("platform-secret keyring is version-pinned and never accepts public configuration", () => {
  const v1 = Buffer.alloc(32, 1).toString("base64url");
  const v2 = Buffer.alloc(32, 2).toString("base64url");
  const configuration = loadPlatformSecretKeyringConfiguration({
    TOKENLESS_ARTIFACT_WRAPPING_KEYS: JSON.stringify({ "artifact-v1": v1, "artifact-v2": v2 }),
    TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v2",
  } as NodeJS.ProcessEnv);
  assert.equal(configuration.activeVersion, "artifact-v2");
  assert.deepEqual([...configuration.keys.keys()], ["artifact-v1", "artifact-v2"]);
  assert.throws(
    () =>
      loadPlatformSecretKeyringConfiguration({
        NEXT_PUBLIC_TOKENLESS_ARTIFACT_WRAPPING_KEYS: "{}",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_vault_key_forbidden",
  );
  assert.throws(
    () =>
      loadPlatformSecretKeyringConfiguration({
        TOKENLESS_ARTIFACT_WRAPPING_KEYS: JSON.stringify({ "artifact-v1": v1 }),
        TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v2",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_artifact_key",
  );
});

test("platform-secret wrapping derives tenant keys and rotates without re-encrypting content", async () => {
  const v1 = Buffer.alloc(32, 1);
  const v2 = Buffer.alloc(32, 2);
  const first = createPlatformSecretKeyWrappingProvider({
    activeVersion: "artifact-v1",
    keys: new Map([["artifact-v1", v1]]),
  });
  const dataKey = Buffer.alloc(32, 9);
  const wrapped = await first.wrap(dataKey, AAD_V1);
  assert.equal(wrapped.provider, "platform-secret");
  assert.equal(wrapped.keyResource, "platform-secret://artifact-wrapping/artifact-v1");
  assert.deepEqual(await first.unwrap(wrapped, AAD_V1), dataKey);

  const rotated = createPlatformSecretKeyWrappingProvider({
    activeVersion: "artifact-v2",
    keys: new Map([
      ["artifact-v1", v1],
      ["artifact-v2", v2],
    ]),
  });
  assert.deepEqual(await rotated.unwrap(wrapped, AAD_V1), dataKey);
  const rewrapped = await rotated.wrap(await rotated.unwrap(wrapped, AAD_V1), AAD_V2);
  assert.equal(rewrapped.keyVersion, "artifact-v2");
  assert.deepEqual(await rotated.unwrap(rewrapped, AAD_V2), dataKey);

  await assert.rejects(
    () => rotated.unwrap(wrapped, Buffer.from("customer_artifact:workspace_2:project_1:artifact_1:artifact-v1")),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "vault_key_unavailable",
  );
});

test("platform-secret keyring decrypts retained legacy local-test envelopes", async () => {
  const root = Buffer.alloc(32, 7);
  const legacy = createLocalKeyWrappingProvider({ key: root, keyVersion: "artifact-v1" });
  const wrapped = await legacy.wrap(Buffer.alloc(32, 8), AAD_V1);
  const platform = createPlatformSecretKeyWrappingProvider({
    activeVersion: "artifact-v2",
    keys: new Map([
      ["artifact-v1", root],
      ["artifact-v2", Buffer.alloc(32, 9)],
    ]),
  });
  assert.deepEqual(await platform.unwrap(wrapped, AAD_V1), Buffer.alloc(32, 8));
});

test("legacy platform secret loads as a one-version transitional keyring", () => {
  const root = Buffer.alloc(32, 4);
  const configuration = loadPlatformSecretKeyringConfiguration({
    TOKENLESS_ARTIFACT_KEY_VERSION: "legacy-v4",
    TOKENLESS_ARTIFACT_MASTER_KEY: root.toString("base64url"),
  } as NodeJS.ProcessEnv);
  assert.equal(configuration.activeVersion, "legacy-v4");
  assert.deepEqual(configuration.keys.get("legacy-v4"), root);
});
