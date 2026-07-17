import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  createWorkspaceReviewerExpertiseDefinition,
  listReviewerExpertiseDefinitions,
  validateReviewerExpertiseRequirementsForWorkspace,
} from "~~/lib/tokenless/reviewerExpertiseDefinitions";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("workspace managers receive useful global suggestions and can add private definitions", async () => {
  const { workspaceId } = await createWorkspace({ name: "Specialist catalog", ownerAddress: OWNER });
  const initial = await listReviewerExpertiseDefinitions({
    accountAddress: OWNER,
    workspaceId,
    context: "Review a TypeScript pull request",
  });
  assert.equal(initial.definitions.filter(definition => definition.scope === "global").length, 6);
  assert.deepEqual(initial.suggestedDefinitionIds, ["expd_code_review_typescript"]);

  const created = await createWorkspaceReviewerExpertiseDefinition({
    accountAddress: OWNER,
    workspaceId,
    label: "  Medical claims review  ",
    description: "  Can assess medical claims against this workspace's approved source policy.  ",
  });
  assert.match(created.definition.definitionId, /^expd_workspace_[a-f0-9]{32}$/u);
  assert.match(created.definition.hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(created.definition.networkEligible, false);

  const listed = await listReviewerExpertiseDefinitions({ accountAddress: OWNER, workspaceId });
  assert.equal(listed.definitions.at(-1)?.label, "Medical claims review");
});

test("private coverage accepts workspace definitions while public coverage stays global and all-seat", async () => {
  const { workspaceId } = await createWorkspace({ name: "Specialist validation", ownerAddress: OWNER });
  const custom = await createWorkspaceReviewerExpertiseDefinition({
    accountAddress: OWNER,
    workspaceId,
    label: "Release operations",
    description: "Can verify this workspace's release checklist and rollback procedure.",
  });
  const privateRequirement = {
    definitionId: custom.definition.definitionId,
    definitionVersion: custom.definition.version,
    definitionHash: custom.definition.hash,
    minimumSeats: 1,
    sourceScope: "customer_invited",
  };
  const privateResult = await validateReviewerExpertiseRequirementsForWorkspace({
    accountAddress: OWNER,
    workspaceId,
    audience: "private_invited",
    panelSize: 2,
    requirements: [privateRequirement],
  });
  assert.deepEqual(privateResult.requirements, [privateRequirement]);

  await assert.rejects(
    () =>
      validateReviewerExpertiseRequirementsForWorkspace({
        accountAddress: OWNER,
        workspaceId,
        audience: "public_network",
        panelSize: 3,
        requirements: [{ ...privateRequirement, minimumSeats: 3, sourceScope: "rateloop_network" }],
      }),
    /RateLoop-verified area/i,
  );

  const catalog = await listReviewerExpertiseDefinitions({ accountAddress: OWNER, workspaceId });
  const typescript = catalog.definitions.find(definition => definition.definitionId === "expd_code_review_typescript")!;
  const publicResult = await validateReviewerExpertiseRequirementsForWorkspace({
    accountAddress: OWNER,
    workspaceId,
    audience: "public_network",
    panelSize: 3,
    requirements: [
      {
        definitionId: typescript.definitionId,
        definitionVersion: typescript.version,
        definitionHash: typescript.hash,
        minimumSeats: 3,
        sourceScope: "rateloop_network",
      },
    ],
  });
  assert.equal(publicResult.definitions[0]?.networkEligible, true);
});
