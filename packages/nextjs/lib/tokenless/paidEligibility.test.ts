import { HUMAN_ASSURANCE_SCHEMA_VERSION, type HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  type EligibilityProvider,
  __setPaidEligibilityOverridesForTests,
  completeEligibilityProviderHandoff,
  createEligibilityProviderHandoff,
  getPaidEligibility,
  issuePaidVoucher,
  recordSanctionsScreening,
  registerVoucherRound,
  submitPaidEligibility,
} from "~~/lib/tokenless/paidEligibility";
import { derivePaidLaneActivationReference } from "~~/lib/tokenless/paidLaneActivation";
import { requirePaidReviewEligibility } from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  createWorkspaceReviewerInvitation,
  redeemWorkspaceReviewerInvitation,
} from "~~/lib/tokenless/workspaceReviewers";

const NOW = new Date("2026-07-12T12:00:00.000Z");
const PRINCIPAL = `rlp_${"1".repeat(24)}`;
const OTHER_PRINCIPAL = `rlp_${"2".repeat(24)}`;
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER_ACCOUNT = "0x2222222222222222222222222222222222222222";
const PANEL = "0x3333333333333333333333333333333333333333";
const ISSUER = "0x4444444444444444444444444444444444444444";
const CONTENT_ID = `0x${"55".repeat(32)}` as const;
const VOTE_KEY = "0x6666666666666666666666666666666666666666" as const;
const SIGNER_PRIVATE_KEY = `0x${"01".padStart(64, "0")}` as const;
const SIGNER = privateKeyToAccount(SIGNER_PRIVATE_KEY);
const PROVIDER_EVIDENCE_KEY = Buffer.alloc(32, 7);
const TAX_RECORDS_KEY = Buffer.alloc(32, 8);
const VOTE_MAPPING_KEY = Buffer.alloc(32, 9);
const PROVIDER_REFERENCE_KEY = Buffer.alloc(32, 10);
const originalProviderId = process.env.TOKENLESS_ELIGIBILITY_PROVIDER_ID;
const originalProviderKey = process.env.TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY;
const originalAppUrl = process.env.APP_URL;
const PAID_LANE_ENV_NAMES = [
  "TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
  "TOKENLESS_NETWORK_PANELS_ENABLED",
  "TOKENLESS_HYBRID_REVIEWS_ENABLED",
  "NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
  "NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED",
  "NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED",
  "TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE",
  "TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE",
  "TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE",
  "TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE",
  "TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT",
  "NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE",
  "WORLD_ID_APP_ID",
  "WORLD_ID_RP_ID",
  "WORLD_ID_ENVIRONMENT",
] as const;
const originalPaidLaneEnv = new Map(PAID_LANE_ENV_NAMES.map(name => [name, process.env[name]]));

function activatePaidLanesForTest() {
  Object.assign(process.env, {
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "true",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: `sha256:${"a".repeat(64)}`,
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: `sha256:${"b".repeat(64)}`,
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: `sha256:${"c".repeat(64)}`,
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-12T00:00:00.000Z",
    WORLD_ID_APP_ID: "app_ratelooptest",
    WORLD_ID_RP_ID: "rp_ratelooptest",
    WORLD_ID_ENVIRONMENT: "production",
  });
  process.env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(process.env);
}

function provider(overrides: Partial<Awaited<ReturnType<EligibilityProvider["verify"]>>> = {}): EligibilityProvider {
  return {
    async verify(input) {
      return {
        providerId: "world:poh",
        assertionId: "assertion-00000001",
        subjectId: "provider-subject-123",
        accountAddress: ACCOUNT,
        capabilities: ["live_human", "unique_human", "document_holder", "minimum_age"],
        minimumAgeVerified: 18,
        documentIssuingCountry: "DE",
        nationalityCountry: "DE",
        verifiedResidenceCountry: "DE",
        evidenceVerifiedAt: new Date(input.now.getTime() - 60_000),
        evidenceExpiresAt: new Date(input.now.getTime() + 86_400_000),
        sanctionsStatus: "clear",
        sanctionsReference: "sanctions-screen-1",
        sanctionsScreenedAt: new Date(input.now.getTime() - 60_000),
        sanctionsExpiresAt: new Date(input.now.getTime() + 86_400_000),
        assertionHash: "provider-assertion-hash",
        ...overrides,
      };
    },
  };
}

function submission(payoutAccount = ACCOUNT) {
  return {
    providerResult: { provider: "identity-production", payload: "opaque", signature: "signed" },
    sanctionsConsent: true as const,
    declaredResidenceCountry: "DE",
    taxResidenceCountry: "DE",
    payoutAccount,
    dac7: {
      fullName: "Ada Rater",
      birthDate: "1990-01-01",
      streetAddress: "Example Street 1",
      city: "Berlin",
      postalCode: "10115",
      tin: "DE-PRIVATE-TIN",
    },
  };
}

const validIntegrityEvidence = async ({ policy }: { policy: HumanAssuranceAudiencePolicy }) =>
  policy.integrity
    ? {
        epochId: policy.integrity.epochId,
        epochManifestHash: policy.integrity.epochManifestHash,
        reviewerLookup: `hmac-sha256:${"b".repeat(64)}`,
        clusterPseudonym: `hmac-sha256:${"c".repeat(64)}`,
        riskBand: "low" as const,
        providerSubjectHashes: [`hmac-sha256:hmac-v1:${"d".repeat(64)}`],
        recentCoassignments: 0,
        activeCustomerAssignments: 0,
      }
    : null;

function installOverrides(
  providerValue = provider(),
  verifyIssuerState = async () => {},
  integrityEvidence: Parameters<
    typeof __setPaidEligibilityOverridesForTests
  >[0]["integrityEvidence"] = validIntegrityEvidence,
  providerReferences = {
    currentVersion: "reference-v1",
    keys: new Map([["reference-v1", PROVIDER_REFERENCE_KEY]]),
  },
) {
  __setPaidEligibilityOverridesForTests({
    provider: providerValue,
    providerReferences,
    vault: {
      provider_evidence: { currentVersion: "test-v1", keys: new Map([["test-v1", PROVIDER_EVIDENCE_KEY]]) },
      tax_records: { currentVersion: "test-v1", keys: new Map([["test-v1", TAX_RECORDS_KEY]]) },
      vote_mapping: { currentVersion: "test-v1", keys: new Map([["test-v1", VOTE_MAPPING_KEY]]) },
    },
    issuerConfig: {
      chainId: 84532,
      panelAddress: PANEL,
      issuerAddress: ISSUER,
      issuerEpoch: 7n,
      signerAccount: SIGNER,
      signerAddress: SIGNER.address,
      rpcUrl: "http://unused.invalid",
    },
    verifyIssuerState,
    requiresDac7: () => true,
    handoff: { startUrl: "https://identity.example/start", secret: Buffer.alloc(32, 9) },
    integrityEvidence,
  });
}

async function bindPayout(principalId: string, payoutAccount: string, suffix: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [principalId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES (?, ?, 'payout', ?, 'self_custodial', 84532, ?, ?, ?)`,
    args: [`wallet_paid_${suffix}`, principalId, payoutAccount.toLowerCase(), `sha256:${suffix.repeat(64)}`, NOW, NOW],
  });
}

beforeEach(async () => {
  process.env.APP_URL = "https://tokenless.example";
  activatePaidLanesForTest();
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await bindPayout(PRINCIPAL, ACCOUNT, "1");
  await bindPayout(OTHER_PRINCIPAL, OTHER_ACCOUNT, "2");
  installOverrides();
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  __setPaidEligibilityOverridesForTests({});
  if (originalProviderId === undefined) delete process.env.TOKENLESS_ELIGIBILITY_PROVIDER_ID;
  else process.env.TOKENLESS_ELIGIBILITY_PROVIDER_ID = originalProviderId;
  if (originalProviderKey === undefined) delete process.env.TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY;
  else process.env.TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY = originalProviderKey;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  for (const name of PAID_LANE_ENV_NAMES) {
    const value = originalPaidLaneEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function unlockPaidTasks() {
  const pending = await submitPaidEligibility({
    principalId: PRINCIPAL,
    payoutAccount: ACCOUNT,
    submission: submission(),
    now: NOW,
  });
  assert.equal(pending.status, "review");
  assert.equal(pending.blockedReason, "sanctions_screening_pending");
  await recordSanctionsScreening({
    screeningId: pending.screeningId,
    status: "clear",
    listSnapshotHash: `sha256:${"a".repeat(64)}`,
    screenedBy: "test-compliance-operator",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
  return {
    status: "eligible" as const,
    blockedReason: null,
    capabilities: pending.capabilities,
  };
}

async function openRound() {
  const admissionPolicy = {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_paid_network",
    version: 1,
    reviewerSource: "rateloop_network" as const,
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1" as const,
      epochId: "integrity:2026-07-13:001",
      epochManifestHash: `sha256:${"a".repeat(64)}` as const,
      maxClusterShareBps: 2_000,
      allowedRiskBands: ["low", "medium"] as Array<"low" | "medium">,
      recentCoassignmentWindowSeconds: 2_592_000,
      maxRecentCoassignments: 0,
      maxPerCustomer: 3,
      onePerProviderSubject: true as const,
    },
    compensation: "paid" as const,
    cohorts: [],
    selection: "randomized" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: ["account_control", "live_human", "unique_human", "minimum_age"].map(capability => ({
        capability: capability as "account_control" | "live_human" | "unique_human" | "minimum_age",
        reviewerSources: ["rateloop_network" as const],
        allowedProviders: ["world:poh"],
      })),
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 10,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
  await registerVoucherRound({
    chainId: 84532,
    panelAddress: PANEL,
    roundId: "42",
    contentId: CONTENT_ID,
    admissionPolicy,
    maximumCommits: 15,
    voucherNotBefore: new Date(NOW.getTime() - 60_000),
    voucherDeadline: new Date(NOW.getTime() + 20 * 60_000),
  });
  return freezeAdmissionPolicy(admissionPolicy);
}

test("voucher issuance stops before eligibility or signing when paid-lane activation is withdrawn", async () => {
  delete process.env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE;
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          idempotencyKey: "voucher:activation:withdrawn",
          roundId: "42",
          contentId: CONTENT_ID,
          voteKey: VOTE_KEY,
          reviewerSource: "rateloop_network",
          assignmentId: "assignment_activation_withdrawn",
          selectionBindingHash: `sha256:${"e".repeat(64)}`,
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_lane_activation_required",
  );
});

test("paid-task unlock persists every gate while vaulting DAC7 and nullifier material", async () => {
  const result = await unlockPaidTasks();
  assert.deepEqual(result, {
    status: "eligible",
    blockedReason: null,
    capabilities: ["account_control", "document_holder", "live_human", "minimum_age", "unique_human"],
  });
  const publicState = await getPaidEligibility(PRINCIPAL, NOW);
  assert.equal(publicState.status, "eligible");
  assert.equal(publicState.dac7Status, "complete");
  assert.equal(publicState.payoutAccount, ACCOUNT);
  assert.equal(publicState.declaredResidenceCountry, "DE");
  assert.equal(publicState.documentIssuingCountry, "DE");
  assert.deepEqual(publicState.assuranceProviders, ["world:poh"]);

  const rows = await dbClient.execute(
    `SELECT p.nullifier_seed_ciphertext, p.nullifier_key_domain,
            l.tax_vault_ciphertext, l.tax_vault_key_domain, a.provider_evidence_key_domain
     FROM tokenless_rater_profiles p
     JOIN tokenless_legal_eligibility l ON l.rater_id = p.rater_id
     JOIN tokenless_assurance_assertions a ON a.rater_id = p.rater_id`,
  );
  const seedCiphertext = String(rows.rows[0]?.nullifier_seed_ciphertext);
  const dac7Ciphertext = String(rows.rows[0]?.tax_vault_ciphertext);
  assert.match(seedCiphertext, /^v1\./);
  assert.match(dac7Ciphertext, /^v1\./);
  assert.doesNotMatch(dac7Ciphertext, /Ada Rater|DE-PRIVATE-TIN/);
  assert.equal(rows.rows[0]?.nullifier_key_domain, "vote_mapping");
  assert.equal(rows.rows[0]?.tax_vault_key_domain, "tax_records");
  assert.equal(rows.rows[0]?.provider_evidence_key_domain, "provider_evidence");

  await unlockPaidTasks();
  const refreshed = await dbClient.execute("SELECT nullifier_seed_ciphertext FROM tokenless_rater_profiles");
  assert.equal(
    String(refreshed.rows[0]?.nullifier_seed_ciphertext),
    seedCiphertext,
    "identity refresh keeps its stable seed",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_assertions
          SET assurance_validity_model = 'durable_enrollment', evidence_expires_at = ?
          WHERE provider_id = 'world:poh'`,
    args: [new Date(NOW.getTime() - 1)],
  });
  const durableEnrollment = await getPaidEligibility(PRINCIPAL, NOW);
  assert.ok(durableEnrollment.capabilities?.includes("unique_human"));
  assert.deepEqual(durableEnrollment.assuranceProviders, ["world:poh"]);
});

test("invited paid eligibility uses the workspace adulthood warranty without calling an identity vendor", async () => {
  const { workspaceId } = await createWorkspace({ name: "Paid invited review", ownerAddress: OTHER_PRINCIPAL });
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: OTHER_PRINCIPAL,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: PRINCIPAL,
    paidAdulthoodAttested: true,
    accessExpiresAt: new Date(NOW.getTime() + 2 * 86_400_000),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: PRINCIPAL, token: invitation.token, now: NOW });
  installOverrides({
    async verify() {
      throw new Error("The invited lane must not call an identity provider.");
    },
  });

  const pending = await submitPaidEligibility({
    principalId: PRINCIPAL,
    payoutAccount: ACCOUNT,
    submission: {
      ...submission(),
      providerResult: undefined,
      reviewerSource: "customer_invited",
      workspaceId,
    },
    now: NOW,
  });
  assert.equal(pending.status, "review");
  assert.equal(pending.adulthoodBasis, "customer_attested");
  assert.deepEqual(pending.capabilities, ["customer_invitation", "minimum_age"]);
  await recordSanctionsScreening({
    screeningId: pending.screeningId,
    status: "clear",
    listSnapshotHash: `sha256:${"d".repeat(64)}`,
    screenedBy: "test-compliance-operator",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });

  const preflight = await requirePaidReviewEligibility(PRINCIPAL, NOW, {
    reviewerSource: "customer_invited",
    workspaceId,
  });
  assert.equal(preflight.identityAssertions[0]?.providerId, "rateloop:invitation");
  assert.equal(preflight.payoutAccount, ACCOUNT.toLowerCase());
  const scope = await dbClient.execute({
    sql: `SELECT adulthood_basis,workspace_id,status
          FROM tokenless_paid_eligibility_scopes WHERE rater_id=?`,
    args: [preflight.raterId],
  });
  assert.deepEqual(scope.rows, [
    { adulthood_basis: "customer_attested", workspace_id: workspaceId, status: "eligible" },
  ]);
});

test("an invited submission cannot clobber network legal eligibility or verified residence", async () => {
  await unlockPaidTasks();
  const networkBefore = await requirePaidReviewEligibility(PRINCIPAL, NOW, {
    reviewerSource: "rateloop_network",
  });
  const { workspaceId } = await createWorkspace({ name: "Lane isolation", ownerAddress: OTHER_PRINCIPAL });
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: OTHER_PRINCIPAL,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: PRINCIPAL,
    paidAdulthoodAttested: true,
    accessExpiresAt: new Date(NOW.getTime() + 2 * 86_400_000),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: PRINCIPAL, token: invitation.token, now: NOW });

  const invited = await submitPaidEligibility({
    principalId: PRINCIPAL,
    payoutAccount: ACCOUNT,
    submission: {
      ...submission(),
      providerResult: undefined,
      reviewerSource: "customer_invited",
      workspaceId,
    },
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(invited.status, "review");

  const networkAfter = await requirePaidReviewEligibility(PRINCIPAL, new Date(NOW.getTime() + 1_000), {
    reviewerSource: "rateloop_network",
  });
  assert.equal(networkAfter.raterId, networkBefore.raterId);
  assert.equal(networkAfter.identityAssertions[0]?.providerId, "world:poh");
  const lanes = await dbClient.execute({
    sql: `SELECT reviewer_source,workspace_id,verified_residence_country,eligibility_status
          FROM tokenless_legal_eligibility ORDER BY reviewer_source`,
  });
  assert.deepEqual(lanes.rows, [
    {
      reviewer_source: "customer_invited",
      workspace_id: workspaceId,
      verified_residence_country: null,
      eligibility_status: "review",
    },
    {
      reviewer_source: "rateloop_network",
      workspace_id: null,
      verified_residence_country: "DE",
      eligibility_status: "eligible",
    },
  ]);
});

test("generic provider identifiers use rotation-aware domain-separated HMAC references", async () => {
  await unlockPaidTasks();
  const first = await dbClient.execute(
    `SELECT b.subject_reference_hash, b.subject_reference_scheme, b.subject_reference_key_version,
            a.provider_assertion_id_hash, a.provider_assertion_reference_scheme,
            a.provider_assertion_key_version, l.sanctions_reference_hash
     FROM tokenless_provider_subject_bindings b
     JOIN tokenless_assurance_assertions a ON a.binding_id = b.binding_id
     JOIN tokenless_legal_eligibility l ON l.rater_id = b.rater_id
     WHERE b.provider_namespace = 'generic:v3'`,
  );
  const firstRow = first.rows[0]!;
  assert.equal(firstRow.subject_reference_scheme, "hmac-sha256-v1");
  assert.equal(firstRow.provider_assertion_reference_scheme, "hmac-sha256-v1");
  assert.equal(firstRow.subject_reference_key_version, "reference-v1");
  assert.equal(firstRow.provider_assertion_key_version, "reference-v1");
  assert.match(String(firstRow.subject_reference_hash), /^hmac-sha256:reference-v1:[0-9a-f]{64}$/u);
  assert.match(String(firstRow.provider_assertion_id_hash), /^hmac-sha256:reference-v1:[0-9a-f]{64}$/u);
  assert.match(String(firstRow.sanctions_reference_hash), /^[0-9a-f]{64}$/u);
  assert.notEqual(
    firstRow.subject_reference_hash,
    createHash("sha256").update("world:poh:provider-subject-123").digest("hex"),
  );

  installOverrides(provider(), async () => {}, validIntegrityEvidence, {
    currentVersion: "reference-v2",
    keys: new Map([
      ["reference-v1", PROVIDER_REFERENCE_KEY],
      ["reference-v2", Buffer.alloc(32, 11)],
    ]),
  });
  await unlockPaidTasks();
  const rotated = await dbClient.execute(
    `SELECT b.subject_reference_hash, b.subject_reference_key_version,
            a.provider_assertion_id_hash, a.provider_assertion_key_version
     FROM tokenless_provider_subject_bindings b
     JOIN tokenless_assurance_assertions a ON a.binding_id = b.binding_id
     WHERE b.provider_namespace = 'generic:v3'`,
  );
  assert.equal(rotated.rows.length, 1);
  assert.equal(rotated.rows[0]?.subject_reference_key_version, "reference-v2");
  assert.equal(rotated.rows[0]?.provider_assertion_key_version, "reference-v2");
  assert.match(String(rotated.rows[0]?.subject_reference_hash), /^hmac-sha256:reference-v2:/u);
  assert.match(String(rotated.rows[0]?.provider_assertion_id_hash), /^hmac-sha256:reference-v2:/u);
});

test("document and nationality countries remain distinct from residence and tax eligibility", async () => {
  installOverrides(
    provider({
      documentIssuingCountry: "FR",
      nationalityCountry: "IT",
      verifiedResidenceCountry: "DE",
    }),
  );
  const result = await unlockPaidTasks();
  assert.equal(result.status, "eligible");
  const state = await getPaidEligibility(PRINCIPAL, NOW);
  assert.equal(state.documentIssuingCountry, "FR");
  assert.equal(state.nationalityCountry, "IT");
  assert.equal(state.verifiedResidenceCountry, "DE");
  assert.equal(state.declaredResidenceCountry, "DE");
  assert.equal(state.taxResidenceCountry, "DE");
});

test("declared and tax residence mismatch is persisted distinctly and blocks paid vouchers", async () => {
  const result = await submitPaidEligibility({
    principalId: PRINCIPAL,
    payoutAccount: ACCOUNT,
    submission: { ...submission(), taxResidenceCountry: "FR" },
    now: NOW,
  });
  assert.equal(result.status, "review");
  assert.equal(result.blockedReason, "residence_tax_review");
  const state = await getPaidEligibility(PRINCIPAL, NOW);
  assert.equal(state.declaredResidenceCountry, "DE");
  assert.equal(state.taxResidenceCountry, "FR");
  assert.equal(state.residenceTaxStatus, "review");
  await openRound();
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          idempotencyKey: "voucher:test:residence",
          roundId: "42",
          contentId: CONTENT_ID,
          voteKey: VOTE_KEY,
          reviewerSource: "rateloop_network",
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_required",
  );
});

test("unlock rejects a payout address that the browser session did not prove", async () => {
  await assert.rejects(
    () =>
      submitPaidEligibility({
        principalId: PRINCIPAL,
        payoutAccount: ACCOUNT,
        submission: submission(OTHER_ACCOUNT),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "payout_ownership_mismatch",
  );
});

test("production provider results require an Ed25519 signature bound to the signed-in account", async () => {
  const keys = generateKeyPairSync("ed25519");
  process.env.TOKENLESS_ELIGIBILITY_PROVIDER_ID = "verified-provider";
  process.env.TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  __setPaidEligibilityOverridesForTests({
    provider: null,
    providerReferences: {
      currentVersion: "reference-v1",
      keys: new Map([["reference-v1", PROVIDER_REFERENCE_KEY]]),
    },
    vault: {
      provider_evidence: { currentVersion: "test-v1", keys: new Map([["test-v1", PROVIDER_EVIDENCE_KEY]]) },
      tax_records: { currentVersion: "test-v1", keys: new Map([["test-v1", TAX_RECORDS_KEY]]) },
      vote_mapping: { currentVersion: "test-v1", keys: new Map([["test-v1", VOTE_MAPPING_KEY]]) },
    },
    requiresDac7: () => true,
    handoff: { startUrl: "https://identity.example/start", secret: Buffer.alloc(32, 9) },
  });
  const payload = Buffer.from(
    JSON.stringify({
      version: 2,
      provider: "verified-provider",
      assertionId: "assertion-signed-1",
      subjectId: "subject-signed-1",
      accountAddress: ACCOUNT,
      capabilities: ["live_human", "minimum_age"],
      minimumAgeVerified: 18,
      documentIssuingCountry: "DE",
      nationalityCountry: "DE",
      verifiedResidenceCountry: "DE",
      evidenceVerifiedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      evidenceExpiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      sanctions: {
        status: "clear",
        reference: "screen-signed-1",
        screenedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      },
    }),
  ).toString("base64url");
  const signature = sign(null, Buffer.from(payload, "base64url"), keys.privateKey).toString("base64url");
  const handoff = await createEligibilityProviderHandoff({ principalId: PRINCIPAL, payoutAccount: ACCOUNT }, NOW);
  assert.equal(
    new URL(handoff.startUrl).searchParams.get("callback_url"),
    "https://tokenless.example/api/rater/eligibility/provider/callback",
  );
  await completeEligibilityProviderHandoff({
    state: handoff.state,
    providerResult: { provider: "verified-provider", payload, signature },
    now: NOW,
  });
  const result = await submitPaidEligibility({
    principalId: PRINCIPAL,
    payoutAccount: ACCOUNT,
    now: NOW,
    submission: { ...submission(), providerResult: undefined, providerState: handoff.state },
  });
  assert.equal(result.status, "review");
  await recordSanctionsScreening({
    screeningId: result.screeningId,
    status: "clear",
    listSnapshotHash: `sha256:${"b".repeat(64)}`,
    screenedBy: "test-compliance-operator",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
  assert.equal((await getPaidEligibility(PRINCIPAL, NOW)).status, "eligible");

  const invalidHandoff = await createEligibilityProviderHandoff(
    { principalId: PRINCIPAL, payoutAccount: ACCOUNT },
    NOW,
  );
  await assert.rejects(
    () =>
      completeEligibilityProviderHandoff({
        state: invalidHandoff.state,
        now: NOW,
        providerResult: {
          provider: "verified-provider",
          payload,
          signature: Buffer.alloc(64).toString("base64url"),
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_provider_result",
  );
});

test("a provider assertion id cannot be replayed onto another immutable identity binding", async () => {
  await unlockPaidTasks();
  installOverrides(
    provider({
      accountAddress: OTHER_ACCOUNT,
      subjectId: "provider-subject-other",
    }),
  );
  await assert.rejects(
    () =>
      submitPaidEligibility({
        principalId: OTHER_PRINCIPAL,
        payoutAccount: OTHER_ACCOUNT,
        submission: submission(OTHER_ACCOUNT),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "identity_already_bound",
  );
  const assertions = await dbClient.execute(`
    SELECT p.account_address, a.provider_assertion_hash
    FROM tokenless_assurance_assertions a
    JOIN tokenless_rater_profiles p ON p.rater_id = a.rater_id
  `);
  assert.deepEqual(assertions.rows, [
    { account_address: ACCOUNT.toLowerCase(), provider_assertion_hash: "provider-assertion-hash" },
  ]);
});

test("manual sanctions review is persisted and remains fail-closed for paid vouchers", async () => {
  installOverrides(provider({ sanctionsStatus: "review" }));
  const result = await submitPaidEligibility({
    principalId: PRINCIPAL,
    payoutAccount: ACCOUNT,
    submission: submission(),
    now: NOW,
  });
  assert.equal(result.status, "review");
  assert.equal(result.blockedReason, "sanctions_screening_pending");
  await recordSanctionsScreening({
    screeningId: result.screeningId,
    status: "review",
    listSnapshotHash: `sha256:${"c".repeat(64)}`,
    screenedBy: "test-compliance-operator",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
  });
  assert.equal((await getPaidEligibility(PRINCIPAL, NOW)).screeningStatus, "review_required");
  await openRound();
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          idempotencyKey: "voucher:test:review",
          roundId: "42",
          contentId: CONTENT_ID,
          voteKey: VOTE_KEY,
          reviewerSource: "rateloop_network",
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_required",
  );
});

test("voucher issuance fails before eligibility and for missing required capabilities", async () => {
  await openRound();
  const request = {
    idempotencyKey: "voucher:test:before",
    roundId: "42",
    contentId: CONTENT_ID,
    voteKey: VOTE_KEY,
    reviewerSource: "rateloop_network",
  } as const;
  await assert.rejects(
    () => issuePaidVoucher({ principalId: PRINCIPAL, request, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_required",
  );
  installOverrides(provider({ capabilities: ["minimum_age"], minimumAgeVerified: 18 }));
  await unlockPaidTasks();
  await assert.rejects(
    () => issuePaidVoucher({ principalId: PRINCIPAL, request, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "admission_policy_not_satisfied",
  );
});

test("network voucher admission cannot omit assignment integrity provenance", async () => {
  await unlockPaidTasks();
  await openRound();
  installOverrides(
    provider(),
    async () => {},
    async () => null,
  );
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          idempotencyKey: "voucher:test:missing-integrity",
          roundId: "42",
          contentId: CONTENT_ID,
          voteKey: VOTE_KEY,
          reviewerSource: "rateloop_network",
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "admission_policy_not_satisfied",
  );
});

test("voucher issuance rejects policy JSON that no longer matches its frozen hash", async () => {
  await unlockPaidTasks();
  await openRound();
  const source = await dbClient.execute(
    "SELECT admission_policy_json FROM tokenless_voucher_rounds WHERE round_id = 42",
  );
  const changedPolicy = {
    ...(JSON.parse(String(source.rows[0]?.admission_policy_json)) as Record<string, unknown>),
    version: 2,
  };
  await dbClient.execute({
    sql: "UPDATE tokenless_voucher_rounds SET admission_policy_json = ? WHERE round_id = 42",
    args: [freezeAdmissionPolicy(changedPolicy).policyJson],
  });
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          idempotencyKey: "voucher:test:tamper",
          roundId: "42",
          contentId: CONTENT_ID,
          voteKey: VOTE_KEY,
          reviewerSource: "rateloop_network",
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "admission_policy_mismatch",
  );
});

test("voucher issuance rejects invalid or caller-mismatched reviewer sources", async () => {
  await unlockPaidTasks();
  await openRound();
  const request = {
    idempotencyKey: "voucher:test:source-binding",
    roundId: "42",
    contentId: CONTENT_ID,
    voteKey: VOTE_KEY,
    reviewerSource: "rateloop_network",
  } as const;
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: { ...request, reviewerSource: "invented_source" } as unknown as typeof request,
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_voucher_request",
  );
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          ...request,
          reviewerSource: "customer_invited",
          assignmentId: "assignment_source_binding",
          issuanceId: "issuance_source_binding",
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "voucher_reviewer_source_mismatch",
  );
});

test("voucher admission composes independent provider assertions and snapshots the exact mix", async () => {
  await unlockPaidTasks();
  const rater = await dbClient.execute("SELECT rater_id FROM tokenless_rater_profiles LIMIT 1");
  const raterId = String(rater.rows[0]?.rater_id);
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_assertions SET capabilities_json = ? WHERE rater_id = ?",
    args: [JSON.stringify(["account_control", "live_human", "unique_human"]), raterId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_provider_subject_bindings
          (binding_id, rater_id, provider_id, provider_namespace, subject_reference_hash,
           subject_reference_scheme, status, bound_at, last_verified_at, created_at, updated_at)
          VALUES ('binding_age', ?, 'age-provider', 'age:test', ?, 'legacy-sha256-v2',
                  'active', ?, ?, ?, ?)`,
    args: [raterId, `sha256:${"7".repeat(64)}`, NOW, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_assertions
          (assertion_id, rater_id, binding_id, provider_id, provider_namespace,
           provider_assertion_hash, provider_assertion_id_hash, provider_assertion_reference_scheme,
           capabilities_json, provider_evidence_ciphertext, provider_evidence_key_version,
           provider_evidence_key_domain, evidence_verified_at, evidence_expires_at,
           minimum_age_verified, status, created_at, updated_at)
          SELECT 'assertion_age', rater_id, 'binding_age', 'age-provider', 'age:test',
                 'age-hash', 'age-id-hash', 'legacy-sha256-v2', '["minimum_age"]',
                 provider_evidence_ciphertext, provider_evidence_key_version,
                 provider_evidence_key_domain, evidence_verified_at, evidence_expires_at,
                 18, 'active', created_at, updated_at
          FROM tokenless_assurance_assertions WHERE rater_id = ? LIMIT 1`,
    args: [raterId],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_paid_eligibility_scopes SET adulthood_assertion_id = ? WHERE rater_id = ?",
    args: ["assertion_age", raterId],
  });
  await registerVoucherRound({
    chainId: 84532,
    panelAddress: PANEL,
    roundId: "42",
    contentId: CONTENT_ID,
    admissionPolicy: {
      schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
      policyId: "policy_composed",
      version: 1,
      reviewerSource: "rateloop_network",
      integrity: {
        schemaVersion: "rateloop.integrity-assignment.v1",
        epochId: "integrity:2026-07-13:001",
        epochManifestHash: `sha256:${"a".repeat(64)}`,
        maxClusterShareBps: 2_000,
        allowedRiskBands: ["low", "medium"],
        recentCoassignmentWindowSeconds: 2_592_000,
        maxRecentCoassignments: 0,
        maxPerCustomer: 3,
        onePerProviderSubject: true,
      },
      compensation: "paid",
      cohorts: [],
      selection: "randomized",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications: [],
      assurance: {
        requirements: [
          {
            capability: "account_control",
            reviewerSources: ["rateloop_network"],
            allowedProviders: ["world:poh"],
          },
          {
            capability: "live_human",
            reviewerSources: ["rateloop_network"],
            allowedProviders: ["world:poh"],
          },
          {
            capability: "unique_human",
            reviewerSources: ["rateloop_network"],
            allowedProviders: ["world:poh"],
          },
          {
            capability: "minimum_age",
            reviewerSources: ["rateloop_network"],
            allowedProviders: ["age-provider"],
          },
        ],
      },
      buyerPrivacy: { visibleFields: ["reviewer_source"], minimumAggregationSize: 10, suppressSmallCells: true },
      legalEligibilityRequired: true,
    },
    maximumCommits: 15,
    voucherNotBefore: new Date(NOW.getTime() - 60_000),
    voucherDeadline: new Date(NOW.getTime() + 20 * 60_000),
  });
  const issued = await issuePaidVoucher({
    principalId: PRINCIPAL,
    request: {
      idempotencyKey: "voucher:test:composed",
      roundId: "42",
      contentId: CONTENT_ID,
      voteKey: VOTE_KEY,
      reviewerSource: "rateloop_network",
    },
    now: NOW,
  });
  const snapshot = await dbClient.execute({
    sql: "SELECT snapshot_json FROM tokenless_voucher_assurance_snapshots WHERE voucher_id = ?",
    args: [issued.voucherId],
  });
  const assertions = (
    JSON.parse(String(snapshot.rows[0]?.snapshot_json)) as {
      assertions: Array<{ providerId: string }>;
    }
  ).assertions;
  assert.deepEqual(assertions.map(value => value.providerId).sort(), ["age-provider", "world:poh"]);
});

test("voucher is domain-bound, exact, idempotent, and one-per-rater-per-round", async () => {
  let issuerChecks = 0;
  installOverrides(provider(), async () => {
    issuerChecks += 1;
  });
  await unlockPaidTasks();
  const frozenPolicy = await openRound();
  const rater = await dbClient.execute("SELECT rater_id FROM tokenless_rater_profiles LIMIT 1");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_reviewer_qualifications
          (qualification_id, rater_id, reviewer_source, qualification_kind, cohort_ids_json,
           qualification_keys_json, verified_at, expires_at, status, created_at, updated_at)
          VALUES ('qual_invited_competing', ?, 'customer_invited', 'invitation', '[]', '[]',
                  ?, ?, 'active', ?, ?)`,
    args: [String(rater.rows[0]?.rater_id), NOW, new Date(NOW.getTime() + 86_400_000), NOW, NOW],
  });
  const request = {
    idempotencyKey: "voucher:test:exact",
    roundId: "42",
    contentId: CONTENT_ID,
    voteKey: VOTE_KEY,
    reviewerSource: "rateloop_network",
  } as const;
  const first = await issuePaidVoucher({ principalId: PRINCIPAL, request, now: NOW });
  const snapshotBefore = await dbClient.execute({
    sql: `SELECT snapshot_json, snapshot_hash
          FROM tokenless_voucher_assurance_snapshots WHERE voucher_id = ?`,
    args: [first.voucherId],
  });
  const snapshottedAssertions = JSON.parse(String(snapshotBefore.rows[0]?.snapshot_json)) as {
    reviewerSource: string;
    assertions: Array<{ providerId: string; capabilities: string[] }>;
  };
  assert.equal(snapshottedAssertions.reviewerSource, "rateloop_network");
  const assertions = snapshottedAssertions.assertions;
  assert.equal(assertions.length, 1);
  assert.equal(assertions[0]?.providerId, "world:poh");
  assert.deepEqual(assertions[0]?.capabilities, [
    "account_control",
    "document_holder",
    "live_human",
    "minimum_age",
    "unique_human",
  ]);
  await dbClient.execute(
    "UPDATE tokenless_assurance_assertions SET capabilities_json = '[]', status = 'revoked' WHERE rater_id IS NOT NULL",
  );
  const replay = await issuePaidVoucher({ principalId: PRINCIPAL, request, now: NOW });
  assert.equal(replay.voucherId, first.voucherId);
  assert.equal(replay.voucherSignature, first.voucherSignature);
  assert.equal(issuerChecks, 1, "idempotent replay does not sign again or recheck the chain");
  assert.equal(first.voucher.issuerEpoch, "7");
  assert.equal(first.voucher.roundId, "42");
  assert.equal(first.voucher.admissionPolicyHash, frozenPolicy.admissionPolicyHash);
  const snapshotAfter = await dbClient.execute({
    sql: `SELECT snapshot_json, snapshot_hash
          FROM tokenless_voucher_assurance_snapshots WHERE voucher_id = ?`,
    args: [first.voucherId],
  });
  assert.deepEqual(snapshotAfter.rows[0], snapshotBefore.rows[0]);
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_assertions SET capabilities_json = ?, status = 'active' WHERE rater_id IS NOT NULL",
    args: [JSON.stringify(assertions[0]?.capabilities)],
  });

  const recovered = await recoverTypedDataAddress({
    domain: { name: "RateLoop Tokenless Panel", version: "1", chainId: 84532, verifyingContract: PANEL },
    types: {
      Voucher: [
        { name: "voteKey", type: "address" },
        { name: "contentId", type: "bytes32" },
        { name: "roundId", type: "uint256" },
        { name: "nullifier", type: "bytes32" },
        { name: "admissionPolicyHash", type: "bytes32" },
        { name: "issuerEpoch", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
      ],
    },
    primaryType: "Voucher",
    message: {
      voteKey: VOTE_KEY,
      contentId: CONTENT_ID,
      roundId: 42n,
      nullifier: first.voucher.nullifier as `0x${string}`,
      admissionPolicyHash: frozenPolicy.admissionPolicyHash,
      issuerEpoch: 7n,
      expiresAt: BigInt(first.voucher.expiresAt as string),
    },
    signature: first.voucherSignature as `0x${string}`,
  });
  assert.equal(recovered, SIGNER.address);

  await assert.rejects(
    () => issuePaidVoucher({ principalId: PRINCIPAL, request: { ...request, voteKey: OTHER_ACCOUNT }, now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "voucher_conflict",
  );
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: { ...request, idempotencyKey: "voucher:test:second" },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "voucher_already_issued",
  );
});

test("issuer acceptance is checked before any voucher record is created", async () => {
  installOverrides(provider(), async () => {
    throw new TokenlessServiceError("epoch rejected", 503, "issuer_mismatch");
  });
  await unlockPaidTasks();
  await openRound();
  await assert.rejects(
    () =>
      issuePaidVoucher({
        principalId: PRINCIPAL,
        request: {
          idempotencyKey: "voucher:test:epoch",
          roundId: "42",
          contentId: CONTENT_ID,
          voteKey: VOTE_KEY,
          reviewerSource: "rateloop_network",
        },
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "issuer_mismatch",
  );
  const rows = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_paid_vouchers");
  assert.equal(Number(rows.rows[0]?.count), 0);
});
