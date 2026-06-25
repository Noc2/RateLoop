import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

type TestableNextConfig = {
  eslint?: { ignoreDuringBuilds?: boolean };
  typescript?: { ignoreBuildErrors?: boolean };
};

const require = createRequire(import.meta.url);
const configPath = require.resolve("../next.config");
const originalIgnoreBuildError = process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;

function requireFreshNextConfig(): TestableNextConfig {
  delete require.cache[configPath];
  return require("../next.config") as TestableNextConfig;
}

afterEach(() => {
  delete require.cache[configPath];
  if (originalIgnoreBuildError === undefined) {
    delete process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;
  } else {
    process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR = originalIgnoreBuildError;
  }
});

test("next config never ignores TypeScript or ESLint build failures by default", () => {
  delete process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;
  const config = requireFreshNextConfig();

  assert.equal(config.typescript?.ignoreBuildErrors, false);
  assert.equal(config.eslint?.ignoreDuringBuilds, false);
});

test("next config rejects the removed public build-error bypass flag", () => {
  process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR = "true";

  assert.throws(
    () => requireFreshNextConfig(),
    /NEXT_PUBLIC_IGNORE_BUILD_ERROR is no longer supported/,
  );
});
