import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = [
  "./OneTimeSecretNotice.tsx",
  "./WormEvidenceDelivery.tsx",
  "./SiemEvidenceDelivery.tsx",
  "./GrcEvidenceDelivery.tsx",
  "./MetricsEvidenceAccess.tsx",
].map(path => readFileSync(new URL(path, import.meta.url), "utf8"));
const source = files.join("\n");

test("enterprise delivery controls use the workspace assurance APIs", () => {
  assert.match(source, /assurance\/worm/);
  assert.match(source, /\/destination/);
  assert.match(source, /\/exports/);
  assert.match(source, /\/supervision/);
  assert.match(source, /assurance\/event-streams/);
  assert.match(source, /assurance\/grc-connectors/);
  assert.match(source, /assurance\/metrics\/credentials/);
});

test("configuration remains explicit and progressively disclosed", () => {
  assert.match(source, /Configure destination/);
  assert.match(source, /Add event stream/);
  assert.match(source, /Add connector/);
  assert.match(source, /Issue credential/);
  assert.ok(files.slice(1).every(value => value.includes("<details")));
});

test("credential forms accept opaque references and status views omit secret values", () => {
  assert.match(source, /placeholder="sec_…"/);
  assert.match(source, /placeholder="vault:\/\/rateloop\/grc\/…"/);
  assert.match(source, /This value is shown once/);
  assert.match(source, /It cannot be recovered/);
  assert.match(source, /I stored it — dismiss/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /created\.signingSecret/);
  assert.match(source, /created\.token/);
  assert.doesNotMatch(source, /accessKeyId|secretAccessKey|apiToken/);
  assert.doesNotMatch(source, /\{stream\.url\}/);
});

test("newly issued secrets stay in ephemeral state until explicit dismissal", () => {
  assert.match(source, /setOneTimeSecret\(\{ label: "SIEM signing secret", value: created\.signingSecret \}\)/);
  assert.match(source, /setOneTimeToken\(created\.token\)/);
  assert.match(source, /onDismiss=\{\(\) => setOneTimeSecret\(null\)\}/);
  assert.match(source, /onDismiss=\{\(\) => setOneTimeToken\(null\)\}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
});
