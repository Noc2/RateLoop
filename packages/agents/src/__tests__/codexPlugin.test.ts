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
const workspaceMcpUrl =
  "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp";

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

describe("RateLoop agent host assets", () => {
  it("preserves marketplace identity while keeping public and workspace MCP servers separate", async () => {
    const manifest = await readJson(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
    );
    const mcp = await readJson(join(pluginRoot, ".mcp.json"));
    const marketplace = await readJson(
      join(repoRoot, ".agents", "plugins", "marketplace.json"),
    );

    expect(manifest.name).toBe("rateloop");
    expect(manifest.version).toMatch(/^0\.2\.0\+codex\.[0-9A-Za-z.-]+$/);
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(mcp).toEqual({
      mcpServers: {
        rateloop: { type: "http", url: tokenlessMcpUrl },
        "rateloop-workspace": { type: "http", url: workspaceMcpUrl },
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

  it("packages a secret-free one-message workspace connection for Codex and Claude", async () => {
    const connectionSkillRoot = join(
      pluginRoot,
      "skills",
      "rateloop-workspace-connection",
    );
    const repositorySkillRoot = join(
      repoRoot,
      ".agents",
      "skills",
      "rateloop-workspace-connection",
    );
    const [skill, repositorySkill, agent, repositoryAgent] = await Promise.all([
      readFile(join(connectionSkillRoot, "SKILL.md"), "utf8"),
      readFile(join(repositorySkillRoot, "SKILL.md"), "utf8"),
      readFile(join(connectionSkillRoot, "agents", "openai.yaml"), "utf8"),
      readFile(join(repositorySkillRoot, "agents", "openai.yaml"), "utf8"),
    ]);

    expect(skill).toBe(repositorySkill);
    expect(agent).toBe(repositoryAgent);
    expect(skill).toContain(
      "https://rateloop-tokenless.vercel.app/connect/aci_",
    );
    expect(skill).toContain("fragment is non-empty");
    expect(skill).toContain("Parse and validate the URL locally");
    expect(skill).toContain("rateloop_claim_connection_intent");
    expect(skill).toContain('{ "connectionUrl": "<complete URL>" }');
    expect(skill).toContain("rateloop_get_agent_context");
    expect(skill).toContain("rateloop_verify_connection");
    expect(skill).toContain("Never create a heartbeat");
    expect(skill).toContain("Never poll registration status");
    expect(skill).toContain("host's native authentication action");
    expect(skill).not.toContain("rateloop_register_agent");
    expect(skill).not.toContain("rateloop_get_registration_status");
    expect(skill).not.toContain("rlk_");
    expect(agent).toContain('value: "rateloop-workspace"');
    expect(agent).toContain(`url: "${workspaceMcpUrl}"`);

    const claudeManifest = await readJson(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
    );
    expect(claudeManifest).toEqual(
      expect.objectContaining({
        name: "rateloop",
        displayName: "RateLoop",
        version: "0.2.0",
        skills: "./skills/",
        mcpServers: "./.mcp.json",
      }),
    );
  });

  it("publishes a generic URL-only workspace config without inventing host credentials", async () => {
    const configPath = join(
      repoRoot,
      "packages",
      "nextjs",
      "public",
      "integrations",
      "rateloop-workspace-mcp.json",
    );
    const config = await readJson(configPath);
    expect(config).toEqual({
      mcpServers: {
        "rateloop-workspace": { type: "http", url: workspaceMcpUrl },
      },
    });
    const guide = await readFile(
      join(
        repoRoot,
        "packages",
        "nextjs",
        "public",
        "docs",
        "agent-connection.md",
      ),
      "utf8",
    );
    expect(guide).toContain(workspaceMcpUrl);
    expect(guide).toContain("host-native OAuth");
    expect(guide).toContain(
      "native VS Code manifest will be published only after",
    );
    expect(guide).toContain(
      "Cursor installation metadata will be published only after",
    );
    for (const forbidden of [
      "rlk_",
      '"Authorization"',
      '"clientId"',
      '"redirectUri"',
      "cursor://",
    ]) {
      expect(JSON.stringify(config)).not.toContain(forbidden);
    }
  });
});
