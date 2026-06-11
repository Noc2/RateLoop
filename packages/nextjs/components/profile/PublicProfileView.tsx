"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import {
  AI_AGENT_FRAMEWORK_OPTIONS,
  AI_AUTONOMY_OPTIONS,
  AI_MODEL_PROVIDER_OPTIONS,
  type ExpertiseArea,
  HYBRID_OVERSIGHT_OPTIONS,
  PROFILE_SELF_REPORT_NOTICE,
  type ProfileRole,
  type ProfileSelfReport,
  RATER_TYPE,
  RATER_TYPE_OPTIONS,
  type RaterTypeValue,
  TEAM_SIZE_OPTIONS,
  TEAM_TYPE_OPTIONS,
  formatRaterTypeName,
  normalizeProfileSelfReport,
  normalizeRaterType,
  parseProfileSelfReport,
  profileSelfReportHasValues,
  serializeProfileSelfReport,
} from "@rateloop/node-utils/profileSelfReport";
import { useQuery } from "@tanstack/react-query";
import { keccak256, toBytes, zeroHash } from "viem";
import { useAccount } from "wagmi";
import { ArrowLeftIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { BalanceHistory } from "~~/components/leaderboard/BalanceHistory";
import { CategoryBars } from "~~/components/leaderboard/CategoryBars";
import { StakeBreakdown } from "~~/components/leaderboard/StakeBreakdown";
import { WinRateRing } from "~~/components/leaderboard/WinRateRing";
import { ProfileEarnings } from "~~/components/profile/ProfileEarnings";
import { ClaimRewardsButton } from "~~/components/shared/ClaimRewardsButton";
import { FollowProfileButton } from "~~/components/shared/FollowProfileButton";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { ProfileImageLightbox } from "~~/components/shared/ProfileImageLightbox";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { SETTINGS_ROUTE, buildRateContentHref } from "~~/constants/routes";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useFollowedProfiles } from "~~/hooks/useFollowedProfiles";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { usePonderQuery } from "~~/hooks/usePonderQuery";
import {
  useAvatarAccent,
  useClearAvatarAccent,
  useIsNameTaken,
  useProfileRegistry,
  useSetAvatarAccent,
  useSetProfile,
} from "~~/hooks/useProfileRegistry";
import { useRateLoopConnectModal } from "~~/hooks/useRateLoopConnectModal";
import {
  useRaterRegistryIdentity,
  useRaterRegistryProfile,
  useSetRaterProfile,
} from "~~/hooks/useRaterRegistryIdentity";
import { useVoterAccuracy } from "~~/hooks/useVoterAccuracy";
import { useVoterStreak } from "~~/hooks/useVoterStreak";
import { avatarAccentHexToRgb, normalizeAvatarAccentHex } from "~~/lib/avatar/avatarAccent";
import { FOLLOWED_CURATOR_TOAST_ID } from "~~/lib/notifications/followedActivity";
import {
  PROFILE_AGE_GROUP_OPTIONS,
  PROFILE_COUNTRY_OPTIONS,
  PROFILE_EXPERTISE_OPTIONS,
  PROFILE_ROLE_OPTIONS,
  getProfileSelfReportDisplayGroups,
} from "~~/lib/profile/profileSelfReportDisplay";
import { MAX_PROFILE_SELF_REPORT_LENGTH } from "~~/lib/profile/profileValidation";
import { AVATAR_WIN_RATE_TOOLTIP } from "~~/lib/profile/winRateTooltip";
import { formatRatingScoreOutOfTen } from "~~/lib/ui/ratingDisplay";
import {
  type PonderProfileDetailResponse,
  type PonderRaterParticipationStatusResponse,
  type PonderVoteItem,
  ponderApi,
} from "~~/services/ponder/client";
import { getReputationAvatarStatsCacheKey, getReputationAvatarUrl } from "~~/utils/profileImage";
import { notification } from "~~/utils/scaffold-eth";

interface PublicProfileViewProps {
  address: `0x${string}`;
  embedded?: boolean;
}

const NAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const DEFAULT_AVATAR_ACCENT_HEX = "#359eee";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatLrepString(value: string | null | undefined) {
  if (!value) return "0";
  return (Number(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatTimestamp(timestamp: string) {
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSanctionExpiry(value: string | null | undefined) {
  if (!value) return "No expiry set";
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  const date = /^[0-9]+$/.test(trimmed) && Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "Expiry unavailable";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatLaunchEligibility(rewardStatus: PonderRaterParticipationStatusResponse["launchRewards"]) {
  if (rewardStatus.eligible) {
    return `${rewardStatus.rewardedRatingCount}/${rewardStatus.qualifyingRatingCount} launch reward slots paid`;
  }
  if (rewardStatus.qualifyingRatingCount > 0) {
    return `${rewardStatus.qualifyingRatingCount} qualifying ratings recorded`;
  }
  return "No launch reward credits recorded yet";
}

function formatLaunchCapSummary(rewardStatus: PonderRaterParticipationStatusResponse["launchRewards"]) {
  const activeCap = formatLrepString(rewardStatus.launchCap);
  const fullCap = formatLrepString(rewardStatus.fullLaunchCap);
  if (rewardStatus.fullCapUnlocked || rewardStatus.unlockableLaunchCap === "0") {
    return `${activeCap} LREP cap`;
  }
  return `${activeCap} / ${fullCap} LREP cap`;
}

function getUrlHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getVoteDirection(vote: PonderVoteItem) {
  if (vote.isUp === true) return { label: "Up", className: "text-success" };
  if (vote.isUp === false) return { label: "Down", className: "text-error" };
  return { label: "Hidden", className: "text-base-content/50" };
}

function getVoteOutcome(vote: PonderVoteItem) {
  if (vote.roundState === ROUND_STATE.Settled && vote.revealed && vote.isUp !== null && vote.roundUpWins !== null) {
    return vote.isUp === vote.roundUpWins
      ? { label: "Won", className: "text-success" }
      : { label: "Lost", className: "text-error" };
  }

  if (vote.roundState === ROUND_STATE.Cancelled) return { label: "Cancelled", className: "text-base-content/50" };
  if (vote.roundState === ROUND_STATE.Tied) return { label: "Tied", className: "text-warning" };
  if (vote.roundState === ROUND_STATE.RevealFailed) return { label: "Reveal failed", className: "text-warning" };
  if (!vote.revealed) return { label: "Voted hidden", className: "text-base-content/50" };
  return { label: "Open", className: "text-primary" };
}

function getProfileWriteErrorMessage(error: any, fallback: string) {
  return error?.shortMessage || error?.message || fallback;
}

function emptySelfReport() {
  return normalizeProfileSelfReport({});
}

function profileSelfReportFromString(value: string | null | undefined) {
  return parseProfileSelfReport(value) ?? emptySelfReport();
}

function getProfileSelfReportLength(value: ProfileSelfReport) {
  const normalized = stripProfileLanguages(value);
  return profileSelfReportHasValues(normalized) ? serializeProfileSelfReport(normalized).length : 0;
}

function updateSelfReportArray<T extends string>(
  report: ProfileSelfReport,
  key: "expertise" | "nationalities" | "roles",
  value: T,
  checked: boolean,
) {
  const current = new Set((report[key] ?? []) as string[]);
  if (checked) {
    current.add(value);
  } else {
    current.delete(value);
  }
  return normalizeProfileSelfReport({ ...report, [key]: Array.from(current) });
}

function optionSelected(values: readonly string[] | undefined, value: string) {
  return values?.includes(value) ?? false;
}

function formatProfileOptionLabel(value: string) {
  return value
    .split("-")
    .map(part => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function getSelfReportRaterType(report: ProfileSelfReport | null | undefined) {
  return normalizeRaterType(report?.raterType);
}

function isHumanCredentialCompatibleRaterType(raterType: RaterTypeValue) {
  return raterType === RATER_TYPE.Human || raterType === RATER_TYPE.Team || raterType === RATER_TYPE.Hybrid;
}

function stripProfileLanguages(report: ProfileSelfReport) {
  const normalized = normalizeProfileSelfReport(report);
  const { ai, team, hybrid } = normalized;
  const baseReport = { ...normalized };
  delete baseReport.languages;
  delete baseReport.ai;
  delete baseReport.team;
  delete baseReport.hybrid;
  const nextReport: ProfileSelfReport = { ...baseReport };

  if (ai) {
    const aiContext = { ...ai };
    delete aiContext.languages;
    nextReport.ai = aiContext;
  }
  if (team) {
    const teamContext = { ...team };
    delete teamContext.languages;
    nextReport.team = teamContext;
  }
  if (hybrid) {
    const hybridContext = { ...hybrid };
    delete hybridContext.languages;
    nextReport.hybrid = hybridContext;
  }

  return normalizeProfileSelfReport(nextReport);
}

function resolveEditableRaterType(
  registryRaterType: RaterTypeValue,
  selfReport: ProfileSelfReport,
  hasActiveHumanCredential: boolean,
) {
  if (registryRaterType !== RATER_TYPE.Unknown) {
    return hasActiveHumanCredential && !isHumanCredentialCompatibleRaterType(registryRaterType)
      ? RATER_TYPE.Human
      : registryRaterType;
  }
  const selfReportRaterType = getSelfReportRaterType(selfReport);
  if (selfReportRaterType === RATER_TYPE.Unknown) return RATER_TYPE.Human;
  return hasActiveHumanCredential && !isHumanCredentialCompatibleRaterType(selfReportRaterType)
    ? RATER_TYPE.Human
    : selfReportRaterType;
}

function withRaterType(report: ProfileSelfReport, raterType: RaterTypeValue) {
  const languageStrippedReport = stripProfileLanguages(report);

  if (raterType === RATER_TYPE.Human) {
    return normalizeProfileSelfReport({
      ageGroup: languageStrippedReport.ageGroup,
      expertise: languageStrippedReport.expertise,
      nationalities: languageStrippedReport.nationalities,
      raterType,
      residenceCountry: languageStrippedReport.residenceCountry,
      roles: languageStrippedReport.roles,
    });
  }
  if (raterType === RATER_TYPE.AI) return normalizeProfileSelfReport({ ai: languageStrippedReport.ai, raterType });
  if (raterType === RATER_TYPE.Team)
    return normalizeProfileSelfReport({ raterType, team: languageStrippedReport.team });
  if (raterType === RATER_TYPE.Hybrid)
    return normalizeProfileSelfReport({ hybrid: languageStrippedReport.hybrid, raterType });
  return normalizeProfileSelfReport({ raterType });
}

function updateContextArray(
  report: ProfileSelfReport,
  section: "ai" | "team" | "hybrid",
  key: "expertise",
  value: string,
  checked: boolean,
) {
  const currentContext = report[section] ?? {};
  const current = new Set(((currentContext as Record<string, readonly string[] | undefined>)[key] ?? []) as string[]);
  if (checked) {
    current.add(value);
  } else {
    current.delete(value);
  }
  return normalizeProfileSelfReport({ ...report, [section]: { ...currentContext, [key]: Array.from(current) } });
}

type CountryOption = (typeof PROFILE_COUNTRY_OPTIONS)[number];

const COUNTRY_PICKER_RESULT_LIMIT = 8;
const MAX_PROFILE_NATIONALITIES = 3;

function AudienceContextHeading() {
  return (
    <div className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.18em] text-primary/90">
      <span>Audience context</span>
      <InfoTooltip text={PROFILE_SELF_REPORT_NOTICE} />
    </div>
  );
}

function normalizeCountrySearch(value: string) {
  return value.trim().toLowerCase();
}

function findCountryOption(value: string) {
  const normalized = normalizeCountrySearch(value);
  if (!normalized) return undefined;
  return PROFILE_COUNTRY_OPTIONS.find(
    option => option.value.toLowerCase() === normalized || option.label.toLowerCase() === normalized,
  );
}

function findCountryOptionByLabel(value: string) {
  const normalized = normalizeCountrySearch(value);
  if (!normalized) return undefined;
  return PROFILE_COUNTRY_OPTIONS.find(option => option.label.toLowerCase() === normalized);
}

function filterCountryOptions(query: string, excludedValues: ReadonlySet<string> = new Set()) {
  const normalized = normalizeCountrySearch(query);
  const options = PROFILE_COUNTRY_OPTIONS.filter(option => !excludedValues.has(option.value));

  if (!normalized) {
    return options.slice(0, COUNTRY_PICKER_RESULT_LIMIT);
  }

  return options
    .filter(
      option => option.label.toLowerCase().includes(normalized) || option.value.toLowerCase().includes(normalized),
    )
    .slice(0, COUNTRY_PICKER_RESULT_LIMIT);
}

function SearchableCountrySelect({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (value: string | undefined) => void;
  value?: string;
}) {
  const selectedOption = useMemo(() => (value ? findCountryOption(value) : undefined), [value]);
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const filteredOptions = useMemo(() => filterCountryOptions(query), [query]);

  useEffect(() => {
    setQuery(selectedOption?.label ?? "");
  }, [selectedOption?.label]);

  const selectOption = useCallback(
    (option: CountryOption | undefined) => {
      onChange(option?.value);
      setQuery(option?.label ?? "");
      setIsOpen(false);
    },
    [onChange],
  );

  return (
    <div className="form-control relative">
      <label htmlFor={id} className="label-text text-base-content/65">
        {label}
      </label>
      <input
        id={id}
        aria-label={label}
        autoComplete="off"
        className="input input-bordered mt-2 w-full bg-base-100"
        disabled={disabled}
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
            setQuery(selectedOption?.label ?? "");
          }, 120);
        }}
        onChange={event => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setIsOpen(true);

          if (!nextQuery.trim()) {
            onChange(undefined);
            return;
          }

          const exactOption = findCountryOptionByLabel(nextQuery);
          if (exactOption) {
            onChange(exactOption.value);
          }
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Prefer not to say"
        value={query}
      />
      {isOpen && !disabled ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-1 shadow-2xl">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-base-content transition hover:bg-base-200 focus:bg-base-200 focus:outline-none"
                onMouseDown={event => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span>{option.label}</span>
                <span className="font-mono text-xs text-base-content/45">{option.value}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-base-content/55">No countries found</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NationalityPicker({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string[]) => void;
  value: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const selectedValues = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () =>
      value
        .map(countryValue => findCountryOption(countryValue))
        .filter((option): option is CountryOption => Boolean(option)),
    [value],
  );
  const filteredOptions = useMemo(() => filterCountryOptions(query, selectedValues), [query, selectedValues]);
  const canAddMore = value.length < MAX_PROFILE_NATIONALITIES;

  const addOption = useCallback(
    (option: CountryOption | undefined) => {
      if (!option || selectedValues.has(option.value) || value.length >= MAX_PROFILE_NATIONALITIES) return;
      onChange([...value, option.value]);
      setQuery("");
      setIsOpen(false);
    },
    [onChange, selectedValues, value],
  );

  const removeOption = useCallback(
    (optionValue: string) => {
      onChange(value.filter(currentValue => currentValue !== optionValue));
    },
    [onChange, value],
  );

  return (
    <div className="form-control relative lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="profile-nationalities" className="label-text text-base-content/65">
          Nationalities
        </label>
        <span className="text-xs font-medium text-base-content/45">
          {value.length}/{MAX_PROFILE_NATIONALITIES}
        </span>
      </div>

      <div className="mt-2 rounded-xl border border-base-300 bg-base-100 px-3 py-2 focus-within:border-primary">
        {selectedOptions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectedOptions.map(option => (
              <span
                key={option.value}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-base-300 bg-base-200 px-3 py-1 text-sm text-base-content"
              >
                <span className="truncate">{option.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${option.label}`}
                  className="rounded-full text-base-content/55 transition hover:text-error focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={disabled}
                  onClick={() => removeOption(option.value)}
                >
                  <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <input
          id="profile-nationalities"
          aria-label="Nationalities"
          autoComplete="off"
          className="w-full bg-transparent py-1 text-base-content outline-none placeholder:text-base-content/45 disabled:cursor-not-allowed"
          disabled={disabled || !canAddMore}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
              setQuery("");
            }, 120);
          }}
          onChange={event => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setIsOpen(true);

            const exactOption = findCountryOptionByLabel(nextQuery);
            if (exactOption) {
              addOption(exactOption);
            }
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addOption(filteredOptions[0]);
          }}
          placeholder={canAddMore ? "Search countries" : "Maximum selected"}
          value={query}
        />
      </div>

      {isOpen && !disabled && canAddMore ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-1 shadow-2xl">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-base-content transition hover:bg-base-200 focus:bg-base-200 focus:outline-none"
                onMouseDown={event => event.preventDefault()}
                onClick={() => addOption(option)}
              >
                <span>{option.label}</span>
                <span className="font-mono text-xs text-base-content/45">{option.value}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-base-content/55">No countries found</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProfileTypeSpecificFields({
  disabled,
  onChange,
  report,
  raterType,
}: {
  disabled: boolean;
  onChange: (report: ProfileSelfReport) => void;
  report: ProfileSelfReport;
  raterType: RaterTypeValue;
}) {
  const setReport = useCallback((value: unknown) => onChange(normalizeProfileSelfReport(value)), [onChange]);

  const renderSelect = (
    id: string,
    label: string,
    value: string | undefined,
    options: readonly string[],
    onValue: (value: string | undefined) => void,
  ) => (
    <label className="form-control">
      <span className="label-text text-base-content/65">{label}</span>
      <select
        id={id}
        aria-label={label}
        className="select select-bordered mt-2 w-full bg-base-100"
        value={value ?? ""}
        onChange={event => onValue(event.target.value || undefined)}
        disabled={disabled}
      >
        <option value="">Not specified</option>
        {options.map(option => (
          <option key={option} value={option}>
            {formatProfileOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );

  const renderText = (
    label: string,
    value: string | undefined,
    onValue: (value: string) => void,
    placeholder: string,
    className = "",
  ) => (
    <label className={`form-control ${className}`}>
      <span className="label-text text-base-content/65">{label}</span>
      <input
        type="text"
        className="input input-bordered mt-2 w-full bg-base-100"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={event => onValue(event.target.value)}
        disabled={disabled}
      />
    </label>
  );

  const renderExpertiseCheckboxes = (section: "ai" | "team" | "hybrid", label: string) => {
    const values = (report[section]?.expertise ?? []) as readonly string[];
    return (
      <div className="lg:col-span-2">
        <div className="label-text text-base-content/65">{label}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PROFILE_EXPERTISE_OPTIONS.map(option => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-base-content/75">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={optionSelected(values, option.value)}
                onChange={event =>
                  onChange(updateContextArray(report, section, "expertise", option.value, event.target.checked))
                }
                disabled={disabled}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  if (raterType === RATER_TYPE.AI) {
    return (
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {renderSelect(
          "profile-ai-provider",
          "Model provider",
          report.ai?.modelProvider,
          AI_MODEL_PROVIDER_OPTIONS,
          value => setReport({ ...report, ai: { ...report.ai, modelProvider: value } }),
        )}
        {renderText(
          "Model family",
          report.ai?.modelFamily,
          value => {
            setReport({ ...report, ai: { ...report.ai, modelFamily: value } });
          },
          "GPT-5, Claude, Gemini...",
        )}
        {renderSelect(
          "profile-ai-framework",
          "Agent framework",
          report.ai?.agentFramework,
          AI_AGENT_FRAMEWORK_OPTIONS,
          value => setReport({ ...report, ai: { ...report.ai, agentFramework: value } }),
        )}
        {renderSelect("profile-ai-autonomy", "Autonomy", report.ai?.autonomy, AI_AUTONOMY_OPTIONS, value =>
          setReport({ ...report, ai: { ...report.ai, autonomy: value } }),
        )}
        {renderExpertiseCheckboxes("ai", "Expertise")}
      </div>
    );
  }

  if (raterType === RATER_TYPE.Team) {
    return (
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {renderSelect("profile-team-type", "Team type", report.team?.teamType, TEAM_TYPE_OPTIONS, value =>
          setReport({ ...report, team: { ...report.team, teamType: value } }),
        )}
        {renderSelect("profile-team-size", "Team size", report.team?.teamSize, TEAM_SIZE_OPTIONS, value =>
          setReport({ ...report, team: { ...report.team, teamSize: value } }),
        )}
        <SearchableCountrySelect
          id="profile-team-country"
          label="Country"
          value={report.team?.country}
          onChange={value => setReport({ ...report, team: { ...report.team, country: value } })}
          disabled={disabled}
        />
        {renderText(
          "Website",
          report.team?.website,
          value => {
            onChange({ ...report, team: { ...report.team, website: value } });
          },
          "https://example.com",
        )}
        {renderExpertiseCheckboxes("team", "Expertise")}
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {renderSelect(
        "profile-hybrid-oversight",
        "Oversight",
        report.hybrid?.oversight,
        HYBRID_OVERSIGHT_OPTIONS,
        value => setReport({ ...report, hybrid: { ...report.hybrid, oversight: value } }),
      )}
      {renderSelect(
        "profile-hybrid-provider",
        "AI model provider",
        report.hybrid?.modelProvider,
        AI_MODEL_PROVIDER_OPTIONS,
        value => setReport({ ...report, hybrid: { ...report.hybrid, modelProvider: value } }),
      )}
      {renderText(
        "Model family",
        report.hybrid?.modelFamily,
        value => {
          setReport({ ...report, hybrid: { ...report.hybrid, modelFamily: value } });
        },
        "GPT-5, Claude, Gemini...",
        "lg:col-span-2",
      )}
      {renderExpertiseCheckboxes("hybrid", "Expertise")}
    </div>
  );
}

export function PublicProfileView({ address, embedded = false }: PublicProfileViewProps) {
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const isPageVisible = usePageVisibility();
  const { targetNetwork } = useTargetNetwork();
  const { address: connectedAddress } = useAccount();
  const { openConnectModal } = useRateLoopConnectModal();
  const { followedWallets, toggleFollow, isPending: isFollowPending } = useFollowedProfiles(connectedAddress);
  const { stats, categories } = useVoterAccuracy(normalizedAddress);
  const { hasActiveHumanCredential, isLoading: credentialLoading } = useRaterRegistryIdentity(normalizedAddress);
  const {
    profile: raterRegistryProfile,
    isLoading: raterRegistryProfileLoading,
    refetch: refetchRaterRegistryProfile,
  } = useRaterRegistryProfile(normalizedAddress);
  const {
    profile: liveProfile,
    hasProfile: hasLiveProfile,
    isLoading: liveProfileLoading,
    refetch: refetchLiveProfile,
  } = useProfileRegistry(normalizedAddress);
  const {
    avatarAccent,
    isLoading: avatarAccentLoading,
    refetch: refetchAvatarAccent,
  } = useAvatarAccent(normalizedAddress);
  const { setProfile, isPending: isSavingProfile } = useSetProfile();
  const { isAvailable: canWriteRaterProfile, setRaterProfile, isPending: isSavingRaterProfile } = useSetRaterProfile();
  const { setAvatarAccent, isPending: avatarAccentPending } = useSetAvatarAccent();
  const { clearAvatarAccent, isPending: clearAvatarAccentPending } = useClearAvatarAccent();

  const { data: profileResult, isLoading: profileLoading } = usePonderQuery<
    PonderProfileDetailResponse,
    PonderProfileDetailResponse
  >({
    queryKey: ["publicProfile", normalizedAddress],
    ponderFn: async () => ponderApi.getProfile(normalizedAddress),
    rpcFn: async () => ({
      profile: null,
      summary: {
        totalVotes: 0,
        totalContent: 0,
        totalRewardsClaimed: "0",
      },
      earningsSummary: {
        totalUsdcEarned: "0",
        totalLrepEarned: "0",
        bountyUsdcEarned: "0",
        bountyLrepEarned: "0",
        feedbackUsdcEarned: "0",
        feedbackLrepEarned: "0",
        roundLrepEarned: "0",
        paidEventCount: 0,
        latestPaidAt: null,
      },
      social: {
        followerCount: 0,
        followingCount: 0,
      },
      recentVotes: [],
      recentRewards: [],
      recentEarnings: [],
      recentSubmissions: [],
    }),
    enabled: true,
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });
  const rewardStatusQuery = useQuery({
    queryKey: ["profile-participation-status", normalizedAddress],
    queryFn: () => ponderApi.getRaterParticipationStatus(normalizedAddress),
    staleTime: 15_000,
  });

  const profileDetail = profileResult?.data ?? null;
  const summary = profileDetail?.profile ?? null;
  const social = profileDetail?.social ?? { followerCount: 0, followingCount: 0 };
  const confidentialitySanction = profileDetail?.confidentialitySanction ?? null;
  const rewardStatus = rewardStatusQuery.data;
  const dailyStreak = useVoterStreak(normalizedAddress);
  const recentVotes = profileDetail?.recentVotes ?? [];
  const recentSubmissions = profileDetail?.recentSubmissions ?? [];
  const ownProfile = connectedAddress?.toLowerCase() === normalizedAddress;
  const [isEditing, setIsEditing] = useState(false);
  const [isAvatarEditorOpen, setIsAvatarEditorOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [raterTypeInput, setRaterTypeInput] = useState<RaterTypeValue>(RATER_TYPE.Human);
  const [selfReportInput, setSelfReportInput] = useState<ProfileSelfReport>(() => emptySelfReport());
  const [avatarAccentInput, setAvatarAccentInput] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [accentError, setAccentError] = useState<string | null>(null);
  const [committedName, setCommittedName] = useState("");
  const [committedRaterType, setCommittedRaterType] = useState<RaterTypeValue>(RATER_TYPE.Unknown);
  const [committedSelfReport, setCommittedSelfReport] = useState<ProfileSelfReport>(() => emptySelfReport());
  const [committedAvatarAccentHex, setCommittedAvatarAccentHex] = useState<string | null>(null);
  const [profileDraftInitialized, setProfileDraftInitialized] = useState(false);
  const [avatarAccentInitialized, setAvatarAccentInitialized] = useState(false);
  const following = followedWallets.has(normalizedAddress);
  const pending = isFollowPending(normalizedAddress);
  const backHref = ownProfile ? "/governance#profile" : "/governance";
  const totalVotes = profileDetail?.summary.totalVotes ?? 0;
  const ponderSelfReport = profileSelfReportFromString(summary?.selfReport);
  const forcedRaterTypeInput =
    hasActiveHumanCredential && !isHumanCredentialCompatibleRaterType(raterTypeInput)
      ? RATER_TYPE.Human
      : raterTypeInput;
  const effectiveSelfReportInput = withRaterType(selfReportInput, forcedRaterTypeInput);

  useEffect(() => {
    setIsEditing(false);
    setIsAvatarEditorOpen(false);
    setNameInput("");
    setRaterTypeInput(RATER_TYPE.Human);
    setSelfReportInput(emptySelfReport());
    setAvatarAccentInput("");
    setProfileError(null);
    setAccentError(null);
    setCommittedName("");
    setCommittedRaterType(RATER_TYPE.Unknown);
    setCommittedSelfReport(emptySelfReport());
    setCommittedAvatarAccentHex(null);
    setProfileDraftInitialized(false);
    setAvatarAccentInitialized(false);
  }, [normalizedAddress]);

  useEffect(() => {
    if (profileDraftInitialized || liveProfileLoading || raterRegistryProfileLoading) {
      return;
    }

    const nextName = liveProfile?.name ?? "";
    const nextSelfReport = profileSelfReportFromString(liveProfile?.selfReport);
    const nextRaterType = resolveEditableRaterType(
      raterRegistryProfile.raterType,
      nextSelfReport,
      hasActiveHumanCredential,
    );
    setCommittedName(nextName);
    setCommittedRaterType(nextRaterType);
    setCommittedSelfReport(withRaterType(nextSelfReport, nextRaterType));
    setNameInput(nextName);
    setRaterTypeInput(nextRaterType);
    setSelfReportInput(withRaterType(nextSelfReport, nextRaterType));
    setProfileDraftInitialized(true);
  }, [
    hasActiveHumanCredential,
    liveProfile?.name,
    liveProfile?.selfReport,
    liveProfileLoading,
    profileDraftInitialized,
    raterRegistryProfile.raterType,
    raterRegistryProfileLoading,
  ]);

  useEffect(() => {
    if (!profileDraftInitialized || isEditing || liveProfileLoading || raterRegistryProfileLoading) {
      return;
    }

    const nextName = liveProfile?.name ?? "";
    const nextSelfReport = profileSelfReportFromString(liveProfile?.selfReport);
    const nextRaterType = resolveEditableRaterType(
      raterRegistryProfile.raterType,
      nextSelfReport,
      hasActiveHumanCredential,
    );
    setCommittedName(nextName);
    setCommittedRaterType(nextRaterType);
    setCommittedSelfReport(withRaterType(nextSelfReport, nextRaterType));
    setNameInput(nextName);
    setRaterTypeInput(nextRaterType);
    setSelfReportInput(withRaterType(nextSelfReport, nextRaterType));
  }, [
    hasActiveHumanCredential,
    isEditing,
    liveProfile?.name,
    liveProfile?.selfReport,
    liveProfileLoading,
    profileDraftInitialized,
    raterRegistryProfile.raterType,
    raterRegistryProfileLoading,
  ]);

  useEffect(() => {
    if (avatarAccentInitialized || avatarAccentLoading) {
      return;
    }

    const nextAccentHex = avatarAccent?.hex ?? null;
    setCommittedAvatarAccentHex(nextAccentHex);
    setAvatarAccentInput(nextAccentHex ?? "");
    setAvatarAccentInitialized(true);
  }, [avatarAccent, avatarAccentInitialized, avatarAccentLoading]);

  useEffect(() => {
    if (!avatarAccentInitialized || isAvatarEditorOpen || avatarAccentLoading) {
      return;
    }

    const nextAccentHex = avatarAccent?.hex ?? null;
    setCommittedAvatarAccentHex(nextAccentHex);
    setAvatarAccentInput(nextAccentHex ?? "");
  }, [avatarAccent, avatarAccentInitialized, avatarAccentLoading, isAvatarEditorOpen]);

  const { isTaken: isNameTaken, isLoading: nameCheckLoading } = useIsNameTaken(nameInput);
  const currentName = ownProfile ? committedName || liveProfile?.name || summary?.name || "" : summary?.name || "";
  const registryDisplayRaterType =
    hasActiveHumanCredential && !isHumanCredentialCompatibleRaterType(raterRegistryProfile.raterType)
      ? RATER_TYPE.Human
      : raterRegistryProfile.raterType;
  const fallbackDisplayRaterType = getSelfReportRaterType(ownProfile ? committedSelfReport : ponderSelfReport);
  const currentRaterType =
    registryDisplayRaterType !== RATER_TYPE.Unknown ? registryDisplayRaterType : fallbackDisplayRaterType;
  const currentRaterTypeName = formatRaterTypeName(currentRaterType);
  const hasCurrentRaterType = currentRaterType !== RATER_TYPE.Unknown;
  const currentSelfReport = ownProfile ? committedSelfReport : ponderSelfReport;
  const currentSelfReportGroups = getProfileSelfReportDisplayGroups(currentSelfReport);
  const hasCurrentSelfReport = currentSelfReportGroups.length > 0;
  const selfReportInputLength = getProfileSelfReportLength(effectiveSelfReportInput);
  const displayName = currentName || truncateAddress(normalizedAddress);
  const displayAvatarAccentHex = ownProfile ? (committedAvatarAccentHex ?? avatarAccent?.hex ?? null) : null;
  const avatarStatsCacheKey = getReputationAvatarStatsCacheKey(stats);
  const fallbackImageUrl =
    getReputationAvatarUrl(normalizedAddress, 96, displayAvatarAccentHex, targetNetwork.id, avatarStatsCacheKey) || "";
  const isOwnName = currentName.length > 0 && currentName.toLowerCase() === nameInput.toLowerCase();
  const showNameStatus = isEditing && nameInput.length >= 3 && !nameCheckLoading;
  const nameIsAvailable = showNameStatus && (!isNameTaken || isOwnName);
  const nameIsUnavailable = showNameStatus && isNameTaken && !isOwnName;
  const normalizedAvatarAccentInput = normalizeAvatarAccentHex(avatarAccentInput);
  const avatarAccentInputError = avatarAccentInput.trim().length > 0 && !normalizedAvatarAccentInput;
  const previewAvatarAccentHex = normalizedAvatarAccentInput ?? committedAvatarAccentHex;
  const avatarAccentPickerValue = normalizedAvatarAccentInput ?? committedAvatarAccentHex ?? DEFAULT_AVATAR_ACCENT_HEX;
  const generatedAvatarPreviewUrl =
    getReputationAvatarUrl(normalizedAddress, 160, previewAvatarAccentHex, targetNetwork.id, avatarStatsCacheKey) || "";
  const generatedAvatarPreviewSrc = generatedAvatarPreviewUrl
    ? `${generatedAvatarPreviewUrl}&preview=${encodeURIComponent(previewAvatarAccentHex ?? "default")}`
    : "";
  const avatarAccentBusy = avatarAccentPending || clearAvatarAccentPending;
  const profileSaveBusy = isSavingProfile || isSavingRaterProfile;
  const hasAvatarAccentChanges = normalizedAvatarAccentInput !== committedAvatarAccentHex;
  const winRateLabel = stats && stats.totalSettledVotes > 0 ? `${(stats.winRate * 100).toFixed(1)}%` : "—";
  const dailyStreakLabel = (dailyStreak?.currentDailyStreak ?? 0).toLocaleString();
  const resolvedVotesLabel = (stats?.totalSettledVotes ?? 0).toLocaleString();

  const streakLabel = useMemo(() => {
    if (!stats) return "0";
    if (stats.currentStreak > 0) return `${stats.currentStreak}W`;
    if (stats.currentStreak < 0) return `${Math.abs(stats.currentStreak)}L`;
    return "0";
  }, [stats]);

  const handleToggleFollow = useCallback(async () => {
    const result = await toggleFollow(normalizedAddress);

    if (!result.ok) {
      if (result.reason === "not_connected") {
        notification.info("Sign in to follow curators.", { id: FOLLOWED_CURATOR_TOAST_ID });
        void openConnectModal();
        return;
      }

      if (result.reason === "self_follow" || result.reason === "rejected") {
        return;
      }

      notification.error(result.error || "Failed to update follows", { id: FOLLOWED_CURATOR_TOAST_ID });
      return;
    }

    notification.success(result.following ? `Following ${displayName}` : `Unfollowed ${displayName}`, {
      id: FOLLOWED_CURATOR_TOAST_ID,
    });
  }, [displayName, normalizedAddress, openConnectModal, toggleFollow]);

  const openEditMode = useCallback(() => {
    const nextRaterType = currentRaterType === RATER_TYPE.Unknown ? RATER_TYPE.Human : currentRaterType;
    setNameInput(currentName);
    setRaterTypeInput(nextRaterType);
    setSelfReportInput(withRaterType(currentSelfReport, nextRaterType));
    setProfileError(null);
    setIsEditing(true);
  }, [currentName, currentRaterType, currentSelfReport]);

  const handleCancelEdit = useCallback(() => {
    const nextRaterType = committedRaterType === RATER_TYPE.Unknown ? RATER_TYPE.Human : committedRaterType;
    setNameInput(currentName);
    setRaterTypeInput(nextRaterType);
    setSelfReportInput(withRaterType(currentSelfReport, nextRaterType));
    setProfileError(null);
    setIsEditing(false);
  }, [committedRaterType, currentName, currentSelfReport]);

  const handleSaveProfile = useCallback(async () => {
    const trimmedName = nameInput.trim();
    let serializedSelfReport: string;
    let normalizedSelfReport: ProfileSelfReport;

    if (!trimmedName) {
      setProfileError("Profile name is required");
      return;
    }

    if (!NAME_REGEX.test(trimmedName)) {
      setProfileError("Name must be 3-20 characters (letters, numbers, underscores)");
      return;
    }

    if (isNameTaken && !isOwnName) {
      setProfileError("This name is already taken");
      return;
    }

    try {
      normalizedSelfReport = withRaterType(selfReportInput, forcedRaterTypeInput);
      serializedSelfReport = profileSelfReportHasValues(normalizedSelfReport)
        ? serializeProfileSelfReport(normalizedSelfReport)
        : "";
    } catch (error: any) {
      setProfileError(error?.message || "Self-reported context is too large");
      return;
    }

    if (serializedSelfReport.length > MAX_PROFILE_SELF_REPORT_LENGTH) {
      setProfileError(`Self-reported context must be ${MAX_PROFILE_SELF_REPORT_LENGTH} characters or fewer`);
      return;
    }

    setProfileError(null);

    try {
      await setProfile(trimmedName, serializedSelfReport);
      if (canWriteRaterProfile) {
        await setRaterProfile(
          forcedRaterTypeInput,
          serializedSelfReport ? keccak256(toBytes(serializedSelfReport)) : zeroHash,
        );
      }
      setCommittedName(trimmedName);
      setCommittedRaterType(forcedRaterTypeInput);
      setCommittedSelfReport(normalizedSelfReport);
      setNameInput(trimmedName);
      setRaterTypeInput(forcedRaterTypeInput);
      setSelfReportInput(normalizedSelfReport);
      setIsEditing(false);
      notification.success(hasLiveProfile ? "Profile updated!" : "Profile created!");
      refetchLiveProfile();
      refetchRaterRegistryProfile();
    } catch (error: any) {
      console.error("Profile update failed:", error);
      setProfileError(getProfileWriteErrorMessage(error, "Failed to update profile"));
    }
  }, [
    canWriteRaterProfile,
    forcedRaterTypeInput,
    hasLiveProfile,
    isNameTaken,
    isOwnName,
    nameInput,
    refetchLiveProfile,
    refetchRaterRegistryProfile,
    selfReportInput,
    setProfile,
    setRaterProfile,
  ]);

  const openAvatarEditor = useCallback(() => {
    setAvatarAccentInput(committedAvatarAccentHex ?? "");
    setAccentError(null);
    setIsAvatarEditorOpen(true);
  }, [committedAvatarAccentHex]);

  const closeAvatarEditor = useCallback(() => {
    setAvatarAccentInput(committedAvatarAccentHex ?? "");
    setAccentError(null);
    setIsAvatarEditorOpen(false);
  }, [committedAvatarAccentHex]);

  const handleSaveAvatarAccent = useCallback(async () => {
    const normalizedAccentHex = normalizeAvatarAccentHex(avatarAccentInput);
    if (!normalizedAccentHex) {
      setAccentError(`Use a valid 6-digit hex color like ${DEFAULT_AVATAR_ACCENT_HEX}.`);
      return;
    }

    const rgbValue = avatarAccentHexToRgb(normalizedAccentHex);
    if (rgbValue === null) {
      setAccentError(`Use a valid 6-digit hex color like ${DEFAULT_AVATAR_ACCENT_HEX}.`);
      return;
    }

    setAccentError(null);

    try {
      await setAvatarAccent(rgbValue);
      setCommittedAvatarAccentHex(normalizedAccentHex);
      setAvatarAccentInput(normalizedAccentHex);
      setIsAvatarEditorOpen(false);
      notification.success("Avatar color updated!");
      refetchAvatarAccent();
    } catch (error: any) {
      console.error("Avatar gradient update failed:", error);
      setAccentError(getProfileWriteErrorMessage(error, "Failed to update avatar gradient"));
    }
  }, [avatarAccentInput, refetchAvatarAccent, setAvatarAccent]);

  const handleResetAvatarAccent = useCallback(async () => {
    if (!committedAvatarAccentHex) {
      setAvatarAccentInput("");
      setAccentError(null);
      setIsAvatarEditorOpen(false);
      return;
    }

    setAccentError(null);

    try {
      await clearAvatarAccent();
      setCommittedAvatarAccentHex(null);
      setAvatarAccentInput("");
      setIsAvatarEditorOpen(false);
      notification.success("Avatar color reset!");
      refetchAvatarAccent();
    } catch (error: any) {
      console.error("Avatar gradient reset failed:", error);
      setAccentError(getProfileWriteErrorMessage(error, "Failed to reset avatar gradient"));
    }
  }, [clearAvatarAccent, committedAvatarAccentHex, refetchAvatarAccent]);

  return (
    <div className={embedded ? "w-full space-y-6" : "flex flex-col items-center grow px-4 pt-8 pb-12"}>
      <div className={embedded ? "w-full space-y-6" : "w-full max-w-5xl space-y-6"}>
        {!embedded ? (
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 rounded-full bg-base-200 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-base-300"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </Link>
        ) : null}

        <div className="surface-card rounded-3xl p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              {ownProfile ? (
                <button
                  type="button"
                  onClick={openAvatarEditor}
                  aria-label="Edit profile avatar"
                  className="group relative shrink-0 rounded-3xl transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
                >
                  <img
                    src={fallbackImageUrl}
                    width={96}
                    height={96}
                    alt={`${displayName} avatar`}
                    className="h-24 w-24 rounded-3xl object-cover shrink-0"
                  />
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-base-200 px-2 py-0.5 text-xs font-medium text-white transition-colors group-hover:bg-base-300">
                    Edit
                  </span>
                </button>
              ) : (
                <ProfileImageLightbox
                  src={fallbackImageUrl}
                  fallbackSrc={fallbackImageUrl}
                  alt={`${displayName} avatar`}
                  width={96}
                  height={96}
                  triggerLabel="Open profile avatar"
                  modalLabel={`${displayName} profile avatar`}
                  buttonClassName="shrink-0 rounded-3xl"
                  imageClassName="h-24 w-24 rounded-3xl object-cover shrink-0"
                  modalImageClassName="rounded-[2rem]"
                />
              )}
              <div className="min-w-0 flex-1">
                {ownProfile && isEditing ? (
                  <>
                    <input
                      type="text"
                      value={nameInput}
                      onChange={event => {
                        setNameInput(event.target.value);
                        setProfileError(null);
                      }}
                      maxLength={20}
                      aria-label="Profile name"
                      placeholder="Profile name"
                      className={`input input-bordered h-auto w-full bg-base-100 px-0 text-3xl font-semibold ${
                        nameIsUnavailable ? "input-error" : ""
                      }`}
                      disabled={profileSaveBusy}
                    />
                    <div className="mt-2 font-mono text-base text-base-content/55 break-all">{normalizedAddress}</div>
                    <div className="mt-2 flex items-start justify-between gap-3 text-sm">
                      <div className="text-base-content/55">
                        {nameIsUnavailable ? <p className="text-error">Name is already taken</p> : null}
                        {!showNameStatus && nameInput.length > 0 && nameInput.length < 3 ? (
                          <p className="text-warning">Min 3 characters</p>
                        ) : null}
                        {nameIsAvailable && !isOwnName ? <p className="text-success">Name is available</p> : null}
                      </div>
                      <span className="shrink-0 text-base-content/60">{nameInput.length}/20</span>
                    </div>
                  </>
                ) : (
                  <>
                    <h1 className="truncate text-3xl font-semibold">{displayName}</h1>
                    <div className="mt-2 font-mono text-base text-base-content/55 break-all">{normalizedAddress}</div>
                    {hasCurrentRaterType ? (
                      <div className="mt-3 inline-flex rounded-full bg-base-content/[0.06] px-3 py-1 text-sm font-medium text-base-content/75">
                        {currentRaterTypeName}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {ownProfile ? (
              isEditing ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="btn btn-ghost border border-base-300"
                    disabled={profileSaveBusy}
                  >
                    Cancel
                  </button>
                  <GradientActionButton
                    onClick={() => void handleSaveProfile()}
                    motion={getGradientActionMotion(profileSaveBusy)}
                    disabled={
                      profileSaveBusy ||
                      !nameInput.trim() ||
                      nameIsUnavailable ||
                      selfReportInputLength > MAX_PROFILE_SELF_REPORT_LENGTH
                    }
                  >
                    {profileSaveBusy ? "Saving..." : hasLiveProfile ? "Save changes" : "Save profile"}
                  </GradientActionButton>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <GradientActionButton onClick={openEditMode}>Edit profile</GradientActionButton>
                </div>
              )
            ) : (
              <FollowProfileButton
                following={following}
                pending={pending}
                onClick={() => {
                  void handleToggleFollow();
                }}
                variant="pill"
              />
            )}
          </div>

          {!isEditing ? (
            <div className="mt-4 flex flex-col gap-2 text-base text-base-content/55 lg:flex-row lg:items-center">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span>
                    Win rate <span className="font-mono tabular-nums text-base-content/75">{winRateLabel}</span>
                  </span>
                  <InfoTooltip text={AVATAR_WIN_RATE_TOOLTIP} position="bottom" />
                </span>
                <span className="text-base-content/60">&bull;</span>
                <span>Daily Streak {dailyStreakLabel}</span>
                <span className="text-base-content/60">&bull;</span>
                <span>{profileLoading ? "..." : `${totalVotes} votes`}</span>
                <span className="text-base-content/60">&bull;</span>
                <span>{resolvedVotesLabel} resolved</span>
                <span className="text-base-content/60">&bull;</span>
                <span>{social.followerCount.toLocaleString()} followers</span>
                <span className="text-base-content/60">&bull;</span>
                <span>{social.followingCount.toLocaleString()} following</span>
                <span className="text-base-content/60">&bull;</span>
                <span>
                  {credentialLoading
                    ? "Loading credential..."
                    : hasActiveHumanCredential
                      ? "Human Credential Active"
                      : "No Human Credential"}
                </span>
              </div>
            </div>
          ) : null}

          {profileError ? (
            <div className="mt-4 surface-card-nested rounded-2xl px-4 py-3 text-base text-error">{profileError}</div>
          ) : null}

          {!isEditing ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                confidentialitySanction?.active
                  ? "border-error/30 bg-error/10 text-error"
                  : "border-base-300 bg-base-100 text-base-content/65"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-base-content">Confidentiality status</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    confidentialitySanction?.active ? "bg-error/15 text-error" : "bg-success/10 text-success"
                  }`}
                >
                  {confidentialitySanction?.active ? "Active sanction" : "No active sanction indexed"}
                </span>
              </div>
              {confidentialitySanction?.active ? (
                <div className="mt-2 space-y-1 text-sm leading-relaxed">
                  <p>{confidentialitySanction.reason || "Governance-marked confidentiality breach."}</p>
                  <p>Scope: {confidentialitySanction.scope || "surplus earning and gated-context access checks"}</p>
                  <p>Expires: {formatSanctionExpiry(confidentialitySanction.expiresAt)}</p>
                  {confidentialitySanction.evidenceHash ? (
                    <p className="break-all font-mono text-xs text-base-content/60">
                      Evidence {confidentialitySanction.evidenceHash}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 leading-relaxed">
                  The public indexer has not reported an active confidentiality sanction for this profile.
                </p>
              )}
            </div>
          ) : null}

          {ownProfile && isEditing ? (
            <div className="mt-6 surface-card-nested rounded-2xl px-5 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <AudienceContextHeading />
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
                    AI tools and public readers may use it as context.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm border border-base-300"
                  onClick={() => {
                    setSelfReportInput(withRaterType(emptySelfReport(), forcedRaterTypeInput));
                    setProfileError(null);
                  }}
                  disabled={profileSaveBusy || !profileSelfReportHasValues(effectiveSelfReportInput)}
                >
                  Clear
                </button>
              </div>

              <div className="mt-5">
                <div className="label-text text-base-content/65">Profile type</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  {RATER_TYPE_OPTIONS.map(option => {
                    const lockedByCredential = hasActiveHumanCredential && option.value === RATER_TYPE.AI;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                          forcedRaterTypeInput === option.value
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-base-300 bg-base-100 text-base-content/70 hover:bg-base-200"
                        } ${lockedByCredential ? "cursor-not-allowed opacity-45" : ""}`}
                        disabled={profileSaveBusy || lockedByCredential}
                        onClick={() => {
                          setRaterTypeInput(option.value);
                          setSelfReportInput(withRaterType(selfReportInput, option.value));
                          setProfileError(null);
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {forcedRaterTypeInput === RATER_TYPE.Human ? (
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text text-base-content/65">Age group</span>
                    <select
                      aria-label="Age group"
                      className="select select-bordered mt-2 w-full bg-base-100"
                      value={selfReportInput.ageGroup ?? ""}
                      onChange={event => {
                        setSelfReportInput(
                          normalizeProfileSelfReport({ ...selfReportInput, ageGroup: event.target.value || undefined }),
                        );
                        setProfileError(null);
                      }}
                      disabled={profileSaveBusy}
                    >
                      <option value="">Prefer not to say</option>
                      {PROFILE_AGE_GROUP_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <SearchableCountrySelect
                    id="profile-country"
                    label="Country"
                    value={selfReportInput.residenceCountry}
                    onChange={value => {
                      setSelfReportInput(
                        normalizeProfileSelfReport({
                          ...selfReportInput,
                          residenceCountry: value,
                        }),
                      );
                      setProfileError(null);
                    }}
                    disabled={profileSaveBusy}
                  />

                  <NationalityPicker
                    value={selfReportInput.nationalities ?? []}
                    onChange={values => {
                      setSelfReportInput(normalizeProfileSelfReport({ ...selfReportInput, nationalities: values }));
                      setProfileError(null);
                    }}
                    disabled={profileSaveBusy}
                  />

                  <div className="lg:col-span-2">
                    <div className="label-text text-base-content/65">Roles</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {PROFILE_ROLE_OPTIONS.map(option => (
                        <label key={option.value} className="flex items-center gap-2 text-sm text-base-content/75">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={optionSelected(selfReportInput.roles, option.value)}
                            onChange={event => {
                              setSelfReportInput(
                                updateSelfReportArray<ProfileRole>(
                                  selfReportInput,
                                  "roles",
                                  option.value,
                                  event.target.checked,
                                ),
                              );
                              setProfileError(null);
                            }}
                            disabled={profileSaveBusy}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-2">
                    <div className="label-text text-base-content/65">Experience</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {PROFILE_EXPERTISE_OPTIONS.map(option => (
                        <label key={option.value} className="flex items-center gap-2 text-sm text-base-content/75">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={optionSelected(selfReportInput.expertise, option.value)}
                            onChange={event => {
                              setSelfReportInput(
                                updateSelfReportArray<ExpertiseArea>(
                                  selfReportInput,
                                  "expertise",
                                  option.value,
                                  event.target.checked,
                                ),
                              );
                              setProfileError(null);
                            }}
                            disabled={profileSaveBusy}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <ProfileTypeSpecificFields
                  disabled={profileSaveBusy}
                  onChange={nextReport => {
                    setSelfReportInput(nextReport);
                    setProfileError(null);
                  }}
                  report={selfReportInput}
                  raterType={forcedRaterTypeInput}
                />
              )}

              <div className="mt-4 flex justify-end">
                <span className="text-sm text-base-content/60">
                  {selfReportInputLength}/{MAX_PROFILE_SELF_REPORT_LENGTH}
                </span>
              </div>
            </div>
          ) : hasCurrentSelfReport ? (
            <div className="mt-6 surface-card-nested rounded-2xl px-5 py-4">
              <AudienceContextHeading />
              <dl className="mt-4 grid gap-x-8 divide-y divide-base-content/10 md:grid-cols-2 md:divide-y-0">
                {currentSelfReportGroups.map(group => (
                  <div
                    key={group.label}
                    className="flex flex-col gap-1 py-3 md:border-t md:border-base-content/10 md:first:border-t-0 md:[&:nth-child(2)]:border-t-0"
                  >
                    <dt className="text-sm font-medium text-base-content/50">{group.label}</dt>
                    <dd className="text-base text-base-content/75">{group.values.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : ownProfile ? (
            <div className="mt-6 rounded-2xl border border-dashed border-base-content/15 px-5 py-4">
              <AudienceContextHeading />
            </div>
          ) : null}
        </div>

        <div className="surface-card rounded-3xl p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-base-content">Reputation Context</h2>
            </div>
            {hasCurrentRaterType ? (
              <div className="rounded-full bg-base-content/[0.05] px-4 py-2 text-sm font-medium text-base-content/70">
                {currentRaterTypeName}
              </div>
            ) : null}
          </div>

          {rewardStatusQuery.isLoading ? (
            <div className="mt-6 flex items-center gap-3 text-base-content/55">
              <span className="loading loading-spinner loading-sm text-primary" />
              <span>Loading public reputation context...</span>
            </div>
          ) : rewardStatusQuery.error ? (
            <div className="mt-6 surface-card-nested rounded-2xl px-4 py-3 text-sm text-error">
              {rewardStatusQuery.error instanceof Error
                ? rewardStatusQuery.error.message
                : "Failed to load reputation context."}
            </div>
          ) : rewardStatus ? (
            <>
              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="surface-card-nested rounded-2xl px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-base-content/60">Verified Human</div>
                      <div className="mt-1 text-xl font-semibold capitalize">{rewardStatus.humanCredential.status}</div>
                    </div>
                    {ownProfile && rewardStatus.humanCredential.status !== "verified" ? (
                      <Link href={`${SETTINGS_ROUTE}#identity`} className="btn btn-submit btn-sm">
                        Get Verified
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-base-content/55">Counts as a launch anchor when active</div>
                </div>

                <div className="surface-card-nested rounded-2xl px-4 py-3">
                  <div className="text-sm text-base-content/60">Launch Reward Progress</div>
                  <div className="mt-1 text-xl font-semibold">{formatLaunchCapSummary(rewardStatus.launchRewards)}</div>
                  <div className="mt-1 text-sm text-base-content/55">
                    {rewardStatus.launchRewards.fullCapUnlocked ||
                    rewardStatus.launchRewards.unlockableLaunchCap === "0"
                      ? formatLaunchEligibility(rewardStatus.launchRewards)
                      : `${formatLaunchEligibility(rewardStatus.launchRewards)}; verify to unlock ${formatLrepString(
                          rewardStatus.launchRewards.unlockableLaunchCap,
                        )} LREP`}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <ProfileEarnings
          headerAction={ownProfile ? <ClaimRewardsButton className="w-fit" /> : undefined}
          isLoading={profileLoading}
          items={profileDetail?.recentEarnings ?? []}
          summary={profileDetail?.earningsSummary}
        />

        {ownProfile ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
            <BalanceHistory address={normalizedAddress} />
            <StakeBreakdown address={normalizedAddress} showEmpty />
          </div>
        ) : null}

        <div className="surface-card rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-medium text-base-content/60">Voting Performance</span>
              <InfoTooltip text="Resolved rounds only. Category bars show win and loss ratios by category." />
            </div>
            <span className="text-base tabular-nums text-base-content/60">{resolvedVotesLabel} resolved</span>
          </div>

          {stats ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                <WinRateRing winRate={stats.winRate} wins={stats.totalWins} losses={stats.totalLosses} />

                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full bg-base-content/[0.06] px-3 py-1.5 text-base">
                      <span className="text-base-content/50">Current Streak </span>
                      <span className="font-mono tabular-nums">{streakLabel}</span>
                    </div>
                    <div className="rounded-full bg-base-content/[0.06] px-3 py-1.5 text-base">
                      <span className="text-base-content/50">Best Streak </span>
                      <span className="font-mono tabular-nums">{stats.bestWinStreak}W</span>
                    </div>
                    <div className="rounded-full bg-base-content/[0.06] px-3 py-1.5 text-base">
                      <span className="text-base-content/50">Win Rate </span>
                      <span className="font-mono tabular-nums">{(stats.winRate * 100).toFixed(1)}%</span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="surface-card-nested rounded-2xl px-4 py-3">
                      <div className="text-base text-base-content/60">Stake Won</div>
                      <div className="mt-1 text-xl font-semibold text-success">
                        {formatLrepString(stats.totalStakeWon)} LREP
                      </div>
                    </div>
                    <div className="surface-card-nested rounded-2xl px-4 py-3">
                      <div className="text-base text-base-content/60">Stake Lost</div>
                      <div className="mt-1 text-xl font-semibold text-error">
                        {formatLrepString(stats.totalStakeLost)} LREP
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <CategoryBars categories={categories} />
            </div>
          ) : (
            <div className="surface-card-nested rounded-2xl px-4 py-8 text-center text-base text-base-content/55">
              No resolved voting history yet.
            </div>
          )}
        </div>

        <div className="surface-card rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-medium text-base-content/60">Recent Questions</span>
              <InfoTooltip text="Latest questions this curator has asked. This is the clearest payoff from following them." />
            </div>
            <span className="text-base tabular-nums text-base-content/60">
              {profileLoading ? "..." : recentSubmissions.length}
            </span>
          </div>

          {profileLoading && recentSubmissions.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="loading loading-spinner loading-sm"></span>
            </div>
          ) : recentSubmissions.length === 0 ? (
            <div className="surface-card-nested rounded-2xl px-4 py-8 text-center text-base text-base-content/55">
              No questions yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {recentSubmissions.map(submission => {
                const categoryName = submission.categoryName || `Category #${submission.categoryId}`;
                const ratingScore = formatRatingScoreOutOfTen(
                  (submission.ratingSettledRounds ?? 0) > 0 ? submission.rating : null,
                );
                return (
                  <Link
                    key={submission.id}
                    href={buildRateContentHref(submission.id)}
                    className="surface-card-nested rounded-2xl p-4 transition-colors hover:bg-base-content/[0.08]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold uppercase tracking-wide text-primary/90">
                          {categoryName}
                        </div>
                        <div className="mt-1 line-clamp-2 text-lg font-semibold leading-7">{submission.title}</div>
                        {submission.description ? (
                          <p className="mt-1 line-clamp-2 text-sm text-base-content/65">{submission.description}</p>
                        ) : null}
                      </div>
                      <div className="rounded-full bg-base-content/[0.06] px-2.5 py-1 text-sm font-mono text-base-content/70">
                        <span className="font-semibold tabular-nums text-base-content/85">{ratingScore}</span>
                        {ratingScore !== "N/A" ? <span className="font-medium text-base-content/50">/10</span> : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-sm text-base-content/55">
                      <span>{getUrlHost(submission.url)}</span>
                      <span>&bull;</span>
                      <span>{submission.totalVotes} votes</span>
                      <span>&bull;</span>
                      <span>{formatTimestamp(submission.createdAt)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="surface-card rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-medium text-base-content/60">Recent Votes</span>
              <InfoTooltip text="Latest 20 vote commits for this wallet. Outcomes appear once rounds settle." />
            </div>
            <span className="text-base tabular-nums text-base-content/60">
              {profileLoading ? "..." : recentVotes.length}
            </span>
          </div>

          {profileLoading && recentVotes.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="loading loading-spinner loading-sm"></span>
            </div>
          ) : recentVotes.length === 0 ? (
            <div className="surface-card-nested rounded-2xl px-4 py-8 text-center text-base text-base-content/55">
              No recent votes yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr className="text-base-content/60">
                    <th>Content</th>
                    <th>Vote</th>
                    <th>Status</th>
                    <th className="text-right">Stake</th>
                    <th className="text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentVotes.map(vote => {
                    const direction = getVoteDirection(vote);
                    const outcome = getVoteOutcome(vote);

                    return (
                      <tr key={vote.id} className="hover:bg-base-200/40">
                        <td>
                          <Link
                            href={buildRateContentHref(vote.contentId)}
                            className="font-medium transition-colors hover:text-primary"
                          >
                            Content #{vote.contentId}
                          </Link>
                          <div className="text-base text-base-content/60">Round #{vote.roundId}</div>
                        </td>
                        <td>
                          <span className={`font-medium ${direction.className}`}>{direction.label}</span>
                        </td>
                        <td>
                          <span className={`font-medium ${outcome.className}`}>{outcome.label}</span>
                        </td>
                        <td className="text-right font-mono">{formatLrepString(vote.stake)} LREP</td>
                        <td className="text-right text-base-content/55">{formatTimestamp(vote.committedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {ownProfile && isAvatarEditorOpen ? (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-label="Edit avatar gradient"
            onClick={closeAvatarEditor}
          >
            <div
              className="w-full max-w-xl rounded-3xl bg-base-200 p-6 shadow-2xl"
              onClick={event => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">Edit Avatar Gradient</h2>
                  <p className="mt-1 text-base text-base-content/60">
                    Choose the color seed for your public avatar ring.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeAvatarEditor}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-base-300 text-base-content transition-colors hover:bg-base-300/80"
                  aria-label="Close avatar editor"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="mt-6 flex justify-center">
                <img
                  key={generatedAvatarPreviewSrc}
                  src={generatedAvatarPreviewSrc}
                  width={160}
                  height={160}
                  alt="Avatar preview"
                  className="h-40 w-40 rounded-[2rem] object-cover"
                />
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-[auto,minmax(0,1fr)] sm:items-center">
                <input
                  type="color"
                  aria-label="Avatar gradient color picker"
                  className="h-12 w-20 cursor-pointer rounded-xl border border-base-300 bg-base-100 p-1"
                  value={avatarAccentPickerValue}
                  onChange={event => {
                    setAvatarAccentInput(event.target.value);
                    setAccentError(null);
                  }}
                  disabled={avatarAccentBusy}
                />
                <input
                  type="text"
                  aria-label="Avatar gradient hex"
                  placeholder={DEFAULT_AVATAR_ACCENT_HEX}
                  className={`input input-bordered w-full bg-base-100 ${avatarAccentInputError ? "input-error" : ""}`}
                  value={avatarAccentInput}
                  onChange={event => {
                    setAvatarAccentInput(event.target.value);
                    setAccentError(null);
                  }}
                  disabled={avatarAccentBusy}
                />
              </div>

              <div className="mt-3 min-h-6 text-sm">
                {avatarAccentInputError ? (
                  <p className="text-error">Use a valid 6-digit hex color like {DEFAULT_AVATAR_ACCENT_HEX}.</p>
                ) : accentError ? (
                  <p className="text-error">{accentError}</p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleSaveAvatarAccent()}
                  className="btn btn-submit sm:flex-1"
                  disabled={
                    avatarAccentBusy ||
                    !normalizedAvatarAccentInput ||
                    avatarAccentInputError ||
                    !hasAvatarAccentChanges
                  }
                >
                  {avatarAccentPending ? "Saving..." : "Save color"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleResetAvatarAccent()}
                  className="btn btn-ghost border border-base-300 sm:w-auto"
                  disabled={avatarAccentBusy || (!committedAvatarAccentHex && avatarAccentInput.trim().length === 0)}
                >
                  {clearAvatarAccentPending ? "Resetting..." : "Reset"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
