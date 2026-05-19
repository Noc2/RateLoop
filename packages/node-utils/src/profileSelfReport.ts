export const PROFILE_SELF_REPORT_SCHEMA_VERSION = 2;
export const PROFILE_SELF_REPORT_SOURCE = "self_reported_public_profiles" as const;
export const PROFILE_SELF_REPORT_VERIFIED = false;
export const PROFILE_SELF_REPORT_RESTRICTS_ELIGIBILITY = false;
export const MAX_PROFILE_SELF_REPORT_LENGTH = 1600;

export const PROFILE_SELF_REPORT_NOTICE =
  "Audience context is public, self-reported, unverified, and not used for vote eligibility.";

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
    expertise: ProfileSelfReportBucket[];
    languages: ProfileSelfReportBucket[];
    nationalities: ProfileSelfReportBucket[];
    residenceCountry: ProfileSelfReportBucket[];
    roles: ProfileSelfReportBucket[];
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

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
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

  if (report.raterType && report.raterType !== RATER_TYPE.Unknown) next.raterType = report.raterType;
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
    (report?.raterType && report.raterType !== RATER_TYPE.Unknown) ||
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
  const serialized = JSON.stringify(normalizeProfileSelfReport(value));
  if (serialized.length > MAX_PROFILE_SELF_REPORT_LENGTH) {
    throw new Error(`Self-report payload must be ${MAX_PROFILE_SELF_REPORT_LENGTH} characters or fewer.`);
  }
  return serialized;
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
    expertise: [],
    languages: [],
    nationalities: [],
    residenceCountry: [],
    roles: [],
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
    expertise: new Map<string, ProfileSelfReportBucket>(),
    languages: new Map<string, ProfileSelfReportBucket>(),
    nationalities: new Map<string, ProfileSelfReportBucket>(),
    residenceCountry: new Map<string, ProfileSelfReportBucket>(),
    roles: new Map<string, ProfileSelfReportBucket>(),
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
  }

  return {
    fields: {
      ageGroup: sortedBuckets(fieldMaps.ageGroup),
      expertise: sortedBuckets(fieldMaps.expertise),
      languages: sortedBuckets(fieldMaps.languages),
      nationalities: sortedBuckets(fieldMaps.nationalities),
      residenceCountry: sortedBuckets(fieldMaps.residenceCountry),
      roles: sortedBuckets(fieldMaps.roles),
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
