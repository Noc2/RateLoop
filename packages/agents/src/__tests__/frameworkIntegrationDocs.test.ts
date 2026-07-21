import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("framework integration documentation", () => {
  it("documents non-blocking state, signed release, and current host primitives", async () => {
    const docs = await readFile(
      `${repoRoot}/packages/nextjs/public/docs/framework-integrations.md`,
      "utf8",
    );
    expect(docs).toContain("never polls for the whole");
    expect(docs).toContain("`skipped` release evidence");
    expect(docs).toContain("terminal states never release output");
    expect(docs).toContain('permissionDecision: "defer"');
    expect(docs).toContain("elicitation/create");
    expect(docs).toContain("MCP-Session-Id");
    expect(docs).toContain("parallel event stream");
  });

  it("keeps wallet and deployment drift decisions explicit", async () => {
    const [claude, design, parity] = await Promise.all([
      readFile(`${repoRoot}/CLAUDE.md`, "utf8"),
      readFile(
        `${repoRoot}/docs/tokenless-immutable-implementation-plan-2026-07.md`,
        "utf8",
      ),
      readFile(`${repoRoot}/docs/tokenless-environment-parity.md`, "utf8"),
    ]);
    expect(claude).toContain("optional thirdweb-created app wallet");
    expect(claude).not.toContain("do not restore thirdweb");
    expect(design).toContain("active disposable Base Sepolia test bundle was deployed");
    expect(design).toContain("not a compatibility anchor or real-money release");
    expect(design).toContain("Wilson lower confidence bound");
    expect(parity).toContain("_journal.json");
    expect(parity).toContain("last entry in `_journal.json` is always the authoritative head");
    expect(parity).toContain("do not copy a journal tag into this document");
  });
});
