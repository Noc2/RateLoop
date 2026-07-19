import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FrozenHybridReviewSplit,
  type HybridHumanReviewDependencies,
  createHybridHumanReviewAdapter,
} from "~~/lib/tokenless/hybridHumanReviewAdapter";
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

function split(): FrozenHybridReviewSplit {
  return {
    schemaVersion: "rateloop.hybrid-review-split.v1",
    opportunityId: "opportunity_hybrid",
    audiencePolicyHash: HASH,
    requestProfileHash: HASH,
    contentCommitments: { source: HASH, suggestion: HASH },
    publication: { visibility: "public", dataClassification: "redacted", confirmedNoSensitiveData: true },
    economics: { asset: "USDC", invitedMaximumChargeAtomic: "1000000", networkMaximumChargeAtomic: "2000000" },
    invited: { requestedCount: 1, candidates: [candidate(A)] },
    network: { requestedCount: 1, candidates: [candidate(B)] },
  };
}

function dependencies(events: string[]): HybridHumanReviewDependencies {
  return {
    requireEligibility: async principalId => {
      const payoutAccount = [A, B, C].find(account => candidate(account).principalId === principalId)!;
      events.push(`preflight:${principalId}`);
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
      return { subpanelReference: "hybrid:invited", bindingHash: HASH, status: "ready", replayed: false };
    },
    prepareNetwork: async input => {
      events.push(`network:${input.candidates.map(value => value.payoutAccount).join(",")}`);
      return { subpanelReference: "hybrid:network", bindingHash: HASH, status: "ready", replayed: false };
    },
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

test("preflights the final deterministic reviewer set before preparing either subpanel", async () => {
  const events: string[] = [];
  const adapter = createHybridHumanReviewAdapter(dependencies(events));
  const result = await adapter(split());
  assert.deepEqual(events, [
    `preflight:${candidate(A).principalId}`,
    `preflight:${candidate(B).principalId}`,
    `invited:${A}`,
    `network:${B}`,
  ]);
  assert.equal(result.invited.reviewerCount, 1);
  assert.equal(result.network.reviewerCount, 1);
  assert.match(result.splitBindingHash, /^sha256:[0-9a-f]{64}$/u);
});

test("invited reviewers win deduplication and an underfilled network panel fails closed", async () => {
  const events: string[] = [];
  const adapter = createHybridHumanReviewAdapter(dependencies(events));
  const input = split();
  input.network.candidates = [candidate(A)];
  await assert.rejects(
    adapter(input),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "hybrid_subpanel_underfilled",
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
  await assert.rejects(adapter(split()), /interrupted/u);
  const recovered = await adapter(split());
  assert.equal(recovered.lane, "hybrid_public_safe");
  assert.equal(events.filter(value => value === `invited:${A}`).length, 2);
  assert.equal(events.at(-1), `network:${B}`);
});

void C;
