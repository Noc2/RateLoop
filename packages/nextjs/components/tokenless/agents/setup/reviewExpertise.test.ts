import {
  buildReviewExpertiseRequestProfile,
  expertiseRequirementSummary,
  hydrateLegacyExpertiseRequirements,
  requirementForDefinition,
  requirementsForAudience,
  reviewExpertiseFormValues,
} from "./reviewExpertise";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REVIEWER_EXPERTISE,
  ReviewerExpertiseDefinition,
  ReviewerExpertiseRequirement,
} from "~~/lib/tokenless/reviewerExpertiseOptions";

const HASH = `sha256:${"a".repeat(64)}` as const;
const GLOBAL_DEFINITION: ReviewerExpertiseDefinition = {
  definitionId: REVIEWER_EXPERTISE[0].definitionId,
  version: 1,
  hash: HASH,
  scope: "global",
  workspaceId: null,
  key: "code-review:typescript",
  label: "TypeScript code review",
  description: "Can assess TypeScript behavior and correctness.",
  networkEligible: true,
};
const WORKSPACE_DEFINITION: ReviewerExpertiseDefinition = {
  definitionId: "expd_workspace_specialist_1234",
  version: 1,
  hash: `sha256:${"b".repeat(64)}`,
  scope: "workspace",
  workspaceId: "ws_one",
  key: "workspace:german-law:1234",
  label: "German employment law",
  description: "Has experience reviewing German employment contracts.",
  networkEligible: false,
};

test("specialist requirements resume from the canonical request profile", () => {
  assert.deepEqual(reviewExpertiseFormValues(undefined), {
    needsSpecialists: false,
    requirements: [],
    legacyRequiredExpertiseKeys: [],
  });
  const requirement = requirementForDefinition({
    audience: "private_invited",
    definition: GLOBAL_DEFINITION,
    panelSize: 3,
  });
  const values = reviewExpertiseFormValues({
    panelSize: 3,
    requiredExpertiseKeys: [],
    expertiseRequirements: [requirement],
  } as never);
  assert.equal(values.needsSpecialists, true);
  assert.deepEqual(values.requirements, [requirement]);
});

test("legacy all-seat keys hydrate without weakening their saved meaning", () => {
  const hydrated = hydrateLegacyExpertiseRequirements({
    audience: "private_invited",
    definitions: [GLOBAL_DEFINITION],
    panelSize: 3,
    values: {
      needsSpecialists: true,
      requirements: [],
      legacyRequiredExpertiseKeys: ["code-review:typescript"],
    },
  });
  assert.deepEqual(hydrated.requirements, [
    {
      definitionId: GLOBAL_DEFINITION.definitionId,
      definitionVersion: 1,
      definitionHash: HASH,
      minimumSeats: 3,
      sourceScope: "customer_invited",
    },
  ]);
});

test("private requirements use minimum seats while network requirements cover every seat", () => {
  const privateRequirement = requirementForDefinition({
    audience: "private_invited",
    definition: GLOBAL_DEFINITION,
    panelSize: 4,
  });
  assert.equal(privateRequirement.minimumSeats, 1);
  assert.equal(privateRequirement.sourceScope, "customer_invited");

  const network = requirementsForAudience({
    audience: "public_network",
    definitions: [GLOBAL_DEFINITION, WORKSPACE_DEFINITION],
    panelSize: 4,
    requirements: [
      privateRequirement,
      requirementForDefinition({
        audience: "private_invited",
        definition: WORKSPACE_DEFINITION,
        panelSize: 4,
      }),
    ],
  });
  assert.deepEqual(network, [
    {
      ...privateRequirement,
      minimumSeats: 4,
      sourceScope: "rateloop_network",
    },
  ]);
  assert.deepEqual(
    requirementsForAudience({
      audience: "hybrid",
      definitions: [GLOBAL_DEFINITION],
      panelSize: 4,
      requirements: [privateRequirement],
    }),
    [],
  );
});

test("changing a legacy all-seat rule writes only canonical exact requirements", () => {
  const requirement: ReviewerExpertiseRequirement = {
    definitionId: GLOBAL_DEFINITION.definitionId,
    definitionVersion: 1,
    definitionHash: HASH,
    minimumSeats: 1,
    sourceScope: "customer_invited",
  };
  const profile = buildReviewExpertiseRequestProfile(
    { requiredExpertiseKeys: ["code-review:typescript"] } as never,
    {
      needsSpecialists: true,
      requirements: [requirement],
      legacyRequiredExpertiseKeys: ["code-review:typescript"],
    },
    3,
  ) as unknown as { requiredExpertiseKeys: string[]; expertiseRequirements: ReviewerExpertiseRequirement[] };
  assert.deepEqual(profile.requiredExpertiseKeys, []);
  assert.deepEqual(profile.expertiseRequirements, [requirement]);
  assert.equal(expertiseRequirementSummary(requirement, [GLOBAL_DEFINITION]), "TypeScript code review · 1 reviewer");
});

test("an unchanged legacy rule keeps its original all-seat semantics and hash family", () => {
  const requirement: ReviewerExpertiseRequirement = {
    definitionId: GLOBAL_DEFINITION.definitionId,
    definitionVersion: 1,
    definitionHash: HASH,
    minimumSeats: 3,
    sourceScope: "customer_invited",
  };
  const profile = buildReviewExpertiseRequestProfile(
    {} as never,
    {
      needsSpecialists: true,
      requirements: [requirement],
      legacyRequiredExpertiseKeys: ["code-review:typescript"],
    },
    3,
  ) as unknown as { requiredExpertiseKeys: string[]; expertiseRequirements: ReviewerExpertiseRequirement[] };
  assert.deepEqual(profile.requiredExpertiseKeys, ["code-review:typescript"]);
  assert.deepEqual(profile.expertiseRequirements, []);
});

test("a legacy hybrid all-seat rule remains legacy without enabling new hybrid specialist rules", () => {
  const values = hydrateLegacyExpertiseRequirements({
    audience: "hybrid",
    definitions: [GLOBAL_DEFINITION],
    panelSize: 4,
    values: {
      needsSpecialists: true,
      requirements: [],
      legacyRequiredExpertiseKeys: ["code-review:typescript"],
    },
  });
  assert.equal(values.requirements[0]?.sourceScope, "any");
  const profile = buildReviewExpertiseRequestProfile({ audience: "hybrid" } as never, values, 4) as unknown as {
    requiredExpertiseKeys: string[];
    expertiseRequirements: ReviewerExpertiseRequirement[];
  };
  assert.deepEqual(profile.requiredExpertiseKeys, ["code-review:typescript"]);
  assert.deepEqual(profile.expertiseRequirements, []);
  assert.throws(
    () => requirementForDefinition({ audience: "hybrid", definition: GLOBAL_DEFINITION, panelSize: 4 }),
    /not available yet/i,
  );
});

test("choosing specialist knowledge requires at least one area", () => {
  assert.throws(
    () =>
      buildReviewExpertiseRequestProfile(
        {} as never,
        { needsSpecialists: true, requirements: [], legacyRequiredExpertiseKeys: [] },
        2,
      ),
    /Choose at least one specialist area/u,
  );
});

test("an explicit no-specialist choice clears legacy and canonical requirements", () => {
  const profile = buildReviewExpertiseRequestProfile(
    { requiredExpertiseKeys: ["code-review:typescript"] } as never,
    {
      needsSpecialists: false,
      requirements: [
        {
          definitionId: GLOBAL_DEFINITION.definitionId,
          definitionVersion: 1,
          definitionHash: HASH,
          minimumSeats: 2,
          sourceScope: "customer_invited",
        },
      ],
      legacyRequiredExpertiseKeys: [],
    },
    2,
  ) as unknown as { requiredExpertiseKeys: string[]; expertiseRequirements: ReviewerExpertiseRequirement[] };
  assert.deepEqual(profile.requiredExpertiseKeys, []);
  assert.deepEqual(profile.expertiseRequirements, []);
});
