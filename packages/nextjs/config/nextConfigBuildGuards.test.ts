import {
  SHARP_LINUX_X64_RUNTIME_PACKAGES,
  SHARP_LINUX_X64_TRACE_GLOBS,
  assertSharpLinuxX64RuntimePackages,
} from "./sharpDeployment";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the framework banner and browser source maps stay off in production", () => {
  delete process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR;
  const config = require("../next.config") as {
    poweredByHeader?: boolean;
    productionBrowserSourceMaps?: boolean;
  };
  // `X-Powered-By: Next.js` ships unless this is explicitly false, and an absent
  // key reads the same as a deliberate one -- so assert the value, not its absence.
  assert.equal(config.poweredByHeader, false);
  // Source maps must never become truthy: they would publish the server-rendered
  // bundle's original sources to any visitor.
  assert.notEqual(config.productionBrowserSourceMaps, true);
});

test("Next traces both Linux x64 sharp runtime packages into every server route", () => {
  const config = require("../next.config") as {
    outputFileTracingIncludes?: Record<string, string[]>;
  };

  assert.deepEqual(config.outputFileTracingIncludes?.["/*"], [...SHARP_LINUX_X64_TRACE_GLOBS]);
  assert.doesNotThrow(() => assertSharpLinuxX64RuntimePackages());
  assert.throws(
    () =>
      assertSharpLinuxX64RuntimePackages(specifier => {
        if (specifier === SHARP_LINUX_X64_RUNTIME_PACKAGES[0].resolveSpecifier) throw new Error("missing");
        return specifier;
      }),
    /Linux x64 sharp packages.*@img\/sharp-linux-x64\/package/s,
  );
});

test("Yarn installs the current host and Vercel Linux x64 native dependency trees", () => {
  const yarnConfig = readFileSync(new URL("../../../.yarnrc.yml", import.meta.url), "utf8");

  assert.match(yarnConfig, /supportedArchitectures:[\s\S]*os:\s*\n\s*- current\s*\n\s*- linux/);
  assert.match(yarnConfig, /supportedArchitectures:[\s\S]*cpu:\s*\n\s*- current\s*\n\s*- x64/);
  assert.match(yarnConfig, /supportedArchitectures:[\s\S]*libc:\s*\n\s*- current\s*\n\s*- glibc/);
});
