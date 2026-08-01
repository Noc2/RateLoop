import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type DatabaseResources, type QueryInput, __setDatabaseResourcesForTests } from "~~/lib/db";
import { listReviewerAssignments } from "~~/lib/tokenless/reviewerAssignments";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

beforeEach(() =>
  __setDatabaseResourcesForTests({
    client: { execute: async () => ({ rowCount: 0, rows: [] }) },
    database: {},
    pool: {},
  } as unknown as DatabaseResources),
);
afterEach(() => __setDatabaseResourcesForTests(null));

test("assignment search is account-bound and returns no private rows for an empty account", async () => {
  assert.deepEqual(
    await listReviewerAssignments({
      accountAddress: "0x1111111111111111111111111111111111111111",
      query: "client secret",
    }),
    [],
  );
});

test("assignment search accepts an opaque Better Auth principal", async () => {
  assert.deepEqual(
    await listReviewerAssignments({
      accountAddress: "rlp_reviewer_assignments_test_0001",
    }),
    [],
  );
});

test("assignment search fails closed on an unknown active/history view", async () => {
  await assert.rejects(
    listReviewerAssignments({ accountAddress: "rlp_reviewer_assignments_test_0001", view: "everything" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assignment_view",
  );
});

test("named DSA assignment listings mask provider and private-routing metadata", async () => {
  const queries: QueryInput[] = [];
  __setDatabaseResourcesForTests({
    client: {
      async execute(input: QueryInput) {
        queries.push(input);
        const sql = typeof input === "string" ? input : input.sql;
        if (sql.includes("FROM tokenless_private_unpaid_review_assignments")) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [
            {
              assignment_id: "assignment_named_dsa",
              project_id: "project_provider_secret",
              project_name: "Provider Alpha moderation",
              data_classification: "private",
              source: "customer_invited",
              status: "reserved",
              paid_assignment: false,
              confidentiality_terms_hash: `sha256:${"a".repeat(64)}`,
              private_group_id: "private_group_provider_secret",
              private_group_policy_version: 7,
              private_group_policy_hash: `sha256:${"b".repeat(64)}`,
              reservation_expires_at: "2030-01-02T00:00:00.000Z",
              assignment_expires_at: null,
              created_at: "2030-01-01T00:00:00.000Z",
              updated_at: "2030-01-01T00:00:00.000Z",
              case_count: 1,
              review_question: "Does Provider Alpha policy X apply?",
              requires_dsa_reference_panel_acceptance: true,
            },
          ],
        };
      },
    },
    database: {},
    pool: {},
  } as unknown as DatabaseResources);

  const assignments = await listReviewerAssignments({
    accountAddress: "rlp_reviewer_assignments_test_0001",
    query: "assignment_named_dsa",
  });
  assert.equal(assignments.length, 1);
  assert.deepEqual(assignments[0], {
    assignmentId: "assignment_named_dsa",
    projectId: null,
    projectName: "Blinded policy review",
    dataClassification: null,
    source: "customer_invited",
    status: "reserved",
    paidAssignment: false,
    confidentialityTermsHash: null,
    privateGroup: null,
    reservationExpiresAt: "2030-01-02T00:00:00.000Z",
    assignmentExpiresAt: null,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    caseCount: 1,
    reviewQuestion: "Blinded policy review",
    requiresDsaReferencePanelAcceptance: true,
  });

  const listing = queries.find(input => {
    const sql = typeof input === "string" ? input : input.sql;
    return sql.includes("FROM tokenless_assurance_assignments a");
  });
  assert.ok(listing && typeof listing !== "string");
  assert.match(listing.sql, /CASE WHEN named_unit\.unit_id IS NULL THEN a\.confidentiality_terms_hash ELSE NULL END/u);
  assert.match(listing.sql, /CASE WHEN named_unit\.unit_id IS NULL THEN a\.private_group_id ELSE NULL END/u);
  assert.match(listing.sql, /named_unit\.unit_id IS NULL AND p\.name ILIKE/u);
  assert.doesNotMatch(listing.sql, /confidentiality_terms_hash ILIKE|private_group_(?:id|policy_hash) ILIKE/u);
});
