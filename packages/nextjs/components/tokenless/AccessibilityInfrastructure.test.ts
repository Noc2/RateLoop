import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("accessibility tooling and browser-visible focus and motion safeguards stay enabled", async () => {
  const [packageJson, eslintConfig, search, styles] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../eslint.config.mjs", import.meta.url), "utf8"),
    readFile(new URL("./navigation/SiteSearch.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../styles/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"axe-core": "4\.11\.2"/);
  assert.match(packageJson, /"eslint-plugin-jsx-a11y": "6\.10\.2"/);
  assert.match(eslintConfig, /jsxA11y\.flatConfigs\.recommended\.rules/);
  assert.match(search, /size-6/);
  assert.match(search, /focus-visible:outline-\[var\(--rateloop-blue\)\]/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.rateloop-gradient-action:hover/);
  assert.doesNotMatch(search, /focus:outline-none focus:ring-0/);
});
