import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const apiSource = readFileSync(
  new URL("../src/api/index.ts", import.meta.url),
  "utf8",
);
const envExample = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
const packageReadme = readFileSync(
  new URL("../README.md", import.meta.url),
  "utf8",
);
const environmentParity = readFileSync(
  new URL("../../../docs/tokenless-environment-parity.md", import.meta.url),
  "utf8",
);

describe("public indexer API boundary", () => {
  test("source and deployment consumers agree that CORS is public rather than authorization", () => {
    expect(apiSource).toContain('app.use("/*", cors({ origin: "*" }))');
    expect(apiSource).toContain("keeperAuthorization");
    expect(packageReadme).toContain("CORS is not an authorization boundary");

    for (const consumer of [
      apiSource,
      envExample,
      packageReadme,
      environmentParity,
    ]) {
      expect(consumer).not.toContain("CORS_ORIGIN");
    }
  });
});
