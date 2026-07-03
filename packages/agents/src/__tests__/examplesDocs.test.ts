import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPackageFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
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
          url?: string;
        };
      };
    };
    const server = config.mcpServers?.rateloop;

    expect(server?.url).toBe("https://www.rateloop.ai/api/mcp");
    expect(server?.headers?.["MCP-Protocol-Version"]).toBe("2025-11-25");
    expect(markdown).toContain('"url": "https://www.rateloop.ai/api/mcp"');
    expect(markdown).toContain('"MCP-Protocol-Version": "2025-11-25"');
    expect(markdown).not.toContain("https://rateloop.example/api/mcp");
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
});
