import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PUBLIC_COPY_FILES = [
  "./page.tsx",
  "./docs/page.tsx",
  "./docs/human-oversight/page.tsx",
  "./docs/ai/page.tsx",
  "./docs/how-it-works/page.tsx",
  "./docs/use-cases/page.tsx",
  "./docs/smart-contracts/page.tsx",
  "./docs/tech-stack/page.tsx",
  "./legal/page.tsx",
  "./legal/imprint/page.tsx",
  "./legal/privacy/page.tsx",
  "./legal/terms/page.tsx",
] as const;

const TEST_DEPLOYMENT_COPY =
  /test version|test deployment|test-only|test interface|test terms|test privacy|disposable test|test records|test interactions|test results|test material|Base Sepolia/iu;

test("static public copy does not frame RateLoop as a test deployment", () => {
  for (const relativePath of PUBLIC_COPY_FILES) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, TEST_DEPLOYMENT_COPY, relativePath);
  }
});
