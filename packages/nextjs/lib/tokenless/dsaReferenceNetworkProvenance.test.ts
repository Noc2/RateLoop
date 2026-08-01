import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  type DsaReferenceNetworkIdentity,
  type DsaReferenceNetworkLifecycleEvent,
  aggregateDsaReferenceNetworkAdjudications,
  buildDsaReferenceNetworkAdjudication,
  buildDsaReferenceNetworkLifecycleEvent,
  deriveDsaReferenceNetworkLabel,
  recordDsaReferenceNetworkLifecycleEvent,
} from "~~/lib/tokenless/dsaReferenceNetworkProvenance";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const DEADLINE = "2026-08-01T12:10:00.000Z";
const identity: DsaReferenceNetworkIdentity = {
  workspaceId: "workspace_network_reference",
  projectId: "project_network_reference",
  benchmarkId: "benchmark_network_reference",
  activationReference: "activation_network_reference",
  opportunityId: "opportunity_network_reference",
  bindingId: "binding_network_reference",
  runId: "run_network_reference",
  caseId: "case_network_reference",
  deploymentKey: "tokenless-v4:test",
  chainId: 84532,
  panelAddress: `0x${"1".repeat(40)}`,
  roundId: "7",
  epochId: `rse_${"2".repeat(40)}`,
  unitId: `rsu_${"A".repeat(22)}`,
};

function eventChain(input: {
  invitation: string;
  reviewer: string;
  offset: number;
  terminal: "completed" | "timed_out";
  choice?: "candidate" | "baseline" | "tie";
}) {
  const result: DsaReferenceNetworkLifecycleEvent[] = [];
  const build = (
    eventType: "invited" | "accepted" | "assigned" | "opened" | "completed" | "timed_out",
    sequence: number,
  ) => {
    const assigned = sequence >= 3;
    const completed = eventType === "completed";
    const event = buildDsaReferenceNetworkLifecycleEvent({
      ...identity,
      invitationId: input.invitation,
      eventId: `dsan_evt_${String(input.offset + sequence).padStart(40, "0")}`,
      sequence,
      eventType,
      reviewerPrincipalId: input.reviewer,
      assertedByKind: ["invited", "assigned", "timed_out"].includes(eventType) ? "allocator" : "reviewer",
      assertedByPrincipalId: ["invited", "assigned", "timed_out"].includes(eventType)
        ? "principal_manager"
        : input.reviewer,
      assignmentId: assigned ? `assignment_${input.offset}` : null,
      reviewerKey: assigned ? `reviewer_${input.offset}` : null,
      responseId: completed ? `response_${input.offset}` : null,
      responseDigest: completed ? digest("a") : null,
      responseChoice: completed ? (input.choice ?? "candidate") : null,
      timeoutStage: eventType === "timed_out" ? "opened" : null,
      occurredAt: eventType === "timed_out" ? DEADLINE : `2026-08-01T12:0${sequence}:00.000Z`,
      responseDeadlineAt: DEADLINE,
      previous: result.at(-1) ?? null,
    });
    result.push(event);
  };
  build("invited", 1);
  build("accepted", 2);
  build("assigned", 3);
  build("opened", 4);
  build(input.terminal, 5);
  return result;
}

test("the frozen polarity maps candidate, baseline, and tie without caller-selected labels", () => {
  assert.equal(deriveDsaReferenceNetworkLabel("candidate"), "pass");
  assert.equal(deriveDsaReferenceNetworkLabel("baseline"), "fail");
  assert.equal(deriveDsaReferenceNetworkLabel("tie"), "uncertain");
});

test("terminal response evidence yields deterministic reviewer-free aggregate provenance", () => {
  const events = eventChain({
    invitation: "invite_b",
    reviewer: "principal_reviewer_b",
    offset: 10,
    terminal: "completed",
  }).concat(
    eventChain({ invitation: "invite_a", reviewer: "principal_reviewer_a", offset: 20, terminal: "completed" }),
  );
  const first = buildDsaReferenceNetworkAdjudication({
    identity,
    events,
    requiredCompletedResponseCount: 2,
    adjudicatedAt: "2026-08-01T12:11:00.000Z",
  });
  const replay = buildDsaReferenceNetworkAdjudication({
    identity,
    events: [...events].reverse(),
    requiredCompletedResponseCount: 2,
    adjudicatedAt: "2026-08-01T12:11:00.000Z",
  });
  assert.equal(first.finalLabel, "pass");
  assert.equal(first.agreementState, "agreed");
  assert.equal(first.adjudicationHash, replay.adjudicationHash);
  assert.doesNotMatch(first.adjudicationJson, /principal_reviewer|reviewerKey|assignment_|response_/u);
});

test("bridge aggregation supports multiple selected units and arbitrary reviewer counts", () => {
  const firstEvents = eventChain({
    invitation: "invite_a",
    reviewer: "principal_a",
    offset: 110,
    terminal: "completed",
  });
  const first = buildDsaReferenceNetworkAdjudication({
    identity,
    events: firstEvents,
    requiredCompletedResponseCount: 1,
    adjudicatedAt: "2026-08-01T12:11:00.000Z",
  });
  const secondIdentity = {
    ...identity,
    unitId: `rsu_${"B".repeat(22)}`,
    bindingId: "binding_network_reference_2",
    opportunityId: "opportunity_network_reference_2",
    runId: "run_network_reference_2",
    caseId: "case_network_reference_2",
  };
  const secondEvents = eventChain({
    invitation: "invite_c",
    reviewer: "principal_c",
    offset: 120,
    terminal: "completed",
  }).map(event => ({ ...event, ...secondIdentity }));
  const second = buildDsaReferenceNetworkAdjudication({
    identity: secondIdentity,
    events: secondEvents,
    requiredCompletedResponseCount: 1,
    adjudicatedAt: "2026-08-01T12:11:00.000Z",
  });
  const aggregate = aggregateDsaReferenceNetworkAdjudications([second, first]);
  assert.equal(aggregate.selectedUnitCount, 2);
  assert.equal(aggregate.invitedCount, 2);
  assert.equal(aggregate.completedCount, 2);
  assert.match(aggregate.adjudicationRoot, /^sha256:[0-9a-f]{64}$/u);
});

test("cross-benchmark and tampered reviewer adjudication provenance fail closed", () => {
  const events = eventChain({
    invitation: "invite_a",
    reviewer: "principal_reviewer",
    offset: 30,
    terminal: "completed",
  });
  assert.throws(
    () =>
      buildDsaReferenceNetworkAdjudication({
        identity: { ...identity, benchmarkId: "other_benchmark" },
        events,
        requiredCompletedResponseCount: 1,
        adjudicatedAt: "2026-08-01T12:11:00.000Z",
      }),
    /unrelated lifecycle/u,
  );
  const disagreeing = events.concat(
    eventChain({
      invitation: "invite_b",
      reviewer: "principal_other",
      offset: 40,
      terminal: "completed",
      choice: "baseline",
    }),
  );
  assert.throws(
    () =>
      buildDsaReferenceNetworkAdjudication({
        identity,
        events: disagreeing,
        requiredCompletedResponseCount: 2,
        adjudicatedBy: "principal_reviewer",
        adjudicatedLabel: "uncertain",
        adjudicatedAt: "2026-08-01T12:11:00.000Z",
      }),
    /cannot adjudicate/u,
  );
});

test("incomplete, nonterminal, and early timed-out invitations cannot be adjudicated", () => {
  const open = eventChain({
    invitation: "invite_open",
    reviewer: "principal_open",
    offset: 50,
    terminal: "completed",
  }).slice(0, 4);
  assert.throws(
    () =>
      buildDsaReferenceNetworkAdjudication({
        identity,
        events: open,
        requiredCompletedResponseCount: 1,
        adjudicatedAt: "2026-08-01T12:11:00.000Z",
      }),
    /coverage is incomplete/u,
  );
  const completed = eventChain({
    invitation: "invite_complete",
    reviewer: "principal_complete",
    offset: 60,
    terminal: "completed",
  });
  assert.throws(
    () =>
      buildDsaReferenceNetworkAdjudication({
        identity,
        events: completed.concat(open),
        requiredCompletedResponseCount: 1,
        adjudicatedAt: "2026-08-01T12:11:00.000Z",
      }),
    /typed terminal state/u,
  );
  const prior = eventChain({
    invitation: "invite_timeout",
    reviewer: "principal_timeout",
    offset: 70,
    terminal: "completed",
  }).slice(0, 4);
  assert.throws(
    () =>
      buildDsaReferenceNetworkLifecycleEvent({
        ...identity,
        invitationId: "invite_timeout",
        eventId: `dsan_evt_${"9".repeat(40)}`,
        sequence: 5,
        eventType: "timed_out",
        reviewerPrincipalId: "principal_timeout",
        assertedByKind: "allocator",
        assertedByPrincipalId: "principal_manager",
        assignmentId: "assignment_70",
        reviewerKey: "reviewer_70",
        occurredAt: "2026-08-01T12:09:59.999Z",
        responseDeadlineAt: DEADLINE,
        timeoutStage: "opened",
        previous: prior.at(-1)!,
      }),
    /before its deadline/u,
  );
});

test("an assigned reviewer who never opens can time out at the frozen assigned stage", () => {
  const prior = eventChain({
    invitation: "invite_no_open",
    reviewer: "principal_no_open",
    offset: 90,
    terminal: "completed",
  }).slice(0, 3);
  const timedOut = buildDsaReferenceNetworkLifecycleEvent({
    ...identity,
    invitationId: "invite_no_open",
    eventId: `dsan_evt_${"5".repeat(40)}`,
    sequence: 4,
    eventType: "timed_out",
    reviewerPrincipalId: "principal_no_open",
    assertedByKind: "allocator",
    assertedByPrincipalId: "principal_manager",
    assignmentId: "assignment_90",
    reviewerKey: "reviewer_90",
    occurredAt: DEADLINE,
    responseDeadlineAt: DEADLINE,
    timeoutStage: "assigned",
    previous: prior.at(-1)!,
  });
  assert.equal(timedOut.terminalState, "timed_out");
  assert.equal(timedOut.timeoutStage, "assigned");
});

test("all pre-completion timeout stages remain terminal without inventing downstream funnel events", () => {
  const completed = eventChain({
    invitation: "invite_done",
    reviewer: "principal_done",
    offset: 130,
    terminal: "completed",
  });
  const buildTimedChain = (stage: "invited" | "accepted" | "assigned", offset: number) => {
    const full = eventChain({
      invitation: `invite_${stage}`,
      reviewer: `principal_${stage}`,
      offset,
      terminal: "completed",
    });
    const prefixLength = stage === "invited" ? 1 : stage === "accepted" ? 2 : 3;
    const prefix = full.slice(0, prefixLength);
    const previous = prefix.at(-1)!;
    return prefix.concat(
      buildDsaReferenceNetworkLifecycleEvent({
        ...identity,
        invitationId: `invite_${stage}`,
        eventId: `dsan_evt_${String(offset + 9).padStart(40, "0")}`,
        sequence: prefixLength + 1,
        eventType: "timed_out",
        reviewerPrincipalId: `principal_${stage}`,
        assertedByKind: "allocator",
        assertedByPrincipalId: "principal_manager",
        assignmentId: stage === "assigned" ? `assignment_${offset}` : null,
        reviewerKey: stage === "assigned" ? `reviewer_${offset}` : null,
        occurredAt: DEADLINE,
        responseDeadlineAt: DEADLINE,
        timeoutStage: stage,
        previous,
      }),
    );
  };
  const evidence = buildDsaReferenceNetworkAdjudication({
    identity,
    events: completed.concat(
      buildTimedChain("invited", 140),
      buildTimedChain("accepted", 150),
      buildTimedChain("assigned", 160),
    ),
    requiredCompletedResponseCount: 1,
    adjudicatedAt: "2026-08-01T12:11:00.000Z",
  });
  assert.deepEqual(
    {
      invited: evidence.invitedCount,
      accepted: evidence.acceptedCount,
      assigned: evidence.assignedCount,
      opened: evidence.openedCount,
      completed: evidence.completedCount,
      timedOut: evidence.timedOutCount,
    },
    { invited: 4, accepted: 3, assigned: 2, opened: 1, completed: 1, timedOut: 3 },
  );
});

test("lifecycle writes reject an authenticated principal that does not own the frozen invitation", async () => {
  let queries = 0;
  const client = {
    query: async () => {
      queries += 1;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  await assert.rejects(
    recordDsaReferenceNetworkLifecycleEvent(client, {
      ...identity,
      invitationId: "invite_auth",
      eventId: `dsan_evt_${"8".repeat(40)}`,
      sequence: 1,
      eventType: "invited",
      reviewerPrincipalId: "principal_owner",
      authenticatedActorKind: "reviewer",
      authenticatedActorPrincipalId: "principal_attacker",
      responseDeadlineAt: DEADLINE,
    }),
    /cannot assert/u,
  );
  assert.equal(queries, 0);
});

test("reviewers cannot self-invite or self-assign", () => {
  assert.throws(
    () =>
      buildDsaReferenceNetworkLifecycleEvent({
        ...identity,
        invitationId: "invite_self",
        eventId: `dsan_evt_${"7".repeat(40)}`,
        sequence: 1,
        eventType: "invited",
        reviewerPrincipalId: "principal_self",
        assertedByKind: "allocator",
        assertedByPrincipalId: "principal_self",
        occurredAt: "2026-08-01T12:01:00.000Z",
        responseDeadlineAt: DEADLINE,
      }),
    /wrong actor/u,
  );
  const accepted = eventChain({
    invitation: "invite_assign",
    reviewer: "principal_self",
    offset: 80,
    terminal: "completed",
  }).slice(0, 2);
  assert.throws(
    () =>
      buildDsaReferenceNetworkLifecycleEvent({
        ...identity,
        invitationId: "invite_assign",
        eventId: `dsan_evt_${"6".repeat(40)}`,
        sequence: 3,
        eventType: "assigned",
        reviewerPrincipalId: "principal_self",
        assertedByKind: "allocator",
        assertedByPrincipalId: "principal_self",
        assignmentId: "assignment_80",
        reviewerKey: "reviewer_80",
        occurredAt: "2026-08-01T12:03:00.000Z",
        responseDeadlineAt: DEADLINE,
        previous: accepted.at(-1)!,
      }),
    /wrong actor/u,
  );
});
