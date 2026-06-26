import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

type TestableNextConfig = {
  outputFileTracingIncludes?: Record<string, string[]>;
};

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config") as TestableNextConfig;

test("vote OG route traces bundled social-card fonts", () => {
  const includes = nextConfig.outputFileTracingIncludes ?? {};

  assert.deepEqual(includes["/api/og/vote"], ["./app/api/og/vote/fonts/**/*"]);
  assert.equal(
    includes["/api/og/vote/route"],
    undefined,
    "Next matches file tracing includes against the normalized route, not the route.tsx file suffix.",
  );
});
