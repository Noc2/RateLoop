import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pluginRoot = join(repoRoot, "plugins", "rateloop");
const workspacePluginRoot = join(repoRoot, "plugins", "rateloop-workspace");
const pluginSkillRoot = join(pluginRoot, "skills", "rateloop-human-assurance");
const agentSkillRoot = join(
  repoRoot,
  ".agents",
  "skills",
  "rateloop-human-assurance",
);
const workspaceReviewSkillRoot = join(
  workspacePluginRoot,
  "skills",
  "rateloop-human-review-loop",
);
const agentReviewSkillRoot = join(
  repoRoot,
  ".agents",
  "skills",
  "rateloop-human-review-loop",
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
  it("publishes public and workspace MCP servers as separate marketplace plugins", async () => {
    const publicManifest = await readJson(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
    );
    const publicMcp = await readJson(join(pluginRoot, ".mcp.json"));
    const workspaceManifest = await readJson(
      join(workspacePluginRoot, ".codex-plugin", "plugin.json"),
    );
    const workspaceMcp = await readJson(join(workspacePluginRoot, ".mcp.json"));
    const marketplace = await readJson(
      join(repoRoot, ".agents", "plugins", "marketplace.json"),
    );

    expect(publicManifest.name).toBe("rateloop");
    expect(publicManifest.version).toMatch(/^0\.2\.0\+codex\.[0-9A-Za-z.-]+$/);
    expect(publicManifest.skills).toBe("./skills/");
    expect(publicManifest.mcpServers).toBe("./.mcp.json");
    expect(publicMcp).toEqual({
      mcpServers: {
        rateloop: { type: "http", url: tokenlessMcpUrl },
      },
    });
    expect(workspaceManifest.name).toBe("rateloop-workspace");
    expect(workspaceManifest.version).toMatch(
      /^0\.1\.1\+codex\.[0-9A-Za-z.-]+$/,
    );
    expect(workspaceManifest.skills).toBe("./skills/");
    expect(workspaceManifest.mcpServers).toBe("./.mcp.json");
    expect(workspaceMcp).toEqual({
      mcpServers: {
        "rateloop-workspace": { type: "http", url: workspaceMcpUrl },
      },
    });
    expect(marketplace.name).toBe("rateloop");
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({
        name: "rateloop",
        source: { source: "local", path: "./plugins/rateloop" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      }),
    );
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({
        name: "rateloop-workspace",
        source: { source: "local", path: "./plugins/rateloop-workspace" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      }),
    );
    expect(publicManifest.interface.defaultPrompt).toHaveLength(2);
    for (const prompt of publicManifest.interface.defaultPrompt)
      expect(prompt.length).toBeLessThanOrEqual(128);
    expect(JSON.stringify(publicManifest)).not.toContain("rateloop-workspace");
    expect(workspaceManifest.interface.defaultPrompt).toHaveLength(1);
    expect(workspaceManifest.interface.defaultPrompt[0]).toContain(
      "$rateloop-workspace-connection",
    );
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
    expect(pluginSkill).toContain("does not create a background hook");
    for (const boundary of ["public", "synthetic", "redacted", "non-urgent"]) {
      expect(pluginSkill.toLowerCase()).toContain(boundary);
    }
    expect(pluginAgent).toContain(`url: "${tokenlessMcpUrl}"`);
    expect(pluginAgent).toContain('value: "rateloop"');
    expect(
      await exists(join(pluginRoot, "skills", "rateloop-ratings", "SKILL.md")),
    ).toBe(false);
    expect(
      await exists(
        join(pluginRoot, "skills", "rateloop-workspace-connection", "SKILL.md"),
      ),
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
      workspacePluginRoot,
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
    expect(skill).toContain("rateloop_connect_workspace");
    expect(skill).toContain("prefer `rateloop_connect_workspace`");
    expect(skill).toContain("rateloop_claim_connection_intent");
    expect(skill).toContain(
      '{ "connectionUrl": "<complete URL>", "reportedLane": "plugin-with-hooks" }',
    );
    expect(skill).toContain("host-reported, never as verified");
    expect(skill).toContain("rateloop_get_agent_context");
    expect(skill).toContain("rateloop_verify_connection");
    expect(skill).toContain("granular fallback");
    expect(skill).toContain(
      "retry `rateloop_connect_workspace` with the same privately held URL",
    );
    expect(skill).toContain("machine-readable `nextAction`");
    expect(skill).not.toContain("atomically resumes");
    expect(skill).toContain("Check the current tool inventory");
    expect(skill).toContain("structured **RateLoop Workspace** plugin mention");
    expect(skill).toContain(
      "explicit `$rateloop-workspace-connection` invocation",
    );
    expect(skill).toContain("replacement for a deleted workspace");
    expect(skill).toContain("revokes its OAuth token family");
    expect(skill).toContain(
      "Treat the first missing workspace-tool inventory for a connection intent as activation pending",
    );
    expect(skill).toContain(
      "never diagnose a stale install or recommend uninstall from that first check",
    );
    expect(skill).toContain(
      "The RateLoop connection is pending host activation",
    );
    expect(skill).toContain("Do not ask the user to start a new task");
    expect(skill).toContain("Uninstall every existing RateLoop plugin");
    expect(skill).toContain(
      "Only if a later active turn still lacks the workspace tools after the first missing-tool check",
    );
    expect(skill).toContain(
      "Never tell the user to reinstall a plugin, start a new task",
    );
    expect(skill).toContain("Never tell them to remove unrelated plugins");
    expect(skill).toContain("host actually presents");
    expect(skill).toContain(
      "On the next active turn after the first missing-tool check, check the workspace tool inventory once more",
    );
    expect(skill).toContain("Do not run a second login");
    expect(skill).toContain(
      "If no prompt is visible, do not claim that one is pending",
    );
    expect(skill).toContain(
      "The RateLoop workspace tools are still unavailable",
    );
    expect(skill).toContain(
      "Never report the workspace connected or ready unless `rateloop_connect_workspace` returned `connected: true` with a successful `verification`",
    );
    expect(skill).toContain("Never create a heartbeat");
    expect(skill).toContain("Never poll registration status");
    expect(skill).toContain("native install/connect flow");
    expect(skill).toContain("does not create a background hook");
    expect(skill).toContain("$rateloop-human-review-loop");
    expect(skill).not.toMatch(
      /native MCP reload|MCP-server reload|refresh action exactly once/,
    );
    expect(skill).not.toContain("rateloop_register_agent");
    expect(skill).not.toContain("rateloop_get_registration_status");
    expect(skill).not.toContain("rlk_");
    expect(agent).toContain('value: "rateloop-workspace"');
    expect(agent).toContain(`url: "${workspaceMcpUrl}"`);

    const claudeManifest = await readJson(
      join(workspacePluginRoot, ".claude-plugin", "plugin.json"),
    );
    expect(claudeManifest).toEqual(
      expect.objectContaining({
        name: "rateloop-workspace",
        displayName: "RateLoop Workspace",
        version: "0.1.1",
        skills: "./skills/",
        mcpServers: "./.mcp.json",
      }),
    );
  });

  it("packages an ongoing policy-bound human-review loop for connected workspaces", async () => {
    const [skill, repositorySkill, agent, repositoryAgent] = await Promise.all([
      readFile(join(workspaceReviewSkillRoot, "SKILL.md"), "utf8"),
      readFile(join(agentReviewSkillRoot, "SKILL.md"), "utf8"),
      readFile(join(workspaceReviewSkillRoot, "agents", "openai.yaml"), "utf8"),
      readFile(join(agentReviewSkillRoot, "agents", "openai.yaml"), "utf8"),
    ]);

    expect(skill).toBe(repositorySkill);
    expect(agent).toBe(repositoryAgent);
    expect(agent).toContain('value: "rateloop-workspace"');
    expect(agent).toContain(`url: "${workspaceMcpUrl}"`);

    const tools = [
      ...new Set(
        [...skill.matchAll(/`(rateloop_[a-z_]+)`/g)].map((match) => match[1]),
      ),
    ].sort();
    expect(tools).toEqual(
      [
        "rateloop_evaluate_review_requirement",
        "rateloop_get_agent_context",
        "rateloop_get_assurance_state",
        "rateloop_get_review_result",
        "rateloop_request_review",
        "rateloop_wait_for_review",
      ].sort(),
    );

    for (const lifecycle of [
      "skipped",
      "approval_required",
      "request_ready",
      "blocked",
      "pending",
      "completed",
      "inconclusive",
      "failed_terminal",
      "cancelled_before_commit",
    ]) {
      expect(skill).toContain(`\`${lifecycle}\``);
    }
    for (const policy of [
      "Adaptive",
      "Every eligible output",
      "Fixed percentage",
      "Risk rules",
      "Manual handoff only",
    ]) {
      expect(skill).toContain(`**${policy}**`);
    }
    for (const authority of [
      "Check only",
      "Prepare for approval",
      "Ask automatically",
    ]) {
      expect(skill).toContain(`**${authority}**`);
    }
    for (const audience of [
      "Public RateLoop network",
      "Private invited",
      "Hybrid",
    ]) {
      expect(skill).toContain(`**${audience}**`);
    }

    expect(skill).toContain("does not create a background process");
    expect(skill).toContain("never create an unbounded polling loop");
    expect(skill).toContain("configured response window freezes");
    expect(skill).toContain("Never self-approve a prepared request");
    expect(skill).toContain("base bounty");
    expect(skill).toContain("Feedback Bonus");
    expect(skill).toContain("separate, optional, and off by default");
    expect(skill).toContain("requester or another designated human awarder");
    expect(skill).toContain("never selected or awarded by the agent");
    expect(skill).not.toContain("rateloop_create_handoff");
    expect(skill).not.toContain("rateloop_capabilities");
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
    expect(guide).toMatch(/standard OAuth\s+authorization challenge/);
    expect(guide).toMatch(/uninstall every existing RateLoop plugin/i);
    expect(guide).toMatch(/do not remove\s+unrelated plugins/i);
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
