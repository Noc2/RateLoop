import {
  RATELOOP_AGENT_INSTALL_TARGETS,
  RATELOOP_AGENT_STANDING_RULE,
  RATELOOP_CODEX_MCP_COMMAND,
  RATELOOP_CONTRACT_DEPLOYMENT_NOTE,
  RATELOOP_GENERIC_MCP_CONFIG,
  RATELOOP_PUBLIC_MCP_URL,
  RATELOOP_SKILL_URL,
  getAgentInstallTarget,
} from "./installSnippets";
import assert from "node:assert/strict";
import test from "node:test";

test("standing rule scopes RateLoop to public or gated evaluative decisions", () => {
  assert.match(RATELOOP_AGENT_STANDING_RULE, /public or explicitly gated hosted-context, non-urgent .*evaluative decision/);
  assert.match(RATELOOP_AGENT_STANDING_RULE, /Do not use RateLoop for private secrets/);
  assert.match(RATELOOP_AGENT_STANDING_RULE, /tests, docs, or source inspection/);
});

test("standing rule includes pre-deployment guard", () => {
  assert.ok(RATELOOP_AGENT_STANDING_RULE.includes(RATELOOP_CONTRACT_DEPLOYMENT_NOTE));
  assert.match(RATELOOP_CONTRACT_DEPLOYMENT_NOTE, /contracts are not deployed/);
  assert.match(RATELOOP_CONTRACT_DEPLOYMENT_NOTE, /stop before paid submission/);
});

test("generic MCP config points at public RateLoop MCP endpoint", () => {
  const parsed = JSON.parse(RATELOOP_GENERIC_MCP_CONFIG) as {
    mcpServers: {
      rateloop: {
        headers: Record<string, string>;
        transport: string;
        url: string;
      };
    };
  };

  assert.equal(parsed.mcpServers.rateloop.transport, "streamable-http");
  assert.equal(parsed.mcpServers.rateloop.url, RATELOOP_PUBLIC_MCP_URL);
  assert.equal(parsed.mcpServers.rateloop.headers["MCP-Protocol-Version"], "2025-11-25");
});

test("Codex target exposes MCP command, AGENTS.md rule, and skill URL", () => {
  const codex = getAgentInstallTarget("OpenAI Codex");
  assert.ok(codex);

  assert.deepEqual(codex.recommended, ["mcp", "rule", "skill"]);
  assert.ok(codex.snippets.some(snippet => snippet.text === RATELOOP_CODEX_MCP_COMMAND));
  assert.ok(codex.snippets.some(snippet => snippet.label === "Add AGENTS.md rule"));
  assert.ok(codex.snippets.some(snippet => snippet.text === RATELOOP_SKILL_URL));
});

test("all install targets include a one-time trial prompt and persistent setup", () => {
  assert.ok(RATELOOP_AGENT_INSTALL_TARGETS.length >= 6);

  for (const target of RATELOOP_AGENT_INSTALL_TARGETS) {
    assert.ok(
      target.snippets.some(snippet => snippet.kind === "prompt"),
      `${target.name} missing prompt`,
    );
    assert.ok(
      target.snippets.some(snippet => snippet.kind === "mcp"),
      `${target.name} missing MCP setup`,
    );
    assert.ok(
      target.snippets.some(snippet => snippet.kind === "rule"),
      `${target.name} missing rule setup`,
    );
  }
});
