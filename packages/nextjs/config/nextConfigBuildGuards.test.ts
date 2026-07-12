import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../next.config");
const originalBypass = process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;

afterEach(() => {
  delete require.cache[configPath];
  if (originalBypass === undefined) delete process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;
  else process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR = originalBypass;
});

test("Next build never ignores type or lint failures", () => {
  delete process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;
  const config = require("../next.config") as {
    eslint?: { ignoreDuringBuilds?: boolean };
    typescript?: { ignoreBuildErrors?: boolean };
  };
  assert.equal(config.typescript?.ignoreBuildErrors, false);
  assert.equal(config.eslint?.ignoreDuringBuilds, false);
});

test("removed public build-error bypass fails closed", () => {
  process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR = "true";
  assert.throws(() => require("../next.config"), /no longer supported/);
});
