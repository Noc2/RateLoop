import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inputPathCandidates, resolveExistingInputPath } from "../inputPaths.js";

describe("agent CLI input paths", () => {
  it("keeps repo-root paths usable from yarn workspace commands", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "rateloop-agent-paths-"));
    const packageRoot = join(repoRoot, "packages", "agents");
    const imagePath = join(packageRoot, "examples", "mockup.png");
    await mkdir(join(packageRoot, "examples"), { recursive: true });
    await writeFile(imagePath, "png");

    const requestedPath = "packages/agents/examples/mockup.png";

    expect(
      inputPathCandidates(requestedPath, {
        invocationCwd: repoRoot,
        packagePrefix: "packages/agents/",
        packageRoot,
        processCwd: packageRoot,
      }),
    ).toContain(imagePath);
    expect(
      resolveExistingInputPath(requestedPath, {
        invocationCwd: repoRoot,
        label: "Handoff image",
        packagePrefix: "packages/agents/",
        packageRoot,
        processCwd: packageRoot,
      }),
    ).toBe(imagePath);
  });

  it("uses a short missing-file error", () => {
    expect(() =>
      resolveExistingInputPath("missing.png", {
        invocationCwd: "/tmp/rateloop-missing",
        label: "Handoff image",
        processCwd: "/tmp/rateloop-missing",
      }),
    ).toThrow("Handoff image not found: missing.png");
  });
});
