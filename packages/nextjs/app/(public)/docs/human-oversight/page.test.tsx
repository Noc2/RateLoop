import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("human-oversight docs map each Article 14(4) measure to a capability and a deployer duty", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HumanOversightPage } = await import("./page");
  const html = renderToStaticMarkup(<HumanOversightPage />).replace(/\s+/g, " ");

  assert.match(html, /Human.*rateloop-text-gradient.*Oversight/i);
  assert.match(html, /support a deployer&#x27;s configured human oversight/i);
  assert.match(
    html,
    /Your people provide oversight\. RateLoop supports the configured workflow and records its evidence\./,
  );
  assert.match(html, /RateLoop does not determine whether the EU AI Act applies or establish compliance\./);
  assert.match(html, /only a verified host integration can enforce its review state at the output boundary\./);

  for (const [requirement, capability, responsibility] of [
    ["Article 14\\(4\\)\\(a\\)", "oversight dashboard", "watching those surfaces"],
    ["Article 14\\(4\\)\\(b\\)", "Independent blinded panels", "pull to over-rely"],
    ["Article 14\\(4\\)\\(c\\)", "owner case view", "correctly interpreting the output"],
    ["Article 14\\(4\\)\\(d\\)", "required reasons field", "disregard, override, or reverse"],
    ["Article 14\\(4\\)\\(e\\)", "verified host adapter that controls delivery", "when to halt"],
  ] as const) {
    assert.match(html, new RegExp(requirement));
    assert.match(html, new RegExp(capability, "i"));
    assert.match(html, new RegExp(responsibility, "i"));
  }
  assert.match(html, /01 · Article 14\(4\)\(a\)/);
  assert.match(html, /05 · Article 14\(4\)\(e\)/);
  assert.match(html, /in-app, email, and browser alerts/i);
  assert.match(html, /no preselected choice/i);
  assert.match(html, /override-rate trend/i);
  assert.match(html, /workspace stop blocks new review-triggered release authorizations/i);
  assert.match(html, /Ordinary Codex, plugin, and MCP integrations are advisory/i);
  assert.match(html, /do not verify interception or withheld delivery/i);
  assert.match(html, /an advisory host can bypass it/i);
  assert.match(html, /Releasing the stop restores no agent grant automatically/i);
  assert.match(html, /per-agent evidence summaries/i);
  assert.match(html, /host-reported, not independently verified/i);

  assert.match(html, /id="designation-and-literacy"/);
  assert.match(html, /attestation records — competence basis, training completed, and authority granted/i);
  assert.match(html, /audit events on every role assignment and change/i);
  assert.match(html, /evidence relevant to Article 4 AI-literacy duties/i);
  assert.match(html, /Choosing those people, and ensuring their competence, training, and authority, remains yours\./);
  assert.match(html, /draft Article 73 serious-incident reporting template/i);
  assert.match(html, /labelled draft-aligned until the template is final/i);
  assert.match(html, /Article 27 fundamental-rights impact assessment/i);

  assert.match(html, /id="reviewer-lanes"/);
  assert.match(html, /Invited reviewers are your personnel/i);
  assert.match(html, /supplementary review capacity and an independent quality signal/i);
  assert.match(html, /neither lane by itself establishes that Article 14 or Article 26 duties are met/i);
  assert.match(html, /href="\/docs\/evidence"/);

  assert.doesNotMatch(html, /compliant|compliance-ready|certif|presumption of conformity|satisfies Article/i);
  assert.doesNotMatch(html, /RateLoop provides the instrument — and the proof/i);
});

test("machine human-oversight doc mirrors the page and is cross-linked with evidence", () => {
  const oversight = readFileSync(
    fileURLToPath(new URL("../../../../public/docs/human-oversight.md", import.meta.url)),
    "utf8",
  );
  const evidence = readFileSync(fileURLToPath(new URL("../../../../public/docs/evidence.md", import.meta.url)), "utf8");

  assert.match(
    oversight,
    /Your people provide oversight\. RateLoop supports the configured workflow and records its evidence\./,
  );
  assert.match(oversight, /only a verified host integration can\s+enforce its review state at the output boundary\./);
  for (const heading of [
    "### 1. Monitor operation — Article 14(4)(a)",
    "### 2. Counter automation bias — Article 14(4)(b)",
    "### 3. Correctly interpret the output — Article 14(4)(c)",
    "### 4. Disregard, override, or reverse — Article 14(4)(d)",
    "### 5. Intervene or stop — Article 14(4)(e)",
  ]) {
    assert.ok(oversight.includes(heading), `missing heading: ${heading}`);
  }
  assert.match(oversight, /## Designation, competence, and literacy/);
  assert.match(oversight, /## Which reviewer lane carries this/);
  assert.match(oversight, /Ordinary Codex, plugin, and MCP integrations are advisory/i);
  assert.match(oversight, /do not\s+verify interception or withheld delivery/i);
  assert.match(oversight, /draft Article 73 serious-incident reporting template/i);
  assert.match(oversight, /Article 27 fundamental-rights impact\s+assessment/i);
  assert.match(oversight, /Invited reviewers are your personnel/);
  assert.match(oversight, /neither lane by itself establishes that Article 14 or Article 26\s+duties are met/i);
  assert.match(oversight, /\[`evidence\.md`\]\(\.\/evidence\.md\)/);
  assert.match(evidence, /\[`human-oversight\.md`\]\(\.\/human-oversight\.md\)/);
  assert.match(evidence, /\[`\/docs\/human-oversight`\]\(\/docs\/human-oversight\)/);
  assert.doesNotMatch(oversight, /compliant|compliance-ready|certif|presumption of conformity|satisfies Article/i);
  assert.doesNotMatch(oversight, /RateLoop provides the instrument — and the proof/i);
});
