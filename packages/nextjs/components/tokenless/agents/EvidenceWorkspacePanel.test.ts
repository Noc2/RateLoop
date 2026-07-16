import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EvidenceWorkspacePanel.tsx", import.meta.url), "utf8");

test("the evidence workspace keeps verification and export state explicit", () => {
  assert.match(source, /Decision records and exports/);
  assert.match(source, /Export packet/);
  assert.match(source, /evidence:verify/);
  assert.match(source, /audit:verify/);
  assert.match(source, /Transparency receipt recorded/);
  assert.match(source, /Anchor pending/);
  assert.match(source, /No receipt recorded/);
  assert.match(source, /Current and retired keys remain visible/);
});

test("workspace compliance controls expose only browser-safe endpoints", () => {
  assert.match(source, /\/audit\/export/);
  assert.match(source, /\/assurance\/coverage\/export/);
  assert.match(source, /\/assurance\/metrics\/grafana/);
  assert.match(source, /minimumRetentionMonths/);
  assert.doesNotMatch(source, /TOKENLESS_|PRIVATE_KEY|secretRef|credentialRef/);
});
