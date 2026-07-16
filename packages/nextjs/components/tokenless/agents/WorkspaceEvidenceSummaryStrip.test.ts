import { anchorForPacketDigest } from "./WorkspaceEvidenceSummaryStrip";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceEvidenceSummaryStrip.tsx", import.meta.url), "utf8");

test("the agent workspace summary labels packet, scoped coverage, and anchor state without conflating them", () => {
  assert.match(source, /Last decision packet/);
  assert.match(source, /Most conservative coverage stage/);
  assert.match(source, /Latest packet anchor/);
  assert.match(source, /No evidence scope/);
  assert.match(source, /No packet anchor/);
  assert.match(source, /Owner\/admin view/);
});

test("the packet anchor is selected by the packet digest", () => {
  const attestations = [
    { artifactKind: "decision_packet", artifactDigest: "sha256:newer-unrelated", state: "completed" },
    { artifactKind: "audit_export", artifactDigest: "sha256:packet", state: "completed" },
    { artifactKind: "decision_packet", artifactDigest: "sha256:packet", state: "retry" },
  ];
  assert.equal(anchorForPacketDigest("sha256:packet", attestations), "pending");
  assert.equal(
    anchorForPacketDigest("sha256:complete", [
      { artifactKind: "decision_packet", artifactDigest: "sha256:complete", state: "completed" },
    ]),
    "completed",
  );
  assert.equal(
    anchorForPacketDigest("sha256:failed", [
      { artifactKind: "decision_packet", artifactDigest: "sha256:failed", state: "dead" },
    ]),
    "failed",
  );
  assert.equal(anchorForPacketDigest("sha256:missing", attestations), "absent");
  assert.equal(anchorForPacketDigest(null, attestations), "absent");
});
