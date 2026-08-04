import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = `${readFileSync(new URL("./EvidenceWorkspacePanel.tsx", import.meta.url), "utf8")}\n${readFileSync(
  new URL("../../../messages/en/agents.json", import.meta.url),
  "utf8",
)}`;

test("the evidence workspace keeps verification and export state explicit", () => {
  assert.match(source, /Decision records and exports/);
  assert.doesNotMatch(source, /tracking-widest[^>]*>\s*Evidence\s*</);
  assert.match(source, /Export packet/);
  assert.doesNotMatch(source, /Evidence settings/);
  assert.match(source, /Retention, keys, and delivery/);
  assert.match(source, /aria-expanded=\{showAdvancedControls\}/);
  assert.match(source, /canManage && showAdvancedControls/);
  assert.match(source, /Verification details/);
  assert.match(source, /respondingReviewerCount/);
  assert.match(source, /targetReviewerCount/);
  assert.match(source, /Point-in-time record/);
  assert.match(source, /projectId: run\.projectId/);
  assert.match(source, /suiteId: run\.suiteId/);
  assert.match(source, /suiteVersion: run\.suiteVersion/);
  assert.match(source, /newerPacketsByIdentity\(packets\)/);
  assert.match(source, /A newer packet exists for this project and suite/);
  assert.match(source, /This signed packet remains an immutable\s+point-in-time record/);
  assert.match(source, /Open newer packet/);
  assert.match(source, /Review coverage and timing/);
  for (const field of [
    "targetExpectedJudgmentCount",
    "assignedExpectedJudgmentCount",
    "submittedJudgmentCount",
    "validJudgmentCount",
    "invalidJudgmentCount",
    "pendingJudgmentCount",
    "missingTargetJudgmentCount",
    "missingAssignedJudgmentCount",
  ]) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /responseSubmissionLatencyFromPeriodStartMs/);
  assert.match(source, /Median response time/);
  assert.match(source, /95th percentile/);
  assert.doesNotMatch(source, /No decision packet yet|A packet appears after/);
  assert.match(source, /evidence:verify/);
  assert.match(source, /audit:verify/);
  assert.match(source, /Transparency receipt recorded/);
  assert.match(source, /Anchor pending/);
  assert.match(source, /No receipt recorded/);
  assert.match(source, /Current and retired keys remain visible/);
  assert.match(source, /Download trusted SPKI pin/);
  assert.match(source, /format=spki&keyId=/);
  assert.match(source, /--key-id '\$\{trustedKey\.keyId\}'/);
  assert.doesNotMatch(source, /--public-key '\$\{packet\.signing\.publicKey\}'/);
  assert.match(source, /Do not verify it using its embedded key/);
  assert.match(source, /attestation:verify/);
  assert.match(source, /--signer-public-key.*--signer-key-id.*--rekor-public-key.*--tsa-ca.*--tsa-chain/s);
  assert.match(source, /Download attestation witness/);
  assert.match(source, /Anchor details restricted/);
  assert.match(source, /Receipt details restricted/);
  assert.match(source, /anchorLabel\(attestation, canManage, copy\)/);
  assert.match(source, /Settlement evidence/);
  assert.match(source, /Reviewer provenance/);
  assert.match(source, /paidReviewerCount/);
  assert.match(source, /minimumAggregationSize/);
  assert.match(source, /safeExternalEvidenceLink/);
  assert.match(source, /Workflow or project/);
  assert.match(source, /All outcomes/);
  assert.match(source, /Last 7 days/);
  assert.match(source, /Last 30 days/);
  assert.match(source, /visiblePackets\.map/);
  assert.match(source, /No evidence records yet/);
  assert.match(source, /No matching evidence/);
  assert.match(source, /parseEvidenceUrlState\(window\.location\.search\)/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /window\.history\.pushState/);
  assert.match(
    source,
    /evidenceLinkHref\(urlSnapshot,\s*\{\s*runId: packet\.payload\.runId,\s*packetId: packet\.payload\.packetId,?\s*\}\)/s,
  );
  assert.match(source, /updateUrlState\(\s*\{ runId: packet\.payload\.runId, packetId: packet\.payload\.packetId \}/s);
  assert.match(source, /aria-current=\{selected \? "page" : undefined\}/);
  assert.match(source, /selected \? copy\("linkToPacket"\) : <AgentText id="dynamic027" \/>/);
  assert.match(source, /!loading && packets\.length > 0/);
  assert.match(source, /!loading && selectedPacket \? \(\s*<VerificationInstructions/s);
  assert.doesNotMatch(source, /Export a packet to show its pinned-key verification command/);
  assert.doesNotMatch(source, /\{packets\.length > 0 \? \(/);
});

test("workspace compliance controls expose only browser-safe endpoints", () => {
  assert.match(
    source,
    /!loading && canManage \? \(\s*<Card as="section"[^>]+aria-labelledby="compliance-export-heading"/s,
  );
  assert.match(source, /Export operating evidence for an audit/);
  assert.match(source, /\/audit\/export/);
  assert.match(source, /\/assurance\/coverage\/export/);
  assert.match(source, /\/assurance\/metrics\/grafana/);
  assert.ok(source.indexOf("evidence-empty-heading") < source.indexOf("compliance-export-heading"));
  assert.ok(source.indexOf("<VerificationInstructions") < source.indexOf("compliance-export-heading"));
  assert.match(source, /minimumRetentionMonths/);
  assert.doesNotMatch(source, /TOKENLESS_|PRIVATE_KEY|secretRef|credentialRef/);
  assert.match(source, /Evidence integrations/);
  assert.match(source, /Add or update one delivery destination at a time/);
  assert.match(source, /copy\("configureDelivery", \{ label \}\)/);
  assert.match(source, /deliveryKind === "worm" \? <WormEvidenceDelivery/);
  assert.match(source, /deliveryKind === "siem" \? <SiemEvidenceDelivery/);
  assert.match(source, /deliveryKind === "grc" \? <GrcEvidenceDelivery/);
  assert.match(source, /deliveryKind === "metrics" \? <MetricsEvidenceAccess/);
  assert.doesNotMatch(source, /grid items-start gap-3 lg:grid-cols-2/);
});

test("verification keeps the required independent trust-anchor instruction and links the full guide", () => {
  assert.match(source, /Never verify a packet with the key inside it\. Download the pinned key from key history\./);
  assert.match(source, /href="\/docs\/evidence#verify"/);
  assert.doesNotMatch(source, /recompute the packet signature, Merkle roots, aggregation, and digest/);
});
