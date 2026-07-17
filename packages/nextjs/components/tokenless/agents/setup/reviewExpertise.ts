import type { ReviewRequestProfileInput } from "./reviewCriterion";
import {
  REVIEWER_EXPERTISE,
  type ReviewerExpertiseDefinition,
  type ReviewerExpertiseKey,
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
  normalizeReviewerExpertiseSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ExpertiseProfile = ReviewRequestProfile & { expertiseRequirements?: ReviewerExpertiseRequirement[] };

export type ReviewExpertiseFormValues = {
  needsSpecialists: boolean;
  requirements: ReviewerExpertiseRequirement[];
  legacyRequiredExpertiseKeys: ReviewerExpertiseKey[];
};

function panelSize(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 1;
}

export function reviewExpertiseFormValues(profile: ReviewRequestProfile | null | undefined): ReviewExpertiseFormValues {
  const legacyRequiredExpertiseKeys = normalizeReviewerExpertiseSelection(profile?.requiredExpertiseKeys ?? []);
  const persisted = (profile as ExpertiseProfile | null | undefined)?.expertiseRequirements ?? [];
  const requirements = normalizeReviewerExpertiseRequirementsSelection(persisted, panelSize(profile?.panelSize));
  return {
    needsSpecialists: requirements.length > 0 || legacyRequiredExpertiseKeys.length > 0,
    requirements,
    legacyRequiredExpertiseKeys,
  };
}

export function requirementForDefinition(input: {
  audience: ReviewRequestProfile["audience"];
  definition: ReviewerExpertiseDefinition;
  panelSize: number | string;
}): ReviewerExpertiseRequirement {
  if (input.audience === "hybrid") {
    throw new Error("Hybrid specialist seats are not available yet.");
  }
  const reviewers = panelSize(input.panelSize);
  const network = input.audience === "public_network";
  return {
    definitionId: input.definition.definitionId,
    definitionVersion: input.definition.version,
    definitionHash: input.definition.hash,
    minimumSeats: network ? reviewers : 1,
    sourceScope: network ? "rateloop_network" : "customer_invited",
  };
}

export function requirementsForAudience(input: {
  audience: ReviewRequestProfile["audience"];
  definitions: readonly ReviewerExpertiseDefinition[];
  panelSize: number | string;
  requirements: readonly ReviewerExpertiseRequirement[];
}) {
  const reviewers = panelSize(input.panelSize);
  if (input.audience === "hybrid") {
    return input.requirements
      .filter(requirement => requirement.sourceScope === "any")
      .map(requirement => ({ ...requirement, minimumSeats: reviewers }));
  }
  const definitions = new Map(input.definitions.map(definition => [definition.definitionId, definition] as const));
  return input.requirements.flatMap(requirement => {
    const definition = definitions.get(requirement.definitionId);
    if (
      input.audience !== "private_invited" &&
      (requirement.definitionId.startsWith("expd_workspace_") ||
        (definition && (definition.scope !== "global" || !definition.networkEligible)))
    ) {
      return [];
    }
    return [
      {
        ...requirement,
        minimumSeats: input.audience === "private_invited" ? Math.min(requirement.minimumSeats, reviewers) : reviewers,
        sourceScope: input.audience === "private_invited" ? "customer_invited" : "rateloop_network",
      } satisfies ReviewerExpertiseRequirement,
    ];
  });
}

export function hydrateLegacyExpertiseRequirements(input: {
  audience: ReviewRequestProfile["audience"];
  definitions: readonly ReviewerExpertiseDefinition[];
  panelSize: number | string;
  values: ReviewExpertiseFormValues;
}): ReviewExpertiseFormValues {
  if (input.values.legacyRequiredExpertiseKeys.length === 0) return input.values;
  const byKey = new Map(input.definitions.map(definition => [definition.key, definition] as const));
  const selected = new Set(input.values.requirements.map(requirement => requirement.definitionId));
  const requirements = [...input.values.requirements];
  for (const key of input.values.legacyRequiredExpertiseKeys) {
    const definition = byKey.get(key);
    if (!definition || selected.has(definition.definitionId)) continue;
    requirements.push(
      input.audience === "hybrid"
        ? {
            definitionId: definition.definitionId,
            definitionVersion: definition.version,
            definitionHash: definition.hash,
            minimumSeats: panelSize(input.panelSize),
            sourceScope: "any",
          }
        : {
            ...requirementForDefinition({ audience: input.audience, definition, panelSize: input.panelSize }),
            minimumSeats: panelSize(input.panelSize),
          },
    );
    selected.add(definition.definitionId);
  }
  return { ...input.values, needsSpecialists: true, requirements };
}

export function buildReviewExpertiseRequestProfile(
  profile: ReviewRequestProfileInput,
  values: ReviewExpertiseFormValues,
  selectedPanelSize: number | string,
): ReviewRequestProfileInput {
  const requirements = values.needsSpecialists
    ? normalizeReviewerExpertiseRequirementsSelection(values.requirements, panelSize(selectedPanelSize))
    : [];
  if (values.needsSpecialists && requirements.length === 0) {
    throw new Error("Choose at least one specialist area.");
  }
  const reviewers = panelSize(selectedPanelSize);
  const legacyDefinitionIds = new Set<string>(
    values.legacyRequiredExpertiseKeys.flatMap(key => {
      const option = REVIEWER_EXPERTISE.find(candidate => candidate.key === key);
      return option ? [option.definitionId] : [];
    }),
  );
  const preservesLegacyAllSeatMeaning =
    values.legacyRequiredExpertiseKeys.length > 0 &&
    requirements.length === legacyDefinitionIds.size &&
    requirements.every(
      requirement =>
        legacyDefinitionIds.has(requirement.definitionId) &&
        requirement.minimumSeats === reviewers &&
        requirement.sourceScope ===
          (profile.audience === "public_network"
            ? "rateloop_network"
            : profile.audience === "hybrid"
              ? "any"
              : "customer_invited"),
    );
  return {
    ...profile,
    requiredExpertiseKeys: preservesLegacyAllSeatMeaning ? values.legacyRequiredExpertiseKeys : [],
    expertiseRequirements: preservesLegacyAllSeatMeaning ? [] : requirements,
  } as ReviewRequestProfileInput;
}

export function expertiseRequirementLabel(
  requirement: ReviewerExpertiseRequirement,
  definitions: readonly ReviewerExpertiseDefinition[],
) {
  return (
    definitions.find(definition => definition.definitionId === requirement.definitionId)?.label ??
    REVIEWER_EXPERTISE.find(option => option.definitionId === requirement.definitionId)?.label ??
    "Saved specialist area"
  );
}

export function expertiseRequirementSummary(
  requirement: ReviewerExpertiseRequirement,
  definitions: readonly ReviewerExpertiseDefinition[],
) {
  const label = expertiseRequirementLabel(requirement, definitions);
  return `${label} · ${requirement.minimumSeats} ${requirement.minimumSeats === 1 ? "reviewer" : "reviewers"}`;
}
