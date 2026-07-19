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
const [, wormSource, siemSource, grcSource, metricsSource] = files;

test("enterprise delivery controls use the workspace assurance APIs", () => {
  assert.match(source, /assurance\/worm/);
  assert.match(source, /\/destination/);
  assert.match(source, /\/exports/);
  assert.match(source, /\/supervision/);
  assert.match(source, /assurance\/event-streams/);
  assert.match(source, /assurance\/grc-connectors/);
  assert.match(source, /assurance\/metrics\/credentials/);
});

test("enterprise delivery status and management stay visible", () => {
  assert.match(wormSource, /<section[^>]+aria-labelledby="immutable-archive-heading"/);
  assert.match(siemSource, /<section[^>]+aria-labelledby="siem-event-streams-heading"/);
  assert.match(grcSource, /<section[^>]+aria-labelledby="grc-connectors-heading"/);
  assert.match(metricsSource, /<section[^>]+aria-labelledby="metrics-access-heading"/);
  for (const value of files.slice(1)) {
    assert.doesNotMatch(value, /<details className="surface-card-nested/);
  }
  assert.match(wormSource, /destination \? "Verified" : "Not configured"/);
  assert.match(siemSource, /streams\.filter\(stream => stream\.active\)\.length/);
  assert.match(grcSource, /connectors\.length/);
  assert.match(metricsSource, /credentials\.filter\(credential => credential\.status === "active"\)\.length/);
});

test("long configuration forms use direct actions with cancel", () => {
  assert.match(source, /Configure destination/);
  assert.match(source, /Add event stream/);
  assert.match(source, /Add connector/);
  assert.match(source, /Issue credential/);
  for (const value of [wormSource, siemSource, grcSource]) {
    assert.match(value, /aria-controls=/);
    assert.match(value, />\s*Cancel\s*<\/button>/);
  }
  assert.doesNotMatch(metricsSource, /<details/);
  assert.match(metricsSource, /<form[\s\S]*Issue credential/);
  assert.match(wormSource, /<details[\s\S]*Recent archive deliveries/);
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
