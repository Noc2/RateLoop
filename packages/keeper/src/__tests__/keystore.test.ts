import { afterEach, describe, expect, it, vi } from "vitest";

type KeystoreOptions = {
  account?: string;
  password?: string;
  decryptError?: Error;
};

const KEYSTORE_ACCOUNT_RESULT = {
  address: "0x1111111111111111111111111111111111111111",
};

async function loadKeystore(options: KeystoreOptions = {}) {
  vi.resetModules();

  if (options.account === undefined) {
    vi.stubEnv("KEYSTORE_ACCOUNT", "");
  } else {
    vi.stubEnv("KEYSTORE_ACCOUNT", options.account);
  }
  if (options.password === undefined) {
    vi.stubEnv("KEYSTORE_PASSWORD", "");
  } else {
    vi.stubEnv("KEYSTORE_PASSWORD", options.password);
  }

  const getKeystoreAccountFromCredentials = vi.fn(() => {
    if (options.decryptError) throw options.decryptError;
    return KEYSTORE_ACCOUNT_RESULT;
  });

  vi.doMock("@rateloop/node-utils/keystore", () => ({
    getKeystoreAccountFromCredentials,
  }));

  const keystoreModule = await import("../keystore.js");
  return { ...keystoreModule, getKeystoreAccountFromCredentials };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("keeper keystore", () => {
  it("returns null when no keystore credentials are configured", async () => {
    const keystore = await loadKeystore();

    expect(keystore.getKeystoreAccount()).toBeNull();
    expect(keystore.getKeystoreAccountFromCredentials).not.toHaveBeenCalled();
  });

  it("decrypts and caches the configured keystore account", async () => {
    const keystore = await loadKeystore({
      account: "keeper",
      password: "secret",
    });

    expect(keystore.getKeystoreAccount()).toBe(KEYSTORE_ACCOUNT_RESULT);
    expect(keystore.getKeystoreAccount()).toBe(KEYSTORE_ACCOUNT_RESULT);
    expect(keystore.getKeystoreAccountFromCredentials).toHaveBeenCalledOnce();
  });

  it("throws with the real cause when keystore decryption fails", async () => {
    const keystore = await loadKeystore({
      account: "keeper",
      password: "wrong-password",
      decryptError: new Error("MAC mismatch"),
    });

    // A wrong keystore password must be fatal — never a silent null that lets
    // client.ts fall back to KEEPER_PRIVATE_KEY (a different signing identity).
    expect(() => keystore.getKeystoreAccount()).toThrow(
      'Failed to decrypt keystore account "keeper": MAC mismatch. ' +
        "Check KEYSTORE_ACCOUNT/KEYSTORE_PASSWORD; refusing to fall back to KEEPER_PRIVATE_KEY.",
    );
  });
});
