export type ExpertiseSeatRequirement = {
  key: string;
  minimumSeats: number;
};

export type ExpertiseCoverageCandidate = {
  id: string;
  expertiseKeys: readonly string[];
};

export type ExpertiseCoverageSummary = ExpertiseSeatRequirement & {
  coveredSeats: number;
  satisfied: boolean;
};

const MAXIMUM_REQUIREMENTS = 8;
const MAXIMUM_PANEL_SIZE = 100;
const MAXIMUM_CANDIDATES = 10_000;
const MAXIMUM_COVERAGE_STATES = 200_000;
const MAXIMUM_KEY_LENGTH = 256;
const MAXIMUM_CANDIDATE_ID_LENGTH = 320;

function normalizedText(value: unknown, field: string, maximumLength: number) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new TypeError(`${field} must contain between 1 and ${maximumLength} characters.`);
  }
  return normalized;
}

function normalizedPanelSize(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_PANEL_SIZE) {
    throw new RangeError(`panelSize must be an integer from 1 to ${MAXIMUM_PANEL_SIZE}.`);
  }
  return Number(value);
}

export function normalizeExpertiseSeatRequirements(
  value: readonly ExpertiseSeatRequirement[],
  panelSize?: number,
): ExpertiseSeatRequirement[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_REQUIREMENTS) {
    throw new TypeError(`Expertise requirements must be an array of at most ${MAXIMUM_REQUIREMENTS} entries.`);
  }
  const maximumSeats = panelSize === undefined ? MAXIMUM_PANEL_SIZE : normalizedPanelSize(panelSize);
  const normalized = value.map((requirement, index) => {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      throw new TypeError(`Expertise requirement ${index + 1} must be an object.`);
    }
    const key = normalizedText(requirement.key, `Expertise requirement ${index + 1} key`, MAXIMUM_KEY_LENGTH);
    if (
      !Number.isSafeInteger(requirement.minimumSeats) ||
      requirement.minimumSeats < 1 ||
      requirement.minimumSeats > maximumSeats
    ) {
      throw new RangeError(`Expertise requirement ${key} minimumSeats must be from 1 to ${maximumSeats}.`);
    }
    return { key, minimumSeats: requirement.minimumSeats };
  });
  normalized.sort((left, right) => left.key.localeCompare(right.key));
  if (normalized.some((requirement, index) => index > 0 && normalized[index - 1]!.key === requirement.key)) {
    throw new TypeError("Expertise requirement keys must be unique.");
  }
  return normalized;
}

function normalizeCandidates(value: readonly ExpertiseCoverageCandidate[]) {
  if (!Array.isArray(value)) throw new TypeError("Expertise candidates must be an array.");
  if (value.length > MAXIMUM_CANDIDATES) {
    throw new RangeError(`Expertise candidates must contain at most ${MAXIMUM_CANDIDATES} entries.`);
  }
  const candidates = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError(`Expertise candidate ${index + 1} must be an object.`);
    }
    const body = candidate as { id: unknown; expertiseKeys: unknown };
    const id = normalizedText(body.id, `Expertise candidate ${index + 1} ID`, MAXIMUM_CANDIDATE_ID_LENGTH);
    if (!Array.isArray(body.expertiseKeys)) {
      throw new TypeError(`Expertise candidate ${id} expertiseKeys must be an array.`);
    }
    const expertiseKeys = [
      ...new Set(
        body.expertiseKeys.map((key: unknown, keyIndex: number) =>
          normalizedText(key, `Expertise candidate ${id} key ${keyIndex + 1}`, MAXIMUM_KEY_LENGTH),
        ),
      ),
    ].sort();
    return { id, expertiseKeys };
  });
  candidates.sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.some((candidate, index) => index > 0 && candidates[index - 1]!.id === candidate.id)) {
    throw new TypeError("Expertise candidate IDs must be unique.");
  }
  return candidates;
}

function coverageKey(coverage: readonly number[]) {
  return coverage.join(",");
}

function lexicographicallyEarlier(left: readonly string[], right: readonly string[]) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const comparison = left[index]!.localeCompare(right[index]!);
    if (comparison !== 0) return comparison < 0;
  }
  return left.length < right.length;
}

function preferredCore(candidate: readonly string[], current: readonly string[] | undefined) {
  return (
    current === undefined ||
    candidate.length < current.length ||
    (candidate.length === current.length && lexicographicallyEarlier(candidate, current))
  );
}

/**
 * Chooses an exact-size panel with panel-level expertise coverage.
 *
 * The sparse dynamic program keeps the smallest deterministic reviewer core
 * for every capped coverage vector. A reviewer increments every requirement
 * they hold, so one specialist may cover several areas without ever counting
 * twice for the same area. Non-specialist seats are filled only after an exact
 * feasible specialist core has been found.
 */
export function chooseExpertiseCoveredPanel(
  candidatesInput: readonly ExpertiseCoverageCandidate[],
  panelSizeInput: number,
  requirementsInput: readonly ExpertiseSeatRequirement[],
): string[] | null {
  const panelSize = normalizedPanelSize(panelSizeInput);
  const requirements = normalizeExpertiseSeatRequirements(requirementsInput, panelSize);
  const candidates = normalizeCandidates(candidatesInput);
  if (candidates.length < panelSize) return null;
  if (requirements.length === 0) return candidates.slice(0, panelSize).map(candidate => candidate.id);

  const requirementIndex = new Map(requirements.map((requirement, index) => [requirement.key, index] as const));
  const relevantCandidates = candidates.flatMap(candidate => {
    const coveredIndexes = [
      ...new Set(
        candidate.expertiseKeys.flatMap(key => {
          const index = requirementIndex.get(key);
          return index === undefined ? [] : [index];
        }),
      ),
    ].sort((left, right) => left - right);
    return coveredIndexes.length === 0 ? [] : [{ id: candidate.id, coveredIndexes }];
  });

  for (let index = 0; index < requirements.length; index += 1) {
    const available = relevantCandidates.filter(candidate => candidate.coveredIndexes.includes(index)).length;
    if (available < requirements[index]!.minimumSeats) return null;
  }

  const emptyCoverage = requirements.map(() => 0);
  const states = new Map<string, { coverage: number[]; selected: string[] }>([
    [coverageKey(emptyCoverage), { coverage: emptyCoverage, selected: [] }],
  ]);
  for (const candidate of relevantCandidates) {
    const priorStates = [...states.values()];
    for (const state of priorStates) {
      if (state.selected.length >= panelSize) continue;
      const coverage = [...state.coverage];
      for (const index of candidate.coveredIndexes) {
        coverage[index] = Math.min(requirements[index]!.minimumSeats, coverage[index]! + 1);
      }
      if (coverage.every((count, index) => count === state.coverage[index])) continue;
      const selected = [...state.selected, candidate.id];
      const key = coverageKey(coverage);
      const current = states.get(key);
      if (preferredCore(selected, current?.selected)) states.set(key, { coverage, selected });
      if (states.size > MAXIMUM_COVERAGE_STATES) return null;
    }
  }

  const target = states.get(coverageKey(requirements.map(requirement => requirement.minimumSeats)));
  if (!target || target.selected.length > panelSize) return null;
  const selected = new Set(target.selected);
  for (const candidate of candidates) {
    if (selected.size >= panelSize) break;
    selected.add(candidate.id);
  }
  return selected.size === panelSize ? [...selected].sort() : null;
}

export function summarizeExpertiseCoverage(
  selectedCandidateIds: readonly string[],
  candidatesInput: readonly ExpertiseCoverageCandidate[],
  requirementsInput: readonly ExpertiseSeatRequirement[],
): ExpertiseCoverageSummary[] {
  const requirements = normalizeExpertiseSeatRequirements(requirementsInput);
  const candidates = normalizeCandidates(candidatesInput);
  const selected = new Set(
    selectedCandidateIds.map((id, index) =>
      normalizedText(id, `Selected expertise candidate ${index + 1} ID`, MAXIMUM_CANDIDATE_ID_LENGTH),
    ),
  );
  if (selected.size !== selectedCandidateIds.length)
    throw new TypeError("Selected expertise candidate IDs must be unique.");
  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate] as const));
  for (const id of selected) {
    if (!candidateById.has(id)) throw new TypeError(`Selected expertise candidate ${id} was not found.`);
  }
  return requirements.map(requirement => {
    const coveredSeats = [...selected].filter(id =>
      candidateById.get(id)!.expertiseKeys.includes(requirement.key),
    ).length;
    return {
      ...requirement,
      coveredSeats,
      satisfied: coveredSeats >= requirement.minimumSeats,
    };
  });
}

export function panelSatisfiesExpertiseCoverage(
  selectedCandidateIds: readonly string[],
  candidates: readonly ExpertiseCoverageCandidate[],
  requirements: readonly ExpertiseSeatRequirement[],
) {
  return summarizeExpertiseCoverage(selectedCandidateIds, candidates, requirements).every(summary => summary.satisfied);
}
