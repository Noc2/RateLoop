import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const outputDir = path.resolve("test-correlation-artifacts");
const mkdir = vi.fn(async (..._args: unknown[]) => undefined);
const rename = vi.fn(async (..._args: unknown[]) => undefined);
const rm = vi.fn(async (..._args: unknown[]) => undefined);
const writeFile = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("node:fs/promises", () => ({ mkdir, rename, rm, writeFile }));
vi.mock("../config.js", () => ({
  config: {
    correlationSnapshots: {
      artifactStorage: {
        mode: "file",
        outputDir,
        publicBaseUrl: "https://artifacts.example.test/correlation",
      },
    },
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("correlation artifact storage", () => {
  it("publishes file artifacts with an atomic rename", async () => {
    const { materializeCorrelationArtifactCanonicalJson } = await import(
      "../correlation-artifact-storage.js"
    );
    const canonical = '{"ok":true}';

    const stored = await materializeCorrelationArtifactCanonicalJson(canonical);
    const finalPath = path.join(outputDir, `${stored.artifactHash}.json`);
    const temporaryPath = writeFile.mock.calls[0]?.[0];

    expect(mkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(temporaryPath).not.toBe(finalPath);
    expect(temporaryPath).toMatch(
      new RegExp(`^${escapeRegExp(finalPath)}\\.\\d+\\.[^.]+\\.tmp$`, "u"),
    );
    expect(writeFile).toHaveBeenCalledWith(temporaryPath, canonical, "utf8");
    expect(rename).toHaveBeenCalledWith(temporaryPath, finalPath);
    expect(stored.artifactURI).toBe(
      `https://artifacts.example.test/correlation/${stored.artifactHash}.json`,
    );
  });

  it("removes the temporary file when publication fails", async () => {
    rename.mockRejectedValueOnce(new Error("rename failed"));
    const { materializeCorrelationArtifactCanonicalJson } = await import(
      "../correlation-artifact-storage.js"
    );

    await expect(
      materializeCorrelationArtifactCanonicalJson('{"ok":false}'),
    ).rejects.toThrow("rename failed");

    expect(rm).toHaveBeenCalledWith(writeFile.mock.calls[0]?.[0], {
      force: true,
    });
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
