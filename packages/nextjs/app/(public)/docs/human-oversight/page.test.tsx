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

test("human-oversight docs lead with capabilities and keep legal context secondary", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HumanOversightPage } = await import("./page");
  const html = renderToStaticMarkup(<HumanOversightPage />).replace(/\s+/g, " ");

  assert.match(html, /Configure.*rateloop-text-gradient.*Accountable Oversight/i);
  assert.match(html, /Article 26\(2\) requires deployers of high-risk AI systems/i);
  assert.match(html, /competence, training, authority, and support/i);
  assert.match(html, /your organization selects, authorizes, and supports the people/i);
  assert.match(
    html,
    /Your people provide oversight\. RateLoop supports the configured workflow and records its evidence\./,
  );
  assert.match(html, /RateLoop does not determine whether the EU AI Act applies or establish compliance\./);
  assert.match(html, /only a verified host integration can enforce its review state at the output boundary\./);
  assert.match(html, /No host currently holds that tier/i);
  assert.doesNotMatch(html, /primary verified path|verified hosts honor/i);
  assert.match(html, /id="deployer-duty"/);
  assert.match(html, /competence basis, training completed, authority scope, and expiry/i);
  assert.match(html, /id="provider-design-duty"/);
  assert.match(html, /Article 14 binds the provider of a high-risk AI system/i);
  assert.match(html, /does not by itself satisfy that provider design duty/i);

  for (const [title, requirement, capability, responsibility] of [
    ["See operation and exceptions", "Article 14\\(4\\)\\(a\\)", "oversight dashboard", "watching those surfaces"],
    ["Collect independent judgments", "Article 14\\(4\\)\\(b\\)", "Independent blinded panels", "pull to over-rely"],
    ["Put the output in context", "Article 14\\(4\\)\\(c\\)", "owner case view", "correctly interpreting the output"],
    [
      "Record the human decision",
      "Article 14\\(4\\)\\(d\\)",
      "required reasons field",
      "disregard, override, or reverse",
    ],
    [
      "Control intervention and stop",
      "Article 14\\(4\\)\\(e\\)",
      "verified host adapter that controls delivery",
      "when to halt",
    ],
  ] as const) {
    assert.match(html, new RegExp(title));
    assert.match(html, new RegExp(requirement));
    assert.match(html, new RegExp(capability, "i"));
    assert.match(html, new RegExp(responsibility, "i"));
  }
  assert.match(html, /id="workflow-controls"/);
  assert.match(html, /Capability 01/);
  assert.match(html, /Capability 05/);
  assert.doesNotMatch(html, /01 · Article 14\(4\)\(a\)|The five Article 14\(4\) measures/);
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
  assert.match(html, /Start with who has authority/i);
  assert.match(html, /Customer-invited reviewers can be people your organization designates and authorizes/i);
  assert.match(html, /A RateLoop-network reviewer is not designated by your organization/i);
  assert.match(html, /Network review is supplementary quality input, not your Article 26\(2\) oversight/i);
  assert.ok(html.indexOf('id="reviewer-lanes"') < html.indexOf("Shared responsibility"));
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
  assert.match(oversight, /Article 26\(2\) requires deployers of high-risk AI systems/i);
  assert.match(oversight, /## The deployer's people and process/);
  assert.match(oversight, /## If you also provide the AI system/);
  assert.match(oversight, /Article 14 binds the provider of a high-risk AI system/i);
  assert.match(oversight, /only a verified host integration can\s+enforce its review state at the output boundary\./);
  assert.match(oversight, /No host currently holds that tier/i);
  for (const heading of [
    "### See operation and exceptions",
    "### Collect independent judgments",
    "### Put the output in context",
    "### Record the human decision",
    "### Control intervention and stop",
  ]) {
    assert.ok(oversight.includes(heading), `missing heading: ${heading}`);
  }
  assert.match(oversight, /## Controls the workflow exposes/);
  assert.doesNotMatch(oversight, /### [1-5]\\.|## The five Article 14/);
  assert.match(oversight, /## Designation, competence, and literacy/);
  assert.match(oversight, /## Start with who has authority/);
  assert.match(oversight, /Ordinary Codex, plugin, and MCP integrations are advisory/i);
  assert.match(oversight, /do not\s+verify interception or withheld delivery/i);
  assert.match(oversight, /draft Article 73 serious-incident reporting template/i);
  assert.match(oversight, /Article 27 fundamental-rights impact\s+assessment/i);
  assert.match(oversight, /Customer-invited reviewers can be people your organization designates and authorizes/i);
  assert.match(oversight, /Network review is supplementary quality input, not your Article 26\(2\) oversight/i);
  assert.ok(oversight.indexOf("## Start with who has authority") < oversight.indexOf("## Shared responsibility"));
  assert.match(oversight, /\[`evidence\.md`\]\(\.\/evidence\.md\)/);
  assert.match(evidence, /\[`human-oversight\.md`\]\(\.\/human-oversight\.md\)/);
  assert.match(evidence, /\[`\/docs\/human-oversight`\]\(\/docs\/human-oversight\)/);
  assert.doesNotMatch(oversight, /compliant|compliance-ready|certif|presumption of conformity|satisfies Article/i);
  assert.doesNotMatch(oversight, /RateLoop provides the instrument — and the proof/i);
});
