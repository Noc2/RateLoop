import { tokenlessDeployedContracts, tokenlessDeploymentStatus } from "@rateloop/contracts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_EVIDENCE_CAPABILITIES,
  PUBLIC_EVIDENCE_CAPABILITY_STATE,
  PUBLIC_EVIDENCE_CLAIMS_MATRIX,
  type PublicEvidenceCapabilityState,
  derivePublicEvidenceCapabilityState,
  findPublicEvidenceClaimViolations,
  findVerifiedHostTierClaimViolations,
} from "~~/lib/tokenless/publicEvidenceClaims";

const PUBLIC_APP_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const NEXTJS_DIRECTORY = path.resolve(PUBLIC_APP_DIRECTORY, "../../..");
const MACHINE_DOCS_DIRECTORY = path.resolve(NEXTJS_DIRECTORY, "public/docs");
const COMPONENTS_DIRECTORY = path.resolve(NEXTJS_DIRECTORY, "components");
const TOKENLESS_COMPONENTS_DIRECTORY = path.join(COMPONENTS_DIRECTORY, "tokenless");
const MESSAGE_DIRECTORIES = [path.join(NEXTJS_DIRECTORY, "messages/en"), path.join(NEXTJS_DIRECTORY, "messages/de")];
const REPOSITORY_DIRECTORY = path.resolve(NEXTJS_DIRECTORY, "../..");
const PLUGINS_DIRECTORY = path.join(REPOSITORY_DIRECTORY, "plugins");

const TOKENLESS_DEPLOYMENT_CLAIM_FILES = [
  path.join(REPOSITORY_DIRECTORY, "docs/tokenless-immutable-implementation-plan-2026-07.md"),
  path.join(REPOSITORY_DIRECTORY, "docs/tokenless-environment-parity.md"),
  path.join(REPOSITORY_DIRECTORY, "packages/contracts/README.md"),
  path.join(REPOSITORY_DIRECTORY, "packages/foundry/README.md"),
  path.join(REPOSITORY_DIRECTORY, "packages/nextjs/public/docs/smart-contracts.md"),
] as const;

const MACHINE_INTEGRATION_GUIDES = [
  path.join(REPOSITORY_DIRECTORY, "packages/nextjs/public/llms.txt"),
  path.join(REPOSITORY_DIRECTORY, "packages/nextjs/public/skill.md"),
] as const;

function filesBelow(directory: string, extension: ".json" | ".md" | ".tsx"): string[] {
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

function resolvePublicComponent(importer: string, specifier: string) {
  const candidate = specifier.startsWith("~~/components/")
    ? path.join(COMPONENTS_DIRECTORY, specifier.slice("~~/components/".length))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : null;
  if (!candidate || !candidate.startsWith(`${COMPONENTS_DIRECTORY}${path.sep}`)) return null;
  for (const file of [candidate, `${candidate}.tsx`, path.join(candidate, "index.tsx")]) {
    if (file.endsWith(".tsx") && existsSync(file)) return file;
  }
  return null;
}

function publicComponentDependencies(publicAppFiles: string[]) {
  const discovered = new Set<string>();
  const queue = [...publicAppFiles];
  const staticImport = /\bfrom\s+["']([^"']+)["']/gu;
  while (queue.length > 0) {
    const importer = queue.shift()!;
    const source = readFileSync(importer, "utf8");
    for (const match of source.matchAll(staticImport)) {
      const dependency = resolvePublicComponent(importer, match[1]!);
      if (!dependency || discovered.has(dependency)) continue;
      discovered.add(dependency);
      queue.push(dependency);
    }
  }
  return [...discovered];
}

function jsonMessageValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonMessageValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(jsonMessageValues);
}

function claimSources(file: string) {
  const source = readFileSync(file, "utf8");
  return file.endsWith(".json") ? jsonMessageValues(JSON.parse(source) as unknown) : [source];
}

test("the unreleased deployment registry and every deployment claim fail closed together", () => {
  assert.deepEqual(tokenlessDeploymentStatus, {
    schemaVersion: "rateloop-tokenless-deployment-v4",
    status: "unreleased",
    reason: "fresh_deployment_required",
  });
  assert.deepEqual(Object.keys(tokenlessDeployedContracts), []);

  for (const file of TOKENLESS_DEPLOYMENT_CLAIM_FILES) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /fresh (?:Base Sepolia )?(?:test-profile )?(?:complete )?deployment|fresh deployment required/iu,
      file,
    );
    assert.doesNotMatch(source, /active disposable Base Sepolia|release status:\s*`released`/iu, file);
  }
});

test("machine integration guides present the hosted unpaid lane before gated fund-backed references", () => {
  for (const file of MACHINE_INTEGRATION_GUIDES) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /(?:private,\s*unpaid|unpaid.*private).*invited|invited.*(?:private,\s*unpaid|unpaid)/iu,
      file,
    );
    assert.match(source, /separately gated/iu, file);
    assert.doesNotMatch(source, /RateLoop provides paid, blinded human assurance panels/iu, file);
  }
  assert.match(readFileSync(MACHINE_INTEGRATION_GUIDES[1], "utf8"), /only when RateLoop explicitly reports/iu);
});

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
      design_weighted_population_estimate: ["design_weighted_population_estimate"],
      method_reviewed_population_interval: [
        "design_weighted_population_estimate",
        "method_reviewed_population_interval",
      ],
      audit_export_offline_verification: ["offline_audit_export_verifier"],
      independent_witnessing: ["managed_evidence_signing", "rekor_attestation", "rfc3161_timestamping"],
      grc_and_siem_delivery: ["vanta_delivery_exercised", "drata_delivery_exercised", "siem_delivery_exercised"],
      otel_instrumentation: ["otel_genai_ingest"],
      paid_private_review: ["paid_private_review_lane"],
      public_network_review: ["public_network_review_lane"],
      hybrid_review: ["hybrid_review_lane"],
      gdpr_launch_compliance: ["gdpr_blockchain_dpia", "provider_transfer_inventory"],
    },
  );
});

test("public paid-lane claims are derived from the routing capability projection", () => {
  const state = derivePublicEvidenceCapabilityState({
    privateInvitedUnpaid: true,
    privateInvitedPaid: true,
    publicPaidNetwork: false,
    hybridPublicSafe: false,
  });
  assert.equal(state.paid_private_review_lane, true);
  assert.equal(state.public_network_review_lane, false);
  assert.equal(state.hybrid_review_lane, false);
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
  assert.deepEqual(
    findPublicEvidenceClaimViolations("rekor: { entryUuid: string } | null; rfc3161Timestamp: string | null"),
    [],
  );
});

test("population point estimates and reviewed intervals have independent public claim gates", () => {
  const pointClaim = "RateLoop publishes a design-weighted population point estimate.";
  const intervalClaim = "RateLoop publishes a method-reviewed population confidence interval.";

  assert.deepEqual(findPublicEvidenceClaimViolations(pointClaim)[0]?.missingCapabilities, [
    "design_weighted_population_estimate",
  ]);
  assert.equal(
    findPublicEvidenceClaimViolations(pointClaim, capabilitiesEnabled("design_weighted_population_estimate")).length,
    0,
  );
  assert.deepEqual(
    findPublicEvidenceClaimViolations(intervalClaim, capabilitiesEnabled("design_weighted_population_estimate"))[0]
      ?.missingCapabilities,
    ["method_reviewed_population_interval"],
  );
  assert.equal(
    findPublicEvidenceClaimViolations(
      intervalClaim,
      capabilitiesEnabled("design_weighted_population_estimate", "method_reviewed_population_interval"),
    ).length,
    0,
  );
  assert.equal(
    findPublicEvidenceClaimViolations("RateLoop veröffentlicht eine designgewichtete Punktschätzung.")[0]?.claimId,
    "design_weighted_population_estimate",
  );
  assert.equal(
    findPublicEvidenceClaimViolations("RateLoop veröffentlicht ein methodengeprüftes Konfidenzintervall.")[0]?.claimId,
    "method_reviewed_population_interval",
  );
  assert.deepEqual(findPublicEvidenceClaimViolations("Confidence interval withheld pending method review."), []);
});

test("forbidden compliance and provenance claims cannot be enabled by capability flags", () => {
  const allEnabled = capabilitiesEnabled(...PUBLIC_EVIDENCE_CAPABILITIES);
  for (const [source, claimId] of [
    ["RateLoop is compliance-ready.", "compliance_ready"],
    ["Our evidence guarantees compliance.", "automatic_compliance"],
    ["RateLoop is ISO/IEC 42001-certified.", "unheld_certification"],
    ["RateLoop provides EU AI Act Article 14 human oversight.", "customer_human_oversight"],
    ["Independent blinded panels review the output.", "independent_blinded_panel"],
    ["RateLoop verifies the actual model that produced the output.", "verified_model_provenance"],
  ] as const) {
    const violations = findPublicEvidenceClaimViolations(source, allEnabled);
    assert.equal(violations[0]?.claimId, claimId);
    assert.equal(violations[0]?.policy, "forbidden");
  }

  assert.deepEqual(findPublicEvidenceClaimViolations("RateLoop does not make anyone compliant."), []);
  assert.equal(
    findPublicEvidenceClaimViolations("Unabhängige verblindete Prüfpanels beurteilen die Ausgabe.")[0]?.claimId,
    "independent_blinded_panel",
  );
  assert.deepEqual(findPublicEvidenceClaimViolations("RateLoop is not ISO/IEC 42001-certified."), []);
  assert.deepEqual(
    findPublicEvidenceClaimViolations(
      "This mapping does not demonstrate that a customer implemented A.6 or that RateLoop is ISO/IEC 42001 certified.",
    ),
    [],
  );
});

test("verified-host delivery claims follow the host registry and require an availability caveat", () => {
  assert.equal(
    findVerifiedHostTierClaimViolations(
      "Only a verified host adapter that owns delivery can enforce waiting. No host currently holds that tier.",
    ).length,
    0,
  );
  assert.equal(
    findVerifiedHostTierClaimViolations("Only a verified host adapter that owns delivery can enforce waiting.")[0]
      ?.claimId,
    "verified_host_delivery_enforcement",
  );
  assert.equal(
    findVerifiedHostTierClaimViolations("Verified host enforcement can hold an output.")[0]?.claimId,
    "verified_host_delivery_enforcement",
  );
});

test("paid/public lanes and launch GDPR claims require their exact shipped capabilities", () => {
  assert.equal(
    findPublicEvidenceClaimViolations("Public RateLoop network review is USDC-paid.")[0]?.claimId,
    "public_network_review",
  );
  assert.equal(
    findPublicEvidenceClaimViolations(
      "Public RateLoop network review is USDC-paid.",
      capabilitiesEnabled("public_network_review_lane"),
    ).length,
    0,
  );
  assert.equal(
    findPublicEvidenceClaimViolations("Your invited reviewers, RateLoop's World ID-backed network.")[0]?.claimId,
    "public_network_review",
  );
  assert.equal(
    findPublicEvidenceClaimViolations("Use invited reviewers or clearly separated hybrid panels.")[0]?.claimId,
    "hybrid_review",
  );
  assert.deepEqual(findPublicEvidenceClaimViolations("RateLoop is GDPR-compliant.")[0]?.missingCapabilities, [
    "gdpr_blockchain_dpia",
    "provider_transfer_inventory",
  ]);
  assert.equal(
    findPublicEvidenceClaimViolations(
      "RateLoop is GDPR-compliant.",
      capabilitiesEnabled("gdpr_blockchain_dpia", "provider_transfer_inventory"),
    ).length,
    0,
  );
  assert.deepEqual(findPublicEvidenceClaimViolations("RateLoop does not claim launch-level GDPR compliance."), []);
});

test("all public TSX, tokenless components, EN/DE messages, machine docs, and plugin copy obey capability gates", () => {
  const publicAppFiles = filesBelow(PUBLIC_APP_DIRECTORY, ".tsx");
  const publicFiles = [
    ...publicAppFiles,
    ...publicComponentDependencies(publicAppFiles),
    ...filesBelow(TOKENLESS_COMPONENTS_DIRECTORY, ".tsx"),
    ...MESSAGE_DIRECTORIES.flatMap(directory => filesBelow(directory, ".json")),
    ...filesBelow(MACHINE_DOCS_DIRECTORY, ".md"),
    ...filesBelow(PLUGINS_DIRECTORY, ".md"),
  ];
  assert.ok(publicFiles.some(file => file.endsWith("/docs/sdk/page.tsx")));
  assert.ok(publicFiles.some(file => file.endsWith("/components/shared/AppPageShell.tsx")));
  assert.ok(publicFiles.some(file => file.endsWith("/messages/en/agents.json")));
  assert.ok(publicFiles.some(file => file.endsWith("/messages/de/agents.json")));
  assert.ok(publicFiles.some(file => file.endsWith("/public/docs/sdk.md")));
  assert.ok(publicFiles.some(file => file.endsWith("/rateloop-human-review-loop/SKILL.md")));

  const failures = publicFiles.flatMap(file =>
    claimSources(file).flatMap(source =>
      [...findPublicEvidenceClaimViolations(source), ...findVerifiedHostTierClaimViolations(source)].map(violation => ({
        file: path.relative(NEXTJS_DIRECTORY, file),
        ...violation,
      })),
    ),
  );
  assert.deepEqual(failures, []);
});
