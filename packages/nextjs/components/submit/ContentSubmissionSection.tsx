"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import {
  type TargetAudience,
  getProfileSelfReportTaxonomy,
  normalizeTargetAudience,
} from "@rateloop/node-utils/profileSelfReport";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, isAddress, toHex } from "viem";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { getPublicClient, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ContentEmbed } from "~~/components/content/ContentEmbed";
import { BountyFundingWarning } from "~~/components/shared/BountyFundingWarning";
import { GasBalanceWarning, shouldShowGasWarningTransactionCostsLink } from "~~/components/shared/GasBalanceWarning";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { ImageAttachmentUploader } from "~~/components/submit/ImageAttachmentUploader";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { serializeTags } from "~~/constants/categories";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useLocalE2ETestWalletClient } from "~~/hooks/scaffold-eth/useLocalE2ETestWalletClient";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { type Category, useCategoryRegistry } from "~~/hooks/useCategoryRegistry";
import { fetchThumbnailMetadataBatch, shouldFetchMetadataUrl } from "~~/hooks/useContentFeedMetadata";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionStatusToast } from "~~/hooks/useTransactionStatusToast";
import { useWalletMessageSigner } from "~~/hooks/useWalletMessageSigner";
import { useWalletRpcRecovery } from "~~/hooks/useWalletRpcRecovery";
import { type AgentQuestionSpecInput, buildQuestionSpecHashes } from "~~/lib/agent/questionSpecs";
import {
  MAX_QUESTION_DETAILS_TEXT_LENGTH,
  getQuestionDetailsTextSizeBytes,
  normalizeQuestionDetailsText,
} from "~~/lib/attachments/questionDetails.shared";
import {
  BOUNTY_ELIGIBILITY_CREDENTIAL_OPTIONS,
  BOUNTY_ELIGIBILITY_OPEN,
  buildBountyEligibility,
} from "~~/lib/bountyEligibility";
import {
  BOUNTY_WINDOW_PRESETS,
  type BountyWindowPreset,
  type BountyWindowUnit,
  DEFAULT_BOUNTY_WINDOW_PRESET,
  DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT,
  DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  formatBountyWindowDuration,
  getBountyStartByFromWindowSeconds,
  getBountyWindowSeconds,
  parseBountyWindowAmount,
  resolveBountyReferenceNowSeconds,
} from "~~/lib/bountyWindows";
import {
  MAX_SUBMISSION_IMAGE_URLS,
  MAX_SUBMISSION_URL_LENGTH,
  isContractSubmissionImageUrl,
  isDirectImageUrl,
  isUploadedImageUrl,
  isYouTubeVideoUrl,
  normalizeSubmissionContextUrl,
  normalizeSubmissionMediaUrl,
} from "~~/lib/contentMedia";
import { MAX_QUESTION_LENGTH } from "~~/lib/contentTitle";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";
import {
  findBlockedContentTags,
  getContentTagValidationError,
  getContentTitleValidationError,
} from "~~/lib/moderation/submissionValidation";
import {
  getContentRegistrySubmissionRewardMinimum,
  getSubmissionRewardCoverageMinimum,
} from "~~/lib/questionRewardMinimums";
import {
  DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS,
  DEFAULT_SUBMISSION_REWARD_POOL,
  ERC20_APPROVAL_ABI,
  FEEDBACK_BONUS_ASSET_LREP,
  FEEDBACK_BONUS_ASSET_USDC,
  FEEDBACK_BONUS_ESCROW_ABI,
  type FeedbackBonusAsset,
  MAX_REWARD_POOL_SETTLED_ROUNDS,
  MIN_REWARD_POOL_REQUIRED_VOTERS,
  MIN_REWARD_POOL_SETTLED_ROUNDS,
  QUESTION_SUBMISSION_ABI,
  SUBMISSION_REWARD_ASSET_LREP,
  SUBMISSION_REWARD_ASSET_USDC,
  type SubmissionRewardAsset,
  formatFeedbackBonusAmount,
  formatSubmissionRewardAmount,
  getConfiguredFeedbackBonusEscrowAddress,
  getDefaultUsdcAddress,
  parseFeedbackBonusAmount,
  parseSubmissionRewardAmount,
} from "~~/lib/questionRewardPools";
import {
  DEFAULT_QUESTION_ROUND_CONFIG,
  DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS,
  MAX_QUESTION_BUNDLE_ROUND_VOTERS,
  QUESTION_ROUND_MAX_EPOCH_COUNT,
  formatDurationLabel,
  getQuestionRoundMaxDurationForEpoch,
  isQuestionRoundMaxDurationValidForEpoch,
  questionRoundConfigToAbi,
  requiredQuestionRewardVotersForAmount,
} from "~~/lib/questionRoundConfig";
import {
  buildQuestionBundleSubmissionRevealCommitment,
  buildQuestionSubmissionKey,
  buildQuestionSubmissionRevealCommitment,
} from "~~/lib/questionSubmissionCommitment";
import {
  assertContentRegistryQuestionSubmissionSelector,
  getSubmissionErrorMessage,
} from "~~/lib/questionSubmissionSelectorSupport";
import {
  getGasBalanceErrorMessage,
  isFreeTransactionExhaustedError,
  isInsufficientFundsError,
  isWalletRpcOverloadedError,
} from "~~/lib/transactionErrors";
import { containsBlockedUrl } from "~~/utils/contentFilter";
import { sanitizeExternalUrl } from "~~/utils/externalUrl";
import { notification } from "~~/utils/scaffold-eth";

const ShareModal = dynamic(() => import("~~/components/submit/ShareModal").then(m => m.ShareModal), { ssr: false });

type MediaMode = "images" | "video";

const MEDIA_URL_CONFIG = {
  contextPlaceholder: "Paste a source link, or add media context below",
  videoPlaceholder: "Paste a YouTube URL, e.g. https://youtube.com/watch?v=...",
  imageHint:
    "Add at least one image when there is no context link. Upload up to four JPG, PNG, or WEBP files for RateLoop-hosted, moderated image context. Landscape images fit the voting content area best; aim for 16:9 and at least 1280x720 px.",
  videoHint: "Add one YouTube link as public video context. Standard landscape videos fit the content area best.",
};

type SubmissionStep = "question" | "bounty" | "feedbackBonus";
type FeedbackBonusSelection = "none" | "enabled";

const MAX_QUESTION_BUNDLE_COUNT = 10;
const MAX_CONTENT_TAGS_LENGTH = 256;
const DEFAULT_SUBMISSION_BOUNTY_AMOUNT = "1";
const DEFAULT_SUBMISSION_ROUND_MAX_VOTERS = 100;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const MIN_HUMAN_RESPONSE_WINDOW_MINUTES = 20;
const QUESTION_DETAILS_PREVIEW_WORDS = 32;
const ROUND_RESPONSE_WINDOW_PRESETS = [
  { id: "2m", label: "2m", minutes: 2 },
  { id: "5m", label: "5m", minutes: 5 },
  { id: "20m", label: "20m", minutes: 20 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "24h", label: "24h", minutes: 24 * 60 },
  { id: "3d", label: "3d", minutes: 3 * 24 * 60 },
  { id: "7d", label: "7d", minutes: 7 * 24 * 60 },
  { id: "14d", label: "14d", minutes: 14 * 24 * 60 },
  { id: "30d", label: "30d", minutes: 30 * 24 * 60 },
] as const;
const TARGET_AUDIENCE_TAXONOMY = getProfileSelfReportTaxonomy().targetAudience;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

type TargetAudienceDraftField = "ageGroups" | "countries" | "expertise" | "languages" | "nationalities" | "roles";
type QuestionTargetAudienceDraft = Record<TargetAudienceDraftField, string[]>;

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

function targetAudienceToQuestionSpecInput(value: TargetAudience | null): AgentQuestionSpecInput["targetAudience"] {
  return value as unknown as AgentQuestionSpecInput["targetAudience"];
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

type QuestionDraft = {
  mediaMode: MediaMode;
  contextUrl: string;
  imageUrls: string[];
  videoUrl: string;
  title: string;
  detailsText: string;
  selectedCategory: Category | null;
  selectedSubcategories: string[];
  customSubcategory: string;
  targetAudience: QuestionTargetAudienceDraft;
};

type ValidatedQuestionDraft = {
  blockedContentTags: string[];
  hasMediaError: boolean;
  hasQuestionErrors: boolean;
  submittedContextUrl: string;
  submittedImageUrls: string[];
  submittedVideoUrl: string;
  submittedTags: string;
  trimmedDetailsText: string;
  trimmedTitle: string;
  selectedCategory: Category | null;
  targetAudience: TargetAudience | null;
};

type QuestionTaxonomySelection = Pick<QuestionDraft, "selectedCategory" | "selectedSubcategories">;

function createEmptyQuestionDraft(): QuestionDraft {
  return {
    mediaMode: "images",
    contextUrl: "",
    imageUrls: [""],
    videoUrl: "",
    title: "",
    detailsText: "",
    selectedCategory: null,
    selectedSubcategories: [],
    customSubcategory: "",
    targetAudience: createEmptyTargetAudienceDraft(),
  };
}

function createQuestionDraftWithTaxonomy(source: QuestionTaxonomySelection): QuestionDraft {
  return {
    ...createEmptyQuestionDraft(),
    selectedCategory: source.selectedCategory,
    selectedSubcategories: [...source.selectedSubcategories],
  };
}

function getDetailsPreviewText(value: string, wordLimit = QUESTION_DETAILS_PREVIEW_WORDS) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= wordLimit) {
    return words.join(" ");
  }
  return `${words.slice(0, wordLimit).join(" ")}...`;
}

const EMPTY_SUBMISSION_DETAILS = {
  detailsUrl: "",
  detailsHash: `0x${"0".repeat(64)}` as `0x${string}`,
};

function createQuestionDetailsId() {
  const bytes = new Uint8Array(18);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `det_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function areSubcategorySelectionsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areTaxonomySelectionsEqual(left: QuestionTaxonomySelection, right: QuestionTaxonomySelection): boolean {
  const leftCategoryId = left.selectedCategory?.id.toString() ?? null;
  const rightCategoryId = right.selectedCategory?.id.toString() ?? null;
  return (
    leftCategoryId === rightCategoryId &&
    areSubcategorySelectionsEqual(left.selectedSubcategories, right.selectedSubcategories)
  );
}

function shouldInheritFirstQuestionTaxonomy(
  draft: QuestionDraft,
  previousSelection: QuestionTaxonomySelection,
): boolean {
  if (!draft.selectedCategory && draft.selectedSubcategories.length === 0) {
    return true;
  }

  return areTaxonomySelectionsEqual(draft, previousSelection);
}

function syncFirstQuestionTaxonomy(
  drafts: QuestionDraft[],
  previousSelection: QuestionTaxonomySelection,
  nextSelection: QuestionTaxonomySelection,
): QuestionDraft[] {
  return drafts.map((draft, index) => {
    if (index !== 0 && !shouldInheritFirstQuestionTaxonomy(draft, previousSelection)) {
      return draft;
    }

    return {
      ...draft,
      selectedCategory: nextSelection.selectedCategory,
      selectedSubcategories: [...nextSelection.selectedSubcategories],
    };
  });
}

function createRandomHex32(): `0x${string}` {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function normalizeWholeNumberInput(value: string): string | null {
  if (value === "" || /^\d+$/.test(value)) {
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

function getSyncedSettlementVotersForPaidCompleters(value: string, min: number, max: number): string {
  return value === "" ? "" : clampWholeNumberInput(value, min, max);
}

function divideRewardAmount(total: bigint, divisor: bigint): bigint {
  return divisor > 0n ? total / divisor : 0n;
}

function applyEstimatedFrontendFee(amount: bigint, frontendFeeBps: number): bigint {
  const normalizedBps = Math.max(0, Math.min(10_000, Math.floor(frontendFeeBps)));
  const frontendFee = (amount * BigInt(normalizedBps)) / 10_000n;
  return amount > frontendFee ? amount - frontendFee : 0n;
}

function formatFrontendFeePercent(frontendFeeBps: number): string {
  const normalizedBps = Math.max(0, Math.min(10_000, Math.floor(frontendFeeBps)));
  const whole = Math.floor(normalizedBps / 100);
  const fractional = normalizedBps % 100;
  return fractional === 0 ? `${whole}%` : `${whole}.${String(fractional).padStart(2, "0").replace(/0+$/, "")}%`;
}

function formatSubmissionRewardInputAmount(value: bigint, asset: SubmissionRewardAsset): string {
  return formatSubmissionRewardAmount(value, asset).replace(/ (?:LREP|USDC)$/, "");
}

function formatShortAddress(address: string | undefined): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connect wallet";
}

function formatBountyExpiryDate(windowSeconds: number | null, referenceTimeMs: number | null): string {
  if (windowSeconds === null) {
    return "Choose a window";
  }
  if (referenceTimeMs === null) {
    return "Calculating...";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(referenceTimeMs + windowSeconds * 1000));
}

function isReservationExistsError(error: unknown): boolean {
  const message =
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ??
    (error as { shortMessage?: string; message?: string } | undefined)?.message ??
    "";
  return message.includes("Reservation exists");
}

function isReservationNotFoundError(error: unknown): boolean {
  const message =
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ??
    (error as { shortMessage?: string; message?: string } | undefined)?.message ??
    "";
  return message.includes("Reservation not found");
}

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      className={`${className || "h-5 w-5"} inline-flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function AudienceChipGroup({
  label,
  onToggle,
  options,
  selected,
}: {
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
              onClick={() => onToggle(option)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isSelected ? "pill-active" : "pill-inactive"
              }`}
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
  error,
  inputValue,
  label,
  onAdd,
  onInputChange,
  onRemove,
  selected,
}: {
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
          className={`input input-bordered input-sm w-24 bg-base-100 uppercase ${error ? "input-error" : ""}`}
        />
        <button type="button" onClick={onAdd} className="btn btn-outline btn-sm">
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
              className="pill-active flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium"
            >
              {value}
              <span className="opacity-70">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ContentSubmissionSection() {
  const wagmiConfig = useConfig();
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(connectedAddress, targetNetwork.id);
  const {
    canSponsorTransactions,
    freeTransactionRemaining,
    freeTransactionVerified,
    isMissingGasBalance,
    nativeTokenSymbol,
  } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const showGasWarningTransactionCostsLink = shouldShowGasWarningTransactionCostsLink({
    freeTransactionRemaining,
    freeTransactionVerified,
  });
  const statusToast = useTransactionStatusToast();
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeSponsoredCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const canUseBatchedSubmitCalls = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const submitCallSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
  const { showWalletRpcOverloadNotification } = useWalletRpcRecovery();
  const { requireAcceptance } = useTermsAcceptance();
  const { signMessageAsync } = useWalletMessageSigner({
    address: connectedAddress,
    localWalletClient: localE2ETestWalletClient,
  });

  const [mediaMode, setMediaMode] = useState<MediaMode>("images");
  const [contextUrl, setContextUrl] = useState("");
  const [contextUrlError, setContextUrlError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [imageUrlErrors, setImageUrlErrors] = useState<(string | null)[]>([null]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoUrlError, setVideoUrlError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [detailsText, setDetailsText] = useState("");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
  const [customSubcategory, setCustomSubcategory] = useState("");
  const [targetAudience, setTargetAudience] = useState<QuestionTargetAudienceDraft>(createEmptyTargetAudienceDraft());
  const [targetAudienceCountryInput, setTargetAudienceCountryInput] = useState("");
  const [targetAudienceCountryError, setTargetAudienceCountryError] = useState<string | null>(null);
  const [targetAudienceNationalityInput, setTargetAudienceNationalityInput] = useState("");
  const [targetAudienceNationalityError, setTargetAudienceNationalityError] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(1);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([createEmptyQuestionDraft()]);
  const [rewardAsset, setRewardAsset] = useState<SubmissionRewardAsset>("usdc");
  const [rewardAmount, setRewardAmount] = useState(DEFAULT_SUBMISSION_BOUNTY_AMOUNT);
  const [rewardAmountTouched, setRewardAmountTouched] = useState(false);
  const [rewardRequiredVoters, setRewardRequiredVoters] = useState("3");
  const [rewardRequiredRounds, setRewardRequiredRounds] = useState("1");
  const [bountyEligibility, setBountyEligibility] = useState(BOUNTY_ELIGIBILITY_OPEN);
  const [bountyRequiresRecentRecheck, setBountyRequiresRecentRecheck] = useState(false);
  const [bountyWindowPreset, setBountyWindowPreset] = useState<BountyWindowPreset>(DEFAULT_BOUNTY_WINDOW_PRESET);
  const [customBountyWindowAmount, setCustomBountyWindowAmount] = useState(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
  const [customBountyWindowUnit, setCustomBountyWindowUnit] = useState<BountyWindowUnit>(
    DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  );
  const [bountyWindowOverridden, setBountyWindowOverridden] = useState(false);
  const [bountyStartByPreset, setBountyStartByPreset] = useState<BountyWindowPreset>(DEFAULT_BOUNTY_WINDOW_PRESET);
  const [customBountyStartByAmount, setCustomBountyStartByAmount] = useState(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
  const [customBountyStartByUnit, setCustomBountyStartByUnit] = useState<BountyWindowUnit>(
    DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  );
  const [bountyStartByOverridden, setBountyStartByOverridden] = useState(false);
  const [bountyExpiryReferenceTimeMs, setBountyExpiryReferenceTimeMs] = useState<number | null>(null);
  const [feedbackBonusMode, setFeedbackBonusMode] = useState<FeedbackBonusSelection>("none");
  const [feedbackBonusAmount, setFeedbackBonusAmount] = useState("2");
  const [feedbackBonusAsset, setFeedbackBonusAsset] = useState<FeedbackBonusAsset>("usdc");
  const [feedbackBonusAwarderAddress, setFeedbackBonusAwarderAddress] = useState("");
  const [feedbackBonusAwarderTouched, setFeedbackBonusAwarderTouched] = useState(false);
  const [feedbackBonusStepAttempted, setFeedbackBonusStepAttempted] = useState(false);
  const [roundBlindMinutes, setRoundBlindMinutes] = useState(
    String(Number(DEFAULT_QUESTION_ROUND_CONFIG.epochDuration / 60n)),
  );
  const [roundMaxDurationMinutes, setRoundMaxDurationMinutes] = useState(
    String(Number(DEFAULT_QUESTION_ROUND_CONFIG.maxDuration / 60n)),
  );
  const [roundMinVoters, setRoundMinVoters] = useState(String(DEFAULT_QUESTION_ROUND_CONFIG.minVoters));
  const [roundMaxVoters, setRoundMaxVoters] = useState(String(DEFAULT_SUBMISSION_ROUND_MAX_VOTERS));
  const [roundConfigTouched, setRoundConfigTouched] = useState(false);
  const [roundMaxDurationOverridden, setRoundMaxDurationOverridden] = useState(false);
  const [showAdvancedRoundSettings, setShowAdvancedRoundSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [questionStepAttempted, setQuestionStepAttempted] = useState(false);
  const [bountyStepAttempted, setBountyStepAttempted] = useState(false);
  const [submissionStep, setSubmissionStep] = useState<SubmissionStep>("question");
  const [submittedContent, setSubmittedContent] = useState<{
    id: bigint;
    title: string;
    description: string;
    lastActivityAt: string;
  } | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  const { categories, isLoading: categoriesLoading } = useCategoryRegistry();

  useEffect(() => {
    setBountyExpiryReferenceTimeMs(Date.now());
  }, [
    bountyStartByOverridden,
    bountyStartByPreset,
    bountyWindowOverridden,
    bountyWindowPreset,
    customBountyStartByAmount,
    customBountyStartByUnit,
    customBountyWindowAmount,
    customBountyWindowUnit,
    roundBlindMinutes,
    roundMaxDurationMinutes,
  ]);

  useEffect(() => {
    if (feedbackBonusAwarderTouched) return;
    setFeedbackBonusAwarderAddress(connectedAddress ?? "");
  }, [connectedAddress, feedbackBonusAwarderTouched]);

  useEffect(() => {
    if (!selectedCategory) return;
    const latestCategory = categories.find(category => category.id === selectedCategory.id);
    if (!latestCategory || latestCategory === selectedCategory) return;

    setSelectedCategory(latestCategory);
    setQuestionDrafts(prev =>
      prev.map(draft =>
        draft.selectedCategory?.id === latestCategory.id ? { ...draft, selectedCategory: latestCategory } : draft,
      ),
    );
  }, [categories, selectedCategory]);

  const getActiveQuestionDraft = (): QuestionDraft => ({
    mediaMode,
    contextUrl,
    imageUrls,
    videoUrl,
    title,
    detailsText,
    selectedCategory,
    selectedSubcategories,
    customSubcategory,
    targetAudience: cloneTargetAudienceDraft(targetAudience),
  });

  const patchActiveQuestionDraft = (patch: Partial<QuestionDraft>) => {
    setQuestionDrafts(prev =>
      prev.map((draft, index) => (index === activeQuestionIndex ? { ...draft, ...patch } : draft)),
    );
  };

  const loadQuestionDraft = (draft: QuestionDraft) => {
    setMediaMode(draft.mediaMode);
    setContextUrl(draft.contextUrl);
    setContextUrlError(null);
    setImageUrls(draft.imageUrls.length > 0 ? draft.imageUrls : [""]);
    setImageUrlErrors((draft.imageUrls.length > 0 ? draft.imageUrls : [""]).map(() => null));
    setVideoUrl(draft.videoUrl);
    setVideoUrlError(null);
    setTitle(draft.title);
    setTitleError(null);
    setDetailsText(draft.detailsText);
    setDetailsError(null);
    setSelectedCategory(draft.selectedCategory);
    setSelectedSubcategories(draft.selectedSubcategories);
    setCustomSubcategory(draft.customSubcategory);
    setTargetAudience(cloneTargetAudienceDraft(draft.targetAudience));
    setTargetAudienceCountryInput("");
    setTargetAudienceCountryError(null);
    setTargetAudienceNationalityInput("");
    setTargetAudienceNationalityError(null);
    setQuestionStepAttempted(false);
    setIsCategoryDropdownOpen(false);
    setCategorySearch("");
  };

  const setActiveQuestionPage = (index: number, drafts = questionDrafts) => {
    const nextIndex = Math.max(0, Math.min(index, questionCount - 1));
    setActiveQuestionIndex(nextIndex);
    loadQuestionDraft(drafts[nextIndex] ?? createEmptyQuestionDraft());
    setSubmissionStep("question");
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setIsCategoryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const search = categorySearch.toLowerCase();
    return categories.filter(
      cat =>
        cat.name.toLowerCase().includes(search) ||
        cat.slug.toLowerCase().includes(search) ||
        cat.subcategories.some(subcategory => subcategory.toLowerCase().includes(search)),
    );
  }, [categories, categorySearch]);

  const urlConfig = MEDIA_URL_CONFIG;
  const selectedTags = serializeTags(selectedSubcategories);
  const selectedTagsValidationError =
    selectedTags.length > MAX_CONTENT_TAGS_LENGTH
      ? `Categories must be ${MAX_CONTENT_TAGS_LENGTH} characters or fewer.`
      : null;
  const pendingCustomTags = customSubcategory.trim()
    ? serializeTags([...selectedSubcategories, customSubcategory.trim()])
    : selectedTags;
  const customSubcategoryError = customSubcategory
    ? (getContentTagValidationError(customSubcategory) ??
      (pendingCustomTags.length > MAX_CONTENT_TAGS_LENGTH
        ? `Categories must be ${MAX_CONTENT_TAGS_LENGTH} characters or fewer.`
        : null))
    : null;

  const getContextUrlValidationError = (value: string): string | null => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }
    if (trimmedValue.length > MAX_SUBMISSION_URL_LENGTH) {
      return `URL must be ${MAX_SUBMISSION_URL_LENGTH} characters or fewer.`;
    }

    const sanitizedUrl = sanitizeExternalUrl(trimmedValue);
    if (!sanitizedUrl) {
      return "Please enter a valid HTTPS URL";
    }

    const urlCheck = containsBlockedUrl(sanitizedUrl);
    if (urlCheck.blocked) {
      return "This URL contains prohibited content and cannot be used";
    }

    if (isDirectImageUrl(sanitizedUrl)) {
      return "Image links are not supported as context links. Upload the image below instead.";
    }

    return normalizeSubmissionContextUrl(trimmedValue) ? null : "Please enter a valid HTTPS URL";
  };

  const handleContextUrlChange = (value: string) => {
    setContextUrl(value);
    patchActiveQuestionDraft({ contextUrl: value });
    setContextUrlError(value.trim() ? getContextUrlValidationError(value) : null);
  };

  const handleDetailsTextChange = (value: string) => {
    setDetailsText(value);
    patchActiveQuestionDraft({ detailsText: value });
    try {
      if (value.trim()) normalizeQuestionDetailsText(value);
      setDetailsError(null);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "Details are invalid.");
    }
  };

  const getMediaUrlValidationError = (
    value: string,
    expectedType: MediaMode,
    options: { required?: boolean } = {},
  ): string | null => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return options.required
        ? expectedType === "video"
          ? "Add a YouTube URL before submitting."
          : "Upload at least one image before submitting."
        : null;
    }
    if (trimmedValue.length > MAX_SUBMISSION_URL_LENGTH) {
      return `URL must be ${MAX_SUBMISSION_URL_LENGTH} characters or fewer.`;
    }

    const normalizedUrl = normalizeSubmissionMediaUrl(trimmedValue);
    if (!normalizedUrl) {
      return "Please enter a valid HTTPS URL";
    }

    const urlCheck = containsBlockedUrl(normalizedUrl);
    if (urlCheck.blocked) {
      return "This URL contains prohibited content and cannot be used";
    }

    if (expectedType === "images" && !isUploadedImageUrl(normalizedUrl)) {
      return "Use an approved RateLoop image upload.";
    }

    if (expectedType === "images" && !isContractSubmissionImageUrl(normalizedUrl)) {
      return "Local image uploads must be served from an HTTPS RateLoop URL before submitting.";
    }

    if (expectedType === "video" && !isYouTubeVideoUrl(normalizedUrl)) {
      return "Use a YouTube URL.";
    }

    return null;
  };

  const handleUploadedImageUrl = (uploadedImageUrl: string) => {
    const emptyIndex = imageUrls.findIndex(url => !url.trim());
    const next =
      emptyIndex >= 0
        ? imageUrls.map((url, index) => (index === emptyIndex ? uploadedImageUrl : url))
        : imageUrls.length < MAX_SUBMISSION_IMAGE_URLS
          ? [...imageUrls, uploadedImageUrl]
          : imageUrls;

    setMediaMode("images");
    setImageUrls(next);
    patchActiveQuestionDraft({ mediaMode: "images", imageUrls: next });
    setImageUrlErrors(next.map(value => (value.trim() ? getMediaUrlValidationError(value, "images") : null)));
  };

  const handleRemoveImageUrl = (index: number) => {
    if (imageUrls.length === 1) {
      setImageUrls([""]);
      patchActiveQuestionDraft({ imageUrls: [""] });
      setImageUrlErrors([null]);
      return;
    }

    setImageUrls(prev => {
      const next = prev.filter((_, itemIndex) => itemIndex !== index);
      patchActiveQuestionDraft({ imageUrls: next });
      return next;
    });
    setImageUrlErrors(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const validateVideoUrl = (value: string, required = false) => {
    setVideoUrlError(getMediaUrlValidationError(value, "video", { required }));
  };

  const handleVideoUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setVideoUrl(value);
    patchActiveQuestionDraft({ videoUrl: value });
    validateVideoUrl(value);
  };

  const normalizedImageUrls = useMemo(
    () =>
      imageUrls
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => normalizeSubmissionMediaUrl(value))
        .filter((value): value is string => Boolean(value)),
    [imageUrls],
  );
  const normalizedVideoUrl = useMemo(
    () => (videoUrl.trim() ? (normalizeSubmissionMediaUrl(videoUrl) ?? "") : ""),
    [videoUrl],
  );
  const normalizedContextUrl = useMemo(
    () => (contextUrl.trim() ? (normalizeSubmissionContextUrl(contextUrl) ?? "") : ""),
    [contextUrl],
  );
  const previewMediaUrl = mediaMode === "video" ? normalizedVideoUrl : (normalizedImageUrls[0] ?? "");
  const hasValidPreviewMedia =
    Boolean(previewMediaUrl) &&
    (mediaMode === "video"
      ? !videoUrlError && isYouTubeVideoUrl(previewMediaUrl)
      : !imageUrlErrors.some(Boolean) && isUploadedImageUrl(previewMediaUrl));
  const previewUrl = hasValidPreviewMedia ? previewMediaUrl : normalizedContextUrl;
  const shouldUseContextLinkPreview = Boolean(normalizedContextUrl) && previewUrl === normalizedContextUrl;
  const shouldFetchContextPreviewMetadata =
    shouldUseContextLinkPreview &&
    !isUploadedImageUrl(normalizedContextUrl) &&
    !isYouTubeVideoUrl(normalizedContextUrl) &&
    shouldFetchMetadataUrl(normalizedContextUrl);
  const { data: contextPreviewMetadataMap } = useQuery({
    queryKey: ["submissionContextPreviewMetadata", normalizedContextUrl],
    enabled: shouldFetchContextPreviewMetadata,
    staleTime: 60_000,
    queryFn: async () => fetchThumbnailMetadataBatch([normalizedContextUrl]),
  });
  const contextPreviewThumbnailUrl = shouldFetchContextPreviewMetadata
    ? (contextPreviewMetadataMap?.[normalizedContextUrl]?.thumbnailUrl ?? null)
    : null;

  const handleCategorySelect = (category: Category) => {
    const previousSelection = { selectedCategory, selectedSubcategories };
    const nextSelection: QuestionTaxonomySelection = { selectedCategory: category, selectedSubcategories: [] };
    setSelectedCategory(category);
    setSelectedSubcategories([]);
    if (activeQuestionIndex === 0) {
      setQuestionDrafts(prev => syncFirstQuestionTaxonomy(prev, previousSelection, nextSelection));
    } else {
      patchActiveQuestionDraft(nextSelection);
    }
  };

  const handleSubcategoryToggle = (subcategory: string) => {
    setSelectedSubcategories(prev => {
      let next = prev;
      if (prev.includes(subcategory)) {
        next = prev.filter(s => s !== subcategory);
      } else if (prev.length < 3) {
        next = [...prev, subcategory];
      }
      if (activeQuestionIndex === 0) {
        setQuestionDrafts(prevDrafts =>
          syncFirstQuestionTaxonomy(
            prevDrafts,
            { selectedCategory, selectedSubcategories: prev },
            { selectedCategory, selectedSubcategories: next },
          ),
        );
      } else {
        patchActiveQuestionDraft({ selectedSubcategories: next });
      }
      return next;
    });
  };

  const handleAddCustomSubcategory = () => {
    const trimmed = customSubcategory.trim();
    const nextSerializedTags = serializeTags([...selectedSubcategories, trimmed]);
    if (
      trimmed &&
      !selectedSubcategories.includes(trimmed) &&
      selectedSubcategories.length < 3 &&
      getContentTagValidationError(trimmed) === null &&
      nextSerializedTags.length <= MAX_CONTENT_TAGS_LENGTH
    ) {
      setSelectedSubcategories(prev => {
        const next = [...prev, trimmed];
        if (activeQuestionIndex === 0) {
          setQuestionDrafts(prevDrafts =>
            syncFirstQuestionTaxonomy(
              prevDrafts,
              { selectedCategory, selectedSubcategories: prev },
              { selectedCategory, selectedSubcategories: next },
            ).map((draft, index) => (index === activeQuestionIndex ? { ...draft, customSubcategory: "" } : draft)),
          );
        } else {
          patchActiveQuestionDraft({ selectedSubcategories: next, customSubcategory: "" });
        }
        return next;
      });
      setCustomSubcategory("");
    }
  };

  const updateTargetAudienceDraft = (
    updater: (current: QuestionTargetAudienceDraft) => QuestionTargetAudienceDraft,
  ) => {
    setTargetAudience(current => {
      const next = updater(cloneTargetAudienceDraft(current));
      patchActiveQuestionDraft({ targetAudience: cloneTargetAudienceDraft(next) });
      return next;
    });
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
    const rawValue = field === "countries" ? targetAudienceCountryInput : targetAudienceNationalityInput;
    const normalized = normalizeAudienceCountryCodeInput(rawValue);
    if (!normalized) {
      const setError = field === "countries" ? setTargetAudienceCountryError : setTargetAudienceNationalityError;
      setError("Use a two-letter country code.");
      return;
    }

    updateTargetAudienceDraft(current => {
      if (current[field].includes(normalized)) return current;
      return { ...current, [field]: [...current[field], normalized] };
    });
    if (field === "countries") {
      setTargetAudienceCountryInput("");
      setTargetAudienceCountryError(null);
    } else {
      setTargetAudienceNationalityInput("");
      setTargetAudienceNationalityError(null);
    }
  };

  const { writeContractAsync: writeRegistry } = useScaffoldWriteContract({
    contractName: "ContentRegistry",
    disableSimulate: true,
  });
  const { data: registryInfo, isLoading: isRegistryLoading } = useDeployedContractInfo({
    contractName: "ContentRegistry",
  });
  const { data: lrepInfo, isLoading: isLrepLoading } = useDeployedContractInfo({
    contractName: REPUTATION_CONTRACT_NAME,
  });
  const { data: rewardEscrowInfo, isLoading: isRewardEscrowLoading } = useDeployedContractInfo({
    contractName: "QuestionRewardPoolEscrow",
  });
  const registryAddress = registryInfo?.address as `0x${string}` | undefined;
  const lrepAddress = lrepInfo?.address as `0x${string}` | undefined;
  const rewardEscrowAddress = rewardEscrowInfo?.address as `0x${string}` | undefined;
  const { data: defaultFrontendFeeBps } = useScaffoldReadContract({
    contractName: "QuestionRewardPoolEscrow" as any,
    functionName: "defaultFrontendFeeBps" as any,
    watch: false,
    query: {
      staleTime: 300_000,
    },
  } as any);
  const { data: minSubmissionLrepPool } = useScaffoldReadContract({
    contractName: "ProtocolConfig" as any,
    functionName: "minSubmissionLrepPool" as any,
    watch: false,
    query: {
      staleTime: 300_000,
    },
  } as any);
  const { data: minSubmissionUsdcPool } = useScaffoldReadContract({
    contractName: "ProtocolConfig" as any,
    functionName: "minSubmissionUsdcPool" as any,
    watch: false,
    query: {
      staleTime: 300_000,
    },
  } as any);
  const { data: protocolRoundConfig } = useScaffoldReadContract({
    contractName: "ProtocolConfig" as any,
    functionName: "config" as any,
    watch: false,
    query: {
      staleTime: 300_000,
    },
  } as any);
  const { data: protocolRoundConfigBounds } = useScaffoldReadContract({
    contractName: "ProtocolConfig" as any,
    functionName: "roundConfigBounds" as any,
    watch: false,
    query: {
      staleTime: 300_000,
    },
  } as any);
  const roundConfigDefaults = useMemo(() => {
    const value = protocolRoundConfig as any;
    return {
      epochDuration: Number(value?.epochDuration ?? value?.[0] ?? DEFAULT_QUESTION_ROUND_CONFIG.epochDuration),
      maxDuration: Number(value?.maxDuration ?? value?.[1] ?? DEFAULT_QUESTION_ROUND_CONFIG.maxDuration),
      minVoters: Number(value?.minVoters ?? value?.[2] ?? DEFAULT_QUESTION_ROUND_CONFIG.minVoters),
      maxVoters: Number(value?.maxVoters ?? value?.[3] ?? DEFAULT_QUESTION_ROUND_CONFIG.maxVoters),
    };
  }, [protocolRoundConfig]);
  const roundConfigBounds = useMemo(() => {
    const value = protocolRoundConfigBounds as any;
    return {
      minEpochDuration: Number(
        value?.minEpochDuration ?? value?.[0] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minEpochDuration,
      ),
      maxEpochDuration: Number(
        value?.maxEpochDuration ?? value?.[1] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxEpochDuration,
      ),
      minRoundDuration: Number(
        value?.minRoundDuration ?? value?.[2] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minRoundDuration,
      ),
      maxRoundDuration: Number(
        value?.maxRoundDuration ?? value?.[3] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxRoundDuration,
      ),
      minSettlementVoters: Number(
        value?.minSettlementVoters ?? value?.[4] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minSettlementVoters,
      ),
      maxSettlementVoters: Number(
        value?.maxSettlementVoters ?? value?.[5] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxSettlementVoters,
      ),
      minVoterCap: Number(value?.minVoterCap ?? value?.[6] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minVoterCap),
      maxVoterCap: Number(value?.maxVoterCap ?? value?.[7] ?? DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxVoterCap),
    };
  }, [protocolRoundConfigBounds]);
  const defaultRoundMaxVoters = useMemo(
    () =>
      clampWholeNumberInput(
        String(DEFAULT_SUBMISSION_ROUND_MAX_VOTERS),
        roundConfigBounds.minVoterCap,
        roundConfigBounds.maxVoterCap,
      ),
    [roundConfigBounds.maxVoterCap, roundConfigBounds.minVoterCap],
  );
  const syncedSettlementVoters = getSyncedSettlementVotersForPaidCompleters(
    rewardRequiredVoters,
    roundConfigBounds.minSettlementVoters,
    roundConfigBounds.maxSettlementVoters,
  );
  const syncSettlementVotersToPaidCompleters = (paidCompleters: string) => {
    setRoundMinVoters(
      getSyncedSettlementVotersForPaidCompleters(
        paidCompleters,
        roundConfigBounds.minSettlementVoters,
        roundConfigBounds.maxSettlementVoters,
      ),
    );
  };
  useEffect(() => {
    if (roundConfigTouched || !protocolRoundConfig) return;
    setRoundBlindMinutes(String(Math.max(1, Math.round(roundConfigDefaults.epochDuration / SECONDS_PER_MINUTE))));
    setRoundMaxDurationMinutes(String(Math.max(1, Math.round(roundConfigDefaults.maxDuration / SECONDS_PER_MINUTE))));
    setRoundMinVoters(syncedSettlementVoters);
    setRoundMaxVoters(defaultRoundMaxVoters);
  }, [defaultRoundMaxVoters, protocolRoundConfig, roundConfigDefaults, roundConfigTouched, syncedSettlementVoters]);
  const roundBlindMinuteBounds = useMemo(() => {
    const min = Math.ceil(roundConfigBounds.minEpochDuration / SECONDS_PER_MINUTE);
    const max = Math.max(min, Math.floor(roundConfigBounds.maxEpochDuration / SECONDS_PER_MINUTE));
    return { min, max };
  }, [roundConfigBounds.maxEpochDuration, roundConfigBounds.minEpochDuration]);
  const selectedRewardAssetId = rewardAsset === "lrep" ? SUBMISSION_REWARD_ASSET_LREP : SUBMISSION_REWARD_ASSET_USDC;
  const selectedRewardAmount = useMemo(() => parseSubmissionRewardAmount(rewardAmount), [rewardAmount]);
  const parsedRoundBlindMinutes = parseWholeNumberInput(roundBlindMinutes);
  const parsedRoundMaxDurationMinutes = parseWholeNumberInput(roundMaxDurationMinutes);
  const parsedRoundMinVoters = parseWholeNumberInput(roundMinVoters);
  const parsedRoundMaxVoters = parseWholeNumberInput(roundMaxVoters);
  const parsedRewardRequiredVoters = parseWholeNumberInput(rewardRequiredVoters);
  const parsedRewardRequiredRounds = parseWholeNumberInput(rewardRequiredRounds);
  const selectedRequiredVoters = BigInt(Math.max(MIN_REWARD_POOL_REQUIRED_VOTERS, parsedRewardRequiredVoters));
  const selectedRequiredSettledRounds = BigInt(Math.max(MIN_REWARD_POOL_SETTLED_ROUNDS, parsedRewardRequiredRounds));
  const selectedRequiredVoterFloor =
    selectedRewardAmount === null
      ? MIN_REWARD_POOL_REQUIRED_VOTERS
      : Number(requiredQuestionRewardVotersForAmount(selectedRewardAmount));
  const selectedRoundResponseWindowPreset =
    ROUND_RESPONSE_WINDOW_PRESETS.find(option => option.minutes === parsedRoundBlindMinutes)?.id ?? "custom";
  const effectiveBlindMinutesForDurationCap =
    parsedRoundBlindMinutes >= roundBlindMinuteBounds.min && parsedRoundBlindMinutes <= roundBlindMinuteBounds.max
      ? parsedRoundBlindMinutes
      : roundBlindMinuteBounds.min;
  const getRoundMaxDurationMinuteBoundsForBlind = (blindMinutes: number) => {
    const blindSeconds = Math.max(1, Math.floor(blindMinutes)) * SECONDS_PER_MINUTE;
    const maxDurationSeconds = getQuestionRoundMaxDurationForEpoch(blindSeconds, roundConfigBounds.maxRoundDuration);
    const minSeconds = Math.max(roundConfigBounds.minRoundDuration, blindSeconds);
    const min = Math.ceil(minSeconds / SECONDS_PER_MINUTE);
    const max = Math.max(min, Math.floor(maxDurationSeconds / SECONDS_PER_MINUTE));
    return { min, max };
  };
  const roundMaxDurationMinuteBounds = getRoundMaxDurationMinuteBoundsForBlind(effectiveBlindMinutesForDurationCap);
  const roundMaxVoterBounds = useMemo(() => {
    const bundleAwareMaxVoters =
      questionCount > 1
        ? Math.min(roundConfigBounds.maxVoterCap, MAX_QUESTION_BUNDLE_ROUND_VOTERS)
        : roundConfigBounds.maxVoterCap;

    return {
      min: roundConfigBounds.minVoterCap,
      max: Math.max(roundConfigBounds.minVoterCap, bundleAwareMaxVoters),
    };
  }, [questionCount, roundConfigBounds.maxVoterCap, roundConfigBounds.minVoterCap]);
  const updateRoundWholeNumberInput = (value: string, setValue: (nextValue: string) => void) => {
    const normalizedValue = normalizeWholeNumberInput(value);
    if (normalizedValue === null) {
      return;
    }

    setRoundConfigTouched(true);
    setValue(normalizedValue);
  };
  const clampRoundMaxDurationForBlindMinutes = (blindMinutes: number) => {
    const bounds = getRoundMaxDurationMinuteBoundsForBlind(blindMinutes);
    setRoundMaxDurationMinutes(current => {
      const currentValue = !roundMaxDurationOverridden ? blindMinutes : parseWholeNumberInput(current);
      return String(Math.min(Math.max(currentValue, bounds.min), bounds.max));
    });
  };
  const updateRoundBlindMinutesInput = (value: string) => {
    const normalizedValue = normalizeWholeNumberInput(value);
    if (normalizedValue === null) {
      return;
    }

    setRoundConfigTouched(true);
    setRoundBlindMinutes(normalizedValue);
    if (normalizedValue !== "") {
      clampRoundMaxDurationForBlindMinutes(parseWholeNumberInput(normalizedValue));
    }
  };
  const clampRoundBlindMinutesInput = () => {
    const clampedBlindMinutes = clampWholeNumberInput(
      roundBlindMinutes,
      roundBlindMinuteBounds.min,
      roundBlindMinuteBounds.max,
    );
    setRoundBlindMinutes(clampedBlindMinutes);
    clampRoundMaxDurationForBlindMinutes(parseWholeNumberInput(clampedBlindMinutes));
  };
  const selectedRoundConfig = useMemo(
    () => ({
      epochDuration: BigInt(Math.max(0, parsedRoundBlindMinutes) * SECONDS_PER_MINUTE),
      maxDuration: BigInt(Math.max(0, parsedRoundMaxDurationMinutes) * SECONDS_PER_MINUTE),
      minVoters: BigInt(Math.max(0, parsedRoundMinVoters)),
      maxVoters: BigInt(Math.max(0, parsedRoundMaxVoters)),
    }),
    [parsedRoundBlindMinutes, parsedRoundMaxDurationMinutes, parsedRoundMinVoters, parsedRoundMaxVoters],
  );
  const roundConfigValidationError = (() => {
    const epochDuration = Number(selectedRoundConfig.epochDuration);
    const maxDuration = Number(selectedRoundConfig.maxDuration);
    const minVoters = Number(selectedRoundConfig.minVoters);
    const maxVoters = Number(selectedRoundConfig.maxVoters);
    if (epochDuration < roundConfigBounds.minEpochDuration || epochDuration > roundConfigBounds.maxEpochDuration) {
      return `Blind phase must be ${formatDurationLabel(roundConfigBounds.minEpochDuration)}-${formatDurationLabel(
        roundConfigBounds.maxEpochDuration,
      )}.`;
    }
    if (maxDuration < roundConfigBounds.minRoundDuration || maxDuration > roundConfigBounds.maxRoundDuration) {
      return `Max duration must be ${formatDurationLabel(roundConfigBounds.minRoundDuration)}-${formatDurationLabel(
        roundConfigBounds.maxRoundDuration,
      )}.`;
    }
    if (maxDuration < epochDuration) {
      return "Max duration must be at least the blind response window.";
    }
    if (!isQuestionRoundMaxDurationValidForEpoch(epochDuration, maxDuration)) {
      return `Max duration can span at most ${QUESTION_ROUND_MAX_EPOCH_COUNT.toLocaleString()} blind phases; choose ${formatDurationLabel(
        roundMaxDurationMinuteBounds.max * SECONDS_PER_MINUTE,
      )} or less for this blind phase.`;
    }
    if (minVoters < roundConfigBounds.minSettlementVoters || minVoters > roundConfigBounds.maxSettlementVoters) {
      return `Settlement voters must be ${roundConfigBounds.minSettlementVoters}-${roundConfigBounds.maxSettlementVoters}.`;
    }
    if (BigInt(minVoters) !== selectedRequiredVoters) {
      return "Settlement voters must match required bounty voters.";
    }
    if (maxVoters < roundMaxVoterBounds.min || maxVoters > roundMaxVoterBounds.max) {
      return questionCount > 1
        ? `Max voters per round must be ${roundMaxVoterBounds.min}-${roundMaxVoterBounds.max} for question bundles.`
        : `Max voters per round must be ${roundMaxVoterBounds.min}-${roundMaxVoterBounds.max}.`;
    }
    if (maxVoters < minVoters) {
      return "Max voters per round must be at least the settlement voters.";
    }
    return null;
  })();
  const rewardRequiredVotersBounds = {
    min: selectedRequiredVoterFloor,
    max: Math.max(
      selectedRequiredVoterFloor,
      Math.min(Number(selectedRoundConfig.maxVoters), roundConfigBounds.maxSettlementVoters, roundMaxVoterBounds.max),
    ),
  };
  const bountyMinimumCoverageAmount = getSubmissionRewardCoverageMinimum({
    maxVoters: selectedRoundConfig.maxVoters,
    requiredSettledRounds: selectedRequiredSettledRounds,
    requiredVoters: selectedRequiredVoters,
  });
  const configuredMinimumRewardAmount =
    rewardAsset === "lrep"
      ? typeof minSubmissionLrepPool === "bigint"
        ? minSubmissionLrepPool
        : DEFAULT_SUBMISSION_REWARD_POOL
      : typeof minSubmissionUsdcPool === "bigint"
        ? minSubmissionUsdcPool
        : DEFAULT_SUBMISSION_REWARD_POOL;
  const minimumRewardAmount = getContentRegistrySubmissionRewardMinimum({
    configuredMinimum: configuredMinimumRewardAmount,
    defaultMaxVoters: BigInt(Math.max(0, roundConfigDefaults.maxVoters)),
  });
  const rewardAmountError =
    selectedRewardAmount === null
      ? "Enter a positive amount with up to 6 decimals."
      : selectedRewardAmount < minimumRewardAmount
        ? `Minimum is ${formatSubmissionRewardAmount(minimumRewardAmount, rewardAsset)}.`
        : selectedRewardAmount < bountyMinimumCoverageAmount
          ? `Minimum is ${formatSubmissionRewardAmount(
              bountyMinimumCoverageAmount,
              rewardAsset,
            )} for the selected voter cap.`
          : null;
  const minimumBountyAmount =
    minimumRewardAmount > bountyMinimumCoverageAmount ? minimumRewardAmount : bountyMinimumCoverageAmount;
  const defaultBountyAmount = useMemo(
    () => formatSubmissionRewardInputAmount(minimumBountyAmount, rewardAsset),
    [minimumBountyAmount, rewardAsset],
  );
  useEffect(() => {
    if (rewardAmountTouched) return;
    setRewardAmount(defaultBountyAmount);
  }, [defaultBountyAmount, rewardAmountTouched]);
  const rewardRequiredVotersValidationError =
    parsedRewardRequiredVoters < selectedRequiredVoterFloor
      ? `Minimum is ${selectedRequiredVoterFloor} voters for this bounty amount.`
      : selectedRequiredVoters > BigInt(roundConfigBounds.maxSettlementVoters)
        ? `Maximum is ${roundConfigBounds.maxSettlementVoters} voters.`
        : selectedRequiredVoters > selectedRoundConfig.maxVoters
          ? "Min voters per round cannot exceed max voters per round."
          : null;
  const rewardRequiredVotersError = bountyStepAttempted ? rewardRequiredVotersValidationError : null;
  const rewardRequiredRoundsValidationError =
    parsedRewardRequiredRounds < MIN_REWARD_POOL_SETTLED_ROUNDS
      ? `Minimum is ${MIN_REWARD_POOL_SETTLED_ROUNDS} round.`
      : parsedRewardRequiredRounds > MAX_REWARD_POOL_SETTLED_ROUNDS
        ? `Maximum is ${MAX_REWARD_POOL_SETTLED_ROUNDS} rounds.`
        : null;
  const rewardRequiredRoundsError = bountyStepAttempted ? rewardRequiredRoundsValidationError : null;
  const bountyWindowSeconds = getBountyWindowSeconds(
    bountyWindowPreset,
    customBountyWindowAmount,
    customBountyWindowUnit,
  );
  const syncedBountyWindowSeconds =
    parsedRoundBlindMinutes >= roundBlindMinuteBounds.min && parsedRoundBlindMinutes <= roundBlindMinuteBounds.max
      ? parsedRoundBlindMinutes * SECONDS_PER_MINUTE
      : null;
  const effectiveBountyWindowSeconds = bountyWindowOverridden ? bountyWindowSeconds : syncedBountyWindowSeconds;
  const bountyStartByWindowSeconds = getBountyWindowSeconds(
    bountyStartByPreset,
    customBountyStartByAmount,
    customBountyStartByUnit,
  );
  const syncedBountyStartByWindowSeconds =
    parsedRoundMaxDurationMinutes >= roundMaxDurationMinuteBounds.min &&
    parsedRoundMaxDurationMinutes <= roundMaxDurationMinuteBounds.max
      ? parsedRoundMaxDurationMinutes * SECONDS_PER_MINUTE
      : null;
  const effectiveBountyStartByWindowSeconds = bountyStartByOverridden
    ? bountyStartByWindowSeconds
    : syncedBountyStartByWindowSeconds;
  const estimatedBountyStartByLabel = formatBountyExpiryDate(
    effectiveBountyStartByWindowSeconds,
    bountyExpiryReferenceTimeMs,
  );
  const bountyEligibilityWindowLabel = formatBountyWindowDuration(effectiveBountyWindowSeconds);
  const estimatedFeedbackBonusClosesAtLabel = formatBountyExpiryDate(
    effectiveBountyStartByWindowSeconds !== null && effectiveBountyWindowSeconds !== null
      ? effectiveBountyStartByWindowSeconds + effectiveBountyWindowSeconds
      : null,
    bountyExpiryReferenceTimeMs,
  );
  const parsedCustomBountyStartByAmount = parseBountyWindowAmount(customBountyStartByAmount);
  const parsedCustomBountyWindowAmount = parseBountyWindowAmount(customBountyWindowAmount);
  const customBountyStartByAmountMax =
    customBountyStartByUnit === "hours"
      ? Math.floor(Number.MAX_SAFE_INTEGER / SECONDS_PER_HOUR)
      : Math.floor(Number.MAX_SAFE_INTEGER / (24 * SECONDS_PER_HOUR));
  const customBountyWindowAmountMax =
    customBountyWindowUnit === "hours"
      ? Math.floor(Number.MAX_SAFE_INTEGER / SECONDS_PER_HOUR)
      : Math.floor(Number.MAX_SAFE_INTEGER / (24 * SECONDS_PER_HOUR));
  const rewardStartByValidationError =
    bountyStartByOverridden && bountyStartByPreset === "custom" && parsedCustomBountyStartByAmount < 1
      ? `Enter at least 1 ${customBountyStartByUnit === "hours" ? "hour" : "day"}.`
      : bountyStartByOverridden &&
          bountyStartByPreset === "custom" &&
          parsedCustomBountyStartByAmount > customBountyStartByAmountMax
        ? `Enter ${customBountyStartByAmountMax.toLocaleString()} ${customBountyStartByUnit} or fewer.`
        : effectiveBountyStartByWindowSeconds === null
          ? "Choose a start-by deadline."
          : null;
  const rewardExpiryValidationError =
    bountyWindowOverridden && bountyWindowPreset === "custom" && parsedCustomBountyWindowAmount < 1
      ? `Enter at least 1 ${customBountyWindowUnit === "hours" ? "hour" : "day"}.`
      : bountyWindowOverridden &&
          bountyWindowPreset === "custom" &&
          parsedCustomBountyWindowAmount > customBountyWindowAmountMax
        ? `Enter ${customBountyWindowAmountMax.toLocaleString()} ${customBountyWindowUnit} or fewer.`
        : effectiveBountyWindowSeconds === null
          ? "Choose a bounty window."
          : null;
  const rewardExpiryError = bountyStepAttempted ? rewardExpiryValidationError : null;
  const rewardStartByError = bountyStepAttempted ? rewardStartByValidationError : null;
  const selectedBountyEligibility = {
    mode: buildBountyEligibility(bountyEligibility, bountyRequiresRecentRecheck),
  };
  const selectedFeedbackBonusAmount = parseFeedbackBonusAmount(feedbackBonusAmount);
  const selectedFeedbackBonusAssetId =
    feedbackBonusAsset === "lrep" ? FEEDBACK_BONUS_ASSET_LREP : FEEDBACK_BONUS_ASSET_USDC;
  const selectedFeedbackBonusAssetLabel = feedbackBonusAsset === "lrep" ? "LREP" : "USDC";
  const trimmedFeedbackBonusAwarderAddress = feedbackBonusAwarderAddress.trim();
  const selectedFeedbackBonusAwarderAddress = trimmedFeedbackBonusAwarderAddress
    ? isAddress(trimmedFeedbackBonusAwarderAddress)
      ? (trimmedFeedbackBonusAwarderAddress as `0x${string}`)
      : undefined
    : connectedAddress;
  const feedbackBonusUnavailableForBundle = questionCount > 1 && feedbackBonusMode === "enabled";
  const feedbackBonusAmountError =
    feedbackBonusStepAttempted && feedbackBonusMode === "enabled" && selectedFeedbackBonusAmount === null
      ? `Enter a positive ${selectedFeedbackBonusAssetLabel} feedback bonus amount.`
      : null;
  const feedbackBonusAwarderError =
    feedbackBonusStepAttempted && feedbackBonusMode === "enabled" && !selectedFeedbackBonusAwarderAddress
      ? trimmedFeedbackBonusAwarderAddress
        ? "Enter a valid EVM address for the awarder."
        : "Connect a wallet or enter an awarder address."
      : null;
  const feedbackBonusSettingsValid =
    feedbackBonusMode === "none" ||
    (!feedbackBonusUnavailableForBundle &&
      selectedFeedbackBonusAmount !== null &&
      selectedFeedbackBonusAwarderAddress !== undefined);
  const bountySettingsValid =
    rewardRequiredVotersValidationError === null &&
    rewardRequiredRoundsValidationError === null &&
    rewardStartByValidationError === null &&
    rewardExpiryValidationError === null &&
    roundConfigValidationError === null &&
    rewardAmountError === null &&
    selectedRewardAmount !== null;
  const frontendFeeBps =
    typeof defaultFrontendFeeBps === "bigint"
      ? Number(defaultFrontendFeeBps)
      : typeof defaultFrontendFeeBps === "number"
        ? defaultFrontendFeeBps
        : DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS;
  const estimatedBountyAmount = selectedRewardAmount ?? minimumBountyAmount;
  const estimatedMinimumVoterClaimDenominator = selectedRequiredVoters * selectedRequiredSettledRounds;
  const estimatedMinimumVoterGrossReward = divideRewardAmount(
    estimatedBountyAmount,
    estimatedMinimumVoterClaimDenominator,
  );
  const estimatedMinimumVoterReward = applyEstimatedFrontendFee(estimatedMinimumVoterGrossReward, frontendFeeBps);
  const estimatedVoterCap = BigInt(Math.max(0, parsedRoundMaxVoters));
  const estimatedVoterCapClaimDenominator = estimatedVoterCap * selectedRequiredSettledRounds;
  const estimatedVoterCapGrossReward = divideRewardAmount(estimatedBountyAmount, estimatedVoterCapClaimDenominator);
  const estimatedVoterCapReward = applyEstimatedFrontendFee(estimatedVoterCapGrossReward, frontendFeeBps);
  const oneTokenPerMinimumVoterBounty = selectedRequiredVoters * selectedRequiredSettledRounds * 1_000_000n;
  const hasShortHumanResponseWindow =
    parsedRoundBlindMinutes > 0 && parsedRoundBlindMinutes < MIN_HUMAN_RESPONSE_WINDOW_MINUTES;
  const bountyRecommendation = hasShortHumanResponseWindow
    ? "Short response windows will most likely only get AI replies and very few human replies. Use 20 minutes or longer when human participation matters."
    : rewardAmountError
      ? "Increase the bounty until the estimate is valid before submitting."
      : rewardRequiredVotersValidationError
        ? "Lower min voters per round or raise max voters per round so the bounty can qualify."
        : estimatedMinimumVoterReward < 1_000_000n
          ? `For a stronger signal, consider ${formatSubmissionRewardAmount(
              oneTokenPerMinimumVoterBounty,
              rewardAsset,
            )} or more so the minimum cohort earns about 1 ${rewardAsset === "lrep" ? "LREP" : "USDC"} each.`
          : parsedRoundMaxVoters > Math.max(parsedRewardRequiredVoters, 1) * 3
            ? "A high max voters per round can dilute the per-voter payout if participation is high; use it when broader input matters more than payout density."
            : "These settings give a clear payout target for a small qualifying round.";
  const usdcAddress = getDefaultUsdcAddress(targetNetwork.id);
  const rewardTokenAddress = rewardAsset === "lrep" ? lrepAddress : usdcAddress;
  const feedbackBonusTokenAddress = feedbackBonusAsset === "lrep" ? lrepAddress : usdcAddress;
  const feedbackBonusEscrowAddress = getConfiguredFeedbackBonusEscrowAddress(targetNetwork.id);
  const { data: lrepBalance, isLoading: isLrepBalanceLoading } = useReadContract({
    address: lrepAddress,
    abi: ERC20_APPROVAL_ABI,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && lrepAddress),
    },
  });
  const { data: usdcBalance, isLoading: isUsdcBalanceLoading } = useReadContract({
    address: usdcAddress,
    abi: ERC20_APPROVAL_ABI,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && usdcAddress),
    },
  });
  const hasResolvedLrepBalance =
    Boolean(connectedAddress && lrepAddress) && !isLrepBalanceLoading && lrepBalance !== undefined;
  const hasResolvedUsdcBalance =
    Boolean(connectedAddress && usdcAddress) && !isUsdcBalanceLoading && usdcBalance !== undefined;
  const selectedRewardBalance = rewardAsset === "lrep" ? lrepBalance : usdcBalance;
  const selectedRewardBalanceResolved = rewardAsset === "lrep" ? hasResolvedLrepBalance : hasResolvedUsdcBalance;
  const estimatedFeedbackBonusRecipientAmount =
    feedbackBonusMode === "enabled" && selectedFeedbackBonusAmount
      ? applyEstimatedFrontendFee(selectedFeedbackBonusAmount, frontendFeeBps)
      : 0n;
  const feedbackBonusWindowLabel = estimatedFeedbackBonusClosesAtLabel;
  const hasNoSupportedBountyFunds =
    hasResolvedLrepBalance && hasResolvedUsdcBalance && lrepBalance === 0n && usdcBalance === 0n;
  const requiredFeedbackBonusFundingAmount =
    feedbackBonusMode === "enabled" && selectedFeedbackBonusAmount ? selectedFeedbackBonusAmount : 0n;
  const selectedFeedbackBonusBalance = feedbackBonusAsset === "lrep" ? lrepBalance : usdcBalance;
  const selectedFeedbackBonusBalanceResolved =
    feedbackBonusAsset === "lrep" ? hasResolvedLrepBalance : hasResolvedUsdcBalance;
  const requiredSelectedFeedbackBonusBalance =
    feedbackBonusMode === "enabled" &&
    selectedFeedbackBonusAmount &&
    feedbackBonusAsset === rewardAsset &&
    selectedRewardAmount
      ? selectedRewardAmount + selectedFeedbackBonusAmount
      : requiredFeedbackBonusFundingAmount;
  const hasInsufficientSelectedBountyFunds =
    selectedRewardAmount !== null &&
    selectedRewardBalanceResolved &&
    selectedRewardBalance !== undefined &&
    selectedRewardBalance < selectedRewardAmount;
  const hasInsufficientFeedbackBonusFunds =
    submissionStep === "feedbackBonus" &&
    feedbackBonusMode === "enabled" &&
    selectedFeedbackBonusAmount !== null &&
    selectedFeedbackBonusBalanceResolved &&
    selectedFeedbackBonusBalance !== undefined &&
    selectedFeedbackBonusBalance < requiredSelectedFeedbackBonusBalance;
  const bountyFundingWarning = (() => {
    if (!connectedAddress || (!hasResolvedLrepBalance && !hasResolvedUsdcBalance)) {
      return null;
    }

    if (submissionStep === "question" && hasNoSupportedBountyFunds) {
      return {
        title: "Need bounty funds",
        message:
          "Every question needs a funded bounty before it can be submitted. Add LREP or World Chain USDC to this wallet, then continue.",
      };
    }

    if (submissionStep !== "question" && rewardAsset === "lrep" && hasInsufficientSelectedBountyFunds) {
      return {
        title: "Need LREP for bounty",
        message: `You need ${formatSubmissionRewardAmount(
          selectedRewardAmount,
          rewardAsset,
        )} to fund this bounty. Your wallet has ${formatSubmissionRewardAmount(selectedRewardBalance, rewardAsset)}.`,
      };
    }

    if (hasInsufficientFeedbackBonusFunds) {
      return {
        title: `Need ${selectedFeedbackBonusAssetLabel} for funding`,
        message: `You need ${formatFeedbackBonusAmount(
          requiredSelectedFeedbackBonusBalance,
          feedbackBonusAsset,
        )} to fund the selected Feedback Bonus${
          feedbackBonusAsset === rewardAsset ? " and bounty" : ""
        }. Your wallet has ${formatFeedbackBonusAmount(selectedFeedbackBonusBalance, feedbackBonusAsset)}.`,
      };
    }

    if (submissionStep !== "question" && hasInsufficientSelectedBountyFunds) {
      return {
        title: "Need USDC for bounty",
        message: `You need ${formatSubmissionRewardAmount(
          selectedRewardAmount,
          rewardAsset,
        )} to fund this bounty. Your wallet has ${formatSubmissionRewardAmount(selectedRewardBalance, rewardAsset)}.`,
      };
    }

    return null;
  })();
  const { refetch: refetchNextContentId } = useScaffoldReadContract({
    contractName: "ContentRegistry",
    functionName: "nextContentId",
  });
  const extractSubmittedContentIds = (logs: { address: string; data: `0x${string}`; topics: `0x${string}`[] }[]) => {
    if (!registryInfo) {
      return [];
    }

    const submittedContentIds: bigint[] = [];
    for (const log of logs) {
      if (log.address.toLowerCase() !== registryInfo.address.toLowerCase()) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: registryInfo.abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        const args = decoded.args as { contentId?: unknown } | undefined;
        if (decoded.eventName === "ContentSubmitted" && typeof args?.contentId === "bigint") {
          submittedContentIds.push(args.contentId);
        }
      } catch {
        continue;
      }
    }

    return submittedContentIds;
  };
  const extractReceiptTransactionHashes = (receipts: Array<{ transactionHash?: unknown }>) =>
    receipts
      .map(receipt => (typeof receipt.transactionHash === "string" ? receipt.transactionHash : ""))
      .filter((hash): hash is `0x${string}` => /^0x[a-fA-F0-9]{64}$/.test(hash));

  const attachQuestionDetailsAfterSubmission = async (params: {
    contentIds: readonly bigint[];
    questions: ReadonlyArray<{
      detailsHash: `0x${string}`;
      detailsUrl: string;
      spec: {
        questionMetadataHash: `0x${string}`;
        resultSpecHash: `0x${string}`;
      };
      targetAudience?: unknown;
    }>;
    transactionHashes: readonly `0x${string}`[];
  }) => {
    const details = params.questions
      .map((question, index) => ({
        contentId: params.contentIds[index]?.toString() ?? "",
        detailsHash: question.detailsHash,
        detailsUrl: question.detailsUrl,
      }))
      .filter(detail => detail.contentId && detail.detailsUrl);
    const metadata = params.questions
      .map((question, index) => ({
        contentId: params.contentIds[index]?.toString() ?? "",
        questionMetadataHash: question.spec.questionMetadataHash,
        resultSpecHash: question.spec.resultSpecHash,
        targetAudience: question.targetAudience ?? null,
      }))
      .filter(entry => entry.contentId);
    if ((details.length === 0 && metadata.length === 0) || params.transactionHashes.length === 0) return;

    const response = await fetch("/api/attachments/details/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: targetNetwork.id,
        details,
        metadata,
        transactionHashes: params.transactionHashes,
      }),
    });
    if (!response.ok) {
      throw new Error("Could not attach question details to submitted content.");
    }
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    patchActiveQuestionDraft({ title: value });
    setTitleError(getContentTitleValidationError(value));
  };

  const validateQuestionSection = (draft = getActiveQuestionDraft(), applyErrors = true): ValidatedQuestionDraft => {
    const trimmedTitle = draft.title.trim();
    const trimmedContextUrl = draft.contextUrl.trim();
    const submittedContextUrl = normalizeSubmissionContextUrl(trimmedContextUrl) ?? "";
    let trimmedDetailsText = "";
    let nextDetailsError: string | null = null;
    if (draft.detailsText.trim()) {
      try {
        trimmedDetailsText = normalizeQuestionDetailsText(draft.detailsText);
      } catch (error) {
        nextDetailsError = error instanceof Error ? error.message : "Details are invalid.";
      }
    }
    const submittedImageUrls =
      draft.mediaMode === "images"
        ? draft.imageUrls
            .map(value => value.trim())
            .filter(Boolean)
            .map(value => normalizeSubmissionMediaUrl(value))
            .filter((value): value is string => Boolean(value))
        : [];
    const submittedVideoUrl = draft.mediaMode === "video" ? (normalizeSubmissionMediaUrl(draft.videoUrl) ?? "") : "";
    const nextImageUrlErrors = draft.imageUrls.map(value =>
      value.trim() ? getMediaUrlValidationError(value, "images") : null,
    );
    const nextVideoUrlError = getMediaUrlValidationError(draft.videoUrl, "video");
    const nextContextUrlError = getContextUrlValidationError(trimmedContextUrl);
    const nextTitleError = trimmedTitle ? getContentTitleValidationError(trimmedTitle) : null;
    const blockedContentTags = findBlockedContentTags(draft.selectedSubcategories);
    const submittedTags = serializeTags(draft.selectedSubcategories);
    const submittedTargetAudience = targetAudienceDraftToMetadata(draft.targetAudience);
    const tagsValidationError =
      submittedTags.length > MAX_CONTENT_TAGS_LENGTH
        ? `Categories must be ${MAX_CONTENT_TAGS_LENGTH} characters or fewer.`
        : null;
    const hasMediaError =
      draft.mediaMode === "images"
        ? nextImageUrlErrors.some(Boolean)
        : Boolean(nextVideoUrlError) || Boolean(draft.videoUrl.trim() && !submittedVideoUrl);
    const hasContextOrMedia =
      Boolean(submittedContextUrl) || submittedImageUrls.length > 0 || Boolean(submittedVideoUrl);
    if (applyErrors) {
      setImageUrlErrors(nextImageUrlErrors);
      setVideoUrlError(nextVideoUrlError);
      setContextUrlError(nextContextUrlError);
      setTitleError(nextTitleError);
      setDetailsError(nextDetailsError);
    }

    const questionFieldsComplete =
      Boolean(draft.selectedCategory) &&
      Boolean(trimmedTitle) &&
      draft.selectedSubcategories.length > 0 &&
      hasContextOrMedia;
    const hasQuestionErrors =
      !questionFieldsComplete ||
      Boolean(nextContextUrlError) ||
      Boolean(nextTitleError) ||
      Boolean(nextDetailsError) ||
      hasMediaError ||
      Boolean(tagsValidationError) ||
      blockedContentTags.length > 0;

    return {
      blockedContentTags,
      hasMediaError,
      hasQuestionErrors,
      selectedCategory: draft.selectedCategory,
      submittedContextUrl,
      submittedImageUrls,
      submittedVideoUrl,
      submittedTags,
      targetAudience: submittedTargetAudience,
      trimmedDetailsText,
      trimmedTitle,
    };
  };

  const uploadQuestionDetailsForSubmission = async (
    text: string,
    submitterAddress: `0x${string}`,
  ): Promise<typeof EMPTY_SUBMISSION_DETAILS> => {
    if (!text.trim()) return EMPTY_SUBMISSION_DETAILS;

    const normalizedText = normalizeQuestionDetailsText(text);
    const detailsId = createQuestionDetailsId();
    const sha256 = await sha256Hex(normalizedText);
    const sizeBytes = getQuestionDetailsTextSizeBytes(normalizedText);
    const challengeResponse = await fetch("/api/attachments/details/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: submitterAddress,
        detailsId,
        sha256,
        sizeBytes,
      }),
    });
    const challenge = (await challengeResponse.json().catch(() => null)) as {
      challengeId?: string;
      message?: string;
      error?: string;
    } | null;
    if (!challengeResponse.ok || !challenge?.challengeId || !challenge.message) {
      throw new Error(challenge?.error || "Could not prepare details upload.");
    }

    const signature = await signMessageAsync({ message: challenge.message });
    const uploadResponse = await fetch("/api/attachments/details/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: submitterAddress,
        challengeId: challenge.challengeId,
        detailsId,
        sha256,
        signature,
        sizeBytes,
        text: normalizedText,
      }),
    });
    const upload = (await uploadResponse.json().catch(() => null)) as {
      detailsHash?: `0x${string}` | null;
      detailsUrl?: string | null;
      error?: string;
    } | null;
    if (!uploadResponse.ok || !upload?.detailsUrl || !upload.detailsHash) {
      throw new Error(upload?.error || "Could not upload details.");
    }

    return {
      detailsUrl: upload.detailsUrl,
      detailsHash: upload.detailsHash,
    };
  };

  const handleContinueToBounty = () => {
    setQuestionStepAttempted(true);
    const questionValidation = validateQuestionSection();
    if (questionValidation.hasQuestionErrors) {
      setSubmissionStep("question");
      notification.warning("Fill in the highlighted fields before continuing.");
      return;
    }

    if (activeQuestionIndex < questionCount - 1) {
      const nextDrafts = questionDrafts.map((draft, index) =>
        index === activeQuestionIndex ? getActiveQuestionDraft() : draft,
      );
      setQuestionDrafts(nextDrafts);
      setActiveQuestionPage(activeQuestionIndex + 1, nextDrafts);
      return;
    }

    setSubmissionStep("bounty");
    setBountyStepAttempted(false);
  };

  const handleGoToPreviousQuestion = () => {
    if (activeQuestionIndex <= 0) return;

    const nextDrafts = questionDrafts.map((draft, index) =>
      index === activeQuestionIndex ? getActiveQuestionDraft() : draft,
    );
    setQuestionDrafts(nextDrafts);
    setActiveQuestionPage(activeQuestionIndex - 1, nextDrafts);
    setBountyStepAttempted(false);
  };

  const handleGoToBountyStep = () => {
    if (submissionStep === "bounty") return;

    const syncedDrafts = questionDrafts
      .map((draft, index) => (index === activeQuestionIndex ? getActiveQuestionDraft() : draft))
      .slice(0, questionCount);
    const validatedQuestions = syncedDrafts.map(draft => validateQuestionSection(draft, false));
    const firstInvalidQuestionIndex = validatedQuestions.findIndex(question => question.hasQuestionErrors);
    if (firstInvalidQuestionIndex >= 0) {
      const invalidDraft = syncedDrafts[firstInvalidQuestionIndex] ?? createEmptyQuestionDraft();
      setQuestionDrafts(syncedDrafts);
      setActiveQuestionIndex(firstInvalidQuestionIndex);
      loadQuestionDraft(invalidDraft);
      setQuestionStepAttempted(true);
      validateQuestionSection(invalidDraft, true);
      setSubmissionStep("question");
      notification.warning("Fill in every question page before opening bounty details.");
      return;
    }

    setQuestionDrafts(syncedDrafts);
    setSubmissionStep("bounty");
    setBountyStepAttempted(false);
  };

  const handleGoToFeedbackBonusStep = () => {
    const syncedDrafts = questionDrafts
      .map((draft, index) => (index === activeQuestionIndex ? getActiveQuestionDraft() : draft))
      .slice(0, questionCount);
    const validatedQuestions = syncedDrafts.map(draft => validateQuestionSection(draft, false));
    const firstInvalidQuestionIndex = validatedQuestions.findIndex(question => question.hasQuestionErrors);
    if (firstInvalidQuestionIndex >= 0) {
      const invalidDraft = syncedDrafts[firstInvalidQuestionIndex] ?? createEmptyQuestionDraft();
      setQuestionDrafts(syncedDrafts);
      setActiveQuestionIndex(firstInvalidQuestionIndex);
      loadQuestionDraft(invalidDraft);
      setQuestionStepAttempted(true);
      validateQuestionSection(invalidDraft, true);
      setSubmissionStep("question");
      notification.warning("Fill in every question page before opening feedback bonus details.");
      return;
    }

    setQuestionDrafts(syncedDrafts);
    setBountyStepAttempted(true);
    if (!bountySettingsValid) {
      setSubmissionStep("bounty");
      if (roundConfigValidationError) {
        setShowAdvancedRoundSettings(true);
      }
      notification.warning("Please fix the bounty details before continuing.");
      return;
    }

    setSubmissionStep("feedbackBonus");
    setFeedbackBonusStepAttempted(false);
  };

  const handleQuestionCountChange = (value: string) => {
    const nextCount = Math.max(1, Math.min(MAX_QUESTION_BUNDLE_COUNT, parseWholeNumberInput(value)));
    const nextVoterCapMax =
      nextCount > 1
        ? Math.min(roundConfigBounds.maxVoterCap, MAX_QUESTION_BUNDLE_ROUND_VOTERS)
        : roundConfigBounds.maxVoterCap;
    const syncedDrafts = questionDrafts.map((draft, index) =>
      index === activeQuestionIndex ? getActiveQuestionDraft() : draft,
    );
    const nextDrafts =
      nextCount > syncedDrafts.length
        ? [
            ...syncedDrafts,
            ...Array.from({ length: nextCount - syncedDrafts.length }, () =>
              createQuestionDraftWithTaxonomy(syncedDrafts[0] ?? createEmptyQuestionDraft()),
            ),
          ]
        : syncedDrafts.slice(0, nextCount);
    const nextActiveIndex = Math.min(activeQuestionIndex, nextCount - 1);

    setQuestionCount(nextCount);
    setQuestionDrafts(nextDrafts);
    setActiveQuestionIndex(nextActiveIndex);
    loadQuestionDraft(nextDrafts[nextActiveIndex] ?? createEmptyQuestionDraft());
    setRoundMaxVoters(current =>
      clampWholeNumberInput(
        current,
        roundConfigBounds.minVoterCap,
        Math.max(roundConfigBounds.minVoterCap, nextVoterCapMax),
      ),
    );
    const clampedPaidCompleters = clampWholeNumberInput(
      rewardRequiredVoters,
      MIN_REWARD_POOL_REQUIRED_VOTERS,
      Math.max(MIN_REWARD_POOL_REQUIRED_VOTERS, Math.min(nextVoterCapMax, roundConfigBounds.maxSettlementVoters)),
    );
    setRewardRequiredVoters(clampedPaidCompleters);
    syncSettlementVotersToPaidCompleters(clampedPaidCompleters);
    setSubmissionStep("question");
    setBountyStepAttempted(false);
    if (nextCount > 1) {
      setFeedbackBonusMode("none");
    }
    setFeedbackBonusStepAttempted(false);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (submissionStep === "question") {
      handleContinueToBounty();
      return;
    }

    if (submissionStep === "bounty") {
      handleGoToFeedbackBonusStep();
      return;
    }
  };

  const handleFinalSubmit = async () => {
    if (submissionStep !== "feedbackBonus") {
      return;
    }

    if (isRegistryLoading || isLrepLoading || isRewardEscrowLoading) {
      notification.warning("Submission is still loading. Try again in a moment.");
      return;
    }

    if (!registryInfo || !registryAddress || !lrepInfo || !lrepAddress || !rewardEscrowInfo || !rewardEscrowAddress) {
      notification.error("Submission is unavailable right now.");
      return;
    }

    if (!rewardTokenAddress) {
      notification.error(`${rewardAsset === "lrep" ? "LREP" : "USDC"} funding is unavailable right now.`);
      return;
    }

    setQuestionStepAttempted(true);

    if (isAwaitingSponsoredSubmitCalls || isAwaitingSelfFundedSubmitCalls) {
      notification.warning("Wallet reconnecting. Retry in a moment.");
      return;
    }

    if (isMissingGasBalance) {
      notification.error(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
      return;
    }

    const syncedDrafts = questionDrafts
      .map((draft, index) => (index === activeQuestionIndex ? getActiveQuestionDraft() : draft))
      .slice(0, questionCount);
    const validatedQuestions = syncedDrafts.map(draft => validateQuestionSection(draft, false));
    const firstInvalidQuestionIndex = validatedQuestions.findIndex(question => question.hasQuestionErrors);
    if (firstInvalidQuestionIndex >= 0) {
      const invalidDraft = syncedDrafts[firstInvalidQuestionIndex] ?? createEmptyQuestionDraft();
      setQuestionDrafts(syncedDrafts);
      setActiveQuestionIndex(firstInvalidQuestionIndex);
      loadQuestionDraft(invalidDraft);
      setQuestionStepAttempted(true);
      validateQuestionSection(invalidDraft, true);
      setSubmissionStep("question");
      notification.warning("Fill in every question page before submitting.");
      return;
    }

    setQuestionDrafts(syncedDrafts);
    setBountyStepAttempted(true);
    setFeedbackBonusStepAttempted(true);
    if (!selectedRewardAmount) {
      notification.warning("Please fix the highlighted fields before submitting.");
      return;
    }

    if (!bountySettingsValid) {
      setSubmissionStep("bounty");
      if (roundConfigValidationError) {
        setShowAdvancedRoundSettings(true);
      }
      notification.warning("Please fix the bounty details before submitting.");
      return;
    }

    if (!feedbackBonusSettingsValid) {
      setSubmissionStep("feedbackBonus");
      notification.warning("Please fix the feedback bonus details before submitting.");
      return;
    }

    let verifiedRewardTokenAddress = rewardTokenAddress;
    let verifiedVotingEngineAddress: `0x${string}` | null = null;
    try {
      const [activeRewardEscrowAddress, registryLrepAddress, registryVotingEngineAddress] = (await Promise.all([
        readContract(wagmiConfig, {
          address: registryAddress,
          abi: QUESTION_SUBMISSION_ABI,
          functionName: "questionRewardPoolEscrow",
        }) as Promise<`0x${string}`>,
        readContract(wagmiConfig, {
          address: registryAddress,
          abi: QUESTION_SUBMISSION_ABI,
          functionName: "lrepToken",
        }) as Promise<`0x${string}`>,
        readContract(wagmiConfig, {
          address: registryAddress,
          abi: QUESTION_SUBMISSION_ABI,
          functionName: "votingEngine",
        }) as Promise<`0x${string}`>,
      ])) as readonly [`0x${string}`, `0x${string}`, `0x${string}`];

      if (activeRewardEscrowAddress.toLowerCase() !== rewardEscrowAddress.toLowerCase()) {
        notification.error("Bounty escrow is not active for this registry.");
        return;
      }
      if (registryLrepAddress.toLowerCase() !== lrepAddress.toLowerCase()) {
        notification.error("Configured LREP token does not match this registry.");
        return;
      }
      if (!registryVotingEngineAddress) {
        notification.error("Bounty registry wiring is incomplete for this network.");
        return;
      }

      verifiedVotingEngineAddress = registryVotingEngineAddress;
      verifiedRewardTokenAddress = rewardAsset === "lrep" ? lrepAddress : rewardTokenAddress;
    } catch {
      notification.error("Could not verify bounty escrow wiring.");
      return;
    }

    if (!verifiedRewardTokenAddress) {
      notification.error(`${rewardAsset === "lrep" ? "LREP" : "USDC"} funding is unavailable right now.`);
      return;
    }

    const shouldFundFeedbackBonus = feedbackBonusMode === "enabled";
    if (shouldFundFeedbackBonus) {
      if (!feedbackBonusEscrowAddress) {
        notification.error("Feedback Bonus escrow is not deployed on this network yet.");
        return;
      }
      if (!feedbackBonusTokenAddress) {
        notification.error(
          `${selectedFeedbackBonusAssetLabel} is not configured for Feedback Bonuses on this network.`,
        );
        return;
      }
      if (!selectedFeedbackBonusAmount) {
        setSubmissionStep("feedbackBonus");
        notification.warning("Enter a feedback bonus amount before submitting.");
        return;
      }
      if (!selectedFeedbackBonusAwarderAddress) {
        setSubmissionStep("feedbackBonus");
        notification.warning("Enter a valid awarder address before submitting.");
        return;
      }
    }

    const submitterAddress = connectedAddress as `0x${string}` | undefined;
    if (!submitterAddress) {
      notification.error("Wallet not connected");
      return;
    }

    try {
      const rewardBalance = (await readContract(wagmiConfig, {
        address: verifiedRewardTokenAddress,
        abi: ERC20_APPROVAL_ABI,
        functionName: "balanceOf",
        args: [submitterAddress],
      })) as bigint;

      if (rewardBalance < selectedRewardAmount) {
        setSubmissionStep("bounty");
        notification.error(
          `You need ${formatSubmissionRewardAmount(selectedRewardAmount, rewardAsset)} to fund this bounty. Your wallet has ${formatSubmissionRewardAmount(
            rewardBalance,
            rewardAsset,
          )}.`,
        );
        return;
      }
    } catch {
      notification.error(`Could not verify your ${rewardAsset === "lrep" ? "LREP" : "USDC"} balance.`);
      return;
    }

    if (shouldFundFeedbackBonus && selectedFeedbackBonusAmount && feedbackBonusTokenAddress) {
      try {
        const feedbackBonusBalance = (await readContract(wagmiConfig, {
          address: feedbackBonusTokenAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "balanceOf",
          args: [submitterAddress],
        })) as bigint;
        const requiredFeedbackBonusBalance =
          rewardAsset === feedbackBonusAsset &&
          verifiedRewardTokenAddress.toLowerCase() === feedbackBonusTokenAddress.toLowerCase()
            ? selectedRewardAmount + selectedFeedbackBonusAmount
            : selectedFeedbackBonusAmount;

        if (feedbackBonusBalance < requiredFeedbackBonusBalance) {
          setSubmissionStep("feedbackBonus");
          notification.error(
            `You need ${formatFeedbackBonusAmount(
              requiredFeedbackBonusBalance,
              feedbackBonusAsset,
            )} to fund the selected Feedback Bonus${feedbackBonusAsset === rewardAsset ? " and bounty" : ""}.`,
          );
          return;
        }
      } catch {
        notification.error(`Could not verify your ${selectedFeedbackBonusAssetLabel} balance for the Feedback Bonus.`);
        return;
      }
    }

    const accepted = await requireAcceptance("submit");
    if (!accepted) return;

    setIsSubmitting(true);
    statusToast.showSubmitting({ action: "content" });
    let reservedRevealCommitment: `0x${string}` | null = null;
    let cancelReservedSubmission: ((revealCommitment: `0x${string}`) => Promise<void>) | null = null;
    try {
      let submittedContentIds: bigint[] = [];
      let submissionTransactionHashes: `0x${string}`[] = [];
      const publicClient = getPublicClient(wagmiConfig, { chainId: targetNetwork.id as any });
      const getFreshPendingNonce = async (minimumNonce?: number): Promise<number | undefined> => {
        if (!publicClient) return minimumNonce;

        let latestNonce: number | undefined;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            latestNonce = await publicClient.getTransactionCount({
              address: submitterAddress,
              blockTag: "pending",
            });
            if (minimumNonce === undefined || latestNonce >= minimumNonce) {
              return latestNonce;
            }
          } catch {
            return minimumNonce;
          }

          await new Promise(resolve => setTimeout(resolve, 350));
        }

        return minimumNonce === undefined || latestNonce === undefined
          ? latestNonce
          : Math.max(latestNonce, minimumNonce);
      };
      const getSubmittedTransactionNonce = async (hash: `0x${string}` | null | undefined) => {
        if (!hash || !publicClient) return undefined;

        try {
          const transaction = await publicClient.getTransaction({ hash });
          return transaction.nonce;
        } catch {
          return undefined;
        }
      };
      const prepareDirectWalletWrite = async <TWrite extends Record<string, unknown>>(
        write: TWrite,
        options: { minimumNonce?: number } = {},
      ) => {
        if (localE2ETestWalletClient || !publicClient) {
          return write;
        }

        const preparedWrite: Record<string, unknown> = {
          ...write,
          account: submitterAddress,
        };

        try {
          const estimatedGas = await publicClient.estimateContractGas({
            ...write,
            account: submitterAddress,
          } as any);
          preparedWrite.gas = (estimatedGas * 120n) / 100n;
        } catch {
          // Let the wallet estimate gas if the direct RPC simulation cannot.
        }

        const nonce = await getFreshPendingNonce(options.minimumNonce);
        if (nonce !== undefined) {
          preparedWrite.nonce = nonce;
        }

        return preparedWrite as TWrite;
      };
      const latestBlockTimestamp = await publicClient
        ?.getBlock({ blockTag: "latest" })
        .then(block => block.timestamp)
        .catch(() => undefined);
      const bountyReferenceNowSeconds = resolveBountyReferenceNowSeconds(latestBlockTimestamp);
      const bountyStartBy = getBountyStartByFromWindowSeconds(
        effectiveBountyStartByWindowSeconds,
        bountyReferenceNowSeconds,
      );
      if (bountyStartBy <= BigInt(bountyReferenceNowSeconds)) {
        setSubmissionStep("bounty");
        notification.warning("Choose a start-by deadline before submitting.");
        return;
      }
      if (effectiveBountyWindowSeconds === null || effectiveBountyWindowSeconds <= 0) {
        setSubmissionStep("bounty");
        notification.warning("Choose a bounty window before submitting.");
        return;
      }
      const bountyWindowSecondsValue = BigInt(effectiveBountyWindowSeconds);
      const feedbackWindowSeconds = bountyWindowSecondsValue;
      const feedbackBonusClosesAt = bountyStartBy + bountyWindowSecondsValue;

      const submittedDetails = await Promise.all(
        validatedQuestions.map(question =>
          uploadQuestionDetailsForSubmission(question.trimmedDetailsText, submitterAddress),
        ),
      );

      const bundleQuestions = validatedQuestions.map((question, index) => {
        if (!question.selectedCategory) {
          throw new Error(`Question ${index + 1} is missing a category.`);
        }
        const details = submittedDetails[index] ?? EMPTY_SUBMISSION_DETAILS;

        const spec = buildQuestionSpecHashes({
          bounty: {
            amount: selectedRewardAmount,
            asset: rewardAsset === "lrep" ? "LREP" : "USDC",
            bountyEligibility: selectedBountyEligibility.mode,
            requiredSettledRounds: selectedRequiredSettledRounds,
            requiredVoters: selectedRequiredVoters,
          },
          categoryId: question.selectedCategory.id,
          contextUrl: question.submittedContextUrl,
          imageUrls: question.submittedImageUrls,
          roundConfig: selectedRoundConfig,
          study: {
            bundleIndex: index,
          },
          tags: question.submittedTags.split(",").filter(Boolean),
          targetAudience: targetAudienceToQuestionSpecInput(question.targetAudience),
          title: question.trimmedTitle,
          videoUrl: question.submittedVideoUrl,
        });

        return {
          contextUrl: question.submittedContextUrl,
          imageUrls: question.submittedImageUrls,
          videoUrl: question.submittedVideoUrl,
          title: question.trimmedTitle,
          tags: question.submittedTags,
          categoryId: question.selectedCategory.id,
          detailsUrl: details.detailsUrl,
          detailsHash: details.detailsHash,
          salt: createRandomHex32(),
          spec: {
            questionMetadataHash: spec.questionMetadataHash,
            resultSpecHash: spec.resultSpecHash,
          },
          targetAudience: question.targetAudience,
        };
      });
      const rewardTerms = {
        asset: selectedRewardAssetId,
        amount: selectedRewardAmount,
        requiredVoters: selectedRequiredVoters,
        requiredSettledRounds: selectedRequiredSettledRounds,
        bountyStartBy,
        bountyWindowSeconds: bountyWindowSecondsValue,
        feedbackWindowSeconds,
        bountyEligibility: selectedBountyEligibility.mode,
      } as const;
      const roundConfigAbi = questionRoundConfigToAbi(selectedRoundConfig);
      const isBundleSubmission = bundleQuestions.length > 1;
      const primaryQuestion = bundleQuestions[0];
      if (!primaryQuestion) {
        throw new Error("Question is missing.");
      }
      await assertContentRegistryQuestionSubmissionSelector(
        publicClient,
        registryAddress,
        isBundleSubmission ? "bundle" : "single",
      );
      const getQuestionSubmissionKey = (question: (typeof bundleQuestions)[number]) =>
        buildQuestionSubmissionKey({
          categoryId: question.categoryId,
          contextUrl: question.contextUrl,
          detailsHash: question.detailsHash,
          detailsUrl: question.detailsUrl,
          imageUrls: question.imageUrls,
          title: question.title,
          tags: question.tags,
          videoUrl: question.videoUrl,
        });
      const revealCommitment = isBundleSubmission
        ? buildQuestionBundleSubmissionRevealCommitment({
            questions: bundleQuestions,
            rewardAmount: selectedRewardAmount,
            rewardAsset: selectedRewardAssetId,
            requiredSettledRounds: selectedRequiredSettledRounds,
            requiredVoters: selectedRequiredVoters,
            bountyStartBy,
            bountyWindowSeconds: bountyWindowSecondsValue,
            feedbackWindowSeconds,
            bountyEligibility: selectedBountyEligibility.mode,
            roundConfig: selectedRoundConfig,
            submitter: submitterAddress,
          })
        : buildQuestionSubmissionRevealCommitment({
            categoryId: primaryQuestion.categoryId,
            detailsHash: primaryQuestion.detailsHash,
            detailsUrl: primaryQuestion.detailsUrl,
            imageUrls: primaryQuestion.imageUrls,
            questionMetadataHash: primaryQuestion.spec.questionMetadataHash,
            rewardAmount: selectedRewardAmount,
            rewardAsset: selectedRewardAssetId,
            requiredSettledRounds: selectedRequiredSettledRounds,
            requiredVoters: selectedRequiredVoters,
            resultSpecHash: primaryQuestion.spec.resultSpecHash,
            bountyStartBy,
            bountyWindowSeconds: bountyWindowSecondsValue,
            feedbackWindowSeconds,
            bountyEligibility: selectedBountyEligibility.mode,
            roundConfig: selectedRoundConfig,
            salt: primaryQuestion.salt,
            submissionKey: getQuestionSubmissionKey(primaryQuestion),
            submitter: submitterAddress,
            tags: primaryQuestion.tags,
            title: primaryQuestion.title,
            videoUrl: primaryQuestion.videoUrl,
          });

      cancelReservedSubmission = async (revealCommitment: `0x${string}`) => {
        if (canUseBatchedSubmitCalls) {
          await executeSponsoredCalls(
            [
              {
                abi: registryInfo.abi,
                address: registryAddress,
                args: [revealCommitment],
                functionName: "cancelReservedSubmission",
              },
            ],
            {
              atomicRequired: true,
              sponsorshipMode: submitCallSponsorshipMode,
              suppressStatusToast: true,
            },
          );
          return;
        }

        const cancelTxHash = await writeRegistry(
          {
            functionName: "cancelReservedSubmission",
            args: [revealCommitment],
          },
          {
            suppressErrorToast: true,
            suppressStatusToast: true,
            suppressSuccessToast: true,
          },
        );

        if (cancelTxHash) {
          await waitForTransactionReceipt(wagmiConfig, { hash: cancelTxHash });
        }
      };

      const reserveSubmission = async (revealCommitment: `0x${string}`) => {
        if (canUseBatchedSubmitCalls) {
          await executeSponsoredCalls(
            [
              {
                abi: registryInfo.abi,
                address: registryAddress,
                args: [revealCommitment],
                functionName: "reserveSubmission",
              },
            ],
            {
              atomicRequired: true,
              sponsorshipMode: submitCallSponsorshipMode,
              suppressStatusToast: true,
            },
          );
          return null;
        }

        const reserveTxHash = await writeRegistry(
          {
            functionName: "reserveSubmission",
            args: [revealCommitment],
          },
          {
            suppressErrorToast: true,
            suppressStatusToast: true,
            suppressSuccessToast: true,
          },
        );

        if (reserveTxHash) {
          await waitForTransactionReceipt(wagmiConfig, { hash: reserveTxHash });
        }

        return reserveTxHash ?? null;
      };

      const reserveTxHash = await reserveSubmission(revealCommitment);
      reservedRevealCommitment = revealCommitment;
      const reserveNonce = await getSubmittedTransactionNonce(reserveTxHash);

      // ContentRegistry enforces a minimum reservation age before reveal.
      // Give the next block timestamp enough room to advance before the reveal submit.
      await new Promise(resolve => setTimeout(resolve, 1_100));

      if (canUseBatchedSubmitCalls) {
        const callsResult = await executeSponsoredCalls(
          [
            {
              abi: ERC20_APPROVAL_ABI,
              address: verifiedRewardTokenAddress,
              args: [rewardEscrowAddress, selectedRewardAmount],
              functionName: "approve",
            },
            {
              abi: QUESTION_SUBMISSION_ABI,
              address: registryAddress,
              args: isBundleSubmission
                ? [bundleQuestions, rewardTerms, roundConfigAbi]
                : [
                    primaryQuestion.contextUrl,
                    primaryQuestion.imageUrls,
                    primaryQuestion.videoUrl,
                    primaryQuestion.title,
                    primaryQuestion.tags,
                    primaryQuestion.categoryId,
                    { detailsUrl: primaryQuestion.detailsUrl, detailsHash: primaryQuestion.detailsHash },
                    primaryQuestion.salt,
                    rewardTerms,
                    roundConfigAbi,
                    primaryQuestion.spec,
                  ],
              functionName: isBundleSubmission
                ? "submitQuestionBundleWithRewardAndRoundConfig"
                : "submitQuestionWithRewardAndRoundConfig",
            },
          ],
          {
            atomicRequired: true,
            sponsorshipMode: submitCallSponsorshipMode,
            suppressStatusToast: true,
          },
        );

        const submissionReceipts = callsResult.receipts ?? [];
        submittedContentIds = extractSubmittedContentIds(submissionReceipts.flatMap(receipt => receipt.logs));
        submissionTransactionHashes = extractReceiptTransactionHashes(submissionReceipts);
      } else {
        const approveWrite = {
          address: verifiedRewardTokenAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "approve",
          args: [rewardEscrowAddress, selectedRewardAmount],
        } as const;
        const approveTxHash = localE2ETestWalletClient
          ? await localE2ETestWalletClient.writeContract(approveWrite as any)
          : await writeContract(
              wagmiConfig,
              await prepareDirectWalletWrite(approveWrite, {
                minimumNonce: reserveNonce === undefined ? undefined : reserveNonce + 1,
              }),
            );

        if (approveTxHash) {
          await waitForTransactionReceipt(wagmiConfig, { hash: approveTxHash });
        }
        const approveNonce = await getSubmittedTransactionNonce(approveTxHash);

        const submitWrite = isBundleSubmission
          ? ({
              address: registryAddress,
              abi: QUESTION_SUBMISSION_ABI,
              functionName: "submitQuestionBundleWithRewardAndRoundConfig",
              args: [bundleQuestions, rewardTerms, roundConfigAbi],
            } as const)
          : ({
              address: registryAddress,
              abi: QUESTION_SUBMISSION_ABI,
              functionName: "submitQuestionWithRewardAndRoundConfig",
              args: [
                primaryQuestion.contextUrl,
                primaryQuestion.imageUrls,
                primaryQuestion.videoUrl,
                primaryQuestion.title,
                primaryQuestion.tags,
                primaryQuestion.categoryId,
                { detailsUrl: primaryQuestion.detailsUrl, detailsHash: primaryQuestion.detailsHash },
                primaryQuestion.salt,
                rewardTerms,
                roundConfigAbi,
                primaryQuestion.spec,
              ],
            } as const);
        const submitTxHash = localE2ETestWalletClient
          ? await localE2ETestWalletClient.writeContract(submitWrite as any)
          : await writeContract(
              wagmiConfig,
              (await prepareDirectWalletWrite(submitWrite, {
                minimumNonce: approveNonce === undefined ? undefined : approveNonce + 1,
              })) as any,
            );

        if (submitTxHash) {
          const submitReceipt = await waitForTransactionReceipt(wagmiConfig, { hash: submitTxHash });
          submittedContentIds = extractSubmittedContentIds(submitReceipt.logs);
          submissionTransactionHashes = [submitTxHash];
        }
      }

      reservedRevealCommitment = null;
      let feedbackBonusFunded = false;
      let feedbackBonusFundingError: string | null = null;
      const primarySubmittedContentId = submittedContentIds[0] ?? null;

      await attachQuestionDetailsAfterSubmission({
        contentIds: submittedContentIds,
        questions: bundleQuestions,
        transactionHashes: submissionTransactionHashes,
      }).catch(error => {
        console.warn("Unable to attach question details to submitted content.", error);
      });

      if (
        shouldFundFeedbackBonus &&
        selectedFeedbackBonusAmount &&
        selectedFeedbackBonusAwarderAddress &&
        feedbackBonusEscrowAddress &&
        feedbackBonusTokenAddress &&
        verifiedVotingEngineAddress &&
        primarySubmittedContentId !== null
      ) {
        try {
          const currentFeedbackRoundId = (await readContract(wagmiConfig, {
            address: verifiedVotingEngineAddress,
            abi: RoundVotingEngineAbi,
            functionName: "currentRoundId",
            args: [primarySubmittedContentId],
          })) as bigint;
          const feedbackRoundId = currentFeedbackRoundId > 0n ? currentFeedbackRoundId : 1n;

          const feedbackApproveWrite = {
            address: feedbackBonusTokenAddress,
            abi: ERC20_APPROVAL_ABI,
            functionName: "approve",
            args: [feedbackBonusEscrowAddress, selectedFeedbackBonusAmount],
          } as const;
          const feedbackPoolWrite = {
            address: feedbackBonusEscrowAddress,
            abi: FEEDBACK_BONUS_ESCROW_ABI,
            functionName: "createFeedbackBonusPoolWithAsset",
            args: [
              primarySubmittedContentId,
              feedbackRoundId,
              selectedFeedbackBonusAssetId,
              selectedFeedbackBonusAmount,
              feedbackBonusClosesAt,
              selectedFeedbackBonusAwarderAddress,
            ],
          } as const;

          if (canUseBatchedSubmitCalls) {
            await executeSponsoredCalls([feedbackApproveWrite, feedbackPoolWrite], {
              atomicRequired: true,
              sponsorshipMode: submitCallSponsorshipMode,
              suppressStatusToast: true,
            });
            feedbackBonusFunded = true;
          } else {
            const feedbackApproveTxHash = localE2ETestWalletClient
              ? await localE2ETestWalletClient.writeContract(feedbackApproveWrite as any)
              : await writeContract(wagmiConfig, await prepareDirectWalletWrite(feedbackApproveWrite));

            if (feedbackApproveTxHash) {
              await waitForTransactionReceipt(wagmiConfig, { hash: feedbackApproveTxHash });
            }
            const feedbackApproveNonce = await getSubmittedTransactionNonce(feedbackApproveTxHash);

            const feedbackPoolTxHash = localE2ETestWalletClient
              ? await localE2ETestWalletClient.writeContract(feedbackPoolWrite as any)
              : await writeContract(
                  wagmiConfig,
                  (await prepareDirectWalletWrite(feedbackPoolWrite, {
                    minimumNonce: feedbackApproveNonce === undefined ? undefined : feedbackApproveNonce + 1,
                  })) as any,
                );

            if (feedbackPoolTxHash) {
              await waitForTransactionReceipt(wagmiConfig, { hash: feedbackPoolTxHash });
            }
            feedbackBonusFunded = true;
          }
        } catch (feedbackBonusError) {
          feedbackBonusFundingError =
            getSubmissionErrorMessage(feedbackBonusError) || "Feedback Bonus funding transaction failed.";
        }
      } else if (shouldFundFeedbackBonus) {
        feedbackBonusFundingError = "Question submitted, but the Feedback Bonus could not be prepared.";
      }

      await refetchNextContentId();

      statusToast.dismiss();
      notification.success(
        `${questionCount === 1 ? "Question" : "Question bundle"} submitted with a ${formatSubmissionRewardAmount(
          selectedRewardAmount,
          rewardAsset,
        )} voter bounty${
          feedbackBonusFunded
            ? ` and a ${formatFeedbackBonusAmount(selectedFeedbackBonusAmount, feedbackBonusAsset)} Feedback Bonus`
            : ""
        }.`,
      );
      if (feedbackBonusFundingError) {
        notification.error(`Question submitted, but Feedback Bonus funding failed: ${feedbackBonusFundingError}`);
      }
      const primarySubmittedQuestion = validatedQuestions[0];
      const primaryContentId = primarySubmittedContentId;
      const submittedQuestion =
        primaryContentId !== null && primarySubmittedQuestion
          ? {
              id: primaryContentId,
              title: primarySubmittedQuestion.trimmedTitle,
              description:
                questionCount > 1
                  ? `${questionCount} question bundle. Answer all questions to qualify for the bounty.`
                  : getDetailsPreviewText(primarySubmittedQuestion.trimmedDetailsText),
              lastActivityAt: new Date().toISOString(),
            }
          : null;
      setSubmittedContent(submittedQuestion);
      const emptyDraft = createEmptyQuestionDraft();
      setQuestionCount(1);
      setActiveQuestionIndex(0);
      setQuestionDrafts([emptyDraft]);
      setMediaMode("images");
      setContextUrl("");
      setContextUrlError(null);
      setImageUrls([""]);
      setImageUrlErrors([null]);
      setVideoUrl("");
      setVideoUrlError(null);
      setTitle("");
      setTitleError(null);
      setDetailsText("");
      setDetailsError(null);
      setSelectedCategory(null);
      setSelectedSubcategories([]);
      setCustomSubcategory("");
      setTargetAudience(createEmptyTargetAudienceDraft());
      setTargetAudienceCountryInput("");
      setTargetAudienceCountryError(null);
      setTargetAudienceNationalityInput("");
      setTargetAudienceNationalityError(null);
      setRewardAmount(defaultBountyAmount);
      setRewardAmountTouched(false);
      setRewardRequiredVoters("3");
      setRewardRequiredRounds("1");
      setBountyEligibility(BOUNTY_ELIGIBILITY_OPEN);
      setBountyRequiresRecentRecheck(false);
      setBountyWindowPreset(DEFAULT_BOUNTY_WINDOW_PRESET);
      setCustomBountyWindowAmount(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
      setCustomBountyWindowUnit(DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT);
      setBountyWindowOverridden(false);
      setBountyStartByPreset(DEFAULT_BOUNTY_WINDOW_PRESET);
      setCustomBountyStartByAmount(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
      setCustomBountyStartByUnit(DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT);
      setBountyStartByOverridden(false);
      setFeedbackBonusMode("none");
      setFeedbackBonusAmount("2");
      setFeedbackBonusAwarderAddress(connectedAddress ?? "");
      setFeedbackBonusAwarderTouched(false);
      setRoundBlindMinutes(String(Math.max(1, Math.round(roundConfigDefaults.epochDuration / SECONDS_PER_MINUTE))));
      setRoundMaxDurationMinutes(String(Math.max(1, Math.round(roundConfigDefaults.maxDuration / SECONDS_PER_MINUTE))));
      setRoundMinVoters(
        getSyncedSettlementVotersForPaidCompleters(
          "3",
          roundConfigBounds.minSettlementVoters,
          roundConfigBounds.maxSettlementVoters,
        ),
      );
      setRoundMaxVoters(defaultRoundMaxVoters);
      setRoundConfigTouched(false);
      setRoundMaxDurationOverridden(false);
      setShowAdvancedRoundSettings(false);
      setQuestionStepAttempted(false);
      setBountyStepAttempted(false);
      setFeedbackBonusStepAttempted(false);
      setSubmissionStep("question");
    } catch (e: unknown) {
      console.error("Submit failed:", e);
      if (reservedRevealCommitment && cancelReservedSubmission) {
        try {
          await cancelReservedSubmission(reservedRevealCommitment);
        } catch (cancelError) {
          if (!isReservationNotFoundError(cancelError)) {
            console.warn("Failed to cancel reserved bundle submission:", cancelError);
          }
        }
      }
      statusToast.dismiss();
      if (isFreeTransactionExhaustedError(e) || isInsufficientFundsError(e)) {
        notification.error(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
      } else if (isWalletRpcOverloadedError(e)) {
        showWalletRpcOverloadNotification();
      } else if (isReservationNotFoundError(e)) {
        notification.warning("Reservation expired. Retry submitting.");
      } else if (isReservationExistsError(e)) {
        notification.warning("Reservation saved. Retry submitting.");
      } else {
        notification.error(
          (e as { shortMessage?: string; message?: string } | undefined)?.shortMessage ||
            (e as { shortMessage?: string; message?: string } | undefined)?.message ||
            "Failed to submit question",
        );
      }
    } finally {
      setIsSubmitting(false);
      statusToast.dismiss();
    }
  };

  const handleCloseShareModal = () => {
    setSubmittedContent(null);
  };

  const hasImageInput = imageUrls.some(url => url.trim());
  const hasVideoInput = Boolean(videoUrl.trim());
  const contextOrMediaMissing =
    questionStepAttempted &&
    !normalizedContextUrl &&
    normalizedImageUrls.length === 0 &&
    !hasImageInput &&
    !normalizedVideoUrl &&
    !hasVideoInput;
  const imageMediaMissing = contextOrMediaMissing && mediaMode === "images";
  const videoMediaMissing = contextOrMediaMissing && mediaMode === "video";
  const pageHeading =
    submissionStep === "question" ? "Submit Question" : submissionStep === "bounty" ? "Bounty" : "Feedback Bonus";
  const pageContext =
    submissionStep === "question"
      ? `Question ${activeQuestionIndex + 1} of ${questionCount}`
      : submissionStep === "bounty"
        ? questionCount > 1
          ? `${questionCount} question bundle`
          : "Single question bounty"
        : questionCount > 1
          ? "Optional feedback bonus unavailable for bundles"
          : "Optional feedback bonus";
  const targetAudienceSelectedCount = countTargetAudienceValues(targetAudience);

  const submissionStepIndicator = (
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-base-content/55">
      {Array.from({ length: questionCount }, (_, index) => (
        <button
          key={index}
          type="button"
          aria-current={submissionStep === "question" && activeQuestionIndex === index ? "step" : undefined}
          aria-label={`Go to question ${index + 1}`}
          onClick={() => setActiveQuestionPage(index)}
          title={`Go to question ${index + 1}`}
          className={`cursor-pointer rounded-md border px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 ${
            submissionStep === "question" && activeQuestionIndex === index
              ? "border-primary bg-primary text-primary-content hover:bg-primary/90"
              : "step-control-inactive"
          }`}
        >
          Q{index + 1}
        </button>
      ))}
      <span aria-hidden="true">→</span>
      <button
        type="button"
        aria-current={submissionStep === "bounty" ? "step" : undefined}
        aria-label="Go to bounty details"
        onClick={handleGoToBountyStep}
        title="Go to bounty details"
        className={`cursor-pointer rounded-md border px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 ${
          submissionStep === "bounty"
            ? "border-primary bg-primary text-primary-content hover:bg-primary/90"
            : "step-control-inactive"
        }`}
      >
        Bounty
      </button>
      <span aria-hidden="true">→</span>
      <button
        type="button"
        aria-current={submissionStep === "feedbackBonus" ? "step" : undefined}
        aria-label="Go to optional feedback bonus details"
        onClick={handleGoToFeedbackBonusStep}
        title="Go to optional feedback bonus details"
        className={`cursor-pointer rounded-md border px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 ${
          submissionStep === "feedbackBonus"
            ? "border-primary bg-primary text-primary-content hover:bg-primary/90"
            : "step-control-inactive"
        }`}
      >
        Feedback Bonus
      </button>
    </div>
  );

  const detailsPreviewText = getDetailsPreviewText(detailsText);
  const targetAudiencePicker = (
    <div className="border-t border-base-300 pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-base font-medium">
          Target audience <span className="font-normal text-base-content/60">(optional)</span>
          <InfoTooltip text="Structured self-report criteria used for targeted bounty eligibility. Raters see the normal question feed." />
        </label>
        {targetAudienceSelectedCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              updateTargetAudienceDraft(() => createEmptyTargetAudienceDraft());
              setTargetAudienceCountryInput("");
              setTargetAudienceCountryError(null);
              setTargetAudienceNationalityInput("");
              setTargetAudienceNationalityError(null);
            }}
            className="btn btn-ghost btn-sm"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="space-y-4">
        {TARGET_AUDIENCE_CHIP_GROUPS.map(group => (
          <AudienceChipGroup
            key={group.field}
            label={group.label}
            options={group.options}
            selected={targetAudience[group.field]}
            onToggle={value => handleTargetAudienceToggle(group.field, value)}
          />
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <AudienceCountryCodeInput
            label="Residence country"
            inputValue={targetAudienceCountryInput}
            error={targetAudienceCountryError}
            selected={targetAudience.countries}
            onInputChange={value => {
              setTargetAudienceCountryInput(value.toUpperCase());
              setTargetAudienceCountryError(null);
            }}
            onAdd={() => handleTargetAudienceCodeAdd("countries")}
            onRemove={value => handleTargetAudienceToggle("countries", value)}
          />
          <AudienceCountryCodeInput
            label="Nationality"
            inputValue={targetAudienceNationalityInput}
            error={targetAudienceNationalityError}
            selected={targetAudience.nationalities}
            onInputChange={value => {
              setTargetAudienceNationalityInput(value.toUpperCase());
              setTargetAudienceNationalityError(null);
            }}
            onAdd={() => handleTargetAudienceCodeAdd("nationalities")}
            onRemove={value => handleTargetAudienceToggle("nationalities", value)}
          />
        </div>
      </div>
    </div>
  );

  const questionPreviewCard =
    previewUrl || title || detailsPreviewText ? (
      <div className="surface-card rounded-2xl p-4 space-y-3">
        <p className="text-base font-medium uppercase tracking-wider text-base-content/60">Preview</p>
        {title ? <h3 className="line-clamp-2 text-lg font-semibold text-base-content">{title}</h3> : null}
        {previewUrl ? (
          <ContentEmbed
            url={previewUrl}
            title={title}
            description={detailsPreviewText}
            thumbnailUrl={contextPreviewThumbnailUrl}
            compact
          />
        ) : null}
        {detailsPreviewText ? <p className="text-base text-base-content/70">{detailsPreviewText}</p> : null}
        {selectedSubcategories.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedSubcategories.map(tag => (
              <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-base font-medium text-primary">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="surface-card rounded-2xl p-4 space-y-3">
        <p className="text-base font-medium uppercase tracking-wider text-base-content/60">Preview</p>
        <p className="text-base text-base-content/50">
          Add the question and context link to preview how it will appear.
        </p>
      </div>
    );

  const prohibitedContentNotice = (
    <div className="surface-card-nested rounded-lg p-4">
      <p className="mb-2 text-base font-medium text-base-content">Prohibited Content</p>
      <p className="text-base text-base-content/70">
        Do not submit questions with illegal or harmful content. This includes but is not limited to: child exploitation
        material, non-consensual intimate imagery, content promoting violence or terrorism, doxxing, or
        copyright-infringing material. Violations may result in removal, blocked access, and potential legal action.
      </p>
    </div>
  );

  const bountyAmountTooltipText = `Every question needs a funded bounty. It discourages low-quality asks and rewards eligible voters. ${protocolDocFacts.usdcBountyPayoutTimingTooltip}`;
  const requiredVotersTooltipText =
    questionCount === 1
      ? `Minimum eligible revealed voters required in a round before that round can receive the bounty payout. Counts do not roll over across rounds. Current min for this amount: ${selectedRequiredVoterFloor}. Bounty floors: ${protocolDocFacts.bountyParticipantFloorsLabel}.`
      : `Minimum eligible completers required in a round set before that set can receive the bounty payout. Each completer must answer every question in the bundle. Current min for this amount: ${selectedRequiredVoterFloor}. Bounty floors: ${protocolDocFacts.bountyParticipantFloorsLabel}.`;
  const requiredRoundsTooltipText =
    "Each settlement round set requires every bundled question to settle once. Eligible completers can claim a reward for each completed set they fully answered.";
  const roundSettingsTooltipText =
    "Governance sets the allowed range. Bounty timing defaults follow the selected round duration.";
  const blindPhaseTooltipText = [
    "How long answers stay hidden before the result can be revealed and settled.",
    `Current min: ${formatDurationLabel(roundBlindMinuteBounds.min * SECONDS_PER_MINUTE)}.`,
    `Current max: ${formatDurationLabel(roundBlindMinuteBounds.max * SECONDS_PER_MINUTE)}.`,
  ].join(" ");
  const maxDurationTooltipText = [
    "How long the round can stay open before it expires without settlement.",
    `Current min: ${formatDurationLabel(roundMaxDurationMinuteBounds.min * SECONDS_PER_MINUTE)}.`,
    `Current max: ${formatDurationLabel(
      roundMaxDurationMinuteBounds.max * SECONDS_PER_MINUTE,
    )} for the selected blind phase.`,
  ].join(" ");
  const settlementVotersTooltipText = [
    "How many revealed voters are required before a round can settle and count for payout.",
    `Current min: ${roundConfigBounds.minSettlementVoters.toLocaleString()}.`,
    `Current max: ${roundConfigBounds.maxSettlementVoters.toLocaleString()}.`,
  ].join(" ");
  const voterCapTooltipText =
    questionCount > 1
      ? [
          "The maximum number of voters who can join each bundled question round.",
          `Current min: ${roundMaxVoterBounds.min.toLocaleString()}.`,
          `Current max: ${roundMaxVoterBounds.max.toLocaleString()} for question bundles.`,
        ].join(" ")
      : [
          "The maximum number of voters who can join the question round.",
          `Current min: ${roundMaxVoterBounds.min.toLocaleString()}.`,
          `Current max: ${roundMaxVoterBounds.max.toLocaleString()}.`,
        ].join(" ");
  const bountyExpiryTooltipText = `Bounty eligibility opens with the first private round and matches the blind response window by default. The start-by deadline defaults to the round max duration. ${protocolDocFacts.usdcBountyPayoutTimingTooltip}`;
  const bountyEstimateTooltipText =
    selectedRewardAmount === null
      ? `Using the current minimum until the bounty amount is valid. ${formatFrontendFeePercent(frontendFeeBps)} may be reserved for an eligible frontend operator. ${protocolDocFacts.usdcBountyPayoutTimingTooltip}`
      : `${formatFrontendFeePercent(frontendFeeBps)} may be reserved for an eligible frontend operator. ${protocolDocFacts.usdcBountyPayoutTimingTooltip}`;
  const minimumClaimEstimateLabel = questionCount === 1 ? "Per voter claim" : "Per completer claim";
  const voterCapEstimateLabel =
    questionCount === 1 ? "If each round reaches voter max" : "If every question reaches voter max";
  const perPaidCompleterTooltipText =
    questionCount === 1
      ? "Estimated claim per eligible voter in each qualified settlement round. A voter can claim once for each round they revealed in."
      : "Estimated claim per paid completer for one completed settlement round set. A completer can claim once for each set they fully answered.";
  const voterCapEstimateTooltipText =
    questionCount === 1
      ? "Estimated per voter claim if each qualifying settlement round fills the selected voter max."
      : "Estimated per completer claim if every bundled question in a round set fills the selected voter max.";

  const bountyDetailsCard = (
    <div className="space-y-5">
      <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
        Bounty
        <InfoTooltip text={protocolDocFacts.usdcBountyPayoutTimingTooltip} />
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={rewardAsset === "usdc"}
          data-testid="bounty-asset-usdc"
          onClick={() => setRewardAsset("usdc")}
          className={`btn btn-sm ${rewardAsset === "usdc" ? "btn-primary" : "btn-outline"}`}
        >
          USDC
        </button>
        <button
          type="button"
          aria-pressed={rewardAsset === "lrep"}
          data-testid="bounty-asset-lrep"
          onClick={() => setRewardAsset("lrep")}
          className={`btn btn-sm ${rewardAsset === "lrep" ? "btn-primary" : "btn-outline"}`}
        >
          LREP
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label
          className={`input input-bordered flex min-w-0 flex-1 items-center gap-2 bg-base-100 ${
            bountyStepAttempted && rewardAmountError ? "input-error" : ""
          }`}
        >
          <input
            type="text"
            inputMode="decimal"
            value={rewardAmount}
            onChange={e => {
              setRewardAmountTouched(true);
              setRewardAmount(e.target.value);
            }}
            className="grow bg-transparent"
            aria-label="Bounty amount"
          />
          <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-base-content/50">
            Min {formatSubmissionRewardAmount(minimumBountyAmount, rewardAsset)}
          </span>
        </label>
        <InfoTooltip text={bountyAmountTooltipText} className="shrink-0" />
      </div>
      {bountyStepAttempted && rewardAmountError ? <p className="text-base text-error">{rewardAmountError}</p> : null}

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-base-content/80">
          Bounty eligibility
          <InfoTooltip text="Everyone can answer. This only selects which revealed answers can qualify for the bounty payout and the eligible result view." />
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-10 items-center gap-3 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-sm"
              checked={bountyEligibility === BOUNTY_ELIGIBILITY_OPEN}
              onChange={() => {
                setBountyEligibility(BOUNTY_ELIGIBILITY_OPEN);
                setBountyRequiresRecentRecheck(false);
              }}
            />
            <span className="font-medium">Everyone</span>
          </label>
          {BOUNTY_ELIGIBILITY_CREDENTIAL_OPTIONS.map(option => {
            const checked = (bountyEligibility & option.bit) !== 0;
            return (
              <label
                key={option.kind}
                className="flex min-h-10 items-center gap-3 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm"
                  checked={checked}
                  onChange={event => {
                    const nextEligibility = event.target.checked
                      ? bountyEligibility | option.bit
                      : bountyEligibility & ~option.bit;
                    setBountyEligibility(nextEligibility);
                    if (nextEligibility === BOUNTY_ELIGIBILITY_OPEN) {
                      setBountyRequiresRecentRecheck(false);
                    }
                  }}
                />
                <span className="font-medium">{option.label}</span>
              </label>
            );
          })}
        </div>
        <label
          className={`mt-3 flex items-center justify-between gap-3 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm ${
            bountyEligibility === BOUNTY_ELIGIBILITY_OPEN ? "opacity-55" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block font-medium text-base-content">Require recent recheck</span>
            <span className="block text-base-content/55">
              Voters must refresh this credential shortly before voting.
            </span>
          </span>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={bountyEligibility !== BOUNTY_ELIGIBILITY_OPEN && bountyRequiresRecentRecheck}
            disabled={bountyEligibility === BOUNTY_ELIGIBILITY_OPEN}
            onChange={event => setBountyRequiresRecentRecheck(event.target.checked)}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="form-control">
            <span className="label-text flex items-center gap-1.5">
              Required voters
              <InfoTooltip text={requiredVotersTooltipText} />
            </span>
            <input
              type="number"
              min={rewardRequiredVotersBounds.min}
              max={rewardRequiredVotersBounds.max}
              step={1}
              inputMode="numeric"
              value={rewardRequiredVoters}
              onChange={e => {
                const normalizedValue = normalizeWholeNumberInput(e.target.value);
                if (normalizedValue !== null) {
                  setRewardRequiredVoters(normalizedValue);
                  syncSettlementVotersToPaidCompleters(normalizedValue);
                }
              }}
              onBlur={() => {
                const clampedPaidCompleters = clampWholeNumberInput(
                  rewardRequiredVoters,
                  rewardRequiredVotersBounds.min,
                  rewardRequiredVotersBounds.max,
                );
                setRewardRequiredVoters(clampedPaidCompleters);
                syncSettlementVotersToPaidCompleters(clampedPaidCompleters);
              }}
              className={`input input-bordered bg-base-100 ${
                bountyStepAttempted && rewardRequiredVotersError ? "input-error" : ""
              }`}
            />
          </div>

          <div className="form-control">
            <div className="flex items-center gap-1.5">
              <label htmlFor="round-voter-cap" className="label-text">
                Max voters per round
              </label>
              <InfoTooltip text={voterCapTooltipText} />
            </div>
            <input
              id="round-voter-cap"
              type="number"
              min={roundMaxVoterBounds.min}
              max={roundMaxVoterBounds.max}
              step={1}
              inputMode="numeric"
              value={roundMaxVoters}
              onChange={e => {
                updateRoundWholeNumberInput(e.target.value, setRoundMaxVoters);
              }}
              onBlur={() => {
                const clampedMaxVoters = clampWholeNumberInput(
                  roundMaxVoters,
                  roundMaxVoterBounds.min,
                  roundMaxVoterBounds.max,
                );
                const clampedPaidCompleters = clampWholeNumberInput(
                  rewardRequiredVoters,
                  MIN_REWARD_POOL_REQUIRED_VOTERS,
                  Math.max(
                    MIN_REWARD_POOL_REQUIRED_VOTERS,
                    Math.min(Number(clampedMaxVoters), roundConfigBounds.maxSettlementVoters),
                  ),
                );

                setRoundMaxVoters(clampedMaxVoters);
                setRewardRequiredVoters(clampedPaidCompleters);
                syncSettlementVotersToPaidCompleters(clampedPaidCompleters);
              }}
              className={`input input-bordered bg-base-100 ${
                bountyStepAttempted && roundConfigValidationError ? "input-error" : ""
              }`}
            />
          </div>
        </div>

        <div className="form-control">
          <div className="flex items-center gap-1.5">
            <span className="label-text">Blind response window</span>
            <InfoTooltip text={blindPhaseTooltipText} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {ROUND_RESPONSE_WINDOW_PRESETS.map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={selectedRoundResponseWindowPreset === option.id}
                onClick={() => updateRoundBlindMinutesInput(String(option.minutes))}
                className={`btn btn-sm ${
                  selectedRoundResponseWindowPreset === option.id ? "btn-primary" : "btn-outline"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label
            className={`mt-2 input input-bordered flex items-center gap-2 bg-base-100 ${
              bountyStepAttempted && roundConfigValidationError ? "input-error" : ""
            }`}
          >
            <input
              type="number"
              min={roundBlindMinuteBounds.min}
              max={roundBlindMinuteBounds.max}
              step={1}
              inputMode="numeric"
              value={roundBlindMinutes}
              onChange={e => updateRoundBlindMinutesInput(e.target.value)}
              onBlur={clampRoundBlindMinutesInput}
              className="grow bg-transparent"
              aria-label="Custom blind response window"
            />
            <span className="text-sm font-semibold text-base-content/50">min</span>
          </label>
        </div>
      </div>
      {bountyStepAttempted && rewardRequiredVotersError ? (
        <p className="text-base text-error">{rewardRequiredVotersError}</p>
      ) : null}
      {bountyStepAttempted && roundConfigValidationError && !showAdvancedRoundSettings ? (
        <p className="text-base text-error">{roundConfigValidationError}</p>
      ) : null}

      <div className="space-y-3 pt-2">
        <div className="surface-card-nested rounded-lg p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-expanded={showAdvancedRoundSettings}
                aria-controls="advanced-round-settings"
                onClick={() => setShowAdvancedRoundSettings(current => !current)}
                className="inline-flex items-center gap-2 text-left text-base font-medium text-base-content transition-colors hover:text-base-content/80"
              >
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 transition-transform ${showAdvancedRoundSettings ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
                Advanced bounty settings
              </button>
              <InfoTooltip text={roundSettingsTooltipText} />
            </div>
          </div>

          {showAdvancedRoundSettings ? (
            <div id="advanced-round-settings" className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="form-control">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="reward-required-rounds" className="label-text">
                    Settlement rounds
                  </label>
                  <InfoTooltip text={requiredRoundsTooltipText} />
                </div>
                <input
                  id="reward-required-rounds"
                  type="number"
                  min={MIN_REWARD_POOL_SETTLED_ROUNDS}
                  max={MAX_REWARD_POOL_SETTLED_ROUNDS}
                  step={1}
                  inputMode="numeric"
                  value={rewardRequiredRounds}
                  onChange={e => {
                    const normalizedValue = normalizeWholeNumberInput(e.target.value);
                    if (normalizedValue !== null) {
                      setRewardRequiredRounds(normalizedValue);
                    }
                  }}
                  onBlur={() => {
                    setRewardRequiredRounds(current =>
                      clampWholeNumberInput(current, MIN_REWARD_POOL_SETTLED_ROUNDS, MAX_REWARD_POOL_SETTLED_ROUNDS),
                    );
                  }}
                  className={`input input-bordered bg-base-100 ${
                    bountyStepAttempted && rewardRequiredRoundsError ? "input-error" : ""
                  }`}
                />
              </div>

              <div className="form-control">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="round-max-duration-minutes" className="label-text">
                    Max duration
                  </label>
                  <InfoTooltip text={maxDurationTooltipText} />
                </div>
                <input
                  id="round-max-duration-minutes"
                  type="number"
                  min={roundMaxDurationMinuteBounds.min}
                  max={roundMaxDurationMinuteBounds.max}
                  step={1}
                  inputMode="numeric"
                  value={roundMaxDurationMinutes}
                  onChange={e => {
                    const normalizedValue = normalizeWholeNumberInput(e.target.value);
                    if (normalizedValue !== null) {
                      setRoundConfigTouched(true);
                      setRoundMaxDurationOverridden(true);
                      setRoundMaxDurationMinutes(normalizedValue);
                    }
                  }}
                  onBlur={() => {
                    setRoundConfigTouched(true);
                    setRoundMaxDurationOverridden(true);
                    setRoundMaxDurationMinutes(current =>
                      clampWholeNumberInput(
                        current,
                        roundMaxDurationMinuteBounds.min,
                        roundMaxDurationMinuteBounds.max,
                      ),
                    );
                  }}
                  className={`input input-bordered bg-base-100 ${
                    bountyStepAttempted && roundConfigValidationError ? "input-error" : ""
                  }`}
                />
                <span className="mt-1 text-xs font-semibold text-base-content/50">minutes</span>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-base-content/80">
                  Start-by deadline
                  <InfoTooltip text={bountyExpiryTooltipText} />
                </p>
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                  <button
                    type="button"
                    aria-pressed={!bountyStartByOverridden}
                    onClick={() => setBountyStartByOverridden(false)}
                    className={`btn btn-sm ${!bountyStartByOverridden ? "btn-primary" : "btn-outline"}`}
                  >
                    Match max duration
                  </button>
                  <button
                    type="button"
                    aria-pressed={bountyStartByOverridden}
                    onClick={() => setBountyStartByOverridden(true)}
                    className={`btn btn-sm ${bountyStartByOverridden ? "btn-primary" : "btn-outline"}`}
                  >
                    Override
                  </button>
                </div>
                {!bountyStartByOverridden ? (
                  <p className="text-sm text-base-content/60">
                    Current deadline: {formatDurationLabel((effectiveBountyStartByWindowSeconds ?? 0) || 0)} (
                    {estimatedBountyStartByLabel})
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      {BOUNTY_WINDOW_PRESETS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={bountyStartByPreset === option.id}
                          onClick={() => {
                            setBountyStartByOverridden(true);
                            setBountyStartByPreset(option.id);
                          }}
                          className={`btn btn-sm ${bountyStartByPreset === option.id ? "btn-primary" : "btn-outline"}`}
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={bountyStartByPreset === "custom"}
                        onClick={() => {
                          setBountyStartByOverridden(true);
                          setBountyStartByPreset("custom");
                        }}
                        className={`btn btn-sm ${bountyStartByPreset === "custom" ? "btn-primary" : "btn-outline"}`}
                      >
                        Custom
                      </button>
                    </div>
                    {bountyStartByPreset === "custom" ? (
                      <div className="grid gap-3 sm:grid-cols-[max-content_8rem] sm:items-end sm:gap-x-6">
                        <label
                          htmlFor="custom-bounty-start-by-amount"
                          className="grid gap-2 sm:grid-cols-[max-content_12rem] sm:items-center sm:gap-x-6"
                        >
                          <span className="label-text">Deadline length</span>
                          <input
                            id="custom-bounty-start-by-amount"
                            type="number"
                            min={1}
                            max={customBountyStartByAmountMax}
                            step={1}
                            inputMode="numeric"
                            value={customBountyStartByAmount}
                            onChange={e => {
                              const normalizedValue = normalizeWholeNumberInput(e.target.value);
                              if (normalizedValue !== null) {
                                setBountyStartByOverridden(true);
                                setCustomBountyStartByAmount(normalizedValue);
                              }
                            }}
                            onBlur={() => {
                              setBountyStartByOverridden(true);
                              setCustomBountyStartByAmount(current =>
                                clampWholeNumberInput(current, 1, customBountyStartByAmountMax),
                              );
                            }}
                            className={`input input-bordered bg-base-100 ${
                              bountyStepAttempted && rewardStartByError ? "input-error" : ""
                            }`}
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text">Unit</span>
                          <select
                            value={customBountyStartByUnit}
                            onChange={e => {
                              const nextUnit = e.target.value as BountyWindowUnit;
                              const nextMax =
                                nextUnit === "hours"
                                  ? Math.floor(Number.MAX_SAFE_INTEGER / SECONDS_PER_HOUR)
                                  : Math.floor(Number.MAX_SAFE_INTEGER / (24 * SECONDS_PER_HOUR));

                              setBountyStartByOverridden(true);
                              setCustomBountyStartByUnit(nextUnit);
                              setCustomBountyStartByAmount(current => clampWholeNumberInput(current, 1, nextMax));
                            }}
                            className="select select-bordered bg-base-100"
                          >
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>
                )}
                {bountyStepAttempted && rewardStartByError ? (
                  <p className="text-base text-error">{rewardStartByError}</p>
                ) : null}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-base-content/80">
                  Eligibility window
                  <InfoTooltip text={bountyExpiryTooltipText} />
                </p>
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                  <button
                    type="button"
                    aria-pressed={!bountyWindowOverridden}
                    onClick={() => setBountyWindowOverridden(false)}
                    className={`btn btn-sm ${!bountyWindowOverridden ? "btn-primary" : "btn-outline"}`}
                  >
                    Match response window
                  </button>
                  <button
                    type="button"
                    aria-pressed={bountyWindowOverridden}
                    onClick={() => setBountyWindowOverridden(true)}
                    className={`btn btn-sm ${bountyWindowOverridden ? "btn-primary" : "btn-outline"}`}
                  >
                    Override
                  </button>
                </div>
                {!bountyWindowOverridden ? (
                  <p className="text-sm text-base-content/60">
                    Current window: {formatDurationLabel((effectiveBountyWindowSeconds ?? 0) || 0)}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      {BOUNTY_WINDOW_PRESETS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={bountyWindowPreset === option.id}
                          onClick={() => {
                            setBountyWindowOverridden(true);
                            setBountyWindowPreset(option.id);
                          }}
                          className={`btn btn-sm ${bountyWindowPreset === option.id ? "btn-primary" : "btn-outline"}`}
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={bountyWindowPreset === "custom"}
                        onClick={() => {
                          setBountyWindowOverridden(true);
                          setBountyWindowPreset("custom");
                        }}
                        className={`btn btn-sm ${bountyWindowPreset === "custom" ? "btn-primary" : "btn-outline"}`}
                      >
                        Custom
                      </button>
                    </div>
                    {bountyWindowPreset === "custom" ? (
                      <div className="grid gap-3 sm:grid-cols-[max-content_8rem] sm:items-end sm:gap-x-6">
                        <label
                          htmlFor="custom-bounty-window-amount"
                          className="grid gap-2 sm:grid-cols-[max-content_12rem] sm:items-center sm:gap-x-6"
                        >
                          <span className="label-text">Window length</span>
                          <input
                            id="custom-bounty-window-amount"
                            type="number"
                            min={1}
                            max={customBountyWindowAmountMax}
                            step={1}
                            inputMode="numeric"
                            value={customBountyWindowAmount}
                            onChange={e => {
                              const normalizedValue = normalizeWholeNumberInput(e.target.value);
                              if (normalizedValue !== null) {
                                setBountyWindowOverridden(true);
                                setCustomBountyWindowAmount(normalizedValue);
                              }
                            }}
                            onBlur={() => {
                              setBountyWindowOverridden(true);
                              setCustomBountyWindowAmount(current =>
                                clampWholeNumberInput(current, 1, customBountyWindowAmountMax),
                              );
                            }}
                            className={`input input-bordered bg-base-100 ${
                              bountyStepAttempted && rewardExpiryError ? "input-error" : ""
                            }`}
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text">Unit</span>
                          <select
                            value={customBountyWindowUnit}
                            onChange={e => {
                              const nextUnit = e.target.value as BountyWindowUnit;
                              const nextMax =
                                nextUnit === "hours"
                                  ? Math.floor(Number.MAX_SAFE_INTEGER / SECONDS_PER_HOUR)
                                  : Math.floor(Number.MAX_SAFE_INTEGER / (24 * SECONDS_PER_HOUR));

                              setBountyWindowOverridden(true);
                              setCustomBountyWindowUnit(nextUnit);
                              setCustomBountyWindowAmount(current => clampWholeNumberInput(current, 1, nextMax));
                            }}
                            className="select select-bordered bg-base-100"
                          >
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>
                )}
                {bountyStepAttempted && rewardExpiryError ? (
                  <p className="text-base text-error">{rewardExpiryError}</p>
                ) : null}
              </div>

              <div className="form-control">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="round-settlement-voters" className="label-text">
                    Settlement voters
                  </label>
                  <InfoTooltip text={settlementVotersTooltipText} />
                </div>
                <input
                  id="round-settlement-voters"
                  type="number"
                  min={roundConfigBounds.minSettlementVoters}
                  max={roundConfigBounds.maxSettlementVoters}
                  step={1}
                  inputMode="numeric"
                  value={roundMinVoters}
                  onChange={e => {
                    const normalizedValue = normalizeWholeNumberInput(e.target.value);
                    if (normalizedValue !== null) {
                      setRoundConfigTouched(true);
                      setRoundMinVoters(normalizedValue);
                      setRewardRequiredVoters(normalizedValue);
                    }
                  }}
                  onBlur={() => {
                    setRoundConfigTouched(true);
                    setRoundMinVoters(current => {
                      const parsedRoundMaxVotersCap = parseWholeNumberInput(roundMaxVoters);
                      const maxSettlementVoters = Math.max(
                        roundConfigBounds.minSettlementVoters,
                        Math.min(
                          roundConfigBounds.maxSettlementVoters,
                          parsedRoundMaxVotersCap > 0 ? parsedRoundMaxVotersCap : roundConfigBounds.maxSettlementVoters,
                        ),
                      );
                      const clampedSettlementVoters = clampWholeNumberInput(
                        current,
                        roundConfigBounds.minSettlementVoters,
                        maxSettlementVoters,
                      );
                      setRewardRequiredVoters(clampedSettlementVoters);
                      return clampedSettlementVoters;
                    });
                  }}
                  className={`input input-bordered bg-base-100 ${
                    bountyStepAttempted && roundConfigValidationError ? "input-error" : ""
                  }`}
                />
              </div>
            </div>
          ) : null}

          {showAdvancedRoundSettings && bountyStepAttempted && roundConfigValidationError ? (
            <p className="mt-3 text-base text-error">{roundConfigValidationError}</p>
          ) : null}
          {showAdvancedRoundSettings && bountyStepAttempted && rewardRequiredRoundsError ? (
            <p className="mt-3 text-base text-error">{rewardRequiredRoundsError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );

  const bountyInsightsCard = (
    <div className="space-y-4">
      <div className="surface-card-nested rounded-lg p-4">
        <p className="mb-4 flex items-center gap-1.5 text-base font-medium text-primary">
          Bounty estimate
          <InfoTooltip text={bountyEstimateTooltipText} />
        </p>

        <div className="space-y-4">
          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              {minimumClaimEstimateLabel}
              <InfoTooltip text={perPaidCompleterTooltipText} />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">
              {formatSubmissionRewardAmount(estimatedMinimumVoterReward, rewardAsset)}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              {voterCapEstimateLabel}
              <InfoTooltip text={voterCapEstimateTooltipText} />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">
              {formatSubmissionRewardAmount(estimatedVoterCapReward, rewardAsset)}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              Start-by deadline
              <InfoTooltip text="The first private round must start by this deadline or the bounty can no longer activate." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">{estimatedBountyStartByLabel}</p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              Eligibility window
              <InfoTooltip text="This duration starts when the first private round starts, so the exact close time depends on the first vote." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">{bountyEligibilityWindowLabel}</p>
          </div>
        </div>
      </div>

      <div className="surface-card-nested rounded-lg p-4">
        <p className="mb-2 text-base font-medium text-primary">Recommendation</p>
        <p className="text-base text-base-content/70">{bountyRecommendation}</p>
      </div>
    </div>
  );

  const bountyActions = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      <button
        type="button"
        onClick={() => {
          setSubmissionStep("question");
          setBountyStepAttempted(false);
        }}
        className="btn btn-ghost w-full sm:w-auto"
      >
        Back
      </button>
      <GradientActionButton onClick={handleGoToFeedbackBonusStep} className="w-full sm:flex-1" disabled={isSubmitting}>
        Continue
      </GradientActionButton>
    </div>
  );

  const feedbackBonusDetailsCard = (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
          Feedback Bonus <span className="text-base-content/55">(optional)</span>
          <InfoTooltip text="Optional LREP or USDC pool for useful public feedback from revealed raters. The awarder pays selected feedback after settlement, with the default frontend fee reserved when eligible." />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <button
          type="button"
          aria-pressed={feedbackBonusMode === "none"}
          onClick={() => {
            setFeedbackBonusMode("none");
            setFeedbackBonusStepAttempted(false);
          }}
          className={`btn btn-sm ${feedbackBonusMode === "none" ? "btn-primary" : "btn-outline"}`}
        >
          No bonus
        </button>
        <button
          type="button"
          aria-pressed={feedbackBonusMode === "enabled"}
          onClick={() => {
            if (questionCount > 1) {
              notification.info("Feedback Bonuses can be added to single-question submissions in this flow.");
              return;
            }
            setFeedbackBonusMode("enabled");
          }}
          className={`btn btn-sm ${feedbackBonusMode === "enabled" ? "btn-primary" : "btn-outline"}`}
          disabled={questionCount > 1}
        >
          Add bonus
        </button>
      </div>

      {questionCount > 1 ? (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Feedback Bonuses are per question and round. This submit flow supports them for single-question bounties
          first.
        </p>
      ) : null}

      {feedbackBonusMode === "enabled" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <button
              type="button"
              aria-pressed={feedbackBonusAsset === "usdc"}
              onClick={() => setFeedbackBonusAsset("usdc")}
              className={`btn btn-sm ${feedbackBonusAsset === "usdc" ? "btn-primary" : "btn-outline"}`}
            >
              USDC
            </button>
            <button
              type="button"
              aria-pressed={feedbackBonusAsset === "lrep"}
              onClick={() => setFeedbackBonusAsset("lrep")}
              className={`btn btn-sm ${feedbackBonusAsset === "lrep" ? "btn-primary" : "btn-outline"}`}
            >
              LREP
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label
              className={`input input-bordered flex min-w-0 flex-1 items-center gap-2 bg-base-100 ${
                feedbackBonusAmountError ? "input-error" : ""
              }`}
            >
              <input
                type="text"
                inputMode="decimal"
                value={feedbackBonusAmount}
                onChange={e => setFeedbackBonusAmount(e.target.value)}
                className="grow bg-transparent"
                aria-label="Feedback Bonus amount"
              />
              <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-base-content/50">
                {selectedFeedbackBonusAssetLabel}
              </span>
            </label>
            <InfoTooltip text="Feedback Bonuses can use LREP or World Chain USDC. The selected awarder later chooses which eligible feedback to pay." />
          </div>
          {feedbackBonusAmountError ? <p className="text-base text-error">{feedbackBonusAmountError}</p> : null}

          <div className="surface-card-nested rounded-lg p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-base text-base-content/70">
                  Feedback window
                  <InfoTooltip text="Sets the requested feedback close. Awarders still get at least 24 hours after settlement to decide payouts." />
                </p>
                <p className="mt-1 text-base font-medium text-base-content">{feedbackBonusWindowLabel}</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-base text-base-content/70">
                  Awarder
                  <InfoTooltip text="This address can award selected revealed feedback after settlement. It can be different from the funding wallet." />
                </p>
                <p className="mt-1 break-all text-base font-medium text-base-content">
                  {formatShortAddress(selectedFeedbackBonusAwarderAddress)}
                </p>
              </div>
            </div>
          </div>

          <label className="form-control">
            <span className="label">
              <span className="label-text flex items-center gap-1.5">
                Awarder address
                <InfoTooltip text="Defaults to your connected wallet. Paste another wallet if someone else should decide feedback awards." />
              </span>
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={feedbackBonusAwarderAddress}
                onChange={e => {
                  setFeedbackBonusAwarderTouched(true);
                  setFeedbackBonusAwarderAddress(e.target.value);
                }}
                placeholder={connectedAddress ?? "0x..."}
                className={`input input-bordered min-w-0 flex-1 bg-base-100 ${
                  feedbackBonusAwarderError ? "input-error" : ""
                }`}
                aria-label="Feedback Bonus awarder address"
              />
              <button
                type="button"
                onClick={() => {
                  setFeedbackBonusAwarderTouched(false);
                  setFeedbackBonusAwarderAddress(connectedAddress ?? "");
                }}
                className="btn btn-outline btn-sm h-12 sm:h-auto"
              >
                Use connected
              </button>
            </div>
            {feedbackBonusAwarderError ? (
              <span className="label pt-1">
                <span className="label-text-alt text-error">{feedbackBonusAwarderError}</span>
              </span>
            ) : null}
          </label>

          {!feedbackBonusEscrowAddress ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Feedback Bonus funding is not available on this network yet.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const feedbackBonusInsightsCard = (
    <div className="space-y-4">
      <div className="surface-card-nested rounded-lg p-4">
        <p className="mb-4 flex items-center gap-1.5 text-base font-medium text-primary">
          Feedback Bonus estimate
          <InfoTooltip
            text={`${formatFrontendFeePercent(frontendFeeBps)} may be reserved for an eligible frontend operator on each award.`}
          />
        </p>

        <div className="space-y-4">
          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              Available to award
              <InfoTooltip text="The gross amount funded into the optional feedback pool." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">
              {feedbackBonusMode === "enabled" && selectedFeedbackBonusAmount
                ? formatFeedbackBonusAmount(selectedFeedbackBonusAmount, feedbackBonusAsset)
                : formatFeedbackBonusAmount(0n, feedbackBonusAsset)}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              After frontend fee
              <InfoTooltip text="Estimated recipient amount if the whole bonus is paid in one award and the default frontend fee applies." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">
              {feedbackBonusMode === "enabled"
                ? formatFeedbackBonusAmount(estimatedFeedbackBonusRecipientAmount, feedbackBonusAsset)
                : formatFeedbackBonusAmount(0n, feedbackBonusAsset)}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              Requested feedback close
              <InfoTooltip text="The effective award deadline is at least 24 hours after the round settles, even when this requested close is earlier." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">{feedbackBonusWindowLabel}</p>
          </div>
        </div>
      </div>

      <div className="surface-card-nested rounded-lg p-4">
        <p className="mb-2 text-base font-medium text-primary">Recommendation</p>
        <p className="text-base text-base-content/70">
          {feedbackBonusMode === "enabled"
            ? "Use a Feedback Bonus when written rationale matters. The bounty still pays revealed votes; this pool is for notes worth calling out after settlement."
            : "Skip this for simple rating asks. Add a Feedback Bonus when you want raters to spend extra effort on useful written feedback."}
        </p>
      </div>
    </div>
  );

  const feedbackBonusActions = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      <button
        type="button"
        onClick={() => {
          setSubmissionStep("bounty");
          setFeedbackBonusStepAttempted(false);
        }}
        className="btn btn-ghost w-full sm:w-auto"
      >
        Back
      </button>
      <GradientActionButton
        onClick={handleFinalSubmit}
        className="w-full sm:flex-1"
        motion={getGradientActionMotion(
          isSubmitting || isAwaitingSponsoredSubmitCalls || isAwaitingSelfFundedSubmitCalls,
        )}
        disabled={
          isSubmitting || isAwaitingSponsoredSubmitCalls || isAwaitingSelfFundedSubmitCalls || isMissingGasBalance
        }
      >
        {isSubmitting ? (
          <span className="flex items-center gap-2 text-base-content">
            <span className="loading loading-spinner loading-sm"></span>
            Submitting...
          </span>
        ) : (
          "Submit"
        )}
      </GradientActionButton>
    </div>
  );

  return (
    <>
      <div className="surface-card rounded-2xl p-6 space-y-5">
        <div>
          <h1 className={surfaceSectionHeadingClassName}>{pageHeading}</h1>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {submissionStepIndicator}

          <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-base-content/55 sm:justify-end">
            <span className="flex items-center gap-2">
              Number of Questions
              <InfoTooltip text="Choose how many separate questions voters must answer in this submission. The bounty is split across all questions." />
            </span>
            <input
              type="number"
              min={1}
              max={MAX_QUESTION_BUNDLE_COUNT}
              step={1}
              value={questionCount}
              onChange={event => handleQuestionCountChange(event.target.value)}
              className="input h-8 w-11 rounded-md px-2 text-center text-base font-semibold leading-none text-base-content transition-colors"
              aria-label="Number of questions"
            />
          </label>
        </div>
      </div>

      <div className="surface-card rounded-2xl p-6" style={{ overflow: "visible" }}>
        <form onSubmit={handleFormSubmit} noValidate className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-base-content/50">{pageContext}</p>
          </div>

          {submissionStep === "question" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)] xl:items-start">
              <div className="space-y-5">
                <div>
                  <label
                    className={`mb-2 flex items-center gap-1.5 text-base font-medium ${
                      questionStepAttempted && !title.trim() ? "text-error" : ""
                    }`}
                  >
                    Question
                    <InfoTooltip text="Good questions are specific, subjective, and easy to compare. Focus on one clear thing voters can rate, avoid yes/no or factual prompts, and add context below." />
                  </label>
                  <input
                    type="text"
                    placeholder="Write a subjective question voters can rate"
                    className={`input input-bordered w-full bg-base-100 ${
                      titleError || (questionStepAttempted && !title.trim()) ? "input-error" : ""
                    }`}
                    value={title}
                    onChange={e => handleTitleChange(e.target.value)}
                    maxLength={MAX_QUESTION_LENGTH}
                  />
                  {questionStepAttempted && !title.trim() ? (
                    <p className="mt-1 text-base text-error">Question is required.</p>
                  ) : null}
                  {titleError ? <p className="mt-1 text-base text-error">{titleError}</p> : null}
                  <div className="mt-1 text-right">
                    <span className="text-base text-base-content/60">
                      {title.length}/{MAX_QUESTION_LENGTH}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-base font-medium">
                    Description <span className="text-base-content/60">(optional)</span>
                  </label>
                  <textarea
                    placeholder="Add context voters can expand before rating"
                    className={`textarea textarea-bordered min-h-32 w-full bg-base-100 ${
                      detailsError ? "textarea-error" : ""
                    }`}
                    value={detailsText}
                    onChange={e => handleDetailsTextChange(e.target.value)}
                    maxLength={MAX_QUESTION_DETAILS_TEXT_LENGTH}
                  />
                  {detailsError ? <p className="mt-1 text-base text-error">{detailsError}</p> : null}
                  <div className="mt-1 text-right">
                    <span className="text-base text-base-content/60">
                      {detailsText.length}/{MAX_QUESTION_DETAILS_TEXT_LENGTH}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    className={`mb-2 flex items-center gap-1.5 text-base font-medium ${
                      contextOrMediaMissing || contextUrlError ? "text-error" : ""
                    }`}
                  >
                    Context Source <span className="font-normal text-base-content/60">(optional with media)</span>
                    <InfoTooltip text="Use a public website as the source voters should judge. If there is no context source, add uploaded images or a YouTube link below." />
                  </label>
                  <input
                    type="url"
                    placeholder={urlConfig.contextPlaceholder}
                    className={`input input-bordered w-full bg-base-100 ${
                      contextOrMediaMissing || contextUrlError ? "input-error" : ""
                    }`}
                    value={contextUrl}
                    onChange={e => handleContextUrlChange(e.target.value)}
                    onBlur={() => setContextUrlError(getContextUrlValidationError(contextUrl))}
                    maxLength={MAX_SUBMISSION_URL_LENGTH}
                  />
                  {contextOrMediaMissing && !contextUrlError ? (
                    <p className="mt-1 text-base text-error">
                      Add a website, image, or YouTube video before submitting.
                    </p>
                  ) : null}
                  {contextUrlError ? <p className="mt-1 text-base text-error">{contextUrlError}</p> : null}
                </div>

                <div>
                  <label
                    className={`mb-2 flex items-center gap-1.5 text-base font-medium ${
                      imageMediaMissing || videoMediaMissing ? "text-error" : ""
                    }`}
                  >
                    Media <span className="font-normal text-base-content/60">(optional)</span>
                    <span className="font-normal text-base-content/60">
                      {mediaMode === "images" ? `(1-${MAX_SUBMISSION_IMAGE_URLS} images)` : "(YouTube)"}
                    </span>
                    <InfoTooltip text={mediaMode === "images" ? urlConfig.imageHint : urlConfig.videoHint} />
                  </label>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-pressed={mediaMode === "images"}
                      onClick={() => {
                        setMediaMode("images");
                        patchActiveQuestionDraft({ mediaMode: "images" });
                      }}
                      className={`btn btn-sm ${mediaMode === "images" ? "btn-primary" : "btn-outline"}`}
                    >
                      Images
                    </button>
                    <button
                      type="button"
                      aria-pressed={mediaMode === "video"}
                      onClick={() => {
                        setMediaMode("video");
                        patchActiveQuestionDraft({ mediaMode: "video" });
                      }}
                      className={`btn btn-sm ${mediaMode === "video" ? "btn-primary" : "btn-outline"}`}
                    >
                      YouTube
                    </button>
                  </div>

                  {mediaMode === "images" ? (
                    <div className="space-y-2">
                      <ImageAttachmentUploader
                        address={connectedAddress}
                        disabled={imageUrls.filter(url => url.trim()).length >= MAX_SUBMISSION_IMAGE_URLS}
                        onUploaded={handleUploadedImageUrl}
                      />
                      {imageUrls.map((imageUrl, index) =>
                        imageUrl.trim() ? (
                          <div
                            key={`${imageUrl}-${index}`}
                            className={`flex items-center gap-3 rounded-lg border bg-base-100 p-2 ${
                              imageUrlErrors[index] ? "border-error" : "border-base-300"
                            }`}
                          >
                            <img
                              src={imageUrl}
                              alt={`Uploaded image ${index + 1}`}
                              className="h-14 w-20 rounded-md object-cover"
                              loading="lazy"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-base-content">Uploaded image {index + 1}</p>
                              <p className="truncate text-xs text-base-content/60">RateLoop-hosted image context</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveImageUrl(index)}
                              className="btn btn-outline btn-square btn-sm"
                              aria-label={`Remove uploaded image ${index + 1}`}
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null,
                      )}
                      {imageUrlErrors.map((error, index) =>
                        error ? (
                          <p key={index} className="text-base text-error">
                            {error}
                          </p>
                        ) : null,
                      )}
                      {imageMediaMissing && !imageUrlErrors.some(Boolean) ? (
                        <p className="text-base text-error">Upload at least one image before submitting.</p>
                      ) : null}
                    </div>
                  ) : (
                    <div>
                      <input
                        type="url"
                        placeholder={urlConfig.videoPlaceholder}
                        className={`input input-bordered w-full bg-base-100 ${
                          videoUrlError || videoMediaMissing ? "input-error" : ""
                        }`}
                        value={videoUrl}
                        onChange={handleVideoUrlChange}
                        onBlur={() => validateVideoUrl(videoUrl, videoMediaMissing)}
                        maxLength={MAX_SUBMISSION_URL_LENGTH}
                      />
                      {videoUrlError ? <p className="mt-1 text-base text-error">{videoUrlError}</p> : null}
                      {videoMediaMissing && !videoUrlError ? (
                        <p className="mt-1 text-base text-error">Add a YouTube URL before submitting.</p>
                      ) : null}
                    </div>
                  )}
                </div>

                <div ref={categoryDropdownRef} className="relative">
                  <label
                    className={`mb-2 block text-base font-medium ${questionStepAttempted && !selectedCategory ? "text-error" : ""}`}
                  >
                    Select Category
                  </label>
                  {categoriesLoading ? (
                    <div className="input input-bordered flex w-full items-center bg-base-100">
                      <span className="loading loading-spinner loading-sm"></span>
                    </div>
                  ) : categories.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                        className={`input input-bordered flex w-full cursor-pointer items-center justify-between bg-base-100 transition-colors hover:bg-base-200 ${
                          questionStepAttempted && !selectedCategory ? "input-error" : ""
                        }`}
                      >
                        {selectedCategory ? (
                          <div className="flex items-center gap-2">
                            <CategoryIcon name={selectedCategory.name} />
                            <span>{selectedCategory.name}</span>
                          </div>
                        ) : (
                          <span className="text-base-content/50">Select a category...</span>
                        )}
                        <ChevronDownIcon
                          className={`h-5 w-5 text-base-content/50 transition-transform ${isCategoryDropdownOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                      {questionStepAttempted && !selectedCategory ? (
                        <p className="mt-1 text-base text-error">Select a category before submitting.</p>
                      ) : null}

                      {isCategoryDropdownOpen ? (
                        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg">
                          <div className="border-b border-base-300 p-2">
                            <div className="relative">
                              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/50" />
                              <input
                                type="text"
                                placeholder="Search categories..."
                                className="input input-sm w-full bg-base-200 pl-9 pr-8"
                                value={categorySearch}
                                onChange={e => setCategorySearch(e.target.value)}
                                autoFocus
                              />
                              {categorySearch ? (
                                <button
                                  type="button"
                                  onClick={() => setCategorySearch("")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div className="max-h-60 space-y-1 overflow-y-auto p-1">
                            {filteredCategories.length > 0 ? (
                              filteredCategories.map(cat => {
                                const isSelected = selectedCategory?.id === cat.id;
                                return (
                                  <button
                                    key={cat.id.toString()}
                                    type="button"
                                    onClick={() => {
                                      handleCategorySelect(cat);
                                      setIsCategoryDropdownOpen(false);
                                      setCategorySearch("");
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                                      isSelected ? "choice-row-active" : "choice-row-inactive"
                                    }`}
                                  >
                                    <CategoryIcon name={cat.name} />
                                    <div className="flex flex-col">
                                      <span className="font-medium">{cat.name}</span>
                                    </div>
                                    {isSelected ? <span className="ml-auto text-primary">✓</span> : null}
                                  </button>
                                );
                              })
                            ) : (
                              <div className="px-4 py-3 text-base text-base-content/50">
                                No categories found for &quot;{categorySearch}&quot;
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-base text-base-content/50">No categories available.</p>
                  )}
                </div>

                {selectedCategory ? (
                  <div>
                    <label
                      className={`mb-2 block text-base font-medium ${
                        questionStepAttempted && selectedSubcategories.length === 0 ? "text-error" : ""
                      }`}
                    >
                      Select Categories <span className="font-normal text-base-content/60">(1-3)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {selectedCategory.subcategories.map(subcat => {
                        const isSelected = selectedSubcategories.includes(subcat);
                        return (
                          <button
                            key={subcat}
                            type="button"
                            onClick={() => handleSubcategoryToggle(subcat)}
                            className={`rounded-full px-3 py-1.5 text-base font-medium transition-colors ${
                              isSelected ? "pill-active" : "pill-inactive"
                            }`}
                          >
                            {subcat}
                          </button>
                        );
                      })}
                      {selectedSubcategories
                        .filter(s => !selectedCategory.subcategories.includes(s))
                        .map(subcat => (
                          <button
                            key={subcat}
                            type="button"
                            onClick={() => handleSubcategoryToggle(subcat)}
                            className="pill-active flex items-center gap-1 rounded-full px-3 py-1.5 text-base font-medium transition-colors"
                          >
                            {subcat}
                            <span className="opacity-70">×</span>
                          </button>
                        ))}
                    </div>
                    <div className="mt-3">
                      <p className="mb-2 text-sm font-medium text-base-content/60">Custom category (optional)</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Add custom category..."
                          className={`input input-bordered input-sm flex-1 bg-base-100 ${customSubcategoryError ? "input-error" : ""}`}
                          value={customSubcategory}
                          onChange={e => {
                            setCustomSubcategory(e.target.value);
                            patchActiveQuestionDraft({ customSubcategory: e.target.value });
                          }}
                          maxLength={MAX_CONTENT_TAGS_LENGTH}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddCustomSubcategory();
                            }
                          }}
                          disabled={selectedSubcategories.length >= 3}
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomSubcategory}
                          disabled={
                            !customSubcategory.trim() ||
                            customSubcategoryError !== null ||
                            selectedSubcategories.length >= 3 ||
                            selectedSubcategories.includes(customSubcategory.trim())
                          }
                          className="btn btn-outline btn-sm"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                    {customSubcategoryError ? (
                      <p className="mt-2 text-base text-error">{customSubcategoryError}</p>
                    ) : null}
                    {selectedTagsValidationError ? (
                      <p className="mt-2 text-base text-error">{selectedTagsValidationError}</p>
                    ) : null}
                    {questionStepAttempted && selectedSubcategories.length === 0 ? (
                      <p className="mt-2 text-base text-error">Pick at least one category before submitting.</p>
                    ) : null}
                  </div>
                ) : null}

                {targetAudiencePicker}
              </div>

              <div className="space-y-4 xl:sticky xl:top-24">
                {questionPreviewCard}
                {prohibitedContentNotice}
                {isMissingGasBalance ? (
                  <GasBalanceWarning
                    nativeTokenSymbol={nativeTokenSymbol}
                    showTransactionCostsLink={showGasWarningTransactionCostsLink}
                  />
                ) : null}
                {bountyFundingWarning ? (
                  <BountyFundingWarning title={bountyFundingWarning.title} message={bountyFundingWarning.message} />
                ) : null}
                {activeQuestionIndex > 0 ? (
                  <button type="button" onClick={handleGoToPreviousQuestion} className="btn btn-ghost w-full">
                    Back to Q{activeQuestionIndex}
                  </button>
                ) : null}
                <GradientActionButton onClick={handleContinueToBounty} className="w-full">
                  {activeQuestionIndex < questionCount - 1
                    ? `Next Question (${activeQuestionIndex + 2}/${questionCount})`
                    : "Continue to Bounty"}
                </GradientActionButton>
              </div>
            </div>
          ) : submissionStep === "bounty" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)] xl:items-start">
              <div className="space-y-4">{bountyDetailsCard}</div>
              <div className="space-y-4 xl:sticky xl:top-24">
                {bountyInsightsCard}
                {isMissingGasBalance ? (
                  <GasBalanceWarning
                    nativeTokenSymbol={nativeTokenSymbol}
                    showTransactionCostsLink={showGasWarningTransactionCostsLink}
                  />
                ) : null}
                {bountyFundingWarning ? (
                  <BountyFundingWarning title={bountyFundingWarning.title} message={bountyFundingWarning.message} />
                ) : null}
                {bountyActions}
              </div>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)] xl:items-start">
              <div className="space-y-4">{feedbackBonusDetailsCard}</div>
              <div className="space-y-4 xl:sticky xl:top-24">
                {feedbackBonusInsightsCard}
                {isMissingGasBalance ? (
                  <GasBalanceWarning
                    nativeTokenSymbol={nativeTokenSymbol}
                    showTransactionCostsLink={showGasWarningTransactionCostsLink}
                  />
                ) : null}
                {bountyFundingWarning ? (
                  <BountyFundingWarning title={bountyFundingWarning.title} message={bountyFundingWarning.message} />
                ) : null}
                {feedbackBonusActions}
              </div>
            </div>
          )}
        </form>
      </div>

      {submittedContent ? (
        <ShareModal
          contentId={submittedContent.id}
          title={submittedContent.title}
          description={submittedContent.description}
          lastActivityAt={submittedContent.lastActivityAt}
          onClose={handleCloseShareModal}
        />
      ) : null}
    </>
  );
}
