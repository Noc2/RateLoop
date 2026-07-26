import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FrozenHybridReviewSplit,
  type HybridHumanReviewDependencies,
  createHybridHumanReviewAdapter,
} from "~~/lib/tokenless/hybridHumanReviewAdapter";
import { hybridRequestForTest } from "~~/lib/tokenless/hybridHumanReviewTestFixtures";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH = `sha256:${"ab".repeat(32)}` as const;
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";

function candidate(accountAddress: string) {
  return {
    principalId: `rlp_${accountAddress.slice(2, 26)}`,
    payoutAccount: accountAddress,
    assignmentReference: `assignment:${accountAddress}`,
    assignmentHash: HASH,
  };
}

function preparationEvidence(cohort: "invited" | "network") {
  return {
    sourceOperationReference: `${cohort}:operation`,
    sourceRunId: `${cohort}:run`,
    chainAdmissionPolicyHash: `0x${(cohort === "invited" ? "1" : "2").repeat(64)}` as `0x${string}`,
    selectedSeatEvidenceHash: HASH,
    voucherPreparationHash: HASH,
    settlementBindingHash: HASH,
  };
}

function split(): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v3",
    workspaceId: "ws_hybrid",
    opportunityId: "opportunity_hybrid",
    audiencePolicyHash: HASH,
    requestProfileHash: HASH,
    semanticProfile: {
      schemaVersion: "rateloop.review-request-profile.v4",
      audience: "hybrid",
      audiencePolicyHash: HASH,
      execution: "two_distinct_rounds",
      invited: {
        reviewerSource: "customer_invited",
        panelSize: 1,
        admissionPolicyHash: HASH,
        economics: { asset: "USDC", bountyPerSeatAtomic: "1000000", maximumChargeAtomic: "1900000" },
        expertiseRequirements: [],
      },
      network: {
        reviewerSource: "rateloop_network",
        panelSize: 1,
        admissionPolicyHash: HASH,
        economics: { asset: "USDC", bountyPerSeatAtomic: "2000000", maximumChargeAtomic: "3800000" },
        expertiseRequirements: [],
      },
    },
    contentCommitments: { source: HASH, suggestion: HASH },
    publication: {
      visibility: "public",
      dataClassification: "redacted",
      confirmedNoSensitiveData: true,
      redactionSummary: "Customer identifiers were removed from the public review copy.",
    },
    economics: { asset: "USDC", invitedMaximumChargeAtomic: "1900000", networkMaximumChargeAtomic: "3800000" },
    invited: { requestedCount: 1, candidates: [] },
    network: { requestedCount: 1, candidates: [] },
  };
}

function dependencies(events: string[]): HybridHumanReviewDependencies {
  return {
    requireEligibility: async ({ principalId, reviewerSource }) => {
      const payoutAccount = [A, B, C].find(account => candidate(account).principalId === principalId)!;
      events.push(`preflight:${reviewerSource}:${principalId}`);
      return {
        schemaVersion: "rateloop.paid-review-eligibility-preflight.v1",
        preflightId: `pef_${payoutAccount.slice(2)}`,
        raterId: `rater_${payoutAccount.slice(2)}`,
        principalId,
        accountAddress: payoutAccount,
        payoutAccount,
        identityAssertions: [],
        checkedAt: "2026-07-16T12:00:00.000Z",
        validUntil: "2026-07-16T13:00:00.000Z",
        eligibilityCommitment: HASH,
      };
    },
    prepareInvited: async input => {
      events.push(`invited:${input.candidates.map(value => value.payoutAccount).join(",")}`);
      return {
        subpanelReference: "hybrid:invited",
        bindingHash: HASH,
        ...preparationEvidence("invited"),
        round: {
          deploymentKey: "base-sepolia",
          chainId: 84532,
          panelAddress: "0x4444444444444444444444444444444444444444",
          roundId: "1",
          admissionPolicyHash: input.hybridParent.admissionPolicyHash,
        },
        status: "ready",
        replayed: false,
      };
    },
    prepareNetwork: async input => {
      events.push(`network:${input.candidates.map(value => value.payoutAccount).join(",")}`);
      return {
        subpanelReference: "hybrid:network",
        bindingHash: HASH,
        ...preparationEvidence("network"),
        round: {
          deploymentKey: "base-sepolia",
          chainId: 84532,
          panelAddress: "0x4444444444444444444444444444444444444444",
          roundId: "2",
          admissionPolicyHash: input.hybridParent.admissionPolicyHash,
        },
        status: "ready",
        replayed: false,
      };
    },
    releaseInvited: async () => {
      events.push("release:invited");
    },
    releaseNetwork: async () => {
      events.push("release:network");
    },
    orchestration: {
      ensure: async () =>
        ({
          operation: { hybridOperationId: "hybrid_test" },
          replayed: false,
        }) as any,
      recordReady: async () => ({ replayed: false }) as any,
      complete: async () => ({ replayed: false }) as any,
      cancel: async input => {
        await input.releaseChildren([]);
        return { replayed: false } as any;
      },
    },
    clock: () => new Date("2026-07-16T12:00:00.000Z"),
  };
}

test("rejects private or unpaid hybrid material before any side effect", async () => {
  const events: string[] = [];
  const adapter = createHybridHumanReviewAdapter(dependencies(events));
  const input = structuredClone(split()) as unknown as Record<string, any>;
  input.publication = { ...split().publication, visibility: "private" };
  await assert.rejects(
    adapter(input as FrozenHybridReviewSplit),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.deepEqual(events, []);
});

test("preflights the server-derived invited set and defers network selection to the worker", async () => {
  const events: string[] = [];
  const adapter = createHybridHumanReviewAdapter(dependencies(events));
  const result = await adapter(hybridRequestForTest(split(), [A]));
  assert.deepEqual(events, [`preflight:customer_invited:${candidate(A).principalId}`, `invited:${A}`, "network:"]);
  assert.equal(result.invited.reviewerCount, 1);
  assert.equal(result.network.reviewerCount, 1);
  assert.notEqual(result.invited.round.roundId, result.network.round.roundId);
  assert.match(result.splitBindingHash, /^sha256:[0-9a-f]{64}$/u);
});

test("v3 rejects caller-supplied network candidates before any side effect", async () => {
  const events: string[] = [];
  const adapter = createHybridHumanReviewAdapter(dependencies(events));
  const input = split();
  input.network.candidates = [candidate(A)];
  await assert.rejects(
    adapter(hybridRequestForTest(input, [A])),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.deepEqual(events, []);
});

test("a partial subpanel failure returns no hybrid success and retries exact idempotent inputs", async () => {
  const events: string[] = [];
  let fail = true;
  const deps = dependencies(events);
  const original = deps.prepareNetwork;
  deps.prepareNetwork = async input => {
    if (fail) {
      fail = false;
      events.push("network:interrupted");
      throw new TokenlessServiceError("interrupted", 503, "hybrid_subpanel_interrupted", true);
    }
    return original(input);
  };
  const adapter = createHybridHumanReviewAdapter(deps);
  await assert.rejects(
    adapter(hybridRequestForTest(split(), [A])),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "hybrid_child_preparation_pending" && error.retryable,
  );
  const recovered = await adapter(hybridRequestForTest(split(), [A]));
  assert.equal(recovered.lane, "hybrid_public_safe");
  assert.equal(events.filter(value => value === `invited:${A}`).length, 2);
  assert.equal(events.at(-1), "network:");
});

test("hybrid preparation rejects one reused round and mismatched cohort economics", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  const invited = deps.prepareInvited;
  deps.prepareNetwork = async input => invited({ ...input, candidates: input.candidates, request: undefined });
  await assert.rejects(
    createHybridHumanReviewAdapter(deps)(hybridRequestForTest(split(), [A])),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_round_identity_conflict",
  );

  const invalid = split();
  invalid.semanticProfile.network.economics.bountyPerSeatAtomic = "1";
  const sideEffects: string[] = [];
  await assert.rejects(
    createHybridHumanReviewAdapter(dependencies(sideEffects))(hybridRequestForTest(invalid, [A])),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_review_binding_invalid",
  );
  assert.deepEqual(sideEffects, []);
});

void C;
