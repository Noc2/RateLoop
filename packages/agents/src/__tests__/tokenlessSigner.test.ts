import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTokenlessAgentKeystore,
  loadTokenlessAgentAccount,
} from "../tokenlessSigner";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("tokenless agent keystore", () => {
  it("creates a mode-0600 encrypted keystore and loads the same account", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rateloop-agent-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "wallet.json");
    const created = await createTokenlessAgentKeystore({ path, password: "correct horse battery staple" });
    const loaded = await loadTokenlessAgentAccount({ path, password: "correct horse battery staple" });
    expect(loaded.address).toBe(created.address);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 3, crypto: { kdf: "scrypt", cipher: "aes-128-ctr" } });
  });

  it("rejects an incorrect password and refuses accidental overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rateloop-agent-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "wallet.json");
    await createTokenlessAgentKeystore({ path, password: "secret" });
    await expect(loadTokenlessAgentAccount({ path, password: "wrong" })).rejects.toThrow(/MAC mismatch/);
    await expect(createTokenlessAgentKeystore({ path, password: "secret" })).rejects.toThrow();
  });
});
