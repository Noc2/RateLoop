import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_EVIDENCE_CAPABILITIES,
  PUBLIC_EVIDENCE_CAPABILITY_STATE,
  PUBLIC_EVIDENCE_CLAIMS_MATRIX,
  type PublicEvidenceCapabilityState,
  findPublicEvidenceClaimViolations,
} from "~~/lib/tokenless/publicEvidenceClaims";

const PUBLIC_APP_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const NEXTJS_DIRECTORY = path.resolve(PUBLIC_APP_DIRECTORY, "../..");
const MACHINE_DOCS_DIRECTORY = path.resolve(PUBLIC_APP_DIRECTORY, "../../public/docs");

function filesBelow(directory: string, extension: ".md" | ".tsx"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(absolutePath, extension);
    if (!entry.isFile() || !entry.name.endsWith(extension) || entry.name.endsWith(`.test${extension}`)) return [];
    return [absolutePath];
  });
}

function capabilitiesEnabled(...enabled: (typeof PUBLIC_EVIDENCE_CAPABILITIES)[number][]) {
  return Object.fromEntries(
    PUBLIC_EVIDENCE_CAPABILITIES.map(capability => [capability, enabled.includes(capability)]),
  ) as unknown as PublicEvidenceCapabilityState;
}

test("the public evidence claims matrix is fail-closed and has explicit prerequisites", () => {
  assert.equal(new Set(PUBLIC_EVIDENCE_CLAIMS_MATRIX.map(rule => rule.id)).size, PUBLIC_EVIDENCE_CLAIMS_MATRIX.length);
  assert.deepEqual(Object.keys(PUBLIC_EVIDENCE_CAPABILITY_STATE).sort(), [...PUBLIC_EVIDENCE_CAPABILITIES].sort());
  assert.ok(Object.values(PUBLIC_EVIDENCE_CAPABILITY_STATE).every(value => value === false));

  for (const rule of PUBLIC_EVIDENCE_CLAIMS_MATRIX) {
    assert.ok(rule.patterns.length > 0, `${rule.id} has no source pattern`);
    if (rule.policy === "gated") assert.ok(rule.requiredCapabilities.length > 0, `${rule.id} has no prerequisite`);
    else assert.deepEqual(rule.requiredCapabilities, []);
  }

  assert.deepEqual(
    Object.fromEntries(
      PUBLIC_EVIDENCE_CLAIMS_MATRIX.filter(rule => rule.policy === "gated").map(rule => [
        rule.id,
        rule.requiredCapabilities,
      ]),
    ),
    {
      signed_decision_packets_offline: [
        "managed_evidence_signing",
        "published_evidence_signing_key_history",
        "offline_evidence_packet_verifier",
      ],
      packet_escalation_and_coverage: ["evidence_packet_compliance_fields", "adaptive_coverage_export"],
      audit_export_offline_verification: ["offline_audit_export_verifier"],
      independent_witnessing: ["managed_evidence_signing", "rekor_attestation", "rfc3161_timestamping"],
      grc_and_siem_delivery: ["vanta_delivery_exercised", "drata_delivery_exercised", "siem_delivery_exercised"],
      otel_instrumentation: ["otel_genai_ingest"],
    },
  );
});

test("gated evidence phrases require every capability named by the matrix", () => {
  for (const rule of PUBLIC_EVIDENCE_CLAIMS_MATRIX) {
    if (rule.policy === "gated") {
      assert.equal(
        findPublicEvidenceClaimViolations(rule.phrase)[0]?.claimId,
        rule.id,
        `${rule.id} phrase is not gated`,
      );
    }
  }

  const phrase = "Signed decision packets you can verify offline";
  assert.deepEqual(
    findPublicEvidenceClaimViolations(phrase).map(violation => violation.claimId),
    ["signed_decision_packets_offline"],
  );
  assert.deepEqual(findPublicEvidenceClaimViolations(phrase)[0]?.missingCapabilities, [
    "managed_evidence_signing",
    "published_evidence_signing_key_history",
    "offline_evidence_packet_verifier",
  ]);
  assert.equal(
    findPublicEvidenceClaimViolations(
      phrase,
      capabilitiesEnabled(
        "managed_evidence_signing",
        "published_evidence_signing_key_history",
        "offline_evidence_packet_verifier",
      ),
    ).length,
    0,
  );
  assert.equal(
    findPublicEvidenceClaimViolations("Signed decision packets you can\nverify offline")[0]?.claimId,
    "signed_decision_packets_offline",
  );

  assert.equal(
    findPublicEvidenceClaimViolations("Verify our audit exports yourself")[0]?.claimId,
    "audit_export_offline_verification",
  );
  assert.equal(
    findPublicEvidenceClaimViolations(
      "Verify our audit exports yourself",
      capabilitiesEnabled("offline_audit_export_verifier"),
    ).length,
    0,
  );
});

test("forbidden compliance and provenance claims cannot be enabled by capability flags", () => {
  const allEnabled = capabilitiesEnabled(...PUBLIC_EVIDENCE_CAPABILITIES);
  for (const [source, claimId] of [
    ["RateLoop is compliance-ready.", "compliance_ready"],
    ["Our evidence guarantees compliance.", "automatic_compliance"],
    ["RateLoop is ISO/IEC 42001-certified.", "unheld_certification"],
    ["RateLoop provides EU AI Act Article 14 human oversight.", "customer_human_oversight"],
    ["RateLoop verifies the actual model that produced the output.", "verified_model_provenance"],
  ] as const) {
    const violations = findPublicEvidenceClaimViolations(source, allEnabled);
    assert.equal(violations[0]?.claimId, claimId);
    assert.equal(violations[0]?.policy, "forbidden");
  }

  assert.deepEqual(findPublicEvidenceClaimViolations("RateLoop does not make anyone compliant."), []);
  assert.deepEqual(findPublicEvidenceClaimViolations("RateLoop is not ISO/IEC 42001-certified."), []);
});

test("all public TSX and machine-doc markdown obey the current evidence claim gates", () => {
  const publicFiles = [...filesBelow(PUBLIC_APP_DIRECTORY, ".tsx"), ...filesBelow(MACHINE_DOCS_DIRECTORY, ".md")];
  assert.ok(publicFiles.some(file => file.endsWith("/docs/sdk/page.tsx")));
  assert.ok(publicFiles.some(file => file.endsWith("/public/docs/sdk.md")));

  const failures = publicFiles.flatMap(file =>
    findPublicEvidenceClaimViolations(readFileSync(file, "utf8")).map(violation => ({
      file: path.relative(NEXTJS_DIRECTORY, file),
      ...violation,
    })),
  );
  assert.deepEqual(failures, []);
});
