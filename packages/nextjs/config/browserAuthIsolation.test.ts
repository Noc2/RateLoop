import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appProvidersSource = readFileSync(new URL("../providers/AppProviders.tsx", import.meta.url), "utf8");
const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
};

test("the application shell cannot mount a Base Account or Wagmi browser connector", () => {
  assert.doesNotMatch(appProvidersSource, /WagmiProvider|baseAccount|getBaseAccountConfig|wagmi/i);
  assert.equal(packageManifest.dependencies?.["@base-org/account"], undefined);
  assert.equal(packageManifest.dependencies?.["@wagmi/core"], undefined);
  assert.equal(packageManifest.dependencies?.wagmi, undefined);
});
