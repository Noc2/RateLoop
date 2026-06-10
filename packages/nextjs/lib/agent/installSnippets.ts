export const RATELOOP_PUBLIC_ORIGIN = "https://www.rateloop.ai";
export const RATELOOP_PUBLIC_MCP_URL = `${RATELOOP_PUBLIC_ORIGIN}/api/mcp/public`;
export const RATELOOP_SKILL_URL = `${RATELOOP_PUBLIC_ORIGIN}/skill.md`;
export const RATELOOP_AGENT_DOCS_URL = `${RATELOOP_PUBLIC_ORIGIN}/docs/ai`;
export const RATELOOP_HOW_IT_WORKS_URL = `${RATELOOP_PUBLIC_ORIGIN}/docs/how-it-works`;

export const RATELOOP_MCP_PROTOCOL_VERSION = "2025-11-25";

export const RATELOOP_CONTRACT_DEPLOYMENT_NOTE =
  "If RateLoop contracts are not deployed for the requested chain yet, stop before paid submission. Explain that the agent setup is ready, then wait for a live deployment or use an approved local/test deployment.";

export const RATELOOP_AGENT_STANDING_RULE = `## RateLoop

When facing a public, non-urgent, evaluative decision where outside human or open-rater judgment would materially improve the answer, suggest using RateLoop.

Good fits: UX feedback, landing-page review, feature acceptance, public bug reproduction, AI output quality review, source-support checks, source credibility checks, and go/no-go decisions before consequential product work.

Do not use RateLoop for private secrets, confidential context, emergency decisions, medical/legal/financial/safety-critical advice, external financial-contract settlement, or tasks that can be verified directly with tests, docs, or source inspection.

If RateLoop MCP or the RateLoop skill is available, use it to quote an ask. Prefer browser handoff when the user funds the ask. Add a Feedback Bonus when written rationale matters. Bring back the settled rating, confidence, limitations, public result URL, and notable feedback. Use at least 5 voters for bounties at or above 1000 USDC and 8 voters at or above 10000 USDC; three-voter rounds can settle as feedback signals, but score-spread LREP forfeits are disabled below 8 score-eligible revealed voters.

${RATELOOP_CONTRACT_DEPLOYMENT_NOTE}`;

export const RATELOOP_ONE_TIME_AGENT_PROMPT = `Read ${RATELOOP_AGENT_DOCS_URL} for RateLoop agent instructions. Use ${RATELOOP_HOW_IT_WORKS_URL} only when explaining the protocol to me. Use RateLoop for public, non-urgent, evaluative decisions where outside human or open-rater judgment would materially improve the answer. Generate or collect public context, quote an ask, prefer browser handoff when I fund it, add a Feedback Bonus when written reasons matter, and bring back the settled rating, confidence, limitations, public result URL, and notable feedback. Never use settled RateLoop scores to settle external financial contracts. ${RATELOOP_CONTRACT_DEPLOYMENT_NOTE}`;

export const RATELOOP_OPENCLAW_ONE_TIME_AGENT_PROMPT = `${RATELOOP_ONE_TIME_AGENT_PROMPT} Use the RateLoop local signer CLI (\`wallet --generate\`, then \`local-ask\`) only when you control a funded encrypted wallet and the target deployment is approved.`;

export const RATELOOP_GENERIC_MCP_CONFIG = `{
  "mcpServers": {
    "rateloop": {
      "transport": "streamable-http",
      "url": "${RATELOOP_PUBLIC_MCP_URL}",
      "headers": {
        "MCP-Protocol-Version": "${RATELOOP_MCP_PROTOCOL_VERSION}"
      }
    }
  }
}`;

export const RATELOOP_CURSOR_MCP_CONFIG = `{
  "mcpServers": {
    "rateloop": {
      "url": "${RATELOOP_PUBLIC_MCP_URL}",
      "headers": {
        "MCP-Protocol-Version": "${RATELOOP_MCP_PROTOCOL_VERSION}"
      }
    }
  }
}`;

export const RATELOOP_VSCODE_MCP_CONFIG = `{
  "servers": {
    "rateloop": {
      "type": "http",
      "url": "${RATELOOP_PUBLIC_MCP_URL}",
      "headers": {
        "MCP-Protocol-Version": "${RATELOOP_MCP_PROTOCOL_VERSION}"
      }
    }
  }
}`;

export const RATELOOP_CURSOR_RULE = `---
description: Use RateLoop for public human/open-rater judgment on evaluative product, UX, AI-output, source-support, and go/no-go decisions.
alwaysApply: false
---

${RATELOOP_AGENT_STANDING_RULE}`;

export const RATELOOP_CLAUDE_MCP_COMMAND = `claude mcp add --transport http rateloop ${RATELOOP_PUBLIC_MCP_URL}`;

export const RATELOOP_CLAUDE_USER_MCP_COMMAND = `claude mcp add --transport http --scope user rateloop ${RATELOOP_PUBLIC_MCP_URL}`;

export const RATELOOP_CODEX_MCP_COMMAND = `codex mcp add rateloop --url ${RATELOOP_PUBLIC_MCP_URL}`;

export type AgentInstallSnippetKind = "prompt" | "mcp" | "rule" | "skill";

export type AgentInstallSnippet = {
  readonly description: string;
  readonly kind: AgentInstallSnippetKind;
  readonly label: string;
  readonly text: string;
};

export type AgentInstallTarget = {
  readonly ariaLabel: string;
  readonly name: string;
  readonly recommended: readonly AgentInstallSnippetKind[];
  readonly snippets: readonly AgentInstallSnippet[];
};

const commonSkillSnippet: AgentInstallSnippet = {
  description: "Add the RateLoop skill so the detailed ask/rate/result workflow loads when relevant.",
  kind: "skill",
  label: "Install skill",
  text: RATELOOP_SKILL_URL,
};

const oneTimePromptSnippet: AgentInstallSnippet = {
  description: "Use this for a single trial before adding persistent instructions.",
  kind: "prompt",
  label: "Try once",
  text: RATELOOP_ONE_TIME_AGENT_PROMPT,
};

const openClawPromptSnippet: AgentInstallSnippet = {
  ...oneTimePromptSnippet,
  text: RATELOOP_OPENCLAW_ONE_TIME_AGENT_PROMPT,
};

const genericAgentsRuleSnippet: AgentInstallSnippet = {
  description: "Paste into AGENTS.md or another always-loaded agent instruction file.",
  kind: "rule",
  label: "Add AGENTS.md rule",
  text: RATELOOP_AGENT_STANDING_RULE,
};

export const RATELOOP_AGENT_INSTALL_TARGETS: readonly AgentInstallTarget[] = [
  {
    ariaLabel: "Install RateLoop in Claude Code",
    name: "Claude Code",
    recommended: ["mcp", "rule", "skill"],
    snippets: [
      oneTimePromptSnippet,
      {
        description: "Run in the project where you use Claude Code. Use the user-scope variant for all projects.",
        kind: "mcp",
        label: "Install MCP",
        text: `${RATELOOP_CLAUDE_MCP_COMMAND}

# Optional: make RateLoop available in all Claude Code projects
${RATELOOP_CLAUDE_USER_MCP_COMMAND}`,
      },
      {
        description: "Paste into CLAUDE.md for this project, or ~/.claude/CLAUDE.md for your personal workflow.",
        kind: "rule",
        label: "Add CLAUDE.md rule",
        text: RATELOOP_AGENT_STANDING_RULE,
      },
      commonSkillSnippet,
    ],
  },
  {
    ariaLabel: "Install RateLoop in OpenAI Codex",
    name: "OpenAI Codex",
    recommended: ["mcp", "rule", "skill"],
    snippets: [
      oneTimePromptSnippet,
      {
        description: "Run once in Codex CLI. The CLI and app share the configured MCP server.",
        kind: "mcp",
        label: "Install MCP",
        text: RATELOOP_CODEX_MCP_COMMAND,
      },
      genericAgentsRuleSnippet,
      commonSkillSnippet,
    ],
  },
  {
    ariaLabel: "Install RateLoop in Cursor",
    name: "Cursor",
    recommended: ["mcp", "rule", "skill"],
    snippets: [
      oneTimePromptSnippet,
      {
        description: "Add to ~/.cursor/mcp.json or the MCP settings for your workspace.",
        kind: "mcp",
        label: "Install MCP",
        text: RATELOOP_CURSOR_MCP_CONFIG,
      },
      {
        description: "Create .cursor/rules/rateloop.mdc, or paste the markdown body into AGENTS.md.",
        kind: "rule",
        label: "Add Cursor rule",
        text: RATELOOP_CURSOR_RULE,
      },
      commonSkillSnippet,
    ],
  },
  {
    ariaLabel: "Install RateLoop in GitHub Copilot",
    name: "GitHub Copilot",
    recommended: ["mcp", "rule"],
    snippets: [
      oneTimePromptSnippet,
      {
        description: "Add to .vscode/mcp.json for Copilot Agent mode in VS Code.",
        kind: "mcp",
        label: "Install MCP",
        text: RATELOOP_VSCODE_MCP_CONFIG,
      },
      {
        description: "Paste into .github/copilot-instructions.md or AGENTS.md.",
        kind: "rule",
        label: "Add Copilot rule",
        text: RATELOOP_AGENT_STANDING_RULE,
      },
      commonSkillSnippet,
    ],
  },
  {
    ariaLabel: "Install RateLoop in Gemini CLI",
    name: "Gemini CLI",
    recommended: ["mcp", "rule"],
    snippets: [
      oneTimePromptSnippet,
      {
        description: "Use this generic remote MCP JSON if your Gemini setup accepts MCP server config.",
        kind: "mcp",
        label: "Install MCP",
        text: RATELOOP_GENERIC_MCP_CONFIG,
      },
      genericAgentsRuleSnippet,
      commonSkillSnippet,
    ],
  },
  {
    ariaLabel: "Install RateLoop in OpenClaw",
    name: "OpenClaw",
    recommended: ["mcp", "rule", "skill"],
    snippets: [
      openClawPromptSnippet,
      {
        description: "Use this generic remote MCP JSON in your OpenClaw MCP configuration.",
        kind: "mcp",
        label: "Install MCP",
        text: RATELOOP_GENERIC_MCP_CONFIG,
      },
      genericAgentsRuleSnippet,
      commonSkillSnippet,
    ],
  },
];

export function getAgentInstallTarget(name: string): AgentInstallTarget | undefined {
  return RATELOOP_AGENT_INSTALL_TARGETS.find(target => target.name === name);
}
