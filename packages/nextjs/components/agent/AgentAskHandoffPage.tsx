"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  type TargetAudience,
  getProfileSelfReportTaxonomy,
  normalizeTargetAudience,
} from "@rateloop/node-utils/profileSelfReport";
import { defineChain } from "thirdweb";
import { type Address, type Hex, erc20Abi, isAddress } from "viem";
import { useAccount, useConfig, useReadContract, useSignTypedData } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PhotoIcon,
  ShieldCheckIcon,
  TagIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { BountyFundingWarning } from "~~/components/shared/BountyFundingWarning";
import { GasBalanceWarning, shouldShowGasWarningTransactionCostsLink } from "~~/components/shared/GasBalanceWarning";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { useWalletFunding } from "~~/components/shared/WalletFundingProvider";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { DurationInput } from "~~/components/ui/DurationInput";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { useTransactionStatusToast } from "~~/hooks/useTransactionStatusToast";
import { useWalletMessageSigner } from "~~/hooks/useWalletMessageSigner";
import { useWalletTransactionPlanExecutor } from "~~/hooks/useWalletTransactionPlanExecutor";
import {
  readBrowserSigningExpectedX402Amount,
  validateBrowserX402AuthorizationRequest,
} from "~~/lib/agent/browserSigningValidation";
import { buildCleanHandoffLocationPath, readHandoffTokenFromLocation } from "~~/lib/agent/handoffLocation";
import { createQuestionDetailsId, questionDetailsSha256Hex } from "~~/lib/attachments/browserQuestionDetails";
import {
  MAX_QUESTION_DETAILS_TEXT_LENGTH,
  getQuestionDetailsTextSizeBytes,
  normalizeQuestionDetailsText,
} from "~~/lib/attachments/questionDetails.shared";
import { formatHumanDuration } from "~~/lib/humanDuration";
import {
  type FeedbackBonusAsset,
  type SubmissionRewardAsset,
  formatFeedbackBonusAmount,
  formatSubmissionRewardAmount,
  getConfiguredX402QuestionSubmitterAddress,
  getDefaultLrepAddress,
  getDefaultUsdcAddress,
  getDefaultUsdcDisplayName,
  parseFeedbackBonusAmount,
  parseSubmissionRewardAmount,
} from "~~/lib/questionRewardPools";
import {
  DEFAULT_QUESTION_ROUND_CONFIG,
  DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS,
  QUESTION_ROUND_MAX_EPOCH_COUNT,
  type QuestionRoundConfigBounds,
  getQuestionRoundMaxDurationForEpoch,
  isQuestionRoundMaxDurationValidForEpoch,
} from "~~/lib/questionRoundConfig";
import { assertContentRegistryQuestionSubmissionSelector } from "~~/lib/questionSubmissionSelectorSupport";
import {
  type HandoffWebMcpQuestion,
  type HandoffWebMcpState,
  createHandoffWebMcpTools,
} from "~~/lib/webmcp/handoffTools";
import { registerWebMcpTools } from "~~/lib/webmcp/registerTools";
import { notification } from "~~/utils/scaffold-eth";

const ShareModal = dynamic(() => import("~~/components/submit/ShareModal").then(module => module.ShareModal), {
  ssr: false,
});

const RESERVED_SUBMISSION_REVEAL_WAIT_MS = 3_000;

type JsonRecord = Record<string, unknown>;

type HandoffAsset = {
  attachmentId?: string;
  dataUrl?: string;
  error?: string | null;
  filename?: string;
  id: string;
  imageUrl?: string | null;
  mimeType?: string;
  sha256?: string;
  sizeBytes?: number;
  status?: string;
};

type HandoffTransactionPlan = {
  calls?: Array<{
    data?: string;
    description?: string;
    functionName?: string;
    id?: string;
    phase?: string;
    to?: string;
    value?: string;
    waitAfterMs?: number;
  }>;
  requiresAtomicExecution?: boolean;
  requiresOrderedExecution?: boolean;
};

type Handoff = {
  assets?: HandoffAsset[];
  chainId: number | null;
  clientRequestId: string | null;
  draftRevision?: number;
  editedByUser?: boolean;
  error: string | null;
  expiresAt: string;
  id: string;
  operationKey: string | null;
  originalRequestBody?: JsonRecord;
  payloadHash: string | null;
  paymentMode: "wallet_calls" | "x402_authorization";
  preparedDraftRevision?: number | null;
  publicUrl?: string | null;
  requestBody?: JsonRecord;
  status: string;
  transactionHashes?: string[];
  transactionPlan?: HandoffTransactionPlan | null;
  updatedAt?: string;
  walletAddress: string | null;
  x402AuthorizationRequest?: JsonRecord | null;
};

type UploadChallenge = {
  assetId: string;
  attachmentId?: string;
  challengeId: string;
  expiresAt?: string;
  message: string;
};

type PrepareResponse = Handoff & {
  nextAction?: string;
  uploadChallenges?: UploadChallenge[];
};

type CompleteResponse = Handoff & {
  ask?: JsonRecord | null;
  nextAction?: string;
};

type ImageSignatureStep = {
  assetId: string;
  filename: string;
  status: "pending" | "signed";
};

type QuestionSummary = {
  categoryId: string;
  confidentiality: DraftConfidentiality;
  contextUrl: string;
  description: string;
  detailsHash: string;
  detailsUrl: string;
  imageUrls: string[];
  tags: string[];
  targetAudience: QuestionTargetAudienceDraft;
  templateId: string;
  title: string;
  videoUrl: string;
};

type RoundSettings = {
  epochDuration: bigint;
  maxDuration: bigint;
  maxVoters: bigint;
  minVoters: bigint;
};

type TargetAudienceDraftField = "ageGroups" | "countries" | "expertise" | "languages" | "nationalities" | "roles";
type QuestionTargetAudienceDraft = Record<TargetAudienceDraftField, string[]>;

type DraftQuestionForm = {
  categoryId: string;
  confidentiality: DraftConfidentiality;
  contextUrl: string;
  description: string;
  detailsHash: string;
  detailsUrl: string;
  imageUrls: string[];
  tags: string;
  targetAudience: QuestionTargetAudienceDraft;
  templateId: string;
  title: string;
  videoUrl: string;
};

type DraftForm = {
  bountyAmount: string;
  bountyAsset: SubmissionRewardAsset;
  feedbackBonusAmount: string | null;
  feedbackBonusAsset: FeedbackBonusAsset | null;
  questions: DraftQuestionForm[];
  roundBlindMinutes: string;
  roundMaxDurationMinutes: string;
  roundMaxVoters: string;
  roundMinVoters: string;
};

type SaveDraftOptions = {
  showSuccess?: boolean;
};

type SubmittedContentModalState = {
  description: string;
  id: bigint;
  lastActivityAt: string | null;
  title: string;
};

type ConfidentialityVisibility = "public" | "gated";
type ConfidentialityDisclosurePolicy = "after_settlement" | "private_forever";
const PRIVATE_FOREVER_DISCLOSURE_POLICY = "private_forever" satisfies ConfidentialityDisclosurePolicy;
type ConfidentialityBondAsset = "LREP" | "USDC";

type DraftConfidentiality = {
  bondAmount: string;
  bondAsset: ConfidentialityBondAsset;
  disclosurePolicy: ConfidentialityDisclosurePolicy;
  visibility: ConfidentialityVisibility;
};

const SECONDS_PER_MINUTE = 60;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as Hex;
const SINGLE_QUESTION_SUBMISSION_SELECTOR = "0x774922ea";
const BUNDLE_QUESTION_SUBMISSION_SELECTOR = "0x4bef7869";
const DEFAULT_ETH_TOP_UP_AMOUNT = "1";
const DEFAULT_USDC_TOP_UP_AMOUNT = "10";
const DEFAULT_FEEDBACK_BONUS_AMOUNT = "2";
const FUNDING_PRESET_OPTIONS: [number, number, number] = [5, 10, 20];

const BOUNTY_AMOUNT_TOOLTIP =
  "USDC amount funded from the connected wallet when the ask is submitted. Use up to 6 decimal places.";
const FEEDBACK_BONUS_AMOUNT_TOOLTIP =
  "Optional pool reserved for useful public feedback after settlement. Use up to 6 decimal places.";
const CONFIDENTIALITY_BOND_TOOLTIP =
  "Optional extra bond raters must post before private context is served. Use 0 for no extra bond.";
const CONFIDENTIALITY_BOND_AMOUNT_TOOLTIP =
  "LREP or USDC amount raters must post before private context is served. Use 0 for no bond, or at least 1.";
const REQUIRED_VOTERS_TOOLTIP =
  "Eligible revealed voters required before the bounty can qualify for payout and the round can settle.";
const MONEY_FIELD_LABEL_ROW_CLASS = "grid grid-cols-2 gap-3";
const MONEY_FIELD_CONTROL_ROW_CLASS = "mt-1.5 grid grid-cols-2 items-start gap-3";
const MONEY_FIELD_LABEL_CLASS = "label-text flex h-6 min-w-0 items-center gap-1.5 text-sm font-medium leading-none";
const MONEY_FIELD_CONTROL_CLASS = "h-12 w-full min-w-0";
const MIN_CONFIDENTIALITY_BOND_ATOMIC = 1_000_000n;
const DEFAULT_DRAFT_CONFIDENTIALITY: DraftConfidentiality = {
  bondAmount: "0",
  bondAsset: "LREP",
  disclosurePolicy: PRIVATE_FOREVER_DISCLOSURE_POLICY,
  visibility: "public",
};
const TARGET_AUDIENCE_TAXONOMY = getProfileSelfReportTaxonomy().targetAudience;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const TARGET_AUDIENCE_CHIP_GROUPS: Array<{
  field: Extract<TargetAudienceDraftField, "ageGroups" | "expertise" | "languages" | "roles">;
  label: string;
  options: readonly string[];
}> = [
  { field: "roles", label: "Roles", options: TARGET_AUDIENCE_TAXONOMY.roles },
  { field: "languages", label: "Languages", options: TARGET_AUDIENCE_TAXONOMY.languages },
  { field: "expertise", label: "Expertise", options: TARGET_AUDIENCE_TAXONOMY.expertise },
  { field: "ageGroups", label: "Age", options: TARGET_AUDIENCE_TAXONOMY.ageGroups },
];

type QuestionDetailsReference = {
  detailsHash: Hex;
  detailsUrl: string;
};

type UploadQuestionDetails = (
  text: string,
  options?: { requiresGatedAccess?: boolean },
) => Promise<QuestionDetailsReference>;

function DraftFieldLabel({ children, htmlFor, tooltip }: { children: ReactNode; htmlFor: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={htmlFor}
        className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45"
      >
        {children}
      </label>
      <InfoTooltip text={tooltip} position="top" className="text-base-content/45" />
    </div>
  );
}

function PrivateContextToggleControl({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-base-content">
          <LockClosedIcon className="h-4 w-4 shrink-0 text-warning" />
          <span>Private context</span>
          <Link href="/docs/how-it-works" className="link link-primary font-normal">
            More
          </Link>
          <InfoTooltip
            text="Use hosted private context for sensitive review material. Eligible raters must accept confidentiality terms before viewing; RateLoop's operator can serve the bytes, so this is deterrence and redaction rather than cryptographic secrecy."
            position="bottom"
          />
        </span>
        <input
          type="checkbox"
          aria-label="Private context"
          className="toggle toggle-warning"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
      </div>
    </div>
  );
}

function AudienceChipGroup({
  disabled,
  label,
  onToggle,
  options,
  selected,
}: {
  disabled?: boolean;
  label: string;
  onToggle: (value: string) => void;
  options: readonly string[];
  selected: readonly string[];
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-base-content/60">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(option => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(option)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isSelected ? "pill-active" : "pill-inactive"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              {formatAudienceOptionLabel(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AudienceCountryCodeInput({
  disabled,
  error,
  inputValue,
  label,
  onAdd,
  onInputChange,
  onRemove,
  selected,
}: {
  disabled?: boolean;
  error: string | null;
  inputValue: string;
  label: string;
  onAdd: () => void;
  onInputChange: (value: string) => void;
  onRemove: (value: string) => void;
  selected: readonly string[];
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-base-content/60">{label}</p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          placeholder="DE"
          value={inputValue}
          onChange={event => onInputChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          maxLength={2}
          disabled={disabled}
          className={`input input-bordered input-sm w-24 bg-base-100 uppercase ${error ? "input-error" : ""}`}
        />
        <button type="button" onClick={onAdd} disabled={disabled} className="btn btn-outline btn-sm">
          Add
        </button>
      </div>
      {error ? <p className="mt-1 text-sm text-error">{error}</p> : null}
      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map(value => (
            <button
              key={value}
              type="button"
              onClick={() => onRemove(value)}
              disabled={disabled}
              className={`pill-active flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ${
                disabled ? "cursor-not-allowed opacity-60" : ""
              }`}
            >
              {value}
              <span className="opacity-70">x</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AdvancedQuestionSettingsControl({
  contextUrl,
  disabled,
  hasImageContext,
  isPrivateContext,
  onContextUrlChange,
  onTargetAudienceChange,
  onVideoUrlChange,
  questionIndex,
  targetAudience,
  videoUrl,
}: {
  contextUrl: string;
  disabled?: boolean;
  hasImageContext: boolean;
  isPrivateContext: boolean;
  onContextUrlChange: (value: string) => void;
  onTargetAudienceChange: (value: QuestionTargetAudienceDraft) => void;
  onVideoUrlChange: (value: string) => void;
  questionIndex: number;
  targetAudience: QuestionTargetAudienceDraft;
  videoUrl: string;
}) {
  const selectedCount = countTargetAudienceValues(targetAudience);
  const canUseVideoUrl = !hasImageContext;
  const [isOpen, setIsOpen] = useState(() =>
    Boolean(selectedCount || contextUrl.trim() || (canUseVideoUrl && videoUrl.trim())),
  );
  const [countryInput, setCountryInput] = useState("");
  const [countryError, setCountryError] = useState<string | null>(null);
  const [nationalityInput, setNationalityInput] = useState("");
  const [nationalityError, setNationalityError] = useState<string | null>(null);
  const settingsId = `agent-ask-advanced-question-settings-${questionIndex}`;

  useEffect(() => {
    if (selectedCount > 0) setIsOpen(true);
  }, [selectedCount]);

  useEffect(() => {
    if (hasImageContext && videoUrl) onVideoUrlChange("");
  }, [hasImageContext, onVideoUrlChange, videoUrl]);

  const updateTargetAudienceDraft = (
    updater: (current: QuestionTargetAudienceDraft) => QuestionTargetAudienceDraft,
  ) => {
    onTargetAudienceChange(updater(cloneTargetAudienceDraft(targetAudience)));
  };

  const handleTargetAudienceToggle = (field: TargetAudienceDraftField, value: string) => {
    updateTargetAudienceDraft(current => {
      const selectedValues = current[field];
      const nextValues = selectedValues.includes(value)
        ? selectedValues.filter(item => item !== value)
        : [...selectedValues, value];
      return { ...current, [field]: nextValues };
    });
  };

  const handleTargetAudienceCodeAdd = (field: Extract<TargetAudienceDraftField, "countries" | "nationalities">) => {
    const rawValue = field === "countries" ? countryInput : nationalityInput;
    const normalized = normalizeAudienceCountryCodeInput(rawValue);
    if (!normalized) {
      const setError = field === "countries" ? setCountryError : setNationalityError;
      setError("Use a two-letter country code.");
      return;
    }

    updateTargetAudienceDraft(current => {
      if (current[field].includes(normalized)) return current;
      return { ...current, [field]: [...current[field], normalized] };
    });
    if (field === "countries") {
      setCountryInput("");
      setCountryError(null);
    } else {
      setNationalityInput("");
      setNationalityError(null);
    }
  };

  return (
    <div className="mt-4 border-t border-base-300 pt-4">
      <div className="surface-card-nested rounded-lg p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={settingsId}
              onClick={() => setIsOpen(current => !current)}
              className="inline-flex items-center gap-2 text-left text-base font-medium text-base-content transition-colors hover:text-base-content/80"
            >
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
              <span>
                Advanced question settings <span className="font-normal text-base-content/60">(optional)</span>
              </span>
            </button>
            <InfoTooltip text="Optional public context source and structured self-report criteria for targeted bounty eligibility." />
          </div>
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                onTargetAudienceChange(createEmptyTargetAudienceDraft());
                setCountryInput("");
                setCountryError(null);
                setNationalityInput("");
                setNationalityError(null);
              }}
              disabled={disabled}
              className="btn btn-ghost btn-sm"
            >
              Clear
            </button>
          ) : null}
        </div>

        {isOpen ? (
          <div id={settingsId} className="mt-4 space-y-4">
            <label className="form-control">
              <span className="label-text flex items-center gap-1.5 text-sm font-medium text-base-content">
                Context Source <span className="font-normal text-base-content/60">(optional with media)</span>
                <InfoTooltip text="Use a public website as the source voters should judge." />
              </span>
              <input
                className="input input-bordered mt-1 w-full bg-base-100"
                disabled={disabled || isPrivateContext}
                placeholder={
                  isPrivateContext
                    ? "Private context uses hosted images/details only"
                    : "Paste a source link, or add media context below"
                }
                type="url"
                value={contextUrl}
                onChange={event => onContextUrlChange(event.target.value)}
              />
            </label>

            {canUseVideoUrl ? (
              <label className="form-control">
                <span className="label-text text-sm font-medium text-base-content">
                  Video URL <span className="font-normal text-base-content/60">(optional)</span>
                </span>
                <input
                  className="input input-bordered mt-1 w-full bg-base-100"
                  disabled={disabled || isPrivateContext}
                  placeholder={isPrivateContext ? "Disabled for private context" : "Paste a YouTube URL"}
                  type="url"
                  value={videoUrl}
                  onChange={event => onVideoUrlChange(event.target.value)}
                />
              </label>
            ) : null}

            {TARGET_AUDIENCE_CHIP_GROUPS.map(group => (
              <AudienceChipGroup
                key={group.field}
                disabled={disabled}
                label={group.label}
                options={group.options}
                selected={targetAudience[group.field]}
                onToggle={value => handleTargetAudienceToggle(group.field, value)}
              />
            ))}

            <div className="grid gap-4 sm:grid-cols-2">
              <AudienceCountryCodeInput
                disabled={disabled}
                label="Residence country"
                inputValue={countryInput}
                error={countryError}
                selected={targetAudience.countries}
                onInputChange={value => {
                  setCountryInput(value.toUpperCase());
                  setCountryError(null);
                }}
                onAdd={() => handleTargetAudienceCodeAdd("countries")}
                onRemove={value => handleTargetAudienceToggle("countries", value)}
              />
              <AudienceCountryCodeInput
                disabled={disabled}
                label="Nationality"
                inputValue={nationalityInput}
                error={nationalityError}
                selected={targetAudience.nationalities}
                onInputChange={value => {
                  setNationalityInput(value.toUpperCase());
                  setNationalityError(null);
                }}
                onAdd={() => handleTargetAudienceCodeAdd("nationalities")}
                onRemove={value => handleTargetAudienceToggle("nationalities", value)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function sameAddress(left: string | undefined | null, right: string | undefined | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function shortAddress(value: string | null | undefined) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not set";
}

function getPostCallDelayMs(call: NonNullable<HandoffTransactionPlan["calls"]>[number]) {
  const waitAfterMs = Number.isFinite(call.waitAfterMs) ? Math.max(0, call.waitAfterMs ?? 0) : 0;
  const isReserveSubmission =
    call.functionName === "reserveSubmission" ||
    call.phase === "reserve_submission" ||
    call.id === "reserve-submission";

  return isReserveSubmission ? Math.max(waitAfterMs, RESERVED_SUBMISSION_REVEAL_WAIT_MS) : waitAfterMs;
}

function readToken() {
  return typeof window === "undefined" ? "" : readHandoffTokenFromLocation(window.location);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readDisplayValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  return "";
}

function readPositiveBigInt(value: unknown) {
  const rawValue =
    typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? String(value).trim() : "";
  if (!/^\d+$/.test(rawValue)) return null;
  const parsed = BigInt(rawValue);
  return parsed > 0n ? parsed : null;
}

function readSubmittedContentId(source: JsonRecord | null) {
  if (!source) return null;
  const directContentId = readPositiveBigInt(source.contentId);
  if (directContentId !== null) return directContentId;

  const contentIds = source.contentIds;
  if (!Array.isArray(contentIds)) return null;
  for (const contentId of contentIds) {
    const parsedContentId = readPositiveBigInt(contentId);
    if (parsedContentId !== null) return parsedContentId;
  }
  return null;
}

function readFirstPositiveBigInt(source: JsonRecord | null, keys: string[], fallback: bigint) {
  if (!source) return fallback;
  for (const key of keys) {
    const parsed = readPositiveBigInt(source[key]);
    if (parsed !== null) return parsed;
  }
  return fallback;
}

function readQuestionRecords(handoff: Handoff | null): JsonRecord[] {
  const requestBody = handoff?.requestBody;
  if (!requestBody) return [];
  if (isJsonRecord(requestBody.question)) return [requestBody.question];
  if (Array.isArray(requestBody.questions)) return requestBody.questions.filter(isJsonRecord);
  return readString(requestBody.title) ? [requestBody] : [];
}

function readQuestionTags(value: unknown) {
  const tags = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return tags.map(tag => readString(tag)).filter(Boolean);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(entry => readString(entry)).filter(Boolean) : [];
}

function createEmptyTargetAudienceDraft(): QuestionTargetAudienceDraft {
  return {
    ageGroups: [],
    countries: [],
    expertise: [],
    languages: [],
    nationalities: [],
    roles: [],
  };
}

function cloneTargetAudienceDraft(draft: QuestionTargetAudienceDraft): QuestionTargetAudienceDraft {
  return {
    ageGroups: [...draft.ageGroups],
    countries: [...draft.countries],
    expertise: [...draft.expertise],
    languages: [...draft.languages],
    nationalities: [...draft.nationalities],
    roles: [...draft.roles],
  };
}

function targetAudienceDraftToMetadata(draft: QuestionTargetAudienceDraft): TargetAudience | null {
  return normalizeTargetAudience({
    ageGroups: draft.ageGroups,
    countries: draft.countries,
    expertise: draft.expertise,
    languages: draft.languages,
    nationalities: draft.nationalities,
    roles: draft.roles,
  });
}

function readTargetAudienceDraft(value: unknown): QuestionTargetAudienceDraft {
  let targetAudience: TargetAudience | null = null;
  try {
    targetAudience = normalizeTargetAudience(value);
  } catch {
    targetAudience = null;
  }

  return {
    ageGroups: [...(targetAudience?.ageGroups ?? [])],
    countries: [...(targetAudience?.countries ?? [])],
    expertise: [...(targetAudience?.expertise ?? [])],
    languages: [...(targetAudience?.languages ?? [])],
    nationalities: [...(targetAudience?.nationalities ?? [])],
    roles: [...(targetAudience?.roles ?? [])],
  };
}

function countTargetAudienceValues(draft: QuestionTargetAudienceDraft) {
  return Object.values(draft).reduce((total, values) => total + values.length, 0);
}

function formatAudienceOptionLabel(value: string) {
  if (/^[a-z]{2,3}$/i.test(value)) return value.toUpperCase();
  return value
    .split("-")
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeAudienceCountryCodeInput(value: string) {
  const normalized = value.trim().toUpperCase();
  return COUNTRY_CODE_PATTERN.test(normalized) ? normalized : null;
}

function cloneDraftConfidentiality(value: DraftConfidentiality): DraftConfidentiality {
  return { ...value, disclosurePolicy: PRIVATE_FOREVER_DISCLOSURE_POLICY };
}

function readConfidentialityVisibility(value: unknown, fallback: ConfidentialityVisibility) {
  const visibility = readString(value);
  return visibility === "gated" || visibility === "public" ? visibility : fallback;
}

function readConfidentialityBondAsset(value: unknown, fallback: ConfidentialityBondAsset) {
  const asset = readString(value).toUpperCase();
  return asset === "USDC" || asset === "LREP" ? asset : fallback;
}

function formatConfidentialityBondInputFromAtomic(value: bigint, asset: ConfidentialityBondAsset) {
  return formatSubmissionRewardAmount(value, asset === "LREP" ? "lrep" : "usdc").replace(
    asset === "LREP" ? / LREP$/ : / USDC$/,
    "",
  );
}

function readConfidentialityBondAmountInput(value: unknown, fallback: string, asset: ConfidentialityBondAsset) {
  const amount = readDisplayValue(value);
  if (!/^\d+$/.test(amount)) return fallback;

  return formatConfidentialityBondInputFromAtomic(BigInt(amount), asset);
}

function isZeroTokenAmountInput(value: string) {
  return /^0+(?:\.0{0,6})?$/.test(value.trim().replace(/,/g, ""));
}

function parseConfidentialityBondAmountInput(value: string, asset: ConfidentialityBondAsset) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Confidentiality bond must be 0 or a token amount with up to 6 decimals.");
  }
  if (isZeroTokenAmountInput(trimmed)) {
    return "0";
  }

  const parsed = parseSubmissionRewardAmount(trimmed);
  if (parsed === null) {
    throw new Error("Confidentiality bond must be 0 or a token amount with up to 6 decimals.");
  }
  if (parsed < MIN_CONFIDENTIALITY_BOND_ATOMIC) {
    throw new Error(`Confidentiality bond must be 0 or at least 1 ${asset}.`);
  }

  return parsed.toString();
}

function formatConfidentialityBondAmountInput(value: string, asset: ConfidentialityBondAsset) {
  const trimmed = value.trim();
  if (!trimmed || isZeroTokenAmountInput(trimmed)) return "0";
  const parsed = parseSubmissionRewardAmount(trimmed);
  return parsed === null ? value : formatConfidentialityBondInputFromAtomic(parsed, asset);
}

function readDraftConfidentiality(
  value: unknown,
  inherited: DraftConfidentiality = DEFAULT_DRAFT_CONFIDENTIALITY,
): DraftConfidentiality {
  const source = isJsonRecord(value) ? value : null;
  if (!source) return cloneDraftConfidentiality(inherited);

  const bond = isJsonRecord(source.bond) ? source.bond : null;
  const bondAsset = readConfidentialityBondAsset(bond?.asset ?? source.bondAsset, inherited.bondAsset);
  return {
    bondAmount: readConfidentialityBondAmountInput(bond?.amount ?? source.bondAmount, inherited.bondAmount, bondAsset),
    bondAsset,
    disclosurePolicy: PRIVATE_FOREVER_DISCLOSURE_POLICY,
    visibility: readConfidentialityVisibility(source.visibility, inherited.visibility),
  };
}

function buildDraftConfidentialityInput(confidentiality: DraftConfidentiality): JsonRecord {
  if (confidentiality.visibility !== "gated") {
    return { visibility: "public" };
  }

  return {
    bond: {
      amount: parseConfidentialityBondAmountInput(confidentiality.bondAmount, confidentiality.bondAsset),
      asset: confidentiality.bondAsset,
    },
    disclosurePolicy: PRIVATE_FOREVER_DISCLOSURE_POLICY,
    visibility: "gated",
  };
}

function draftQuestionHasHostedDetails(question: Pick<DraftQuestionForm, "description" | "detailsUrl">) {
  return Boolean(question.description.trim() || question.detailsUrl.trim());
}

function readQuestionDetailsReference(source: JsonRecord | null | undefined): QuestionDetailsReference | null {
  if (!source) return null;
  const detailsUrl = readString(source.detailsUrl);
  const detailsHash = readString(source.detailsHash);
  if (!detailsUrl || !/^0x[a-fA-F0-9]{64}$/.test(detailsHash) || detailsHash.toLowerCase() === EMPTY_DETAILS_HASH) {
    return null;
  }

  return {
    detailsHash: detailsHash as Hex,
    detailsUrl,
  };
}

function readNormalizedDraftDescription(value: string) {
  return value.trim() ? normalizeQuestionDetailsText(value) : "";
}

function draftQuestionNeedsDetailsUpload(baseQuestion: JsonRecord | undefined, draft: DraftQuestionForm) {
  const description = draft.description.trim();
  if (!description) return false;

  const baseDescription = readString(baseQuestion?.description);
  return description !== baseDescription.trim() || !readQuestionDetailsReference(baseQuestion);
}

function draftNeedsQuestionDetailsUpload(handoff: Handoff | null, draftForm: DraftForm | null) {
  if (!handoff || !draftForm) return false;

  const baseQuestions = readQuestionRecords(handoff);
  return draftForm.questions.some((question, index) =>
    draftQuestionNeedsDetailsUpload(baseQuestions[index] ?? baseQuestions[0], question),
  );
}

async function uploadQuestionDetailsForHandoff(params: {
  requiresGatedAccess?: boolean;
  signMessageAsync: (input: { message: string }) => Promise<Hex>;
  submitterAddress: Address;
  text: string;
}): Promise<QuestionDetailsReference> {
  const normalizedText = normalizeQuestionDetailsText(params.text);
  const detailsId = createQuestionDetailsId();
  const sha256 = await questionDetailsSha256Hex({
    detailsId,
    normalizedText,
    requiresGatedAccess: params.requiresGatedAccess === true,
  });
  const sizeBytes = getQuestionDetailsTextSizeBytes(normalizedText);
  const challengeResponse = await fetch("/api/attachments/details/challenge", {
    body: JSON.stringify({
      address: params.submitterAddress,
      detailsId,
      requiresGatedAccess: params.requiresGatedAccess === true,
      sha256,
      sizeBytes,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const challenge = (await challengeResponse.json().catch(() => null)) as {
    challengeId?: string;
    error?: string;
    message?: string;
  } | null;
  if (!challengeResponse.ok || !challenge?.challengeId || !challenge.message) {
    throw new Error(challenge?.error || "Could not prepare description upload.");
  }

  const signature = await params.signMessageAsync({ message: challenge.message });
  const uploadResponse = await fetch("/api/attachments/details/upload", {
    body: JSON.stringify({
      address: params.submitterAddress,
      challengeId: challenge.challengeId,
      detailsId,
      requiresGatedAccess: params.requiresGatedAccess === true,
      sha256,
      signature,
      sizeBytes,
      text: normalizedText,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const upload = (await uploadResponse.json().catch(() => null)) as {
    detailsHash?: string | null;
    detailsUrl?: string | null;
    error?: string;
  } | null;
  if (
    !uploadResponse.ok ||
    !upload?.detailsUrl ||
    !upload.detailsHash ||
    !/^0x[a-fA-F0-9]{64}$/.test(upload.detailsHash)
  ) {
    throw new Error(upload?.error || "Could not upload description.");
  }

  return {
    detailsHash: upload.detailsHash as Hex,
    detailsUrl: upload.detailsUrl,
  };
}

function readQuestionSummaries(handoff: Handoff | null): QuestionSummary[] {
  const topLevelConfidentiality = readDraftConfidentiality(handoff?.requestBody?.confidentiality);
  return readQuestionRecords(handoff).map((question, index) => ({
    categoryId: readDisplayValue(question.categoryId),
    confidentiality: readDraftConfidentiality(question.confidentiality, topLevelConfidentiality),
    contextUrl: readString(question.contextUrl),
    description: readString(question.description),
    detailsHash: readString(question.detailsHash),
    detailsUrl: readString(question.detailsUrl),
    imageUrls: readStringArray(question.imageUrls),
    tags: readQuestionTags(question.tags),
    targetAudience: readTargetAudienceDraft(question.targetAudience),
    templateId: readString(question.templateId),
    title: readString(question.title) || `Question ${index + 1}`,
    videoUrl: readString(question.videoUrl),
  }));
}

function readBountyAmountAtomic(handoff: Handoff | null) {
  const bounty = handoff?.requestBody?.bounty;
  if (!isJsonRecord(bounty)) return null;
  const amount = bounty.amount;
  if (typeof amount !== "string" && typeof amount !== "number" && typeof amount !== "bigint") return null;
  try {
    const atomic = BigInt(amount);
    return atomic > 0n ? atomic : null;
  } catch {
    return null;
  }
}

function readBountyRequiredVoters(handoff: Handoff | null) {
  const bounty = handoff?.requestBody?.bounty;
  if (!isJsonRecord(bounty)) return null;
  return readPositiveBigInt(bounty.requiredVoters);
}

function readBountyAsset(handoff: Handoff | null): SubmissionRewardAsset {
  const bounty = handoff?.requestBody?.bounty;
  if (!isJsonRecord(bounty)) return "usdc";
  return readString(bounty.asset).toUpperCase() === "LREP" ? "lrep" : "usdc";
}

function readFeedbackBonusAsset(feedbackBonus: JsonRecord): FeedbackBonusAsset {
  return readString(feedbackBonus.asset).toUpperCase() === "LREP" ? "lrep" : "usdc";
}

function readFeedbackBonusSummary(handoff: Handoff | null) {
  const feedbackBonus = handoff?.requestBody?.feedbackBonus;
  if (!isJsonRecord(feedbackBonus)) return null;
  const amount = readPositiveBigInt(feedbackBonus.amount);
  if (amount === null) return null;
  const asset = readFeedbackBonusAsset(feedbackBonus);
  return {
    amount,
    asset,
    label: formatFeedbackBonusAmount(amount, asset),
  };
}

function formatSubmissionRewardInput(value: bigint | null, asset: SubmissionRewardAsset) {
  if (value === null) return "";
  return formatSubmissionRewardAmount(value, asset).replace(asset === "lrep" ? / LREP$/ : / USDC$/, "");
}

function formatFeedbackBonusInput(value: bigint | null, asset: FeedbackBonusAsset) {
  if (value === null) return "";
  return formatFeedbackBonusAmount(value, asset).replace(asset === "lrep" ? / LREP$/ : / USDC$/, "");
}

function readRoundSettings(handoff: Handoff | null): RoundSettings {
  const requestBody = handoff?.requestBody ?? null;
  const firstQuestion = readQuestionRecords(handoff)[0];
  const source = isJsonRecord(requestBody?.roundConfig)
    ? requestBody.roundConfig
    : isJsonRecord(firstQuestion?.roundConfig)
      ? firstQuestion.roundConfig
      : null;
  const requiredVoters = readBountyRequiredVoters(handoff);
  const minVoters =
    requiredVoters ?? readFirstPositiveBigInt(source, ["minVoters"], DEFAULT_QUESTION_ROUND_CONFIG.minVoters);
  const maxVoters = readFirstPositiveBigInt(source, ["maxVoters"], DEFAULT_QUESTION_ROUND_CONFIG.maxVoters);

  return {
    epochDuration: readFirstPositiveBigInt(
      source,
      ["epochDuration", "blindPhaseSeconds", "blindSeconds"],
      DEFAULT_QUESTION_ROUND_CONFIG.epochDuration,
    ),
    maxDuration: readFirstPositiveBigInt(
      source,
      ["maxDuration", "maxDurationSeconds", "deadlineSeconds"],
      DEFAULT_QUESTION_ROUND_CONFIG.maxDuration,
    ),
    maxVoters: maxVoters < minVoters ? minVoters : maxVoters,
    minVoters,
  };
}

function readQuestionTitle(handoff: Handoff | null) {
  const questions = readQuestionRecords(handoff);
  if (questions.length === 1) return readString(questions[0].title) || "RateLoop ask";
  if (questions.length > 1) return `${questions.length} question bundle`;
  return "RateLoop ask";
}

function readDraftTitle(form: DraftForm | null, handoff: Handoff | null) {
  if (!form) return readQuestionTitle(handoff);
  if (form.questions.length === 1) return form.questions[0]?.title.trim() || readQuestionTitle(handoff);
  if (form.questions.length > 1) return `${form.questions.length} question bundle`;
  return readQuestionTitle(handoff);
}

function secondsToMinutesInput(value: bigint) {
  const rounded = (value + 30n) / 60n;
  return rounded > 0n ? rounded.toString() : "1";
}

function createDraftForm(handoff: Handoff): DraftForm {
  const roundSettings = readRoundSettings(handoff);
  const questions = readQuestionSummaries(handoff);
  const feedbackBonusSummary = readFeedbackBonusSummary(handoff);
  const bountyAsset = readBountyAsset(handoff);
  return {
    bountyAmount: formatSubmissionRewardInput(readBountyAmountAtomic(handoff), bountyAsset),
    bountyAsset,
    feedbackBonusAmount: feedbackBonusSummary
      ? formatFeedbackBonusInput(feedbackBonusSummary.amount, feedbackBonusSummary.asset)
      : null,
    feedbackBonusAsset: feedbackBonusSummary?.asset ?? null,
    questions: questions.length
      ? questions.map(question => ({
          categoryId: question.categoryId,
          confidentiality: question.confidentiality,
          contextUrl: question.confidentiality.visibility === "gated" ? "" : question.contextUrl,
          description: question.description,
          detailsHash: question.detailsHash,
          detailsUrl: question.detailsUrl,
          imageUrls: question.imageUrls,
          tags: question.tags.join(", "),
          targetAudience: cloneTargetAudienceDraft(question.targetAudience),
          templateId: question.templateId,
          title: question.title,
          videoUrl: question.confidentiality.visibility === "gated" ? "" : question.videoUrl,
        }))
      : [
          {
            categoryId: "",
            confidentiality: readDraftConfidentiality(handoff.requestBody?.confidentiality),
            contextUrl: "",
            description: "",
            detailsHash: EMPTY_DETAILS_HASH,
            detailsUrl: "",
            imageUrls: [],
            tags: "",
            targetAudience: createEmptyTargetAudienceDraft(),
            templateId: "",
            title: readQuestionTitle(handoff),
            videoUrl: "",
          },
        ],
    roundBlindMinutes: secondsToMinutesInput(roundSettings.epochDuration),
    roundMaxDurationMinutes: secondsToMinutesInput(roundSettings.maxDuration),
    roundMaxVoters: roundSettings.maxVoters.toString(),
    roundMinVoters: roundSettings.minVoters.toString(),
  };
}

function parsePositiveInteger(value: string, fieldName: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${fieldName} must be a positive whole number.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive whole number.`);
  }
  return parsed;
}

function normalizeWholeNumberInput(value: string): string | null {
  if (value === "" || /^\d+$/.test(value)) {
    return value;
  }

  return null;
}

function normalizeUsdcAmountInput(value: string): string | null {
  if (value === "" || /^[\d,]*(?:\.\d{0,6})?$/.test(value)) {
    return value;
  }

  return null;
}

function parseWholeNumberInput(value: string): number {
  const normalized = normalizeWholeNumberInput(value);
  if (normalized === null || normalized === "") {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function clampWholeNumberInput(value: string, min: number, max: number): string {
  const parsed = parseWholeNumberInput(value);
  return String(Math.min(Math.max(parsed, min), max));
}

function readRoundConfigBounds(value: unknown): QuestionRoundConfigBounds {
  const source = value as any;
  return {
    minEpochDuration: Number(
      source?.minEpochDuration ?? source?.[0] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minEpochDuration,
    ),
    maxEpochDuration: Number(
      source?.maxEpochDuration ?? source?.[1] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxEpochDuration,
    ),
    minRoundDuration: Number(
      source?.minRoundDuration ?? source?.[2] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minRoundDuration,
    ),
    maxRoundDuration: Number(
      source?.maxRoundDuration ?? source?.[3] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxRoundDuration,
    ),
    minSettlementVoters: Number(
      source?.minSettlementVoters ?? source?.[4] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minSettlementVoters,
    ),
    maxSettlementVoters: Number(
      source?.maxSettlementVoters ?? source?.[5] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxSettlementVoters,
    ),
    minVoterCap: Number(source?.minVoterCap ?? source?.[6] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minVoterCap),
    maxVoterCap: Number(source?.maxVoterCap ?? source?.[7] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxVoterCap),
  };
}

function getRoundBlindMinuteBounds(bounds: QuestionRoundConfigBounds) {
  const min = Math.ceil(bounds.minEpochDuration / SECONDS_PER_MINUTE);
  const max = Math.max(min, Math.floor(bounds.maxEpochDuration / SECONDS_PER_MINUTE));
  return { min, max };
}

function getRoundMaxDurationMinuteBoundsForBlind(blindMinutes: number, bounds: QuestionRoundConfigBounds) {
  const blindSeconds = Math.max(1, Math.floor(blindMinutes)) * SECONDS_PER_MINUTE;
  const maxDurationSeconds = getQuestionRoundMaxDurationForEpoch(blindSeconds, bounds.maxRoundDuration);
  const minSeconds = Math.max(bounds.minRoundDuration, blindSeconds);
  const min = Math.ceil(minSeconds / SECONDS_PER_MINUTE);
  const max = Math.max(min, Math.floor(maxDurationSeconds / SECONDS_PER_MINUTE));
  return { min, max };
}

function getEffectiveBlindMinutes(value: string, bounds: QuestionRoundConfigBounds): number {
  const blindMinuteBounds = getRoundBlindMinuteBounds(bounds);
  const parsed = parseWholeNumberInput(value);
  return parsed >= blindMinuteBounds.min && parsed <= blindMinuteBounds.max ? parsed : blindMinuteBounds.min;
}

function getBlindMinutesTooltip(bounds: QuestionRoundConfigBounds): string {
  return `Private response window before reveal/open voting. Must be ${formatHumanDuration(
    bounds.minEpochDuration,
  )}-${formatHumanDuration(bounds.maxEpochDuration)}.`;
}

function getMaxMinutesTooltip(bounds: QuestionRoundConfigBounds): string {
  return `Total round duration. It must be at least the blind window, no more than ${formatHumanDuration(
    bounds.maxRoundDuration,
  )}, and can span at most ${QUESTION_ROUND_MAX_EPOCH_COUNT.toLocaleString()} blind phases.`;
}

function getMinVotersTooltip(bounds: QuestionRoundConfigBounds): string {
  return `${REQUIRED_VOTERS_TOOLTIP} Must be ${bounds.minSettlementVoters}-${bounds.maxSettlementVoters}.`;
}

function getMaxVotersTooltip(bounds: QuestionRoundConfigBounds): string {
  return `Per-round voter cap. Must be ${bounds.minVoterCap}-${bounds.maxVoterCap} and cannot be below min voters.`;
}

function parseRoundSecondsFromMinutes(value: string, fieldName: string) {
  return BigInt(parsePositiveInteger(value, fieldName)) * BigInt(SECONDS_PER_MINUTE);
}

function parseTagsInput(value: string) {
  return value
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}

async function applyDraftQuestion(
  baseQuestion: JsonRecord,
  draft: DraftQuestionForm,
  index: number,
  uploadQuestionDetails: UploadQuestionDetails,
  options: { hasHandoffImageContext?: boolean } = {},
): Promise<JsonRecord> {
  const title = draft.title.trim();
  const categoryId = draft.categoryId.trim();
  const tags = parseTagsInput(draft.tags);
  if (!title) throw new Error(`Question ${index + 1} needs a title.`);
  if (!categoryId) throw new Error(`Question ${index + 1} needs a category.`);
  if (tags.length === 0 || tags.length > 3) {
    throw new Error(`Question ${index + 1} needs one to three categories.`);
  }

  const nextQuestion: JsonRecord = {
    ...baseQuestion,
    categoryId,
    confidentiality: buildDraftConfidentialityInput(draft.confidentiality),
    tags,
    title,
  };
  const contextUrl = draft.contextUrl.trim();
  const videoUrl = draft.videoUrl.trim();
  const templateId = draft.templateId.trim();
  const hasImageContext =
    draft.imageUrls.length > 0 ||
    readStringArray(baseQuestion.imageUrls).length > 0 ||
    Boolean(options.hasHandoffImageContext);
  if (draft.confidentiality.visibility === "gated") {
    delete nextQuestion.contextUrl;
    delete nextQuestion.videoUrl;
  } else {
    if (contextUrl) {
      nextQuestion.contextUrl = contextUrl;
    } else {
      delete nextQuestion.contextUrl;
    }
    if (videoUrl && !hasImageContext) {
      nextQuestion.videoUrl = videoUrl;
    } else {
      delete nextQuestion.videoUrl;
    }
  }
  if (templateId) {
    nextQuestion.templateId = templateId;
  } else {
    delete nextQuestion.templateId;
  }
  const targetAudience = targetAudienceDraftToMetadata(draft.targetAudience);
  if (targetAudience) {
    nextQuestion.targetAudience = targetAudience;
  } else {
    delete nextQuestion.targetAudience;
  }

  const description = readNormalizedDraftDescription(draft.description);
  const baseDescription = readNormalizedDraftDescription(readString(baseQuestion.description));
  if (description) {
    nextQuestion.description = description;
    const currentDetails = readQuestionDetailsReference(baseQuestion);
    if (description === baseDescription && currentDetails) {
      nextQuestion.detailsHash = currentDetails.detailsHash;
      nextQuestion.detailsUrl = currentDetails.detailsUrl;
    } else {
      const uploadedDetails = await uploadQuestionDetails(description, {
        requiresGatedAccess: draft.confidentiality.visibility === "gated",
      });
      nextQuestion.detailsHash = uploadedDetails.detailsHash;
      nextQuestion.detailsUrl = uploadedDetails.detailsUrl;
    }
  } else {
    delete nextQuestion.description;
    if (baseDescription) {
      delete nextQuestion.detailsHash;
      delete nextQuestion.detailsUrl;
    }
  }
  if (draft.confidentiality.visibility === "gated") {
    const hasHostedDetails = Boolean(readQuestionDetailsReference(nextQuestion));
    if (!hasHostedDetails) {
      throw new Error(`Question ${index + 1} needs a hosted description for private context.`);
    }
  }
  return nextQuestion;
}

async function buildDraftRequestBody(
  handoff: Handoff,
  form: DraftForm,
  roundConfigBounds: QuestionRoundConfigBounds,
  uploadQuestionDetails: UploadQuestionDetails,
): Promise<JsonRecord> {
  const requestBody = structuredClone(handoff.requestBody ?? {}) as JsonRecord;
  const bountyAmount = parseSubmissionRewardAmount(form.bountyAmount);
  if (bountyAmount === null) {
    throw new Error("Bounty must be a positive USDC amount with up to 6 decimals.");
  }

  const blindSeconds = parseRoundSecondsFromMinutes(form.roundBlindMinutes, "Blind phase");
  const maxDurationSeconds = parseRoundSecondsFromMinutes(form.roundMaxDurationMinutes, "Max duration");
  const minVoters = parsePositiveInteger(form.roundMinVoters, "Min voters");
  const maxVoters = parsePositiveInteger(form.roundMaxVoters, "Max voters");
  if (maxDurationSeconds < blindSeconds) {
    throw new Error("Max duration must be at least the blind phase.");
  }
  if (minVoters > maxVoters) {
    throw new Error("Min voters cannot be greater than max voters.");
  }
  if (
    Number(blindSeconds) < roundConfigBounds.minEpochDuration ||
    Number(blindSeconds) > roundConfigBounds.maxEpochDuration
  ) {
    throw new Error(
      `Blind phase must be ${formatHumanDuration(roundConfigBounds.minEpochDuration)}-${formatHumanDuration(
        roundConfigBounds.maxEpochDuration,
      )}.`,
    );
  }
  if (
    Number(maxDurationSeconds) < roundConfigBounds.minRoundDuration ||
    Number(maxDurationSeconds) > roundConfigBounds.maxRoundDuration
  ) {
    throw new Error(
      `Max duration must be ${formatHumanDuration(
        roundConfigBounds.minRoundDuration,
      )}-${formatHumanDuration(roundConfigBounds.maxRoundDuration)}.`,
    );
  }
  if (!isQuestionRoundMaxDurationValidForEpoch(Number(blindSeconds), Number(maxDurationSeconds))) {
    throw new Error("Max duration spans too many blind phases.");
  }
  if (minVoters < roundConfigBounds.minSettlementVoters || minVoters > roundConfigBounds.maxSettlementVoters) {
    throw new Error(
      `Min voters must be ${roundConfigBounds.minSettlementVoters}-${roundConfigBounds.maxSettlementVoters}.`,
    );
  }
  if (maxVoters < roundConfigBounds.minVoterCap || maxVoters > roundConfigBounds.maxVoterCap) {
    throw new Error(`Max voters must be ${roundConfigBounds.minVoterCap}-${roundConfigBounds.maxVoterCap}.`);
  }

  requestBody.bounty = {
    ...(isJsonRecord(requestBody.bounty) ? requestBody.bounty : {}),
    amount: bountyAmount.toString(),
    asset: form.bountyAsset === "lrep" ? "LREP" : "USDC",
    requiredVoters: minVoters.toString(),
  };
  let feedbackBonusPaymentAmount = 0n;
  if (form.feedbackBonusAmount !== null) {
    const feedbackBonusAmount = parseFeedbackBonusAmount(form.feedbackBonusAmount);
    if (feedbackBonusAmount === null) {
      throw new Error("Feedback Bonus must be a positive amount with up to 6 decimals.");
    }
    const feedbackBonusAsset =
      form.feedbackBonusAsset ??
      (isJsonRecord(requestBody.feedbackBonus) ? readFeedbackBonusAsset(requestBody.feedbackBonus) : "usdc");
    requestBody.feedbackBonus = {
      ...(isJsonRecord(requestBody.feedbackBonus) ? requestBody.feedbackBonus : {}),
      amount: feedbackBonusAmount.toString(),
      asset: feedbackBonusAsset === "lrep" ? "LREP" : "USDC",
    };
    feedbackBonusPaymentAmount = feedbackBonusAmount;
  } else {
    delete requestBody.feedbackBonus;
  }
  requestBody.maxPaymentAmount = (bountyAmount + feedbackBonusPaymentAmount).toString();
  requestBody.roundConfig = {
    epochDuration: blindSeconds.toString(),
    maxDuration: maxDurationSeconds.toString(),
    maxVoters: maxVoters.toString(),
    minVoters: minVoters.toString(),
  };

  if (Array.isArray(requestBody.questions)) {
    const nextQuestions = [];
    for (const [index, question] of requestBody.questions.entries()) {
      nextQuestions.push(
        await applyDraftQuestion(
          isJsonRecord(question) ? question : {},
          form.questions[index] ?? form.questions[0],
          index,
          uploadQuestionDetails,
          { hasHandoffImageContext: Boolean(handoff.assets?.length) },
        ),
      );
    }
    requestBody.questions = nextQuestions;
    return requestBody;
  }

  if (isJsonRecord(requestBody.question)) {
    requestBody.question = await applyDraftQuestion(requestBody.question, form.questions[0], 0, uploadQuestionDetails, {
      hasHandoffImageContext: Boolean(handoff.assets?.length),
    });
    return requestBody;
  }

  return {
    ...requestBody,
    ...(await applyDraftQuestion(requestBody, form.questions[0], 0, uploadQuestionDetails, {
      hasHandoffImageContext: Boolean(handoff.assets?.length),
    })),
  };
}

function getDraftConfidentialityBondError(form: DraftForm | null) {
  if (!form) return null;

  for (const question of form.questions) {
    if (question.confidentiality.visibility !== "gated") continue;
    try {
      parseConfidentialityBondAmountInput(question.confidentiality.bondAmount, question.confidentiality.bondAsset);
    } catch (error) {
      return error instanceof Error ? error.message : "Confidentiality bond is invalid.";
    }
  }

  return null;
}

function readSubmittedContentForShare(handoff: Handoff | null, ask: unknown): SubmittedContentModalState | null {
  const contentId = readSubmittedContentId(isJsonRecord(ask) ? ask : null);
  if (contentId === null) return null;

  const questions = readQuestionSummaries(handoff);
  const primaryQuestion = questions[0];
  return {
    description:
      questions.length > 1
        ? `${questions.length} question bundle. Answer all questions to qualify for the bounty.`
        : primaryQuestion?.description || "",
    id: contentId,
    lastActivityAt: new Date().toISOString(),
    title: primaryQuestion?.title || readQuestionTitle(handoff),
  };
}

function readBounty(handoff: Handoff | null) {
  const amount = readBountyAmountAtomic(handoff);
  return amount === null ? "Unknown bounty" : formatSubmissionRewardAmount(amount, readBountyAsset(handoff));
}

function readDraftBountyLabel(form: DraftForm | null, handoff: Handoff | null) {
  const draftAmount = form?.bountyAmount.trim();
  if (draftAmount && form?.bountyAsset) {
    return `${draftAmount} ${form.bountyAsset === "lrep" ? "LREP" : "USDC"}`;
  }
  return readBounty(handoff);
}

function readDraftBountyAmountAtomic(form: DraftForm | null, handoff: Handoff | null) {
  const draftAmount = form?.bountyAmount.trim();
  if (draftAmount) return parseSubmissionRewardAmount(draftAmount);
  return readBountyAmountAtomic(handoff);
}

function readDraftBountyAsset(form: DraftForm | null, handoff: Handoff | null): SubmissionRewardAsset {
  return form?.bountyAsset ?? readBountyAsset(handoff);
}

function readDraftBountyLrepAmountAtomic(form: DraftForm | null, handoff: Handoff | null) {
  if (readDraftBountyAsset(form, handoff) !== "lrep") return 0n;
  return readDraftBountyAmountAtomic(form, handoff) ?? 0n;
}

function readDraftBountyUsdcAmountAtomic(form: DraftForm | null, handoff: Handoff | null) {
  if (readDraftBountyAsset(form, handoff) !== "usdc") return 0n;
  return readDraftBountyAmountAtomic(form, handoff) ?? 0n;
}

function readDraftFeedbackBonusUsdcAmountAtomic(form: DraftForm | null, handoff: Handoff | null) {
  if (!form) {
    const summary = readFeedbackBonusSummary(handoff);
    return summary?.asset === "usdc" ? summary.amount : 0n;
  }
  if (form.feedbackBonusAmount === null || form.feedbackBonusAsset !== "usdc") return 0n;

  const draftAmount = form.feedbackBonusAmount.trim();
  return draftAmount ? (parseFeedbackBonusAmount(draftAmount) ?? 0n) : 0n;
}

function readDraftFeedbackBonusLabel(form: DraftForm | null, handoff: Handoff | null) {
  const draftAmount = form?.feedbackBonusAmount?.trim();
  if (draftAmount && form?.feedbackBonusAsset) {
    return `${draftAmount} ${form.feedbackBonusAsset === "lrep" ? "LREP" : "USDC"}`;
  }

  return readFeedbackBonusSummary(handoff)?.label ?? "Not included";
}

function normalizeHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x([a-fA-F0-9]{2})*$/.test(value)) {
    throw new Error(`${field} must be hex data.`);
  }
  return value as Hex;
}

function normalizeAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be an EVM address.`);
  }
  return value as Address;
}

function findHandoffQuestionSubmissionCall(calls: HandoffTransactionPlan["calls"]) {
  for (const [index, call] of (calls ?? []).entries()) {
    const data = normalizeHex(call.data ?? "0x", `transactionPlan.calls[${index}].data`);
    const selector = data.slice(0, 10).toLowerCase();
    if (selector === SINGLE_QUESTION_SUBMISSION_SELECTOR || selector === BUNDLE_QUESTION_SUBMISSION_SELECTOR) {
      return {
        kind: selector === BUNDLE_QUESTION_SUBMISSION_SELECTOR ? "bundle" : "single",
        to: normalizeAddress(call.to, `transactionPlan.calls[${index}].to`) as `0x${string}`,
      } as const;
    }
  }

  return null;
}

function readResponseError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as { error?: unknown; message?: unknown };
  return typeof record.message === "string"
    ? record.message
    : typeof record.error === "string"
      ? record.error
      : fallback;
}

function imageSignatureLabel(challenge: UploadChallenge, handoff: Handoff | null) {
  const asset = handoff?.assets?.find(candidate => candidate.id === challenge.assetId);
  return asset?.filename || challenge.attachmentId || challenge.assetId;
}

function canPrepareHandoffStatus(status: string | undefined) {
  return (
    status === "pending" ||
    status === "awaiting_image_signatures" ||
    status === "uploading_images" ||
    status === "failed"
  );
}

export function AgentAskHandoffPage({ handoffId }: { handoffId: string }) {
  const wagmiConfig = useConfig();
  const { address, chain, chainId } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { openWalletFunding } = useWalletFunding();
  const thirdwebTargetChain = useMemo(() => defineChain(targetNetwork), [targetNetwork]);
  const { signMessageAsync, isPending: isSigningMessage } = useWalletMessageSigner({ address });
  const { signTypedDataAsync, isPending: isSigningTypedData } = useSignTypedData();
  const { freeTransactionRemaining, freeTransactionVerified, isMissingGasBalance, nativeTokenSymbol } =
    useGasBalanceStatus({
      includeExternalSendCalls: true,
    });
  const showGasWarningTransactionCostsLink = shouldShowGasWarningTransactionCostsLink({
    freeTransactionRemaining,
    freeTransactionVerified,
  });
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const { dismiss: dismissTransactionStatusToast, showSubmitting: showTransactionSubmittingToast } =
    useTransactionStatusToast();
  const { executeWalletTransactionPlan } = useWalletTransactionPlanExecutor();
  const { requireAcceptance } = useTermsAcceptance();
  const [token] = useState(readToken);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<DraftForm | null>(null);
  const [savedDraftJson, setSavedDraftJson] = useState("");
  const [draftSourceKey, setDraftSourceKey] = useState("");
  const [imageSignatureSteps, setImageSignatureSteps] = useState<ImageSignatureStep[]>([]);
  const [submittedContent, setSubmittedContent] = useState<SubmittedContentModalState | null>(null);
  const boundsChainId = handoff?.chainId ?? chain?.id ?? chainId;
  const { data: protocolRoundConfigBounds } = useScaffoldReadContract({
    contractName: "ProtocolConfig" as any,
    functionName: "roundConfigBounds" as any,
    chainId: boundsChainId,
    watch: false,
    query: {
      staleTime: 300_000,
    },
  } as any);
  const roundConfigBounds = useMemo(
    () => readRoundConfigBounds(protocolRoundConfigBounds),
    [protocolRoundConfigBounds],
  );
  const roundBlindMinuteBounds = useMemo(() => getRoundBlindMinuteBounds(roundConfigBounds), [roundConfigBounds]);
  const roundMinVoterBounds = useMemo(
    () => ({
      min: roundConfigBounds.minSettlementVoters,
      max: roundConfigBounds.maxSettlementVoters,
    }),
    [roundConfigBounds],
  );
  const roundMaxVoterBounds = useMemo(
    () => ({
      min: roundConfigBounds.minVoterCap,
      max: roundConfigBounds.maxVoterCap,
    }),
    [roundConfigBounds],
  );
  const blindMinutesTooltip = useMemo(() => getBlindMinutesTooltip(roundConfigBounds), [roundConfigBounds]);
  const maxMinutesTooltip = useMemo(() => getMaxMinutesTooltip(roundConfigBounds), [roundConfigBounds]);
  const minVotersTooltip = useMemo(() => getMinVotersTooltip(roundConfigBounds), [roundConfigBounds]);
  const maxVotersTooltip = useMemo(() => getMaxVotersTooltip(roundConfigBounds), [roundConfigBounds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cleanPath = buildCleanHandoffLocationPath(window.location);
    if (!cleanPath) return;
    window.history.replaceState(null, "", cleanPath);
  }, []);

  const loadHandoff = useCallback(async () => {
    if (!token) {
      setError("This handoff link is missing its private token.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/handoffs/${handoffId}`, {
        headers: {
          "x-rateloop-handoff-token": token,
        },
      });
      const body = (await response.json()) as Handoff | { error?: string; message?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to load handoff."));
      setHandoff(body as Handoff);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load handoff.");
    } finally {
      setIsLoading(false);
    }
  }, [handoffId, token]);

  useEffect(() => {
    void loadHandoff();
  }, [loadHandoff]);

  const currentDraftSourceKey = handoff ? `${handoff.id}:${handoff.draftRevision ?? 0}` : "";
  useEffect(() => {
    if (!handoff || !currentDraftSourceKey || draftSourceKey === currentDraftSourceKey) return;
    const nextForm = createDraftForm(handoff);
    setDraftForm(nextForm);
    setSavedDraftJson(JSON.stringify(nextForm));
    setDraftSourceKey(currentDraftSourceKey);
    setDraftError(null);
  }, [currentDraftSourceKey, draftSourceKey, handoff]);

  const draftFormJson = useMemo(() => (draftForm ? JSON.stringify(draftForm) : ""), [draftForm]);
  const isDraftDirty = Boolean(draftForm && savedDraftJson && draftFormJson !== savedDraftJson);
  const draftNeedsDescriptionUpload = useMemo(
    () => draftNeedsQuestionDetailsUpload(handoff, draftForm),
    [draftForm, handoff],
  );
  const draftConfidentialityBondError = useMemo(() => getDraftConfidentialityBondError(draftForm), [draftForm]);
  const hasUnsavedDraft = isDraftDirty || draftNeedsDescriptionUpload;
  const isExpiredHandoff = handoff?.status === "expired";
  const isTerminalStatus = handoff?.status === "expired" || handoff?.status === "submitted";
  const isFeedbackBonusStep = handoff?.status === "feedback_bonus_prepared";
  const failedImageAsset = handoff?.assets?.find(asset => asset.status === "failed") ?? null;
  const failedImageUploadMessage =
    handoff?.status === "failed" && failedImageAsset ? handoff.error || failedImageAsset.error || null : null;
  const connectedMismatch = Boolean(handoff?.walletAddress && address && !sameAddress(handoff.walletAddress, address));
  const hasTransactionPlan = Boolean(handoff?.transactionPlan?.calls?.length);
  const connectedChainId = chain?.id ?? chainId ?? null;
  const handoffChainId = handoff?.chainId ?? null;
  const handoffFundingChainId = handoffChainId ?? targetNetwork.id;
  const fundingWalletAddress =
    address && isAddress(address, { strict: false }) ? (address as `0x${string}`) : undefined;
  const lrepAddress = getDefaultLrepAddress(handoffFundingChainId);
  const usdcAddress = getDefaultUsdcAddress(handoffFundingChainId);
  const usdcDisplayName = getDefaultUsdcDisplayName(handoffFundingChainId);
  const { data: lrepBalanceRaw, isLoading: isLrepBalanceLoading } = useReadContract({
    address: lrepAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: fundingWalletAddress ? [fundingWalletAddress] : undefined,
    query: {
      enabled: Boolean(fundingWalletAddress && lrepAddress),
    },
  });
  const {
    data: usdcBalanceRaw,
    isLoading: isUsdcBalanceLoading,
    refetch: refetchUsdcBalance,
  } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: fundingWalletAddress ? [fundingWalletAddress] : undefined,
    query: {
      enabled: Boolean(fundingWalletAddress && usdcAddress),
    },
  });
  const needsChainSwitch = Boolean(handoffChainId && connectedChainId && connectedChainId !== handoffChainId);
  const isBusy =
    isPreparing || isExecuting || isSigningMessage || isSigningTypedData || isSavingDraft || switchingChainId !== null;
  const isDraftEditable = Boolean(handoff && (handoff.status === "pending" || handoff.status === "failed"));
  const canEditDraft = Boolean(isDraftEditable && !isBusy);
  const canSaveDraft = Boolean(handoff && draftForm && isDraftEditable && hasUnsavedDraft && !isBusy);
  const canSaveDraftBeforeSubmit = Boolean(draftForm && isDraftEditable);
  const draftRoundMaxDurationMinuteBounds = useMemo(
    () =>
      getRoundMaxDurationMinuteBoundsForBlind(
        getEffectiveBlindMinutes(draftForm?.roundBlindMinutes ?? "", roundConfigBounds),
        roundConfigBounds,
      ),
    [draftForm?.roundBlindMinutes, roundConfigBounds],
  );
  const canSubmit = Boolean(
    token &&
      address &&
      handoff &&
      !connectedMismatch &&
      !isTerminalStatus &&
      !isBusy &&
      !failedImageUploadMessage &&
      !draftConfidentialityBondError &&
      (!hasUnsavedDraft || canSaveDraftBeforeSubmit) &&
      (hasTransactionPlan || (connectedChainId && canPrepareHandoffStatus(handoff.status))),
  );
  const questionSummaries = useMemo(() => readQuestionSummaries(handoff), [handoff]);
  const hasQuestionBundle = (draftForm?.questions.length ?? questionSummaries.length) > 1;
  const feedbackBonusSummary = readFeedbackBonusSummary(handoff);
  const feedbackBonusDraftLabel = readDraftFeedbackBonusLabel(draftForm, handoff);
  const draftBountyLrepAmountAtomic = readDraftBountyLrepAmountAtomic(draftForm, handoff);
  const draftBountyUsdcAmountAtomic = readDraftBountyUsdcAmountAtomic(draftForm, handoff);
  const draftFeedbackBonusUsdcAmountAtomic = readDraftFeedbackBonusUsdcAmountAtomic(draftForm, handoff);
  const draftFeedbackBonusLrepAmountAtomic =
    draftForm?.feedbackBonusAmount !== null && draftForm?.feedbackBonusAsset === "lrep"
      ? (parseFeedbackBonusAmount(draftForm.feedbackBonusAmount.trim()) ?? 0n)
      : 0n;
  const requiredHandoffLrepAmount = isFeedbackBonusStep
    ? draftFeedbackBonusLrepAmountAtomic
    : draftBountyLrepAmountAtomic + draftFeedbackBonusLrepAmountAtomic;
  const requiredHandoffUsdcAmount = isFeedbackBonusStep
    ? draftFeedbackBonusUsdcAmountAtomic
    : draftBountyUsdcAmountAtomic + draftFeedbackBonusUsdcAmountAtomic;
  const hasResolvedHandoffLrepBalance =
    Boolean(fundingWalletAddress && lrepAddress) && !isLrepBalanceLoading && lrepBalanceRaw !== undefined;
  const handoffLrepBalance = typeof lrepBalanceRaw === "bigint" ? lrepBalanceRaw : 0n;
  const hasInsufficientHandoffLrep =
    hasResolvedHandoffLrepBalance && requiredHandoffLrepAmount > 0n && handoffLrepBalance < requiredHandoffLrepAmount;
  const hasResolvedHandoffUsdcBalance =
    Boolean(fundingWalletAddress && usdcAddress) && !isUsdcBalanceLoading && usdcBalanceRaw !== undefined;
  const handoffUsdcBalance = typeof usdcBalanceRaw === "bigint" ? usdcBalanceRaw : 0n;
  const hasInsufficientHandoffUsdc =
    hasResolvedHandoffUsdcBalance && requiredHandoffUsdcAmount > 0n && handoffUsdcBalance < requiredHandoffUsdcAmount;
  const handleOpenEthFunding = useCallback(() => {
    if (!fundingWalletAddress) return;

    openWalletFunding({
      amount: DEFAULT_ETH_TOP_UP_AMOUNT,
      asset: "ETH",
      buttonLabel: `Add ${nativeTokenSymbol}`,
      chain: thirdwebTargetChain,
      description: `Fund this wallet with native ${nativeTokenSymbol} for ${targetNetwork.name} gas costs.`,
      presetOptions: FUNDING_PRESET_OPTIONS,
      receiverAddress: fundingWalletAddress,
      title: `Add ${nativeTokenSymbol}`,
    });
  }, [fundingWalletAddress, nativeTokenSymbol, openWalletFunding, targetNetwork.name, thirdwebTargetChain]);
  const handleOpenUsdcFunding = useCallback(() => {
    if (!fundingWalletAddress || !usdcAddress) return;

    openWalletFunding({
      amount: DEFAULT_USDC_TOP_UP_AMOUNT,
      asset: "USDC",
      buttonLabel: "Add USDC",
      chain: thirdwebTargetChain,
      description: `Fund this wallet with ${usdcDisplayName} for this handoff.`,
      onSuccess: () => void refetchUsdcBalance(),
      presetOptions: FUNDING_PRESET_OPTIONS,
      receiverAddress: fundingWalletAddress,
      title: `Add ${usdcDisplayName}`,
      tokenAddress: usdcAddress,
      unavailableMessage: "USDC is not configured for this network.",
    });
  }, [fundingWalletAddress, openWalletFunding, refetchUsdcBalance, thirdwebTargetChain, usdcAddress, usdcDisplayName]);
  const hasImageContext = Boolean(handoff?.assets?.length);
  const privateContextCount =
    draftForm?.questions.filter(question => question.confidentiality.visibility === "gated").length ??
    questionSummaries.filter(question => question.confidentiality.visibility === "gated").length;
  const hasPrivateContextDraft = privateContextCount > 0;
  const primaryPrivateConfidentiality =
    draftForm?.questions.find(question => question.confidentiality.visibility === "gated")?.confidentiality ??
    questionSummaries.find(question => question.confidentiality.visibility === "gated")?.confidentiality ??
    DEFAULT_DRAFT_CONFIDENTIALITY;
  const contextSummaryLabel = hasPrivateContextDraft
    ? privateContextCount > 1
      ? `Private (${privateContextCount})`
      : "Private"
    : "Public";
  const webMcpQuestions = useMemo<HandoffWebMcpQuestion[]>(() => {
    if (draftForm?.questions.length) {
      return draftForm.questions.map(question => ({
        categoryId: question.categoryId,
        hasPublicContext:
          question.confidentiality.visibility === "gated"
            ? draftQuestionHasHostedDetails(question)
            : Boolean(
                question.contextUrl.trim() ||
                  question.videoUrl.trim() ||
                  question.description.trim() ||
                  hasImageContext,
              ),
        tags: parseTagsInput(question.tags),
        title: question.title,
      }));
    }

    return questionSummaries.map(question => ({
      categoryId: question.categoryId,
      hasPublicContext:
        question.confidentiality.visibility === "gated"
          ? draftQuestionHasHostedDetails({
              description: question.description,
              detailsUrl: question.detailsUrl,
            })
          : Boolean(question.contextUrl || question.videoUrl || question.description || hasImageContext),
      tags: question.tags,
      title: question.title,
    }));
  }, [draftForm?.questions, hasImageContext, questionSummaries]);
  const webMcpState = useMemo<HandoffWebMcpState>(
    () => ({
      bountyLabel: readDraftBountyLabel(draftForm, handoff),
      canPrepare: Boolean(connectedChainId && handoff && canPrepareHandoffStatus(handoff.status)),
      canSaveDraft,
      canSubmit,
      chainId: handoff?.chainId ?? null,
      connectedChainId,
      connectedMismatch,
      connectedWallet: address ?? null,
      draftError,
      error,
      feedbackBonusLabel: feedbackBonusDraftLabel,
      handoffId,
      hasConnectedWallet: Boolean(address),
      hasTransactionPlan,
      hasUnsavedDraft,
      isFeedbackBonusStep,
      isLoaded: Boolean(!isLoading && handoff),
      isTerminalStatus,
      needsChainSwitch,
      questions: webMcpQuestions,
      status: handoff?.status ?? (isLoading ? "loading" : "missing"),
      walletAddress: handoff?.walletAddress ?? null,
    }),
    [
      address,
      canSaveDraft,
      canSubmit,
      connectedChainId,
      connectedMismatch,
      draftError,
      draftForm,
      error,
      feedbackBonusDraftLabel,
      handoff,
      handoffId,
      hasTransactionPlan,
      hasUnsavedDraft,
      isFeedbackBonusStep,
      isLoading,
      isTerminalStatus,
      needsChainSwitch,
      webMcpQuestions,
    ],
  );

  useEffect(() => {
    const tools = createHandoffWebMcpTools(() => webMcpState);
    return registerWebMcpTools(tools, {
      onError: error => console.warn("[webmcp] handoff tools unavailable", error),
    });
  }, [webMcpState]);

  const postPrepare = useCallback(
    async (
      options: {
        imageSignatures?: Array<{ assetId: string; challengeId: string; signature: Hex }>;
        paymentAuthorization?: JsonRecord;
      } = {},
    ) => {
      if (!address) throw new Error("Connect a wallet before preparing this ask.");
      if (!connectedChainId) throw new Error("Connect a supported network before preparing this ask.");
      const prepareChainId = handoff?.chainId ?? connectedChainId;
      const response = await fetch(`/api/agent/handoffs/${handoffId}/prepare`, {
        body: JSON.stringify({
          chainId: prepareChainId,
          imageSignatures: options.imageSignatures,
          paymentAuthorization: options.paymentAuthorization,
          token,
          walletAddress: address,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as PrepareResponse | { error?: string; message?: string };
      if (!response.ok) throw new Error(readResponseError(body, "Failed to prepare handoff."));
      return body as PrepareResponse;
    },
    [address, connectedChainId, handoff?.chainId, handoffId, token],
  );

  const updateDraftField = useCallback((field: keyof Omit<DraftForm, "questions">, value: string) => {
    setDraftForm(current => (current ? { ...current, [field]: value } : current));
    setDraftError(null);
  }, []);

  const updateDraftBountyAmount = useCallback(
    (value: string) => {
      const normalizedValue = normalizeUsdcAmountInput(value);
      if (normalizedValue === null) return;

      updateDraftField("bountyAmount", normalizedValue);
    },
    [updateDraftField],
  );

  const updateDraftBountyAsset = useCallback((asset: SubmissionRewardAsset) => {
    setDraftForm(current => {
      if (!current) return current;
      const parsedAmount = parseSubmissionRewardAmount(current.bountyAmount);
      return {
        ...current,
        bountyAmount: parsedAmount === null ? current.bountyAmount : formatSubmissionRewardInput(parsedAmount, asset),
        bountyAsset: asset,
      };
    });
    setDraftError(null);
  }, []);

  const enableDraftFeedbackBonus = useCallback(() => {
    setDraftForm(current => {
      if (!current || current.feedbackBonusAmount !== null) return current;
      return {
        ...current,
        feedbackBonusAmount: DEFAULT_FEEDBACK_BONUS_AMOUNT,
        feedbackBonusAsset: "usdc",
      };
    });
    setDraftError(null);
  }, []);

  const disableDraftFeedbackBonus = useCallback(() => {
    setDraftForm(current => {
      if (!current || current.feedbackBonusAmount === null) return current;
      return {
        ...current,
        feedbackBonusAmount: null,
        feedbackBonusAsset: null,
      };
    });
    setDraftError(null);
  }, []);

  const updateDraftFeedbackBonusAmount = useCallback(
    (value: string) => {
      const normalizedValue = normalizeUsdcAmountInput(value);
      if (normalizedValue === null) return;

      updateDraftField("feedbackBonusAmount", normalizedValue);
    },
    [updateDraftField],
  );

  const updateDraftFeedbackBonusAsset = useCallback((asset: FeedbackBonusAsset) => {
    setDraftForm(current => {
      if (!current || current.feedbackBonusAmount === null) return current;
      return { ...current, feedbackBonusAsset: asset };
    });
    setDraftError(null);
  }, []);

  const formatDraftBountyAmount = useCallback(() => {
    setDraftForm(current => {
      if (!current) return current;
      const parsedAmount = parseSubmissionRewardAmount(current.bountyAmount);
      return parsedAmount === null
        ? current
        : { ...current, bountyAmount: formatSubmissionRewardInput(parsedAmount, current.bountyAsset) };
    });
  }, []);

  const formatDraftFeedbackBonusAmount = useCallback(() => {
    setDraftForm(current => {
      if (!current || current.feedbackBonusAmount === null || !current.feedbackBonusAsset) return current;
      const parsedAmount = parseFeedbackBonusAmount(current.feedbackBonusAmount);
      return parsedAmount === null
        ? current
        : {
            ...current,
            feedbackBonusAmount: formatFeedbackBonusInput(parsedAmount, current.feedbackBonusAsset),
          };
    });
  }, []);

  const updateDraftWholeNumberField = useCallback(
    (field: "roundBlindMinutes" | "roundMaxDurationMinutes" | "roundMaxVoters" | "roundMinVoters", value: string) => {
      const normalizedValue = normalizeWholeNumberInput(value);
      if (normalizedValue === null) return;

      setDraftForm(current => {
        if (!current) return current;
        const next = { ...current, [field]: normalizedValue };
        if (field !== "roundBlindMinutes" || normalizedValue === "") {
          return next;
        }

        const maxDurationBounds = getRoundMaxDurationMinuteBoundsForBlind(
          parseWholeNumberInput(normalizedValue),
          roundConfigBounds,
        );
        next.roundMaxDurationMinutes = clampWholeNumberInput(
          next.roundMaxDurationMinutes,
          maxDurationBounds.min,
          maxDurationBounds.max,
        );
        return next;
      });
      setDraftError(null);
    },
    [roundConfigBounds],
  );

  const clampDraftWholeNumberField = useCallback(
    (field: "roundBlindMinutes" | "roundMaxDurationMinutes" | "roundMaxVoters" | "roundMinVoters") => {
      setDraftForm(current => {
        if (!current) return current;

        if (field === "roundBlindMinutes") {
          const roundBlindMinutes = clampWholeNumberInput(
            current.roundBlindMinutes,
            roundBlindMinuteBounds.min,
            roundBlindMinuteBounds.max,
          );
          const maxDurationBounds = getRoundMaxDurationMinuteBoundsForBlind(
            parseWholeNumberInput(roundBlindMinutes),
            roundConfigBounds,
          );
          return {
            ...current,
            roundBlindMinutes,
            roundMaxDurationMinutes: clampWholeNumberInput(
              current.roundMaxDurationMinutes,
              maxDurationBounds.min,
              maxDurationBounds.max,
            ),
          };
        }

        if (field === "roundMaxDurationMinutes") {
          const maxDurationBounds = getRoundMaxDurationMinuteBoundsForBlind(
            getEffectiveBlindMinutes(current.roundBlindMinutes, roundConfigBounds),
            roundConfigBounds,
          );
          return {
            ...current,
            roundMaxDurationMinutes: clampWholeNumberInput(
              current.roundMaxDurationMinutes,
              maxDurationBounds.min,
              maxDurationBounds.max,
            ),
          };
        }

        if (field === "roundMinVoters") {
          return {
            ...current,
            roundMinVoters: clampWholeNumberInput(
              current.roundMinVoters,
              roundMinVoterBounds.min,
              roundMinVoterBounds.max,
            ),
          };
        }

        return {
          ...current,
          roundMaxVoters: clampWholeNumberInput(
            current.roundMaxVoters,
            roundMaxVoterBounds.min,
            roundMaxVoterBounds.max,
          ),
        };
      });
      setDraftError(null);
    },
    [roundBlindMinuteBounds, roundConfigBounds, roundMaxVoterBounds, roundMinVoterBounds],
  );

  const updateDraftQuestion = useCallback((index: number, patch: Partial<DraftQuestionForm>) => {
    setDraftForm(current => {
      if (!current) return current;
      return {
        ...current,
        questions: current.questions.map((question, questionIndex) =>
          questionIndex === index ? { ...question, ...patch } : question,
        ),
      };
    });
    setDraftError(null);
  }, []);

  const updateDraftQuestionPrivateContext = useCallback((index: number, enabled: boolean) => {
    setDraftForm(current => {
      if (!current) return current;
      const sharedConfidentiality =
        current.questions.find(
          (question, questionIndex) => questionIndex !== index && question.confidentiality.visibility === "gated",
        )?.confidentiality ?? current.questions[index]?.confidentiality;

      return {
        ...current,
        questions: current.questions.map((question, questionIndex) => {
          if (questionIndex !== index) return question;

          const nextConfidentiality: DraftConfidentiality = enabled
            ? {
                ...question.confidentiality,
                bondAmount: sharedConfidentiality?.bondAmount ?? "0",
                bondAsset: sharedConfidentiality?.bondAsset ?? "LREP",
                disclosurePolicy: PRIVATE_FOREVER_DISCLOSURE_POLICY,
                visibility: "gated",
              }
            : {
                ...question.confidentiality,
                visibility: "public",
              };

          return {
            ...question,
            confidentiality: nextConfidentiality,
            contextUrl: enabled ? "" : question.contextUrl,
            videoUrl: enabled ? "" : question.videoUrl,
          };
        }),
      };
    });
    setDraftError(null);
  }, []);

  const updateDraftPrivateConfidentialityBond = useCallback((patch: Partial<DraftConfidentiality>) => {
    setDraftForm(current => {
      if (!current) return current;

      return {
        ...current,
        questions: current.questions.map(question =>
          question.confidentiality.visibility === "gated"
            ? {
                ...question,
                confidentiality: {
                  ...question.confidentiality,
                  ...patch,
                },
              }
            : question,
        ),
      };
    });
    setDraftError(null);
  }, []);

  const updateDraftConfidentialityBondAmount = useCallback(
    (value: string) => {
      const normalizedValue = normalizeUsdcAmountInput(value);
      if (normalizedValue === null) return;

      updateDraftPrivateConfidentialityBond({ bondAmount: normalizedValue });
    },
    [updateDraftPrivateConfidentialityBond],
  );

  const formatDraftConfidentialityBondAmount = useCallback(() => {
    setDraftForm(current => {
      if (!current) return current;

      return {
        ...current,
        questions: current.questions.map(question => {
          if (question.confidentiality.visibility !== "gated") return question;
          const bondAmount = formatConfidentialityBondAmountInput(
            question.confidentiality.bondAmount,
            question.confidentiality.bondAsset,
          );
          return {
            ...question,
            confidentiality: {
              ...question.confidentiality,
              bondAmount,
            },
          };
        }),
      };
    });
    setDraftError(null);
  }, []);

  const saveDraft = useCallback(
    async (options: SaveDraftOptions = {}) => {
      if (!handoff || !draftForm) return null;
      setDraftError(null);
      setIsSavingDraft(true);
      try {
        const requestBody = await buildDraftRequestBody(
          handoff,
          draftForm,
          roundConfigBounds,
          async (description, options) => {
            if (!address) {
              throw new Error("Connect a wallet before saving a description.");
            }
            if (handoff.walletAddress && !sameAddress(handoff.walletAddress, address)) {
              throw new Error("Connected wallet does not match this handoff.");
            }
            return uploadQuestionDetailsForHandoff({
              requiresGatedAccess: options?.requiresGatedAccess,
              signMessageAsync,
              submitterAddress: address,
              text: description,
            });
          },
        );
        const response = await fetch(`/api/agent/handoffs/${handoffId}`, {
          body: JSON.stringify({
            requestBody,
            token,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        });
        const body = (await response.json()) as Handoff | { error?: string; message?: string };
        if (!response.ok) throw new Error(readResponseError(body, "Failed to save draft."));
        const savedHandoff = body as Handoff;
        setHandoff(savedHandoff);
        if (options.showSuccess !== false) {
          notification.success("Draft saved.");
        }
        return savedHandoff;
      } catch (saveError) {
        setDraftError(saveError instanceof Error ? saveError.message : "Failed to save draft.");
        return null;
      } finally {
        setIsSavingDraft(false);
      }
    },
    [address, draftForm, handoff, handoffId, roundConfigBounds, signMessageAsync, token],
  );

  const handleSaveDraft = useCallback(async () => {
    await saveDraft();
  }, [saveDraft]);

  const prepareHandoff = useCallback(
    async (options: { skipUnsavedDraftCheck?: boolean } = {}) => {
      if (!address) {
        notification.error("Connect the wallet that will fund this ask.");
        return null;
      }
      if (!connectedChainId) {
        notification.error("Connect a supported network before preparing this ask.");
        return null;
      }
      if (connectedMismatch) {
        notification.error("Connected wallet does not match this handoff.");
        return null;
      }
      if (hasUnsavedDraft && !options.skipUnsavedDraftCheck) {
        notification.error("Save the draft before submitting.");
        return null;
      }

      setIsPreparing(true);
      showTransactionSubmittingToast({
        description: "Approve the wallet request to continue.",
        title: "Preparing ask",
      });
      setImageSignatureSteps([]);
      setError(null);
      try {
        let prepared = await postPrepare();
        setHandoff(prepared);
        const uploadChallenges = prepared.uploadChallenges ?? [];
        if (uploadChallenges.length > 0) {
          setImageSignatureSteps(
            uploadChallenges.map(challenge => ({
              assetId: challenge.assetId,
              filename: imageSignatureLabel(challenge, prepared),
              status: "pending",
            })),
          );
          const imageSignatures = [];
          for (const challenge of uploadChallenges) {
            const signature = await signMessageAsync({ message: challenge.message });
            imageSignatures.push({
              assetId: challenge.assetId,
              challengeId: challenge.challengeId,
              signature,
            });
            setImageSignatureSteps(current =>
              current.map(step => (step.assetId === challenge.assetId ? { ...step, status: "signed" } : step)),
            );
          }
          prepared = await postPrepare({ imageSignatures });
        }

        const authorizationRequest = prepared.x402AuthorizationRequest;
        const calls = prepared.transactionPlan?.calls ?? [];
        if (authorizationRequest && calls.length === 0) {
          const expectedChainId = prepared.chainId ?? handoff?.chainId ?? connectedChainId;
          if (!expectedChainId) {
            throw new Error("Handoff is missing a chainId.");
          }
          const expectedUsdcAddress = getDefaultUsdcAddress(expectedChainId);
          if (!expectedUsdcAddress) {
            throw new Error("Cannot validate x402 authorization without a configured USDC token.");
          }
          const expectedSubmitterAddress = getConfiguredX402QuestionSubmitterAddress(expectedChainId);
          if (!expectedSubmitterAddress) {
            throw new Error("Cannot validate x402 authorization without a configured RateLoop x402 submitter.");
          }
          const requestBody = prepared.requestBody ?? handoff?.requestBody ?? null;
          const { authorization, typedData } = validateBrowserX402AuthorizationRequest({
            expectedAmount: readBrowserSigningExpectedX402Amount(requestBody),
            expectedChainId,
            expectedSubmitterAddress,
            expectedUsdcAddress,
            expectedWalletAddress: address,
            request: authorizationRequest,
          });
          const signature = await signTypedDataAsync({
            domain: typedData.domain,
            message: typedData.message,
            primaryType: typedData.primaryType,
            types: typedData.types,
          });
          prepared = await postPrepare({
            paymentAuthorization: {
              ...authorization,
              signature,
            },
          });
        }

        setHandoff(prepared);
        setImageSignatureSteps([]);
        return prepared;
      } catch (prepareError) {
        setError(prepareError instanceof Error ? prepareError.message : "Failed to prepare handoff.");
        return null;
      } finally {
        setIsPreparing(false);
        dismissTransactionStatusToast();
      }
    },
    [
      address,
      connectedChainId,
      connectedMismatch,
      dismissTransactionStatusToast,
      hasUnsavedDraft,
      handoff?.chainId,
      handoff?.requestBody,
      postPrepare,
      showTransactionSubmittingToast,
      signMessageAsync,
      signTypedDataAsync,
    ],
  );

  const executeHandoff = useCallback(
    async (targetHandoff: Handoff) => {
      const isExecutingFeedbackBonus = targetHandoff.status === "feedback_bonus_prepared";
      if (!(targetHandoff.transactionPlan?.calls ?? []).length) {
        notification.error(
          isExecutingFeedbackBonus
            ? "Feedback Bonus funding is not prepared yet."
            : "This ask could not prepare wallet calls.",
        );
        return;
      }
      if (!address) {
        notification.error("Connect the wallet that will fund this ask.");
        return;
      }
      if (connectedMismatch) {
        notification.error("Connected wallet does not match this handoff.");
        return;
      }

      setIsExecuting(true);
      setError(null);
      setSubmittedContent(null);

      try {
        let activeChainId = connectedChainId;
        let currentHandoff = targetHandoff;
        let submittedContentForShare: SubmittedContentModalState | null = null;

        while (true) {
          const calls = currentHandoff.transactionPlan?.calls ?? [];
          const isFundingFeedbackBonus = currentHandoff.status === "feedback_bonus_prepared";
          if (!calls.length) {
            throw new Error(
              isFundingFeedbackBonus
                ? "Feedback Bonus funding is not prepared yet."
                : "This ask could not prepare wallet calls.",
            );
          }

          showTransactionSubmittingToast(
            isFundingFeedbackBonus
              ? {
                  description: "Approve the Feedback Bonus wallet calls so raters can see the bonus.",
                  title: "Funding Feedback Bonus",
                }
              : { action: "ask" },
          );

          if (currentHandoff.chainId && activeChainId !== currentHandoff.chainId) {
            await switchToChain(currentHandoff.chainId);
            activeChainId = currentHandoff.chainId;
          }

          const handoffChainId = currentHandoff.chainId ?? undefined;
          const questionSubmissionCall = findHandoffQuestionSubmissionCall(calls);
          if (questionSubmissionCall) {
            const publicClient = getPublicClient(
              wagmiConfig,
              handoffChainId === undefined ? undefined : { chainId: handoffChainId },
            );
            await assertContentRegistryQuestionSubmissionSelector(
              publicClient,
              questionSubmissionCall.to,
              questionSubmissionCall.kind,
            );
          }

          const hashes = await executeWalletTransactionPlan({
            calls,
            chainId: handoffChainId,
            getPostCallDelayMs,
            requiresAtomicExecution: currentHandoff.transactionPlan?.requiresAtomicExecution,
            requiresOrderedExecution: currentHandoff.transactionPlan?.requiresOrderedExecution,
          });

          const response = await fetch(`/api/agent/handoffs/${handoffId}/complete`, {
            body: JSON.stringify({ token, transactionHashes: hashes }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          const body = (await response.json()) as CompleteResponse | { error?: string; message?: string };
          if (!response.ok) throw new Error(readResponseError(body, "Failed to confirm RateLoop ask."));
          const nextHandoff = body as CompleteResponse;
          const nextPublicUrl = nextHandoff.publicUrl ?? currentHandoff.publicUrl ?? null;
          const nextHandoffWithPublicUrl = {
            ...nextHandoff,
            publicUrl: nextPublicUrl,
          };
          setHandoff(current => ({
            ...nextHandoff,
            publicUrl: nextHandoff.publicUrl ?? current?.publicUrl ?? currentHandoff.publicUrl ?? null,
          }));

          if (!isFundingFeedbackBonus) {
            submittedContentForShare =
              readSubmittedContentForShare(currentHandoff, nextHandoff.ask) ?? submittedContentForShare;
          }

          if (!isFundingFeedbackBonus && nextHandoff.status === "feedback_bonus_prepared") {
            currentHandoff = nextHandoffWithPublicUrl;
            continue;
          }

          dismissTransactionStatusToast();
          if (isFundingFeedbackBonus) {
            notification.success("Ask submitted and Feedback Bonus funded.");
          } else {
            notification.success("Ask submitted to RateLoop.");
          }
          if (nextHandoff.status === "submitted" && submittedContentForShare) {
            setSubmittedContent(submittedContentForShare);
          }
          break;
        }
      } catch (executeError) {
        dismissTransactionStatusToast();
        setError(executeError instanceof Error ? executeError.message : "Failed to execute wallet calls.");
      } finally {
        setIsExecuting(false);
        dismissTransactionStatusToast();
      }
    },
    [
      address,
      connectedChainId,
      connectedMismatch,
      dismissTransactionStatusToast,
      executeWalletTransactionPlan,
      handoffId,
      showTransactionSubmittingToast,
      switchToChain,
      token,
      wagmiConfig,
    ],
  );

  const handleSubmitAsk = useCallback(async () => {
    if (!handoff) return;
    if (!address) {
      notification.error("Connect the wallet that will fund this ask.");
      return;
    }
    if (connectedMismatch) {
      notification.error("Connected wallet does not match this handoff.");
      return;
    }

    let executableHandoff = handoff;
    const shouldAutoSaveDraft = hasUnsavedDraft;
    if (shouldAutoSaveDraft) {
      const savedHandoff = await saveDraft({ showSuccess: false });
      if (!savedHandoff) return;
      executableHandoff = savedHandoff;
    }

    const accepted = await requireAcceptance("submit");
    if (!accepted) return;

    if (!executableHandoff.transactionPlan?.calls?.length) {
      if (isFeedbackBonusStep) {
        notification.error("Feedback Bonus funding is waiting for a transaction plan.");
        return;
      }
      const prepared = await prepareHandoff({ skipUnsavedDraftCheck: shouldAutoSaveDraft });
      if (!prepared) return;
      executableHandoff = prepared;
    }

    await executeHandoff(executableHandoff);
  }, [
    address,
    connectedMismatch,
    executeHandoff,
    handoff,
    hasUnsavedDraft,
    isFeedbackBonusStep,
    prepareHandoff,
    requireAcceptance,
    saveDraft,
  ]);

  const handleCloseShareModal = useCallback(() => {
    setSubmittedContent(null);
  }, []);

  const submitLabel = (() => {
    if (isSavingDraft) return "Saving...";
    if (switchingChainId !== null) return "Switching...";
    if (isPreparing || isSigningMessage || isSigningTypedData) return "Preparing...";
    if (isFeedbackBonusStep) return isExecuting ? "Funding..." : "Fund Bonus";
    return isExecuting ? "Submitting..." : "Submit";
  })();

  return (
    <AppPageShell contentClassName="space-y-5" paddingTopClassName="pt-6">
      <section className="surface-card rounded-lg p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-base-content/50">Agent ask handoff</p>
            <h1 className={`${surfaceSectionHeadingClassName} mt-2`}>{readDraftTitle(draftForm, handoff)}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-base-content/65">
              Review the RateLoop ask, connect the wallet that should pay the bounty, then approve the image signatures
              and wallet calls in the browser.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RateLoopConnectButton />
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="surface-card rounded-lg p-6">
          <span className="loading loading-spinner loading-sm text-primary" /> Loading handoff...
        </div>
      ) : null}

      {error ? (
        <div className="surface-card-nested rounded-lg p-4 text-sm text-error">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {handoff ? (
        <>
          <section className="surface-card rounded-lg p-6">
            <div className="grid gap-x-5 gap-y-4 md:grid-cols-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <WalletIcon className="h-4 w-4" />
                  <span>Funding wallet</span>
                </div>
                <p className="mt-2 font-mono text-sm">{shortAddress(handoff.walletAddress ?? address)}</p>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <ShieldCheckIcon className="h-4 w-4" />
                  <span>Bounty</span>
                </div>
                <p className="mt-2 text-lg font-semibold">{readDraftBountyLabel(draftForm, handoff)}</p>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <ChatBubbleLeftRightIcon className="h-4 w-4" />
                  <span>Feedback Bonus</span>
                </div>
                <p className={`mt-2 text-sm font-semibold ${feedbackBonusSummary ? "" : "text-warning"}`}>
                  {feedbackBonusDraftLabel}
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <LockClosedIcon className="h-4 w-4" />
                  <span>Context</span>
                </div>
                <p className={`mt-2 text-sm font-semibold ${hasPrivateContextDraft ? "text-warning" : ""}`}>
                  {contextSummaryLabel}
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>Status</span>
                </div>
                <p
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-sm font-semibold ${
                    isExpiredHandoff ? "bg-error/15 text-error" : ""
                  }`}
                >
                  {handoff.status}
                </p>
              </div>
            </div>

            {connectedMismatch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This handoff expects {handoff.walletAddress}. You are connected as {address}.
              </p>
            ) : null}
            {needsChainSwitch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This handoff is on chain {handoff.chainId}. Your wallet is on chain {connectedChainId}.
              </p>
            ) : null}
            {isMissingGasBalance ? (
              <div className="mt-4">
                <GasBalanceWarning
                  actionDisabled={!fundingWalletAddress}
                  actionLabel={`Add ${nativeTokenSymbol}`}
                  nativeTokenSymbol={nativeTokenSymbol}
                  onAction={handleOpenEthFunding}
                  showTransactionCostsLink={showGasWarningTransactionCostsLink}
                />
              </div>
            ) : null}
            {hasInsufficientHandoffLrep ? (
              <div className="mt-4">
                <BountyFundingWarning
                  title={isFeedbackBonusStep ? "Need LREP for funding" : "Need bounty funds"}
                  message={
                    isFeedbackBonusStep
                      ? `This handoff needs ${formatSubmissionRewardAmount(
                          requiredHandoffLrepAmount,
                          "lrep",
                        )} to fund the Feedback Bonus. Your wallet has ${formatSubmissionRewardAmount(
                          handoffLrepBalance,
                          "lrep",
                        )}.`
                      : `This handoff needs ${formatSubmissionRewardAmount(
                          requiredHandoffLrepAmount,
                          "lrep",
                        )} before it can be submitted. Your wallet has ${formatSubmissionRewardAmount(
                          handoffLrepBalance,
                          "lrep",
                        )}.`
                  }
                />
              </div>
            ) : null}
            {hasInsufficientHandoffUsdc ? (
              <div className="mt-4">
                <BountyFundingWarning
                  actionDisabled={!fundingWalletAddress || !usdcAddress}
                  actionLabel="Add USDC"
                  title={isFeedbackBonusStep ? `Need ${usdcDisplayName} for funding` : "Need bounty funds"}
                  message={
                    isFeedbackBonusStep
                      ? `This handoff needs ${formatSubmissionRewardAmount(
                          requiredHandoffUsdcAmount,
                          "usdc",
                        )} to fund the Feedback Bonus. Your wallet has ${formatSubmissionRewardAmount(
                          handoffUsdcBalance,
                          "usdc",
                        )}.`
                      : `This handoff needs ${formatSubmissionRewardAmount(
                          requiredHandoffUsdcAmount,
                          "usdc",
                        )} before it can be submitted. Your wallet has ${formatSubmissionRewardAmount(
                          handoffUsdcBalance,
                          "usdc",
                        )}.`
                  }
                  onAction={handleOpenUsdcFunding}
                />
              </div>
            ) : null}
            {failedImageUploadMessage ? (
              <div className="surface-card-nested mt-4 rounded-lg border border-error/20 bg-error/10 p-3 text-sm text-error">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Image upload failed.</p>
                    <p className="mt-1 text-error/80">{failedImageUploadMessage}</p>
                    <p className="mt-1 text-error/80">
                      Ask the agent for a fresh handoff link with a regenerated or re-exported image.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="surface-card rounded-lg p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-base-content/60" />
                  <h2 className="text-lg font-semibold">Ask details</h2>
                </div>
                {!hasQuestionBundle && draftForm?.questions[0] ? (
                  <PrivateContextToggleControl
                    checked={draftForm.questions[0].confidentiality.visibility === "gated"}
                    disabled={!canEditDraft}
                    onChange={enabled => updateDraftQuestionPrivateContext(0, enabled)}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">
                  Revision {handoff.draftRevision ?? 0}
                </span>
                {handoff.editedByUser ? (
                  <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">Edited</span>
                ) : null}
                {hasUnsavedDraft ? <span className="reward-chip px-2 py-0.5 text-xs text-warning">Unsaved</span> : null}
                {!isDraftEditable ? (
                  <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">Locked</span>
                ) : null}
                <button
                  className="btn btn-outline btn-sm"
                  disabled={!canSaveDraft}
                  type="button"
                  onClick={() => void handleSaveDraft()}
                >
                  {isSavingDraft ? (
                    <span className="flex items-center gap-2">
                      <span className="loading loading-spinner loading-xs" />
                      <span>Saving</span>
                    </span>
                  ) : (
                    "Save draft"
                  )}
                </button>
              </div>
            </div>

            {draftError ? (
              <div className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-error">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>{draftError}</span>
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
              <div className="space-y-5">
                {draftForm?.questions.length ? (
                  draftForm.questions.map((question, index) => {
                    const questionHasImageContext = hasImageContext || question.imageUrls.length > 0;

                    return (
                      <div
                        key={`agent-ask-question-${index}`}
                        className={hasQuestionBundle ? "rounded-lg border border-base-content/10 p-4" : ""}
                      >
                        <label className="form-control">
                          <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            {hasQuestionBundle ? `Question ${index + 1}` : "Question"}
                          </span>
                          <input
                            className="input input-bordered mt-1 w-full"
                            disabled={!canEditDraft}
                            value={question.title}
                            onChange={event => updateDraftQuestion(index, { title: event.target.value })}
                          />
                        </label>

                        {hasQuestionBundle ? (
                          <div className="mt-4">
                            <PrivateContextToggleControl
                              checked={question.confidentiality.visibility === "gated"}
                              disabled={!canEditDraft}
                              onChange={enabled => updateDraftQuestionPrivateContext(index, enabled)}
                            />
                          </div>
                        ) : null}

                        <label className="form-control mt-4">
                          <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            Description{" "}
                            <span className="text-base-content/35">
                              {question.confidentiality.visibility === "gated" ? "(required)" : "(optional)"}
                            </span>
                          </span>
                          <textarea
                            className="textarea textarea-bordered mt-1 min-h-28 w-full resize-y"
                            disabled={!canEditDraft}
                            maxLength={MAX_QUESTION_DETAILS_TEXT_LENGTH}
                            placeholder="Add context voters can expand before rating"
                            value={question.description}
                            onChange={event => updateDraftQuestion(index, { description: event.target.value })}
                          />
                          <span className="mt-1 text-right text-xs text-base-content/45">
                            {question.description.length}/{MAX_QUESTION_DETAILS_TEXT_LENGTH}
                          </span>
                        </label>

                        <label className="form-control mt-4">
                          <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            Category
                          </span>
                          <input
                            className="input input-bordered mt-1 w-full"
                            disabled={!canEditDraft}
                            value={question.categoryId}
                            onChange={event => updateDraftQuestion(index, { categoryId: event.target.value })}
                          />
                        </label>

                        <label className="form-control mt-4">
                          <span className="label-text flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            <TagIcon className="h-3.5 w-3.5" />
                            <span>Categories (1-3)</span>
                          </span>
                          <input
                            className="input input-bordered mt-1 w-full"
                            disabled={!canEditDraft}
                            value={question.tags}
                            onChange={event => updateDraftQuestion(index, { tags: event.target.value })}
                          />
                        </label>

                        <AdvancedQuestionSettingsControl
                          contextUrl={question.contextUrl}
                          disabled={!canEditDraft}
                          hasImageContext={questionHasImageContext}
                          isPrivateContext={question.confidentiality.visibility === "gated"}
                          questionIndex={index}
                          targetAudience={question.targetAudience}
                          videoUrl={question.videoUrl}
                          onContextUrlChange={contextUrl => updateDraftQuestion(index, { contextUrl })}
                          onTargetAudienceChange={targetAudience => updateDraftQuestion(index, { targetAudience })}
                          onVideoUrlChange={videoUrl => updateDraftQuestion(index, { videoUrl })}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-base-content/10 p-4 text-sm text-base-content/55">
                    Question details are unavailable for this handoff.
                  </div>
                )}
              </div>

              <div className="space-y-5">
                {hasPrivateContextDraft ? (
                  <div className="space-y-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
                        Confidentiality bond
                        <InfoTooltip
                          text={CONFIDENTIALITY_BOND_TOOLTIP}
                          position="top"
                          className="text-base-content/45"
                        />
                      </p>
                    </div>
                    <div>
                      <div className={MONEY_FIELD_LABEL_ROW_CLASS}>
                        <label htmlFor="agent-ask-confidentiality-bond-asset" className={MONEY_FIELD_LABEL_CLASS}>
                          Asset
                        </label>
                        <div className={MONEY_FIELD_LABEL_CLASS}>
                          <label htmlFor="agent-ask-confidentiality-bond-amount">Amount</label>
                          <InfoTooltip
                            text={CONFIDENTIALITY_BOND_AMOUNT_TOOLTIP}
                            position="top"
                            className="text-base-content/45"
                          />
                        </div>
                      </div>
                      <div className={MONEY_FIELD_CONTROL_ROW_CLASS}>
                        <select
                          id="agent-ask-confidentiality-bond-asset"
                          className={`select select-bordered ${MONEY_FIELD_CONTROL_CLASS} bg-base-100`}
                          disabled={!canEditDraft}
                          value={primaryPrivateConfidentiality.bondAsset}
                          onChange={event =>
                            updateDraftPrivateConfidentialityBond({
                              bondAsset: event.target.value as ConfidentialityBondAsset,
                            })
                          }
                        >
                          <option value="LREP">LREP</option>
                          <option value="USDC">USDC</option>
                        </select>
                        <input
                          id="agent-ask-confidentiality-bond-amount"
                          className={`input input-bordered ${MONEY_FIELD_CONTROL_CLASS} bg-base-100`}
                          disabled={!canEditDraft}
                          inputMode="decimal"
                          value={primaryPrivateConfidentiality.bondAmount}
                          onBlur={formatDraftConfidentialityBondAmount}
                          onChange={event => updateDraftConfidentialityBondAmount(event.target.value)}
                        />
                      </div>
                    </div>
                    {draftConfidentialityBondError ? (
                      <p className="mt-3 text-xs leading-relaxed text-error">
                        {draftConfidentialityBondError}
                        {!canEditDraft ? " Ask the agent for a fresh handoff link." : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
                    Bounty
                    <InfoTooltip text={BOUNTY_AMOUNT_TOOLTIP} position="top" className="text-base-content/45" />
                  </p>
                  <div>
                    <div className={MONEY_FIELD_LABEL_ROW_CLASS}>
                      <label htmlFor="agent-ask-bounty-asset" className={MONEY_FIELD_LABEL_CLASS}>
                        Asset
                      </label>
                      <label htmlFor="agent-ask-bounty-amount" className={MONEY_FIELD_LABEL_CLASS}>
                        Amount
                      </label>
                    </div>
                    <div className={MONEY_FIELD_CONTROL_ROW_CLASS}>
                      <select
                        id="agent-ask-bounty-asset"
                        className={`select select-bordered ${MONEY_FIELD_CONTROL_CLASS} bg-base-100`}
                        disabled={!canEditDraft}
                        value={draftForm?.bountyAsset ?? readBountyAsset(handoff)}
                        aria-label="Bounty asset"
                        onChange={event => updateDraftBountyAsset(event.target.value as SubmissionRewardAsset)}
                      >
                        <option value="lrep">LREP</option>
                        <option value="usdc">USDC</option>
                      </select>
                      <input
                        id="agent-ask-bounty-amount"
                        className={`input input-bordered ${MONEY_FIELD_CONTROL_CLASS} bg-base-100`}
                        disabled={!canEditDraft}
                        inputMode="decimal"
                        value={draftForm?.bountyAmount ?? ""}
                        onBlur={formatDraftBountyAmount}
                        onChange={event => updateDraftBountyAmount(event.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
                    Feedback Bonus
                    <InfoTooltip text={FEEDBACK_BONUS_AMOUNT_TOOLTIP} position="top" className="text-base-content/45" />
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                    <button
                      type="button"
                      aria-pressed={draftForm?.feedbackBonusAmount === null}
                      className={`btn btn-sm ${draftForm?.feedbackBonusAmount === null ? "btn-primary" : "btn-outline"}`}
                      disabled={!canEditDraft}
                      onClick={disableDraftFeedbackBonus}
                    >
                      No bonus
                    </button>
                    <button
                      type="button"
                      aria-pressed={draftForm?.feedbackBonusAmount !== null}
                      className={`btn btn-sm ${draftForm?.feedbackBonusAmount !== null ? "btn-primary" : "btn-outline"}`}
                      disabled={!canEditDraft || hasQuestionBundle}
                      onClick={() => {
                        if (hasQuestionBundle) {
                          notification.info("Feedback Bonuses can be added to single-question handoffs.");
                          return;
                        }
                        enableDraftFeedbackBonus();
                      }}
                    >
                      Add bonus
                    </button>
                  </div>
                  {hasQuestionBundle ? (
                    <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
                      Feedback Bonuses are per question and round. Browser handoffs support them for single-question
                      asks first.
                    </p>
                  ) : null}
                  {draftForm?.feedbackBonusAmount !== null ? (
                    <div>
                      <div className={MONEY_FIELD_LABEL_ROW_CLASS}>
                        <label htmlFor="agent-ask-feedback-bonus-asset" className={MONEY_FIELD_LABEL_CLASS}>
                          Asset
                        </label>
                        <label htmlFor="agent-ask-feedback-bonus-amount" className={MONEY_FIELD_LABEL_CLASS}>
                          Amount
                        </label>
                      </div>
                      <div className={MONEY_FIELD_CONTROL_ROW_CLASS}>
                        <select
                          id="agent-ask-feedback-bonus-asset"
                          className={`select select-bordered ${MONEY_FIELD_CONTROL_CLASS} bg-base-100`}
                          disabled={!canEditDraft}
                          value={draftForm?.feedbackBonusAsset ?? "usdc"}
                          onChange={event => updateDraftFeedbackBonusAsset(event.target.value as FeedbackBonusAsset)}
                        >
                          <option value="lrep">LREP</option>
                          <option value="usdc">USDC</option>
                        </select>
                        <input
                          id="agent-ask-feedback-bonus-amount"
                          className={`input input-bordered ${MONEY_FIELD_CONTROL_CLASS} bg-base-100`}
                          disabled={!canEditDraft}
                          inputMode="decimal"
                          value={draftForm?.feedbackBonusAmount ?? ""}
                          onBlur={formatDraftFeedbackBonusAmount}
                          onChange={event => updateDraftFeedbackBonusAmount(event.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-base-content/75">
                    <ClockIcon className="h-4 w-4" />
                    <span>Round settings</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="form-control">
                      <DraftFieldLabel htmlFor="agent-ask-round-blind-minutes" tooltip={blindMinutesTooltip}>
                        Blind response window
                      </DraftFieldLabel>
                      <DurationInput
                        id="agent-ask-round-blind-minutes"
                        className="mt-1"
                        disabled={!canEditDraft}
                        valueMinutes={draftForm?.roundBlindMinutes ?? ""}
                        minMinutes={roundBlindMinuteBounds.min}
                        maxMinutes={roundBlindMinuteBounds.max}
                        onBlur={() => clampDraftWholeNumberField("roundBlindMinutes")}
                        onChangeMinutes={value => updateDraftWholeNumberField("roundBlindMinutes", value)}
                        ariaLabel="Blind response window"
                      />
                    </div>
                    <div className="form-control">
                      <DraftFieldLabel htmlFor="agent-ask-round-max-minutes" tooltip={maxMinutesTooltip}>
                        Total round duration
                      </DraftFieldLabel>
                      <DurationInput
                        id="agent-ask-round-max-minutes"
                        className="mt-1"
                        disabled={!canEditDraft}
                        valueMinutes={draftForm?.roundMaxDurationMinutes ?? ""}
                        minMinutes={draftRoundMaxDurationMinuteBounds.min}
                        maxMinutes={draftRoundMaxDurationMinuteBounds.max}
                        onBlur={() => clampDraftWholeNumberField("roundMaxDurationMinutes")}
                        onChangeMinutes={value => updateDraftWholeNumberField("roundMaxDurationMinutes", value)}
                        ariaLabel="Total round duration"
                        summarySuffix="for selected blind window"
                      />
                    </div>
                    <div className="form-control">
                      <DraftFieldLabel htmlFor="agent-ask-round-min-voters" tooltip={minVotersTooltip}>
                        Required voters
                      </DraftFieldLabel>
                      <input
                        id="agent-ask-round-min-voters"
                        type="number"
                        className="input input-bordered mt-1 w-full"
                        disabled={!canEditDraft}
                        inputMode="numeric"
                        min={roundMinVoterBounds.min}
                        max={roundMinVoterBounds.max}
                        step={1}
                        value={draftForm?.roundMinVoters ?? ""}
                        onBlur={() => clampDraftWholeNumberField("roundMinVoters")}
                        onChange={event => updateDraftWholeNumberField("roundMinVoters", event.target.value)}
                      />
                    </div>
                    <div className="form-control">
                      <DraftFieldLabel htmlFor="agent-ask-round-max-voters" tooltip={maxVotersTooltip}>
                        Max voters
                      </DraftFieldLabel>
                      <input
                        id="agent-ask-round-max-voters"
                        type="number"
                        className="input input-bordered mt-1 w-full"
                        disabled={!canEditDraft}
                        inputMode="numeric"
                        min={roundMaxVoterBounds.min}
                        max={roundMaxVoterBounds.max}
                        step={1}
                        value={draftForm?.roundMaxVoters ?? ""}
                        onBlur={() => clampDraftWholeNumberField("roundMaxVoters")}
                        onChange={event => updateDraftWholeNumberField("roundMaxVoters", event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {handoff.assets?.length ? (
            <section className="surface-card rounded-lg p-5">
              <div className="flex items-center gap-2">
                <PhotoIcon className="h-5 w-5 text-base-content/60" />
                <h2 className="text-lg font-semibold">Images</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {handoff.assets.map(asset => (
                  <div key={asset.id} className="overflow-hidden rounded-lg border border-base-300/70 bg-base-100">
                    {asset.dataUrl || asset.imageUrl ? (
                      <img
                        alt={asset.filename ?? "RateLoop handoff image"}
                        className="aspect-video w-full object-cover"
                        src={asset.dataUrl ?? asset.imageUrl ?? ""}
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-base-200 text-sm text-base-content/50">
                        Image pending
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{asset.filename ?? asset.attachmentId}</p>
                        <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">{asset.status}</span>
                      </div>
                      {asset.error ? <p className="mt-2 text-xs text-error">{asset.error}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
              {imageSignatureSteps.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {imageSignatureSteps.map(step => (
                    <div key={step.assetId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{step.filename}</span>
                      <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">{step.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="surface-card rounded-lg p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{isFeedbackBonusStep ? "Fund Feedback Bonus" : "Submit Ask"}</h2>
                {isFeedbackBonusStep ? (
                  <p className="mt-1 text-sm text-base-content/60">
                    The question is submitted, but raters will not see the Feedback Bonus until these wallet calls are
                    funded.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-outline btn-sm"
                  disabled={isBusy}
                  type="button"
                  onClick={() => void loadHandoff()}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  Refresh
                </button>
                <GradientActionButton
                  className="min-w-28"
                  disabled={!canSubmit}
                  motion={getGradientActionMotion(isBusy)}
                  size="sm"
                  onClick={() => void handleSubmitAsk()}
                >
                  {isBusy ? (
                    <span className="flex items-center gap-2">
                      <span className="loading loading-spinner loading-xs" />
                      <span>{submitLabel}</span>
                    </span>
                  ) : (
                    submitLabel
                  )}
                </GradientActionButton>
              </div>
            </div>

            {isExpiredHandoff ? (
              <div className="surface-card-nested mt-4 rounded-lg border border-error/20 bg-error/10 p-4 text-sm text-error">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">This handoff link expired.</p>
                    <p className="mt-1 text-error/80">
                      Ask agent for a fresh link before editing or submitting this ask.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {handoff.publicUrl && !isFeedbackBonusStep ? (
              <Link className="btn btn-outline btn-sm mt-4" href={handoff.publicUrl}>
                View public result
              </Link>
            ) : null}
          </section>
        </>
      ) : null}

      {submittedContent ? (
        <ShareModal
          contentId={submittedContent.id}
          title={submittedContent.title}
          description={submittedContent.description}
          lastActivityAt={submittedContent.lastActivityAt}
          onClose={handleCloseShareModal}
        />
      ) : null}
    </AppPageShell>
  );
}
