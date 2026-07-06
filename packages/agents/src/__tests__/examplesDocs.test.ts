import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPackageFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function listExampleTopLevelInventory() {
  return readdirSync(new URL("../../examples", import.meta.url), {
    withFileTypes: true,
  })
    .filter(entry => !entry.name.startsWith("."))
    .filter(entry => entry.name !== "README.md")
    .filter(entry => entry.name !== "questions")
    .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
}

function listQuestionExamples() {
  return readdirSync(new URL("../../examples/questions", import.meta.url), {
    withFileTypes: true,
  })
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith(".json"))
    .map(entry => entry.name)
    .sort();
}

function expectMarkdownInventory(markdown: string, entries: readonly string[]) {
  for (const entry of entries) {
    expect(markdown).toContain(`\`${entry}\``);
  }
}

describe("agent public examples and docs", () => {
  it("keeps Gemini MCP markdown aligned with the checked JSON example", () => {
    const markdown = readPackageFile("examples/gemini-cli.md");
    const config = JSON.parse(
      readPackageFile("examples/gemini-cli.mcpServers.json"),
    ) as {
      mcpServers?: {
        rateloop?: {
          headers?: Record<string, string>;
          httpUrl?: string;
          url?: string;
        };
      };
    };
    const server = config.mcpServers?.rateloop;

    expect(server?.httpUrl).toBe("https://www.rateloop.ai/api/mcp/public");
    expect(server?.url).toBeUndefined();
    expect(server?.headers?.["MCP-Protocol-Version"]).toBe("2025-11-25");
    expect(server?.headers?.["Authorization"]).toBeUndefined();
    expect(server?.headers?.["X-Agent-Name"]).toBeUndefined();
    expect(markdown).toContain('"httpUrl": "https://www.rateloop.ai/api/mcp/public"');
    expect(markdown).toContain('"MCP-Protocol-Version": "2025-11-25"');
    expect(markdown).toContain("`rateloop_get_question_status`");
    expect(markdown).toContain("`rateloop_get_result`");
    expect(markdown).not.toContain("https://rateloop.example/api/mcp");
  });

  it("keeps OpenClaw MCP markdown aligned with the checked JSON example", () => {
    const markdown = readPackageFile("examples/openclaw.md");
    const config = JSON.parse(
      readPackageFile("examples/openclaw.mcpServers.json"),
    ) as {
      mcpServers?: {
        rateloop?: {
          headers?: Record<string, string>;
          transport?: string;
          url?: string;
        };
      };
    };
    const server = config.mcpServers?.rateloop;

    expect(server?.url).toBe("https://www.rateloop.ai/api/mcp/public");
    expect(server?.transport).toBe("streamable-http");
    expect(server?.headers?.["MCP-Protocol-Version"]).toBe("2025-11-25");
    expect(server?.headers?.["Authorization"]).toBeUndefined();
    expect(server?.headers?.["X-Agent-Name"]).toBeUndefined();
    expect(markdown).toContain('"url": "https://www.rateloop.ai/api/mcp/public"');
    expect(markdown).toContain('"transport": "streamable-http"');
    expect(markdown).toContain("`rateloop_get_question_status`");
    expect(markdown).toContain("`rateloop_get_result`");
  });

  it("keeps install docs aligned with the package Node engine", () => {
    const readme = readPackageFile("README.md");
    const packageJson = JSON.parse(readPackageFile("package.json")) as {
      engines?: { node?: string };
    };

    expect(packageJson.engines?.node).toBe(">=24 <25");
    expect(readme).toContain("Node 24 runtime");
    expect(readme).not.toContain("any Node runtime");
  });

  it("keeps public examples on the live Base mainnet deployment", () => {
    const openclaw = readPackageFile("examples/openclaw.md");
    const landingPitch = readPackageFile("examples/landing-pitch-review.ts");

    expect(openclaw).toContain('RATELOOP_API_BASE_URL="https://www.rateloop.ai"');
    expect(openclaw).toContain("RATELOOP_CHAIN_ID=8453");
    expect(openclaw).not.toMatch(/testnet practice|staging\.rateloop\.example/);

    expect(landingPitch).toContain("PRODUCTION_API_BASE_URL");
    expect(landingPitch).toContain("BASE_MAINNET_CHAIN_ID");
    expect(landingPitch).not.toMatch(/SEPOLIA/);
    expect(landingPitch).toContain("live Base mainnet deployment");
    expect(landingPitch).toContain("requiresAtomicExecution");
    expect(landingPitch).toContain("Batch every transactionPlan.calls item in one atomic wallet operation");
  });

  it("keeps README example inventories aligned with checked files", () => {
    const packageReadme = readPackageFile("README.md");
    const examplesReadme = readPackageFile("examples/README.md");
    const topLevelEntries = listExampleTopLevelInventory();
    const questionEntries = listQuestionExamples();

    expectMarkdownInventory(examplesReadme, [
      ...topLevelEntries,
      ...questionEntries.map(entry => `questions/${entry}`),
    ]);
    expectMarkdownInventory(packageReadme, [...topLevelEntries, ...questionEntries]);
  });
});
