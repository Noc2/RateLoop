import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pluginRoot = join(repoRoot, "plugins", "rateloop");
const pluginSkillRoot = join(pluginRoot, "skills", "rateloop-human-assurance");
const agentSkillRoot = join(
  repoRoot,
  ".agents",
  "skills",
  "rateloop-human-assurance",
);
const tokenlessMcpUrl = "https://rateloop-tokenless.vercel.app/api/mcp";

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("Codex plugin", () => {
  it("preserves marketplace identity while targeting only the tokenless MCP", async () => {
    const manifest = await readJson(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
    );
    const mcp = await readJson(join(pluginRoot, ".mcp.json"));
    const marketplace = await readJson(
      join(repoRoot, ".agents", "plugins", "marketplace.json"),
    );

    expect(manifest.name).toBe("rateloop");
    expect(manifest.version).toMatch(/^0\.1\.1(?:\+codex\.[0-9A-Za-z.-]+)?$/);
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(mcp).toEqual({
      mcpServers: {
        rateloop: { type: "http", url: tokenlessMcpUrl },
      },
    });
    expect(marketplace.name).toBe("rateloop");
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({
        name: "rateloop",
        source: { source: "local", path: "./plugins/rateloop" },
      }),
    );
    expect(manifest.interface.defaultPrompt).toHaveLength(3);
    for (const prompt of manifest.interface.defaultPrompt)
      expect(prompt.length).toBeLessThanOrEqual(128);
  });

  it("keeps the packaged and repository skills identical and privacy bounded", async () => {
    const pluginSkill = await readFile(
      join(pluginSkillRoot, "SKILL.md"),
      "utf8",
    );
    const agentSkill = await readFile(join(agentSkillRoot, "SKILL.md"), "utf8");
    const pluginAgent = await readFile(
      join(pluginSkillRoot, "agents", "openai.yaml"),
      "utf8",
    );
    const agentAgent = await readFile(
      join(agentSkillRoot, "agents", "openai.yaml"),
      "utf8",
    );

    expect(pluginSkill).toBe(agentSkill);
    expect(pluginAgent).toBe(agentAgent);
    expect(pluginSkill.toLowerCase()).toContain("explicit user approval");
    for (const boundary of [
      "public",
      "synthetic",
      "redacted",
      "non-urgent",
      "simulated",
    ]) {
      expect(pluginSkill.toLowerCase()).toContain(boundary);
    }
    expect(pluginAgent).toContain(`url: "${tokenlessMcpUrl}"`);
    expect(pluginAgent).toContain('value: "rateloop"');
    expect(
      await exists(join(pluginRoot, "skills", "rateloop-ratings", "SKILL.md")),
    ).toBe(false);
    expect(
      await exists(
        join(repoRoot, ".agents", "skills", "rateloop-ratings", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("documents exactly the four tokenless tools and no legacy surface", async () => {
    const files = [
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      join(pluginRoot, ".mcp.json"),
      join(pluginSkillRoot, "SKILL.md"),
      join(pluginSkillRoot, "agents", "openai.yaml"),
      join(agentSkillRoot, "SKILL.md"),
      join(agentSkillRoot, "agents", "openai.yaml"),
    ];
    const surface = (
      await Promise.all(files.map((path) => readFile(path, "utf8")))
    ).join("\n");
    const skill = await readFile(join(pluginSkillRoot, "SKILL.md"), "utf8");
    const tools = [
      ...new Set(
        [...skill.matchAll(/`(rateloop_[a-z_]+)`/g)].map((match) => match[1]),
      ),
    ].sort();

    expect(tools).toEqual(
      [
        "rateloop_capabilities",
        "rateloop_create_handoff",
        "rateloop_get_handoff_status",
        "rateloop_get_result",
      ].sort(),
    );
    for (const forbidden of [
      "rateloop.ai",
      "/api/mcp/public",
      "rateloop-ratings",
      "rateloop_ask_humans",
      "rateloop_quote_question",
      "rateloop_get_rating_context",
      "rateloop_prepare_rating_transactions",
      "Base mainnet",
    ]) {
      expect(surface).not.toContain(forbidden);
    }
  });
});
