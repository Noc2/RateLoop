import * as fc from "fast-check";
import assert from "node:assert/strict";
import test from "node:test";
import {
  type StripeRefundReversalIdentity,
  artifactDeletionAuditKey,
  drataGrcSessionId,
  stripeRefundReversalKey,
  tokenlessScheduledWorkItemId,
  vantaGrcDocumentFileName,
  workspaceDeletionRetentionWorkItemKey,
} from "~~/lib/tokenless/idempotencyKeys";
import type { TokenlessScheduledWorkKind } from "~~/lib/tokenless/scheduledWorkItems";

type DerivedKeyCase = {
  first: string;
  identity: string;
  second: string;
};

type KeyDerivation = {
  arbitrary: fc.Arbitrary<DerivedKeyCase>;
  distinctPairs: fc.Arbitrary<readonly [DerivedKeyCase, DerivedKeyCase]>;
  label: string;
};

const SAFE_CHARACTERS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"];
const HEX_CHARACTERS = [..."0123456789abcdef"];
const WORK_KINDS = [
  "publish_finalized_round",
  "recover_chain_execution",
  "recover_rater_commit",
  "delete_artifact",
  "delete_public_media",
  "prepare_public_network_audience",
  "cleanup_public_network_foundation",
  "project_private_review_evidence",
] as const satisfies readonly TokenlessScheduledWorkKind[];
const RETENTION_CATEGORIES = [
  "billing_records",
  "legal_hold_records",
  "legal_hold_schedule",
  "referenced_private_quote_commitments",
  "settlement_audit",
] as const;

function token(characters: readonly string[], minimumLength = 1, maximumLength = 48) {
  return fc
    .array(fc.constantFrom(...characters), { maxLength: maximumLength, minLength: minimumLength })
    .map(value => value.join(""));
}

function derived<T>(
  arbitrary: fc.Arbitrary<T>,
  identity: (value: T) => string,
  key: (value: T) => string,
): fc.Arbitrary<DerivedKeyCase> {
  return arbitrary.map(value => ({
    first: key(value),
    identity: identity(value),
    second: key(value),
  }));
}

function distinctDerivedPair<T>(
  arbitrary: fc.Arbitrary<readonly [T, T]>,
  identity: (value: T) => string,
  key: (value: T) => string,
) {
  return arbitrary
    .filter(([left, right]) => identity(left) !== identity(right))
    .map(
      ([left, right]) =>
        [
          {
            first: key(left),
            identity: identity(left),
            second: key(left),
          },
          {
            first: key(right),
            identity: identity(right),
            second: key(right),
          },
        ] as const,
    );
}

const stripeIdentity = fc.oneof(
  token(SAFE_CHARACTERS, 8, 48).map(
    suffix =>
      ({
        kind: "refund",
        refundId: `re_${suffix}`,
      }) satisfies StripeRefundReversalIdentity,
  ),
  fc
    .record({
      amountRefundedMinor: fc.integer({ max: 999_999_999, min: 1 }),
      chargeId: token(SAFE_CHARACTERS, 8, 48).map(suffix => `ch_${suffix}`),
    })
    .map(
      value =>
        ({
          ...value,
          kind: "charge_running_total",
        }) satisfies StripeRefundReversalIdentity,
    ),
);

const scheduledWorkIdentity = fc.record({
  kind: fc.constantFrom(...WORK_KINDS),
  subjectKey: token(SAFE_CHARACTERS, 1, 80),
});

const workspaceRetentionIdentity = fc.record({
  category: fc.constantFrom(...RETENTION_CATEGORIES),
  jobId: token(HEX_CHARACTERS, 32, 32).map(suffix => `del_${suffix}`),
});

const distinctStripeIdentities = fc.oneof(
  fc
    .record({
      amountRefundedMinor: fc.integer({ max: 999_999_998, min: 1 }),
      chargeId: token(SAFE_CHARACTERS, 8, 48).map(suffix => `ch_${suffix}`),
    })
    .map(
      value =>
        [
          {
            ...value,
            kind: "charge_running_total",
          },
          {
            ...value,
            amountRefundedMinor: value.amountRefundedMinor + 1,
            kind: "charge_running_total",
          },
        ] as const satisfies readonly [StripeRefundReversalIdentity, StripeRefundReversalIdentity],
    ),
  fc.tuple(token(SAFE_CHARACTERS, 8, 48), token(SAFE_CHARACTERS, 8, 48)).map(
    ([left, right]) =>
      [
        { kind: "refund", refundId: `re_${left}` },
        { kind: "refund", refundId: `re_${right}` },
      ] as const satisfies readonly [StripeRefundReversalIdentity, StripeRefundReversalIdentity],
  ),
);

const distinctScheduledWorkIdentities = fc.oneof(
  fc.tuple(fc.constantFrom(...WORK_KINDS), token(SAFE_CHARACTERS, 1, 80), token(SAFE_CHARACTERS, 1, 80)).map(
    ([kind, left, right]) =>
      [
        { kind, subjectKey: left },
        { kind, subjectKey: right },
      ] as const,
  ),
  fc.tuple(token(SAFE_CHARACTERS, 1, 80), fc.constantFrom(...WORK_KINDS), fc.constantFrom(...WORK_KINDS)).map(
    ([subjectKey, left, right]) =>
      [
        { kind: left, subjectKey },
        { kind: right, subjectKey },
      ] as const,
  ),
);

const distinctWorkspaceRetentionIdentities = fc.oneof(
  fc
    .tuple(
      token(HEX_CHARACTERS, 32, 32).map(suffix => `del_${suffix}`),
      fc.constantFrom(...RETENTION_CATEGORIES),
      fc.constantFrom(...RETENTION_CATEGORIES),
    )
    .map(
      ([jobId, left, right]) =>
        [
          { category: left, jobId },
          { category: right, jobId },
        ] as const,
    ),
  fc
    .tuple(
      fc.constantFrom(...RETENTION_CATEGORIES),
      token(HEX_CHARACTERS, 32, 32).map(suffix => `del_${suffix}`),
      token(HEX_CHARACTERS, 32, 32).map(suffix => `del_${suffix}`),
    )
    .map(
      ([category, left, right]) =>
        [
          { category, jobId: left },
          { category, jobId: right },
        ] as const,
    ),
);

const grcIdempotencyKey = token(SAFE_CHARACTERS, 8, 160);
const vantaBundleId = token(HEX_CHARACTERS, 40, 40).map(suffix => `grcb_${suffix}`);
const artifactObjectId = token(HEX_CHARACTERS, 32, 32).map(suffix => `obj_${suffix}`);

const KEY_DERIVATIONS: readonly KeyDerivation[] = [
  {
    arbitrary: derived(
      stripeIdentity,
      value => JSON.stringify(value),
      value => stripeRefundReversalKey(value),
    ),
    distinctPairs: distinctDerivedPair<StripeRefundReversalIdentity>(
      distinctStripeIdentities,
      value => JSON.stringify(value),
      value => stripeRefundReversalKey(value),
    ),
    label: "Stripe refund reversal",
  },
  {
    arbitrary: derived(
      scheduledWorkIdentity,
      value => JSON.stringify(value),
      value => tokenlessScheduledWorkItemId(value.kind, value.subjectKey),
    ),
    distinctPairs: distinctDerivedPair(
      distinctScheduledWorkIdentities,
      value => JSON.stringify(value),
      value => tokenlessScheduledWorkItemId(value.kind, value.subjectKey),
    ),
    label: "scheduled work item",
  },
  {
    arbitrary: derived(
      grcIdempotencyKey,
      value => value,
      value => drataGrcSessionId(value),
    ),
    distinctPairs: distinctDerivedPair(
      fc.tuple(grcIdempotencyKey, grcIdempotencyKey),
      value => value,
      value => drataGrcSessionId(value),
    ),
    label: "Drata GRC session",
  },
  {
    arbitrary: derived(
      vantaBundleId,
      value => value,
      value => vantaGrcDocumentFileName(value),
    ),
    distinctPairs: distinctDerivedPair(
      fc.tuple(vantaBundleId, vantaBundleId),
      value => value,
      value => vantaGrcDocumentFileName(value),
    ),
    label: "Vanta GRC document",
  },
  {
    arbitrary: derived(
      artifactObjectId,
      value => value,
      value => artifactDeletionAuditKey(value),
    ),
    distinctPairs: distinctDerivedPair(
      fc.tuple(artifactObjectId, artifactObjectId),
      value => value,
      value => artifactDeletionAuditKey(value),
    ),
    label: "artifact deletion audit",
  },
  {
    arbitrary: derived(
      workspaceRetentionIdentity,
      value => JSON.stringify(value),
      value => workspaceDeletionRetentionWorkItemKey(value.jobId, value.category),
    ),
    distinctPairs: distinctDerivedPair(
      distinctWorkspaceRetentionIdentities,
      value => JSON.stringify(value),
      value => workspaceDeletionRetentionWorkItemKey(value.jobId, value.category),
    ),
    label: "workspace deletion retention",
  },
];

test("idempotency key derivations are deterministic for redelivery", () => {
  for (const derivation of KEY_DERIVATIONS) {
    fc.assert(
      fc.property(derivation.arbitrary, value => {
        assert.equal(value.first, value.second, `${derivation.label} changed on redelivery`);
      }),
      { numRuns: 1_000 },
    );
  }
});

test("idempotency key derivations are injective for distinct logical events", () => {
  for (const derivation of KEY_DERIVATIONS) {
    fc.assert(
      fc.property(derivation.distinctPairs, ([left, right]) => {
        assert.notEqual(left.first, right.first, `${derivation.label} collided for distinct events`);
      }),
      { numRuns: 1_000 },
    );
  }
});
