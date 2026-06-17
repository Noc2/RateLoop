import {
  AGE_GROUP_OPTIONS,
  AI_AGENT_FRAMEWORK_OPTIONS,
  AI_AUTONOMY_OPTIONS,
  AI_MODEL_PROVIDER_OPTIONS,
  EXPERTISE_OPTIONS,
  type ExpertiseArea,
  HYBRID_OVERSIGHT_OPTIONS,
  type ProfileRole,
  type ProfileSelfReport,
  RATER_TYPE,
  ROLE_OPTIONS,
  TEAM_SIZE_OPTIONS,
  TEAM_TYPE_OPTIONS,
  formatRaterTypeName,
} from "@rateloop/node-utils/profileSelfReport";

const PROFILE_ROLE_LABELS: Record<ProfileRole, string> = {
  creator: "Creator",
  educator: "Educator",
  engineer: "Engineer",
  finance: "Finance",
  founder: "Founder",
  healthcare: "Healthcare",
  "legal-policy": "Legal / policy",
  operator: "Operations",
  other: "Other",
  "product-design": "Product / design",
  "public-sector": "Public sector",
  researcher: "Researcher",
  student: "Student",
};

const PROFILE_EXPERTISE_LABELS: Record<ExpertiseArea, string> = {
  ai: "AI",
  "consumer-products": "Consumer products",
  crypto: "Crypto",
  education: "Education",
  finance: "Finance",
  gaming: "Gaming",
  health: "Health",
  "local-services": "Local services",
  media: "Media",
  other: "Other",
  "public-policy": "Public policy",
  science: "Science",
};

function formatProfileOptionLabel(value: string) {
  return value
    .split("-")
    .map(part => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

const AI_MODEL_PROVIDER_LABELS = Object.fromEntries(
  AI_MODEL_PROVIDER_OPTIONS.map(value => [value, formatProfileOptionLabel(value)]),
) as Record<(typeof AI_MODEL_PROVIDER_OPTIONS)[number], string>;
const AI_AGENT_FRAMEWORK_LABELS = Object.fromEntries(
  AI_AGENT_FRAMEWORK_OPTIONS.map(value => [value, formatProfileOptionLabel(value)]),
) as Record<(typeof AI_AGENT_FRAMEWORK_OPTIONS)[number], string>;
const AI_AUTONOMY_LABELS = Object.fromEntries(
  AI_AUTONOMY_OPTIONS.map(value => [value, formatProfileOptionLabel(value)]),
) as Record<(typeof AI_AUTONOMY_OPTIONS)[number], string>;
const TEAM_TYPE_LABELS = Object.fromEntries(
  TEAM_TYPE_OPTIONS.map(value => [value, formatProfileOptionLabel(value)]),
) as Record<(typeof TEAM_TYPE_OPTIONS)[number], string>;
const TEAM_SIZE_LABELS = Object.fromEntries(TEAM_SIZE_OPTIONS.map(value => [value, value])) as Record<
  (typeof TEAM_SIZE_OPTIONS)[number],
  string
>;
const HYBRID_OVERSIGHT_LABELS = Object.fromEntries(
  HYBRID_OVERSIGHT_OPTIONS.map(value => [value, formatProfileOptionLabel(value)]),
) as Record<(typeof HYBRID_OVERSIGHT_OPTIONS)[number], string>;

const FALLBACK_COUNTRY_CODES = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
] as const;

const REGION_CODES_TO_EXCLUDE = new Set(["AC", "CP", "DG", "EA", "EU", "EZ", "IC", "TA", "UN", "XK"]);

function supportedRegionCodes() {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  let regions: readonly string[] = FALLBACK_COUNTRY_CODES;

  try {
    regions = intl.supportedValuesOf?.("region") ?? FALLBACK_COUNTRY_CODES;
  } catch {
    regions = FALLBACK_COUNTRY_CODES;
  }

  return regions.filter(code => /^[A-Z]{2}$/.test(code) && !REGION_CODES_TO_EXCLUDE.has(code));
}

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames("en", { type: "region" }) : null;

export function formatProfileCountryCode(code: string) {
  return regionNames?.of(code) ?? code;
}

export const PROFILE_COUNTRY_OPTIONS = supportedRegionCodes()
  .map(code => ({ label: formatProfileCountryCode(code), value: code }))
  .sort((a, b) => a.label.localeCompare(b.label));

export const PROFILE_AGE_GROUP_OPTIONS = AGE_GROUP_OPTIONS.map(value => ({ label: value, value }));
export const PROFILE_ROLE_OPTIONS = ROLE_OPTIONS.map(value => ({ label: PROFILE_ROLE_LABELS[value], value }));
export const PROFILE_EXPERTISE_OPTIONS = EXPERTISE_OPTIONS.map(value => ({
  label: PROFILE_EXPERTISE_LABELS[value],
  value,
}));

export function getProfileSelfReportDisplayGroups(report: ProfileSelfReport | null) {
  if (!report) return [];

  return [
    report.raterType !== undefined && report.raterType !== RATER_TYPE.Unknown
      ? { label: "Profile type", values: [formatRaterTypeName(report.raterType)] }
      : null,
    report.ageGroup ? { label: "Age group", values: [report.ageGroup] } : null,
    report.residenceCountry ? { label: "Country", values: [formatProfileCountryCode(report.residenceCountry)] } : null,
    report.nationalities?.length
      ? { label: "Nationality", values: report.nationalities.map(formatProfileCountryCode) }
      : null,
    report.roles?.length ? { label: "Roles", values: report.roles.map(value => PROFILE_ROLE_LABELS[value]) } : null,
    report.expertise?.length
      ? { label: "Experience", values: report.expertise.map(value => PROFILE_EXPERTISE_LABELS[value]) }
      : null,
    report.ai?.modelProvider
      ? { label: "Model provider", values: [AI_MODEL_PROVIDER_LABELS[report.ai.modelProvider]] }
      : null,
    report.ai?.modelFamily ? { label: "Model family", values: [report.ai.modelFamily] } : null,
    report.ai?.modelVersion ? { label: "Model version", values: [report.ai.modelVersion] } : null,
    report.ai?.agentFramework
      ? { label: "Agent framework", values: [AI_AGENT_FRAMEWORK_LABELS[report.ai.agentFramework]] }
      : null,
    report.ai?.autonomy ? { label: "Autonomy", values: [AI_AUTONOMY_LABELS[report.ai.autonomy]] } : null,
    report.ai?.expertise?.length
      ? { label: "AI expertise", values: report.ai.expertise.map(value => PROFILE_EXPERTISE_LABELS[value]) }
      : null,
    report.team?.teamType ? { label: "Team type", values: [TEAM_TYPE_LABELS[report.team.teamType]] } : null,
    report.team?.teamSize ? { label: "Team size", values: [TEAM_SIZE_LABELS[report.team.teamSize]] } : null,
    report.team?.country ? { label: "Team country", values: [formatProfileCountryCode(report.team.country)] } : null,
    report.team?.website ? { label: "Website", values: [report.team.website] } : null,
    report.team?.expertise?.length
      ? { label: "Team expertise", values: report.team.expertise.map(value => PROFILE_EXPERTISE_LABELS[value]) }
      : null,
    report.hybrid?.oversight
      ? { label: "Oversight", values: [HYBRID_OVERSIGHT_LABELS[report.hybrid.oversight]] }
      : null,
    report.hybrid?.modelProvider
      ? { label: "AI model provider", values: [AI_MODEL_PROVIDER_LABELS[report.hybrid.modelProvider]] }
      : null,
    report.hybrid?.modelFamily ? { label: "AI model family", values: [report.hybrid.modelFamily] } : null,
    report.hybrid?.expertise?.length
      ? { label: "Hybrid expertise", values: report.hybrid.expertise.map(value => PROFILE_EXPERTISE_LABELS[value]) }
      : null,
  ].filter((group): group is { label: string; values: string[] } => Boolean(group));
}
