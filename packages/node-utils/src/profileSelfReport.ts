export const PROFILE_SELF_REPORT_SCHEMA_VERSION = 2;
export const PROFILE_SELF_REPORT_SOURCE = "self_reported_public_profiles" as const;
export const PROFILE_SELF_REPORT_VERIFIED = false;
export const PROFILE_SELF_REPORT_RESTRICTS_ELIGIBILITY = false;
export const MAX_PROFILE_SELF_REPORT_LENGTH = 1600;
export const TARGET_AUDIENCE_CAVEAT = "unverified_self_report" as const;

export const PROFILE_SELF_REPORT_NOTICE =
  "Audience context is public, self-reported, unverified, and not used for vote eligibility. Governance may penalize clearly false context when public evidence supports it.";

export const RATER_TYPE = {
  Unknown: 0,
  Human: 1,
  AI: 2,
  Team: 3,
  Hybrid: 4,
} as const;

export const RATER_TYPE_OPTIONS = [
  { label: "Human", value: RATER_TYPE.Human },
  { label: "AI", value: RATER_TYPE.AI },
  { label: "Team", value: RATER_TYPE.Team },
  { label: "Hybrid", value: RATER_TYPE.Hybrid },
] as const;

export const AI_MODEL_PROVIDER_OPTIONS = [
  "openai",
  "anthropic",
  "google",
  "meta",
  "mistral",
  "xai",
  "local",
  "other",
] as const;

export const AI_AGENT_FRAMEWORK_OPTIONS = [
  "custom",
  "openai-agents",
  "langchain",
  "llamaindex",
  "autogen",
  "crew-ai",
  "other",
] as const;

export const AI_AUTONOMY_OPTIONS = ["assistant", "tool-using", "supervised", "autonomous"] as const;

export const TEAM_TYPE_OPTIONS = ["company", "research-lab", "dao", "agency", "community", "other"] as const;
export const TEAM_SIZE_OPTIONS = ["2-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export const HYBRID_OVERSIGHT_OPTIONS = ["human-led", "human-in-the-loop", "human-reviewed", "ai-led"] as const;

export const AGE_GROUP_OPTIONS = [
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
] as const;

export const LANGUAGE_OPTIONS = [
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "nl",
  "pl",
  "tr",
  "ar",
  "hi",
  "id",
  "ja",
  "ko",
  "zh",
  "other",
] as const;

export const ROLE_OPTIONS = [
  "student",
  "founder",
  "engineer",
  "product-design",
  "researcher",
  "operator",
  "finance",
  "creator",
  "educator",
  "healthcare",
  "legal-policy",
  "public-sector",
  "other",
] as const;

export const EXPERTISE_OPTIONS = [
  "ai",
  "crypto",
  "finance",
  "consumer-products",
  "media",
  "science",
  "health",
  "gaming",
  "education",
  "local-services",
  "public-policy",
  "other",
] as const;

export type AgeGroup = (typeof AGE_GROUP_OPTIONS)[number];
export type LanguageCode = (typeof LANGUAGE_OPTIONS)[number];
export type ProfileRole = (typeof ROLE_OPTIONS)[number];
export type ExpertiseArea = (typeof EXPERTISE_OPTIONS)[number];
export type RaterTypeValue = (typeof RATER_TYPE)[keyof typeof RATER_TYPE];
export type RaterTypeName = keyof typeof RATER_TYPE;
export type AiModelProvider = (typeof AI_MODEL_PROVIDER_OPTIONS)[number];
export type AiAgentFramework = (typeof AI_AGENT_FRAMEWORK_OPTIONS)[number];
export type AiAutonomy = (typeof AI_AUTONOMY_OPTIONS)[number];
export type TeamType = (typeof TEAM_TYPE_OPTIONS)[number];
export type TeamSize = (typeof TEAM_SIZE_OPTIONS)[number];
export type HybridOversight = (typeof HYBRID_OVERSIGHT_OPTIONS)[number];

export interface ProfileAiContext {
  modelProvider?: AiModelProvider;
  modelFamily?: string;
  modelVersion?: string;
  agentFramework?: AiAgentFramework;
  autonomy?: AiAutonomy;
  languages?: LanguageCode[];
  expertise?: ExpertiseArea[];
}

export interface ProfileTeamContext {
  teamType?: TeamType;
  teamSize?: TeamSize;
  country?: string;
  languages?: LanguageCode[];
  expertise?: ExpertiseArea[];
  website?: string;
}

export interface ProfileHybridContext {
  oversight?: HybridOversight;
  modelProvider?: AiModelProvider;
  modelFamily?: string;
  languages?: LanguageCode[];
  expertise?: ExpertiseArea[];
}

export interface ProfileSelfReport {
  v: typeof PROFILE_SELF_REPORT_SCHEMA_VERSION;
  raterType?: RaterTypeValue;
  ageGroup?: AgeGroup;
  residenceCountry?: string;
  nationalities?: string[];
  languages?: LanguageCode[];
  roles?: ProfileRole[];
  expertise?: ExpertiseArea[];
  ai?: ProfileAiContext;
  team?: ProfileTeamContext;
  hybrid?: ProfileHybridContext;
}

export interface ProfileSelfReportBucket {
  down: number;
  total: number;
  up: number;
  value: string;
}

export interface ProfileSelfReportAudienceContext {
  fields: {
    ageGroup: ProfileSelfReportBucket[];
    aiAgentFramework: ProfileSelfReportBucket[];
    aiAutonomy: ProfileSelfReportBucket[];
    aiExpertise: ProfileSelfReportBucket[];
    aiLanguages: ProfileSelfReportBucket[];
    aiModelProvider: ProfileSelfReportBucket[];
    expertise: ProfileSelfReportBucket[];
    hybridExpertise: ProfileSelfReportBucket[];
    hybridLanguages: ProfileSelfReportBucket[];
    hybridModelProvider: ProfileSelfReportBucket[];
    hybridOversight: ProfileSelfReportBucket[];
    languages: ProfileSelfReportBucket[];
    nationalities: ProfileSelfReportBucket[];
    residenceCountry: ProfileSelfReportBucket[];
    roles: ProfileSelfReportBucket[];
    teamCountry: ProfileSelfReportBucket[];
    teamExpertise: ProfileSelfReportBucket[];
    teamLanguages: ProfileSelfReportBucket[];
    teamSize: ProfileSelfReportBucket[];
    teamType: ProfileSelfReportBucket[];
  };
  missingSelfReportCount: number;
  note: string;
  restrictedEligibility: false;
  selfReportedProfileCount: number;
  source: typeof PROFILE_SELF_REPORT_SOURCE;
  totalRevealedVotes: number;
  verified: false;
}

export interface ProfileSelfReportVoteRow {
  isUp?: boolean | null;
  selfReport?: string | null;
}

export interface TargetAudienceAiCriteria {
  agentFrameworks?: AiAgentFramework[];
  autonomy?: AiAutonomy[];
  expertise?: ExpertiseArea[];
  languages?: LanguageCode[];
  modelProviders?: AiModelProvider[];
}

export interface TargetAudienceTeamCriteria {
  countries?: string[];
  expertise?: ExpertiseArea[];
  languages?: LanguageCode[];
  sizes?: TeamSize[];
  types?: TeamType[];
}

export interface TargetAudienceHybridCriteria {
  expertise?: ExpertiseArea[];
  languages?: LanguageCode[];
  modelProviders?: AiModelProvider[];
  oversight?: HybridOversight[];
}

export interface TargetAudience {
  ageGroups?: AgeGroup[];
  countries?: string[];
  expertise?: ExpertiseArea[];
  languages?: LanguageCode[];
  nationalities?: string[];
  roles?: ProfileRole[];
  ai?: TargetAudienceAiCriteria;
  team?: TargetAudienceTeamCriteria;
  hybrid?: TargetAudienceHybridCriteria;
}

export interface TargetAudienceDimensionMatch {
  dimension: string;
  matchShare: number | null;
  matchedCount: number;
  requested: string[];
  totalCount: number;
}

export interface TargetAudienceMatchReport {
  caveat: typeof TARGET_AUDIENCE_CAVEAT;
  matchedDimensionCount: number;
  note: string;
  perDimension: TargetAudienceDimensionMatch[];
  requestedAudience: TargetAudience;
  revealedCohort: {
    selfReportedProfileCount: number;
    totalRevealedVotes: number;
  };
  source: typeof PROFILE_SELF_REPORT_SOURCE;
  verified: false;
}

export type TargetAudienceValidationIssue = {
  field: string;
  message: string;
  suggestion?: string;
  value?: string;
};

export class TargetAudienceValidationError extends Error {
  readonly issues: TargetAudienceValidationIssue[];

  constructor(issues: TargetAudienceValidationIssue[]) {
    super(formatTargetAudienceValidationIssues(issues));
    this.name = "TargetAudienceValidationError";
    this.issues = issues;
  }
}

const AGE_GROUP_SET = new Set<string>(AGE_GROUP_OPTIONS);
const LANGUAGE_SET = new Set<string>(LANGUAGE_OPTIONS);
const ROLE_SET = new Set<string>(ROLE_OPTIONS);
const EXPERTISE_SET = new Set<string>(EXPERTISE_OPTIONS);
const AI_MODEL_PROVIDER_SET = new Set<string>(AI_MODEL_PROVIDER_OPTIONS);
const AI_AGENT_FRAMEWORK_SET = new Set<string>(AI_AGENT_FRAMEWORK_OPTIONS);
const AI_AUTONOMY_SET = new Set<string>(AI_AUTONOMY_OPTIONS);
const TEAM_TYPE_SET = new Set<string>(TEAM_TYPE_OPTIONS);
const TEAM_SIZE_SET = new Set<string>(TEAM_SIZE_OPTIONS);
const HYBRID_OVERSIGHT_SET = new Set<string>(HYBRID_OVERSIGHT_OPTIONS);
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const RATER_TYPE_NAMES = ["Unknown", "Human", "AI", "Team", "Hybrid"] as const;
const ROLE_ALIASES: Record<string, ProfileRole> = {
  dev: "engineer",
  developer: "engineer",
  designer: "product-design",
  lawyer: "legal-policy",
  policy: "legal-policy",
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCountryCode(value: unknown) {
  const normalized = asString(value).toUpperCase();
  return COUNTRY_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<string>): T | undefined {
  const normalized = asString(value);
  return allowed.has(normalized) ? (normalized as T) : undefined;
}

function normalizeText(value: unknown, maxLength: number) {
  const normalized = asString(value).replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : undefined;
}

function normalizeWebsite(value: unknown) {
  const normalized = normalizeText(value, 120);
  if (!normalized) return undefined;
  if (/^https:\/\/[^\s.]+\.[^\s]+$/i.test(normalized)) return normalized;
  return undefined;
}

export function normalizeRaterType(value: unknown): RaterTypeValue {
  if (typeof value === "number" && Number.isInteger(value) && value >= RATER_TYPE.Unknown && value <= RATER_TYPE.Hybrid) {
    return value as RaterTypeValue;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= RATER_TYPE.Unknown && numeric <= RATER_TYPE.Hybrid) {
      return numeric as RaterTypeValue;
    }

    const lower = trimmed.toLowerCase();
    if (lower === "human") return RATER_TYPE.Human;
    if (lower === "ai") return RATER_TYPE.AI;
    if (lower === "team") return RATER_TYPE.Team;
    if (lower === "hybrid") return RATER_TYPE.Hybrid;
  }

  return RATER_TYPE.Unknown;
}

export function formatRaterTypeName(value: unknown): RaterTypeName {
  return RATER_TYPE_NAMES[normalizeRaterType(value)];
}

function normalizeStringArray<T extends string>(
  value: unknown,
  options: {
    allowCountryCodes?: boolean;
    allowed?: Set<string>;
    maxItems: number;
  },
) {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  for (const item of value) {
    const normalized = options.allowCountryCodes
      ? normalizeCountryCode(item)
      : options.allowed
        ? normalizeEnum<T>(item, options.allowed)
        : undefined;
    if (normalized) {
      seen.add(normalized);
    }
  }

  const items = Array.from(seen).slice(0, options.maxItems) as T[];
  return items.length > 0 ? items : undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function pruneUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function normalizeAiContext(value: unknown): ProfileAiContext | undefined {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const context = pruneUndefined<ProfileAiContext>({
    modelProvider: normalizeEnum<AiModelProvider>(source.modelProvider, AI_MODEL_PROVIDER_SET),
    modelFamily: normalizeText(source.modelFamily, 80),
    modelVersion: normalizeText(source.modelVersion, 40),
    agentFramework: normalizeEnum<AiAgentFramework>(source.agentFramework, AI_AGENT_FRAMEWORK_SET),
    autonomy: normalizeEnum<AiAutonomy>(source.autonomy, AI_AUTONOMY_SET),
    languages: normalizeStringArray<LanguageCode>(source.languages, { allowed: LANGUAGE_SET, maxItems: 5 }),
    expertise: normalizeStringArray<ExpertiseArea>(source.expertise, { allowed: EXPERTISE_SET, maxItems: 5 }),
  });
  return Object.values(context).some(Boolean) ? context : undefined;
}

function normalizeTeamContext(value: unknown): ProfileTeamContext | undefined {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const context = pruneUndefined<ProfileTeamContext>({
    teamType: normalizeEnum<TeamType>(source.teamType, TEAM_TYPE_SET),
    teamSize: normalizeEnum<TeamSize>(source.teamSize, TEAM_SIZE_SET),
    country: normalizeCountryCode(source.country),
    languages: normalizeStringArray<LanguageCode>(source.languages, { allowed: LANGUAGE_SET, maxItems: 5 }),
    expertise: normalizeStringArray<ExpertiseArea>(source.expertise, { allowed: EXPERTISE_SET, maxItems: 5 }),
    website: normalizeWebsite(source.website),
  });
  return Object.values(context).some(Boolean) ? context : undefined;
}

function normalizeHybridContext(value: unknown): ProfileHybridContext | undefined {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const context = pruneUndefined<ProfileHybridContext>({
    oversight: normalizeEnum<HybridOversight>(source.oversight, HYBRID_OVERSIGHT_SET),
    modelProvider: normalizeEnum<AiModelProvider>(source.modelProvider, AI_MODEL_PROVIDER_SET),
    modelFamily: normalizeText(source.modelFamily, 80),
    languages: normalizeStringArray<LanguageCode>(source.languages, { allowed: LANGUAGE_SET, maxItems: 5 }),
    expertise: normalizeStringArray<ExpertiseArea>(source.expertise, { allowed: EXPERTISE_SET, maxItems: 5 }),
  });
  return Object.values(context).some(Boolean) ? context : undefined;
}

function pruneEmpty(report: ProfileSelfReport) {
  const next: ProfileSelfReport = { v: PROFILE_SELF_REPORT_SCHEMA_VERSION };

  if (report.raterType !== undefined && report.raterType !== RATER_TYPE.Unknown) next.raterType = report.raterType;
  if (report.ageGroup) next.ageGroup = report.ageGroup;
  if (report.residenceCountry) next.residenceCountry = report.residenceCountry;
  if (report.nationalities?.length) next.nationalities = report.nationalities;
  if (report.languages?.length) next.languages = report.languages;
  if (report.roles?.length) next.roles = report.roles;
  if (report.expertise?.length) next.expertise = report.expertise;
  if (report.ai) next.ai = report.ai;
  if (report.team) next.team = report.team;
  if (report.hybrid) next.hybrid = report.hybrid;

  return next;
}

export function normalizeProfileSelfReport(value: unknown): ProfileSelfReport {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return pruneEmpty({
    v: PROFILE_SELF_REPORT_SCHEMA_VERSION,
    raterType: normalizeRaterType(source.raterType),
    ageGroup: normalizeEnum<AgeGroup>(source.ageGroup, AGE_GROUP_SET),
    residenceCountry: normalizeCountryCode(source.residenceCountry),
    nationalities: normalizeStringArray<string>(source.nationalities, { allowCountryCodes: true, maxItems: 3 }),
    languages: normalizeStringArray<LanguageCode>(source.languages, { allowed: LANGUAGE_SET, maxItems: 5 }),
    roles: normalizeStringArray<ProfileRole>(source.roles, { allowed: ROLE_SET, maxItems: 4 }),
    expertise: normalizeStringArray<ExpertiseArea>(source.expertise, { allowed: EXPERTISE_SET, maxItems: 5 }),
    ai: normalizeAiContext(source.ai),
    team: normalizeTeamContext(source.team),
    hybrid: normalizeHybridContext(source.hybrid),
  });
}

export function profileSelfReportHasValues(report: ProfileSelfReport | null | undefined) {
  return Boolean(
    (report?.raterType !== undefined && report.raterType !== RATER_TYPE.Unknown) ||
      report?.ageGroup ||
      report?.residenceCountry ||
      report?.nationalities?.length ||
      report?.languages?.length ||
      report?.roles?.length ||
      report?.expertise?.length ||
      report?.ai ||
      report?.team ||
      report?.hybrid,
  );
}

export function serializeProfileSelfReport(value: unknown) {
  const serialized = stableJson(normalizeProfileSelfReport(value));
  if (serialized.length > MAX_PROFILE_SELF_REPORT_LENGTH) {
    throw new Error(`Self-report payload must be ${MAX_PROFILE_SELF_REPORT_LENGTH} characters or fewer.`);
  }
  return serialized;
}

function closestOption(value: string, options: readonly string[]) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  let best: { distance: number; option: string } | null = null;

  for (const option of options) {
    const distance = levenshteinDistance(normalized, option.toLowerCase());
    if (!best || distance < best.distance || (distance === best.distance && option.localeCompare(best.option) < 0)) {
      best = { distance, option };
    }
  }

  if (!best) return undefined;
  const threshold = Math.max(2, Math.floor(Math.max(normalized.length, best.option.length) / 3));
  return best.distance <= threshold ? best.option : undefined;
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length] ?? 0;
}

function formatTargetAudienceValidationIssues(issues: TargetAudienceValidationIssue[]) {
  const first = issues[0];
  if (!first) return "targetAudience is invalid.";
  const suffix = first.suggestion ? ` Did you mean "${first.suggestion}"?` : "";
  return `${first.field}: ${first.message}${suffix}`;
}

function prefixTargetAudienceIssues(
  issues: TargetAudienceValidationIssue[],
  fieldPrefix = "targetAudience",
): TargetAudienceValidationIssue[] {
  return issues.map(issue => ({
    ...issue,
    field: issue.field === "targetAudience"
      ? fieldPrefix
      : issue.field.startsWith("targetAudience.")
        ? `${fieldPrefix}${issue.field.slice("targetAudience".length)}`
        : issue.field,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTargetStringArray<T extends string>(params: {
  allowed?: Set<string>;
  aliases?: Record<string, T>;
  field: string;
  issues: TargetAudienceValidationIssue[];
  maxItems?: number;
  options?: readonly T[];
  uppercaseCountryCodes?: boolean;
  value: unknown;
}): T[] | undefined {
  if (params.value === undefined || params.value === null) return undefined;
  if (!Array.isArray(params.value)) {
    params.issues.push({
      field: params.field,
      message: "must be an array of strings.",
    });
    return undefined;
  }

  const seen = new Set<string>();
  const normalizedValues: T[] = [];
  for (const item of params.value) {
    const raw = asString(item);
    if (!raw) {
      params.issues.push({
        field: params.field,
        message: "contains a blank value.",
      });
      continue;
    }

    let normalized: string | undefined;
    if (params.uppercaseCountryCodes) {
      normalized = normalizeCountryCode(raw);
      if (!normalized) {
        params.issues.push({
          field: params.field,
          message: "must contain ISO-3166 alpha-2 country codes.",
          value: raw,
        });
        continue;
      }
    } else {
      const direct = params.allowed?.has(raw) ? raw : undefined;
      normalized = direct;
      if (!normalized) {
        const suggestion = params.aliases?.[raw.trim().toLowerCase()] ?? (params.options ? closestOption(raw, params.options) : undefined);
        params.issues.push({
          field: params.field,
          message: `"${raw}" is not supported.`,
          suggestion,
          value: raw,
        });
        continue;
      }
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      normalizedValues.push(normalized as T);
    }
  }

  if (params.maxItems !== undefined && normalizedValues.length > params.maxItems) {
    params.issues.push({
      field: params.field,
      message: `supports at most ${params.maxItems} values.`,
    });
  }

  return normalizedValues.length > 0 ? normalizedValues.slice(0, params.maxItems) : undefined;
}

function assertKnownTargetAudienceFields(
  value: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  issues: TargetAudienceValidationIssue[],
) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push({
        field: field ? `${field}.${key}` : key,
        message: "is not a supported targetAudience field.",
      });
    }
  }
}

function normalizeTargetAudienceAi(value: unknown, issues: TargetAudienceValidationIssue[]) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    issues.push({ field: "targetAudience.ai", message: "must be an object when provided." });
    return undefined;
  }
  assertKnownTargetAudienceFields(value, "targetAudience.ai", [
    "agentFrameworks",
    "autonomy",
    "expertise",
    "languages",
    "modelProviders",
  ], issues);
  const context = pruneUndefined<TargetAudienceAiCriteria>({
    agentFrameworks: normalizeTargetStringArray<AiAgentFramework>({
      allowed: AI_AGENT_FRAMEWORK_SET,
      field: "targetAudience.ai.agentFrameworks",
      issues,
      options: AI_AGENT_FRAMEWORK_OPTIONS,
      value: value.agentFrameworks,
    }),
    autonomy: normalizeTargetStringArray<AiAutonomy>({
      allowed: AI_AUTONOMY_SET,
      field: "targetAudience.ai.autonomy",
      issues,
      options: AI_AUTONOMY_OPTIONS,
      value: value.autonomy,
    }),
    expertise: normalizeTargetStringArray<ExpertiseArea>({
      allowed: EXPERTISE_SET,
      field: "targetAudience.ai.expertise",
      issues,
      options: EXPERTISE_OPTIONS,
      value: value.expertise,
    }),
    languages: normalizeTargetStringArray<LanguageCode>({
      allowed: LANGUAGE_SET,
      field: "targetAudience.ai.languages",
      issues,
      options: LANGUAGE_OPTIONS,
      value: value.languages,
    }),
    modelProviders: normalizeTargetStringArray<AiModelProvider>({
      allowed: AI_MODEL_PROVIDER_SET,
      field: "targetAudience.ai.modelProviders",
      issues,
      options: AI_MODEL_PROVIDER_OPTIONS,
      value: value.modelProviders,
    }),
  });
  return Object.values(context).some(Boolean) ? context : undefined;
}

function normalizeTargetAudienceTeam(value: unknown, issues: TargetAudienceValidationIssue[]) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    issues.push({ field: "targetAudience.team", message: "must be an object when provided." });
    return undefined;
  }
  assertKnownTargetAudienceFields(value, "targetAudience.team", [
    "countries",
    "expertise",
    "languages",
    "sizes",
    "types",
  ], issues);
  const context = pruneUndefined<TargetAudienceTeamCriteria>({
    countries: normalizeTargetStringArray<string>({
      field: "targetAudience.team.countries",
      issues,
      uppercaseCountryCodes: true,
      value: value.countries,
    }),
    expertise: normalizeTargetStringArray<ExpertiseArea>({
      allowed: EXPERTISE_SET,
      field: "targetAudience.team.expertise",
      issues,
      options: EXPERTISE_OPTIONS,
      value: value.expertise,
    }),
    languages: normalizeTargetStringArray<LanguageCode>({
      allowed: LANGUAGE_SET,
      field: "targetAudience.team.languages",
      issues,
      options: LANGUAGE_OPTIONS,
      value: value.languages,
    }),
    sizes: normalizeTargetStringArray<TeamSize>({
      allowed: TEAM_SIZE_SET,
      field: "targetAudience.team.sizes",
      issues,
      options: TEAM_SIZE_OPTIONS,
      value: value.sizes,
    }),
    types: normalizeTargetStringArray<TeamType>({
      allowed: TEAM_TYPE_SET,
      field: "targetAudience.team.types",
      issues,
      options: TEAM_TYPE_OPTIONS,
      value: value.types,
    }),
  });
  return Object.values(context).some(Boolean) ? context : undefined;
}

function normalizeTargetAudienceHybrid(value: unknown, issues: TargetAudienceValidationIssue[]) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    issues.push({ field: "targetAudience.hybrid", message: "must be an object when provided." });
    return undefined;
  }
  assertKnownTargetAudienceFields(value, "targetAudience.hybrid", [
    "expertise",
    "languages",
    "modelProviders",
    "oversight",
  ], issues);
  const context = pruneUndefined<TargetAudienceHybridCriteria>({
    expertise: normalizeTargetStringArray<ExpertiseArea>({
      allowed: EXPERTISE_SET,
      field: "targetAudience.hybrid.expertise",
      issues,
      options: EXPERTISE_OPTIONS,
      value: value.expertise,
    }),
    languages: normalizeTargetStringArray<LanguageCode>({
      allowed: LANGUAGE_SET,
      field: "targetAudience.hybrid.languages",
      issues,
      options: LANGUAGE_OPTIONS,
      value: value.languages,
    }),
    modelProviders: normalizeTargetStringArray<AiModelProvider>({
      allowed: AI_MODEL_PROVIDER_SET,
      field: "targetAudience.hybrid.modelProviders",
      issues,
      options: AI_MODEL_PROVIDER_OPTIONS,
      value: value.modelProviders,
    }),
    oversight: normalizeTargetStringArray<HybridOversight>({
      allowed: HYBRID_OVERSIGHT_SET,
      field: "targetAudience.hybrid.oversight",
      issues,
      options: HYBRID_OVERSIGHT_OPTIONS,
      value: value.oversight,
    }),
  });
  return Object.values(context).some(Boolean) ? context : undefined;
}

export function targetAudienceHasValues(value: TargetAudience | null | undefined) {
  return Boolean(
    value?.ageGroups?.length ||
      value?.countries?.length ||
      value?.expertise?.length ||
      value?.languages?.length ||
      value?.nationalities?.length ||
      value?.roles?.length ||
      value?.ai?.agentFrameworks?.length ||
      value?.ai?.autonomy?.length ||
      value?.ai?.expertise?.length ||
      value?.ai?.languages?.length ||
      value?.ai?.modelProviders?.length ||
      value?.team?.countries?.length ||
      value?.team?.expertise?.length ||
      value?.team?.languages?.length ||
      value?.team?.sizes?.length ||
      value?.team?.types?.length ||
      value?.hybrid?.expertise?.length ||
      value?.hybrid?.languages?.length ||
      value?.hybrid?.modelProviders?.length ||
      value?.hybrid?.oversight?.length,
  );
}

export function normalizeTargetAudience(
  value: unknown,
  options: { fieldPrefix?: string } = {},
): TargetAudience | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new TargetAudienceValidationError(
      prefixTargetAudienceIssues(
        [{ field: "targetAudience", message: "must be an object when provided." }],
        options.fieldPrefix,
      ),
    );
  }

  const issues: TargetAudienceValidationIssue[] = [];
  assertKnownTargetAudienceFields(value, "targetAudience", [
    "ageGroups",
    "ai",
    "countries",
    "expertise",
    "hybrid",
    "languages",
    "nationalities",
    "roles",
    "team",
  ], issues);
  const audience = pruneUndefined<TargetAudience>({
    ageGroups: normalizeTargetStringArray<AgeGroup>({
      allowed: AGE_GROUP_SET,
      field: "targetAudience.ageGroups",
      issues,
      options: AGE_GROUP_OPTIONS,
      value: value.ageGroups,
    }),
    countries: normalizeTargetStringArray<string>({
      field: "targetAudience.countries",
      issues,
      uppercaseCountryCodes: true,
      value: value.countries,
    }),
    expertise: normalizeTargetStringArray<ExpertiseArea>({
      allowed: EXPERTISE_SET,
      field: "targetAudience.expertise",
      issues,
      options: EXPERTISE_OPTIONS,
      value: value.expertise,
    }),
    languages: normalizeTargetStringArray<LanguageCode>({
      allowed: LANGUAGE_SET,
      field: "targetAudience.languages",
      issues,
      options: LANGUAGE_OPTIONS,
      value: value.languages,
    }),
    nationalities: normalizeTargetStringArray<string>({
      field: "targetAudience.nationalities",
      issues,
      uppercaseCountryCodes: true,
      value: value.nationalities,
    }),
    roles: normalizeTargetStringArray<ProfileRole>({
      aliases: ROLE_ALIASES,
      allowed: ROLE_SET,
      field: "targetAudience.roles",
      issues,
      options: ROLE_OPTIONS,
      value: value.roles,
    }),
    ai: normalizeTargetAudienceAi(value.ai, issues),
    team: normalizeTargetAudienceTeam(value.team, issues),
    hybrid: normalizeTargetAudienceHybrid(value.hybrid, issues),
  });

  if (issues.length > 0) {
    throw new TargetAudienceValidationError(prefixTargetAudienceIssues(issues, options.fieldPrefix));
  }

  return targetAudienceHasValues(audience) ? audience : null;
}

export function serializeTargetAudience(value: unknown) {
  const normalized = normalizeTargetAudience(value);
  return normalized ? stableJson(normalized) : "null";
}

function roundMatchShare(value: number) {
  return Math.round(value * 1000) / 1000;
}

function bucketMatchCount(
  buckets: ProfileSelfReportBucket[] | undefined,
  requested: readonly string[] | undefined,
  denominator: number,
) {
  if (!requested?.length || denominator <= 0) return null;
  const requestedSet = new Set(requested);
  const matchedCount = Math.min(
    denominator,
    (buckets ?? []).reduce((sum, bucket) => sum + (requestedSet.has(bucket.value) ? bucket.total : 0), 0),
  );
  return {
    matchShare: roundMatchShare(matchedCount / denominator),
    matchedCount,
    requested: [...requested],
    totalCount: denominator,
  };
}

export function buildTargetAudienceMatchReport(
  targetAudienceInput: unknown,
  audienceContextInput: unknown,
): TargetAudienceMatchReport | null {
  const requestedAudience = normalizeTargetAudience(targetAudienceInput);
  if (!requestedAudience) return null;
  if (!audienceContextInput || typeof audienceContextInput !== "object" || Array.isArray(audienceContextInput)) {
    return null;
  }

  const audienceContext = audienceContextInput as Partial<ProfileSelfReportAudienceContext>;
  const fields = audienceContext.fields;
  if (!fields || typeof fields !== "object") return null;

  const selfReportedProfileCount = Number(audienceContext.selfReportedProfileCount ?? 0);
  const totalRevealedVotes = Number(audienceContext.totalRevealedVotes ?? 0);
  const denominator = selfReportedProfileCount > 0 ? selfReportedProfileCount : totalRevealedVotes;
  const typedFields = fields as ProfileSelfReportAudienceContext["fields"];
  const matches: TargetAudienceDimensionMatch[] = [];
  const addDimension = (
    dimension: string,
    buckets: ProfileSelfReportBucket[] | undefined,
    requested: readonly string[] | undefined,
  ) => {
    const match = bucketMatchCount(buckets, requested, denominator);
    if (!match) return;
    matches.push({
      dimension,
      ...match,
    });
  };

  addDimension("ageGroups", typedFields.ageGroup, requestedAudience.ageGroups);
  addDimension("countries", typedFields.residenceCountry, requestedAudience.countries);
  addDimension("expertise", typedFields.expertise, requestedAudience.expertise);
  addDimension("languages", typedFields.languages, requestedAudience.languages);
  addDimension("nationalities", typedFields.nationalities, requestedAudience.nationalities);
  addDimension("roles", typedFields.roles, requestedAudience.roles);
  addDimension("ai.agentFrameworks", typedFields.aiAgentFramework, requestedAudience.ai?.agentFrameworks);
  addDimension("ai.autonomy", typedFields.aiAutonomy, requestedAudience.ai?.autonomy);
  addDimension("ai.expertise", typedFields.aiExpertise, requestedAudience.ai?.expertise);
  addDimension("ai.languages", typedFields.aiLanguages, requestedAudience.ai?.languages);
  addDimension("ai.modelProviders", typedFields.aiModelProvider, requestedAudience.ai?.modelProviders);
  addDimension("team.countries", typedFields.teamCountry, requestedAudience.team?.countries);
  addDimension("team.expertise", typedFields.teamExpertise, requestedAudience.team?.expertise);
  addDimension("team.languages", typedFields.teamLanguages, requestedAudience.team?.languages);
  addDimension("team.sizes", typedFields.teamSize, requestedAudience.team?.sizes);
  addDimension("team.types", typedFields.teamType, requestedAudience.team?.types);
  addDimension("hybrid.expertise", typedFields.hybridExpertise, requestedAudience.hybrid?.expertise);
  addDimension("hybrid.languages", typedFields.hybridLanguages, requestedAudience.hybrid?.languages);
  addDimension("hybrid.modelProviders", typedFields.hybridModelProvider, requestedAudience.hybrid?.modelProviders);
  addDimension("hybrid.oversight", typedFields.hybridOversight, requestedAudience.hybrid?.oversight);

  if (matches.length === 0) return null;

  return {
    caveat: TARGET_AUDIENCE_CAVEAT,
    matchedDimensionCount: matches.filter(match => match.matchedCount > 0).length,
    note:
      "Audience matching uses public self-reported profile fields from revealed voters. Values are unverified, and multi-value dimensions are cohort-bucket shares capped to the self-reported cohort size.",
    perDimension: matches,
    requestedAudience,
    revealedCohort: {
      selfReportedProfileCount,
      totalRevealedVotes,
    },
    source: PROFILE_SELF_REPORT_SOURCE,
    verified: false,
  };
}

export function getProfileSelfReportTaxonomy() {
  return {
    caveat: TARGET_AUDIENCE_CAVEAT,
    selfReportSchemaVersion: PROFILE_SELF_REPORT_SCHEMA_VERSION,
    source: PROFILE_SELF_REPORT_SOURCE,
    targetAudience: {
      ageGroups: [...AGE_GROUP_OPTIONS],
      countries: "ISO-3166 alpha-2 country codes matching residenceCountry",
      expertise: [...EXPERTISE_OPTIONS],
      languages: [...LANGUAGE_OPTIONS],
      nationalities: "ISO-3166 alpha-2 country codes",
      roles: [...ROLE_OPTIONS],
      ai: {
        agentFrameworks: [...AI_AGENT_FRAMEWORK_OPTIONS],
        autonomy: [...AI_AUTONOMY_OPTIONS],
        expertise: [...EXPERTISE_OPTIONS],
        languages: [...LANGUAGE_OPTIONS],
        modelProviders: [...AI_MODEL_PROVIDER_OPTIONS],
      },
      team: {
        countries: "ISO-3166 alpha-2 country codes",
        expertise: [...EXPERTISE_OPTIONS],
        languages: [...LANGUAGE_OPTIONS],
        sizes: [...TEAM_SIZE_OPTIONS],
        types: [...TEAM_TYPE_OPTIONS],
      },
      hybrid: {
        expertise: [...EXPERTISE_OPTIONS],
        languages: [...LANGUAGE_OPTIONS],
        modelProviders: [...AI_MODEL_PROVIDER_OPTIONS],
        oversight: [...HYBRID_OVERSIGHT_OPTIONS],
      },
    },
  } as const;
}

export function parseProfileSelfReport(value: unknown): ProfileSelfReport | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(value);
    const report = normalizeProfileSelfReport(parsed);
    return profileSelfReportHasValues(report) ? report : null;
  } catch {
    return null;
  }
}

function emptyBucketFields(): ProfileSelfReportAudienceContext["fields"] {
  return {
    ageGroup: [],
    aiAgentFramework: [],
    aiAutonomy: [],
    aiExpertise: [],
    aiLanguages: [],
    aiModelProvider: [],
    expertise: [],
    hybridExpertise: [],
    hybridLanguages: [],
    hybridModelProvider: [],
    hybridOversight: [],
    languages: [],
    nationalities: [],
    residenceCountry: [],
    roles: [],
    teamCountry: [],
    teamExpertise: [],
    teamLanguages: [],
    teamSize: [],
    teamType: [],
  };
}

export function emptyProfileSelfReportAudienceContext(totalRevealedVotes = 0): ProfileSelfReportAudienceContext {
  return {
    fields: emptyBucketFields(),
    missingSelfReportCount: totalRevealedVotes,
    note: PROFILE_SELF_REPORT_NOTICE,
    restrictedEligibility: PROFILE_SELF_REPORT_RESTRICTS_ELIGIBILITY,
    selfReportedProfileCount: 0,
    source: PROFILE_SELF_REPORT_SOURCE,
    totalRevealedVotes,
    verified: PROFILE_SELF_REPORT_VERIFIED,
  };
}

function addBucketCount(map: Map<string, ProfileSelfReportBucket>, value: string, isUp: boolean | null | undefined) {
  const bucket = map.get(value) ?? { down: 0, total: 0, up: 0, value };
  bucket.total += 1;
  if (isUp === true) bucket.up += 1;
  if (isUp === false) bucket.down += 1;
  map.set(value, bucket);
}

function sortedBuckets(map: Map<string, ProfileSelfReportBucket>) {
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
}

export function aggregateProfileSelfReports(rows: Iterable<ProfileSelfReportVoteRow>): ProfileSelfReportAudienceContext {
  const fieldMaps = {
    ageGroup: new Map<string, ProfileSelfReportBucket>(),
    aiAgentFramework: new Map<string, ProfileSelfReportBucket>(),
    aiAutonomy: new Map<string, ProfileSelfReportBucket>(),
    aiExpertise: new Map<string, ProfileSelfReportBucket>(),
    aiLanguages: new Map<string, ProfileSelfReportBucket>(),
    aiModelProvider: new Map<string, ProfileSelfReportBucket>(),
    expertise: new Map<string, ProfileSelfReportBucket>(),
    hybridExpertise: new Map<string, ProfileSelfReportBucket>(),
    hybridLanguages: new Map<string, ProfileSelfReportBucket>(),
    hybridModelProvider: new Map<string, ProfileSelfReportBucket>(),
    hybridOversight: new Map<string, ProfileSelfReportBucket>(),
    languages: new Map<string, ProfileSelfReportBucket>(),
    nationalities: new Map<string, ProfileSelfReportBucket>(),
    residenceCountry: new Map<string, ProfileSelfReportBucket>(),
    roles: new Map<string, ProfileSelfReportBucket>(),
    teamCountry: new Map<string, ProfileSelfReportBucket>(),
    teamExpertise: new Map<string, ProfileSelfReportBucket>(),
    teamLanguages: new Map<string, ProfileSelfReportBucket>(),
    teamSize: new Map<string, ProfileSelfReportBucket>(),
    teamType: new Map<string, ProfileSelfReportBucket>(),
  };
  let missingSelfReportCount = 0;
  let selfReportedProfileCount = 0;
  let totalRevealedVotes = 0;

  for (const row of rows) {
    totalRevealedVotes += 1;
    const report = parseProfileSelfReport(row.selfReport);
    if (!report) {
      missingSelfReportCount += 1;
      continue;
    }

    selfReportedProfileCount += 1;
    if (report.ageGroup) addBucketCount(fieldMaps.ageGroup, report.ageGroup, row.isUp);
    if (report.residenceCountry) addBucketCount(fieldMaps.residenceCountry, report.residenceCountry, row.isUp);
    for (const nationality of report.nationalities ?? []) {
      addBucketCount(fieldMaps.nationalities, nationality, row.isUp);
    }
    for (const language of report.languages ?? []) {
      addBucketCount(fieldMaps.languages, language, row.isUp);
    }
    for (const role of report.roles ?? []) {
      addBucketCount(fieldMaps.roles, role, row.isUp);
    }
    for (const area of report.expertise ?? []) {
      addBucketCount(fieldMaps.expertise, area, row.isUp);
    }
    if (report.ai?.modelProvider) addBucketCount(fieldMaps.aiModelProvider, report.ai.modelProvider, row.isUp);
    if (report.ai?.agentFramework) addBucketCount(fieldMaps.aiAgentFramework, report.ai.agentFramework, row.isUp);
    if (report.ai?.autonomy) addBucketCount(fieldMaps.aiAutonomy, report.ai.autonomy, row.isUp);
    for (const language of report.ai?.languages ?? []) {
      addBucketCount(fieldMaps.aiLanguages, language, row.isUp);
    }
    for (const area of report.ai?.expertise ?? []) {
      addBucketCount(fieldMaps.aiExpertise, area, row.isUp);
    }
    if (report.team?.teamType) addBucketCount(fieldMaps.teamType, report.team.teamType, row.isUp);
    if (report.team?.teamSize) addBucketCount(fieldMaps.teamSize, report.team.teamSize, row.isUp);
    if (report.team?.country) addBucketCount(fieldMaps.teamCountry, report.team.country, row.isUp);
    for (const language of report.team?.languages ?? []) {
      addBucketCount(fieldMaps.teamLanguages, language, row.isUp);
    }
    for (const area of report.team?.expertise ?? []) {
      addBucketCount(fieldMaps.teamExpertise, area, row.isUp);
    }
    if (report.hybrid?.oversight) addBucketCount(fieldMaps.hybridOversight, report.hybrid.oversight, row.isUp);
    if (report.hybrid?.modelProvider) addBucketCount(fieldMaps.hybridModelProvider, report.hybrid.modelProvider, row.isUp);
    for (const language of report.hybrid?.languages ?? []) {
      addBucketCount(fieldMaps.hybridLanguages, language, row.isUp);
    }
    for (const area of report.hybrid?.expertise ?? []) {
      addBucketCount(fieldMaps.hybridExpertise, area, row.isUp);
    }
  }

  return {
    fields: {
      ageGroup: sortedBuckets(fieldMaps.ageGroup),
      aiAgentFramework: sortedBuckets(fieldMaps.aiAgentFramework),
      aiAutonomy: sortedBuckets(fieldMaps.aiAutonomy),
      aiExpertise: sortedBuckets(fieldMaps.aiExpertise),
      aiLanguages: sortedBuckets(fieldMaps.aiLanguages),
      aiModelProvider: sortedBuckets(fieldMaps.aiModelProvider),
      expertise: sortedBuckets(fieldMaps.expertise),
      hybridExpertise: sortedBuckets(fieldMaps.hybridExpertise),
      hybridLanguages: sortedBuckets(fieldMaps.hybridLanguages),
      hybridModelProvider: sortedBuckets(fieldMaps.hybridModelProvider),
      hybridOversight: sortedBuckets(fieldMaps.hybridOversight),
      languages: sortedBuckets(fieldMaps.languages),
      nationalities: sortedBuckets(fieldMaps.nationalities),
      residenceCountry: sortedBuckets(fieldMaps.residenceCountry),
      roles: sortedBuckets(fieldMaps.roles),
      teamCountry: sortedBuckets(fieldMaps.teamCountry),
      teamExpertise: sortedBuckets(fieldMaps.teamExpertise),
      teamLanguages: sortedBuckets(fieldMaps.teamLanguages),
      teamSize: sortedBuckets(fieldMaps.teamSize),
      teamType: sortedBuckets(fieldMaps.teamType),
    },
    missingSelfReportCount,
    note: PROFILE_SELF_REPORT_NOTICE,
    restrictedEligibility: PROFILE_SELF_REPORT_RESTRICTS_ELIGIBILITY,
    selfReportedProfileCount,
    source: PROFILE_SELF_REPORT_SOURCE,
    totalRevealedVotes,
    verified: PROFILE_SELF_REPORT_VERIFIED,
  };
}
