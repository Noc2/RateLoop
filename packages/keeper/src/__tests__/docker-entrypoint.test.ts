import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entrypoint = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docker-entrypoint.sh",
);

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runEntrypoint(enabled: string) {
  const tempDir = await mkdtemp(join(tmpdir(), "rateloop-keeper-entrypoint-"));
  const binDir = join(tempDir, "bin");
  const artifactDir = join(tempDir, "artifacts");

  await mkdir(binDir);
  for (const command of ["chown", "su-exec"]) {
    const commandPath = join(binDir, command);
    await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(commandPath, 0o755);
  }

  const result = spawnSync("sh", [entrypoint], {
    encoding: "utf8",
    env: {
      ...process.env,
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: enabled,
      KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR: artifactDir,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
  });

  return { artifactDir, result, tempDir };
}

describe("keeper Docker entrypoint", () => {
  for (const enabled of ["1", "true", " YES ", "On"]) {
    it(`prepares file artifacts for ${JSON.stringify(enabled)}`, async () => {
      const { artifactDir, result, tempDir } = await runEntrypoint(enabled);
      try {
        expect(result.status, result.stderr).toBe(0);
        expect(await pathExists(artifactDir)).toBe(true);
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    });
  }

  it("leaves file artifacts untouched when snapshots are disabled", async () => {
    const { artifactDir, result, tempDir } = await runEntrypoint("off");
    try {
      expect(result.status, result.stderr).toBe(0);
      expect(await pathExists(artifactDir)).toBe(false);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
