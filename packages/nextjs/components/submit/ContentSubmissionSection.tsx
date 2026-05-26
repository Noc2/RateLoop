"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, encodeFunctionData, toHex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ContentEmbed } from "~~/components/content/ContentEmbed";
import { GasBalanceWarning } from "~~/components/shared/GasBalanceWarning";
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
import { useWalletRpcRecovery } from "~~/hooks/useWalletRpcRecovery";
import { buildQuestionSpecHashes } from "~~/lib/agent/questionSpecs";
import {
  BOUNTY_WINDOW_PRESETS,
  type BountyWindowPreset,
  type BountyWindowUnit,
  DEFAULT_BOUNTY_WINDOW_PRESET,
  DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT,
  DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  getBountyClosesAtFromWindowSeconds,
  getBountyWindowSeconds,
  parseBountyWindowAmount,
  resolveBountyReferenceNowSeconds,
} from "~~/lib/bountyWindows";
import { MAX_CONTENT_DESCRIPTION_LENGTH } from "~~/lib/contentDescription";
import {
  MAX_SUBMISSION_IMAGE_URLS,
  MAX_SUBMISSION_URL_LENGTH,
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
  getContentDescriptionValidationError,
  getContentTagValidationError,
  getContentTitleValidationError,
} from "~~/lib/moderation/submissionValidation";
import {
  DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS,
  DEFAULT_SUBMISSION_REWARD_POOL,
  ERC20_APPROVAL_ABI,
  FEEDBACK_BONUS_ESCROW_ABI,
  MAX_REWARD_POOL_SETTLED_ROUNDS,
  MIN_REWARD_POOL_REQUIRED_VOTERS,
  MIN_REWARD_POOL_SETTLED_ROUNDS,
  QUESTION_SUBMISSION_ABI,
  SUBMISSION_REWARD_ASSET_LREP,
  SUBMISSION_REWARD_ASSET_USDC,
  type SubmissionRewardAsset,
  formatSubmissionRewardAmount,
  formatUsdAmount,
  getConfiguredFeedbackBonusEscrowAddress,
  getDefaultUsdcAddress,
  parseSubmissionRewardAmount,
  parseUsdRewardPoolAmount,
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
} from "~~/lib/questionRoundConfig";
import {
  buildQuestionBundleSubmissionRevealCommitment,
  buildQuestionSubmissionRevealCommitment,
} from "~~/lib/questionSubmissionCommitment";
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
type BountyEligibilitySelection = "everyone" | "verified_humans";
type FeedbackBonusSelection = "none" | "enabled";

const BOUNTY_ELIGIBILITY_OPTIONS: Array<{
  id: BountyEligibilitySelection;
  label: string;
  mode: number;
}> = [
  { id: "everyone", label: "Everyone", mode: 0 },
  { id: "verified_humans", label: "Verified humans", mode: 1 },
];

const MAX_QUESTION_BUNDLE_COUNT = 10;
const MAX_CONTENT_TAGS_LENGTH = 256;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const MIN_HUMAN_RESPONSE_WINDOW_MINUTES = 20;
const ROUND_RESPONSE_WINDOW_PRESETS = [
  { id: "2m", label: "2m", minutes: 2 },
  { id: "5m", label: "5m", minutes: 5 },
  { id: "20m", label: "20m", minutes: 20 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "24h", label: "24h", minutes: 24 * 60 },
  { id: "3d", label: "3d", minutes: 3 * 24 * 60 },
  { id: "7d", label: "7d", minutes: 7 * 24 * 60 },
] as const;

type QuestionDraft = {
  mediaMode: MediaMode;
  contextUrl: string;
  imageUrls: string[];
  videoUrl: string;
  title: string;
  description: string;
  selectedCategory: Category | null;
  selectedSubcategories: string[];
  customSubcategory: string;
};

type ValidatedQuestionDraft = {
  blockedContentTags: string[];
  hasMediaError: boolean;
  hasQuestionErrors: boolean;
  submittedContextUrl: string;
  submittedImageUrls: string[];
  submittedVideoUrl: string;
  submittedTags: string;
  trimmedDescription: string;
  trimmedTitle: string;
  selectedCategory: Category | null;
};

type QuestionTaxonomySelection = Pick<QuestionDraft, "selectedCategory" | "selectedSubcategories">;

function createEmptyQuestionDraft(): QuestionDraft {
  return {
    mediaMode: "images",
    contextUrl: "",
    imageUrls: [""],
    videoUrl: "",
    title: "",
    description: "",
    selectedCategory: null,
    selectedSubcategories: [],
    customSubcategory: "",
  };
}

function createQuestionDraftWithTaxonomy(source: QuestionTaxonomySelection): QuestionDraft {
  return {
    ...createEmptyQuestionDraft(),
    selectedCategory: source.selectedCategory,
    selectedSubcategories: [...source.selectedSubcategories],
  };
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

function getSubmissionErrorMessage(error: unknown): string {
  return (
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ??
    (error as { shortMessage?: string; message?: string } | undefined)?.message ??
    ""
  );
}

function isUnknownEmptyRevertError(error: unknown): boolean {
  const message = getSubmissionErrorMessage(error);
  return (
    message.includes("Execution reverted for an unknown reason") ||
    message.includes("execution reverted for an unknown reason") ||
    message.includes('data: "0x"') ||
    message.includes("data: 0x") ||
    message.includes("EvmError: Revert")
  );
}

async function assertQuestionBundleSubmissionSelector(
  publicClient:
    | {
        call: (args: { to: `0x${string}`; data: `0x${string}` }) => Promise<unknown>;
      }
    | undefined,
  registryAddress: `0x${string}`,
) {
  if (!publicClient) return;

  const data = encodeFunctionData({
    abi: QUESTION_SUBMISSION_ABI,
    functionName: "submitQuestionBundleWithRewardAndRoundConfig",
    args: [
      [],
      {
        asset: SUBMISSION_REWARD_ASSET_LREP,
        amount: 0n,
        requiredVoters: 0n,
        requiredSettledRounds: 0n,
        bountyClosesAt: 0n,
        feedbackClosesAt: 0n,
        bountyEligibility: 0,
      },
      {
        epochDuration: 60,
        maxDuration: 60,
        minVoters: 3,
        maxVoters: 3,
      },
    ],
  });

  try {
    await publicClient.call({ to: registryAddress, data });
  } catch (error) {
    const message = getSubmissionErrorMessage(error);
    if (message.includes("No questions")) return;
    if (isUnknownEmptyRevertError(error)) {
      throw new Error(
        "This ContentRegistry deployment does not support question bundles. Restart the local chain and redeploy contracts, then try again.",
      );
    }
  }
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

export function ContentSubmissionSection() {
  const wagmiConfig = useConfig();
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(connectedAddress, targetNetwork.id);
  const { canSponsorTransactions, isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const statusToast = useTransactionStatusToast();
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls, isAwaitingSponsoredSubmitCalls } =
    useThirdwebSponsoredSubmitCalls();
  const { showWalletRpcOverloadNotification } = useWalletRpcRecovery();
  const { requireAcceptance } = useTermsAcceptance();

  const [mediaMode, setMediaMode] = useState<MediaMode>("images");
  const [contextUrl, setContextUrl] = useState("");
  const [contextUrlError, setContextUrlError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [imageUrlErrors, setImageUrlErrors] = useState<(string | null)[]>([null]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoUrlError, setVideoUrlError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
  const [customSubcategory, setCustomSubcategory] = useState("");
  const [questionCount, setQuestionCount] = useState(1);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([createEmptyQuestionDraft()]);
  const [rewardAsset, setRewardAsset] = useState<SubmissionRewardAsset>("usdc");
  const [rewardAmount, setRewardAmount] = useState("1");
  const [rewardRequiredVoters, setRewardRequiredVoters] = useState("3");
  const [rewardRequiredRounds, setRewardRequiredRounds] = useState("1");
  const [bountyEligibility, setBountyEligibility] = useState<BountyEligibilitySelection>("everyone");
  const [bountyWindowPreset, setBountyWindowPreset] = useState<BountyWindowPreset>(DEFAULT_BOUNTY_WINDOW_PRESET);
  const [customBountyWindowAmount, setCustomBountyWindowAmount] = useState(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
  const [customBountyWindowUnit, setCustomBountyWindowUnit] = useState<BountyWindowUnit>(
    DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT,
  );
  const [bountyWindowOverridden, setBountyWindowOverridden] = useState(false);
  const [bountyExpiryReferenceTimeMs, setBountyExpiryReferenceTimeMs] = useState<number | null>(null);
  const [feedbackBonusMode, setFeedbackBonusMode] = useState<FeedbackBonusSelection>("none");
  const [feedbackBonusAmount, setFeedbackBonusAmount] = useState("2");
  const [feedbackBonusStepAttempted, setFeedbackBonusStepAttempted] = useState(false);
  const [roundBlindMinutes, setRoundBlindMinutes] = useState(
    String(Number(DEFAULT_QUESTION_ROUND_CONFIG.epochDuration / 60n)),
  );
  const [roundMaxDurationMinutes, setRoundMaxDurationMinutes] = useState(
    String(Number(DEFAULT_QUESTION_ROUND_CONFIG.maxDuration / 60n)),
  );
  const [roundMinVoters, setRoundMinVoters] = useState(String(DEFAULT_QUESTION_ROUND_CONFIG.minVoters));
  const [roundMaxVoters, setRoundMaxVoters] = useState(String(DEFAULT_QUESTION_ROUND_CONFIG.maxVoters));
  const [roundConfigTouched, setRoundConfigTouched] = useState(false);
  const [roundMaxDurationOverridden, setRoundMaxDurationOverridden] = useState(false);
  const [settlementVotersOverridden, setSettlementVotersOverridden] = useState(false);
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
  }, [bountyWindowOverridden, bountyWindowPreset, customBountyWindowAmount, customBountyWindowUnit, roundBlindMinutes]);

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
    description,
    selectedCategory,
    selectedSubcategories,
    customSubcategory,
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
    setDescription(draft.description);
    setDescriptionError(null);
    setSelectedCategory(draft.selectedCategory);
    setSelectedSubcategories(draft.selectedSubcategories);
    setCustomSubcategory(draft.customSubcategory);
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
  const syncedSettlementVoters = getSyncedSettlementVotersForPaidCompleters(
    rewardRequiredVoters,
    roundConfigBounds.minSettlementVoters,
    roundConfigBounds.maxSettlementVoters,
  );
  const syncSettlementVotersToPaidCompleters = (paidCompleters: string) => {
    if (settlementVotersOverridden) {
      return;
    }

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
    setRoundMaxVoters(String(roundConfigDefaults.maxVoters));
  }, [protocolRoundConfig, roundConfigDefaults, roundConfigTouched, syncedSettlementVoters]);
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
  const parsedRewardRequiredVoters = parseWholeNumberInput(rewardRequiredVoters);
  const parsedRewardRequiredRounds = parseWholeNumberInput(rewardRequiredRounds);
  const rewardRequiredVotersBounds = {
    min: MIN_REWARD_POOL_REQUIRED_VOTERS,
    max: Math.max(
      MIN_REWARD_POOL_REQUIRED_VOTERS,
      Math.min(Number(selectedRoundConfig.maxVoters), roundMaxVoterBounds.max),
    ),
  };
  const selectedRequiredVoters = BigInt(Math.max(MIN_REWARD_POOL_REQUIRED_VOTERS, parsedRewardRequiredVoters));
  const selectedRequiredSettledRounds = BigInt(Math.max(MIN_REWARD_POOL_SETTLED_ROUNDS, parsedRewardRequiredRounds));
  const bountyMinimumCoverageAmount = selectedRequiredVoters * selectedRequiredSettledRounds;
  const minimumRewardAmount =
    rewardAsset === "lrep"
      ? typeof minSubmissionLrepPool === "bigint"
        ? minSubmissionLrepPool
        : DEFAULT_SUBMISSION_REWARD_POOL
      : typeof minSubmissionUsdcPool === "bigint"
        ? minSubmissionUsdcPool
        : DEFAULT_SUBMISSION_REWARD_POOL;
  const rewardAmountError =
    selectedRewardAmount === null
      ? "Enter a positive amount with up to 6 decimals."
      : selectedRewardAmount < minimumRewardAmount
        ? `Minimum is ${formatSubmissionRewardAmount(minimumRewardAmount, rewardAsset)}.`
        : selectedRewardAmount < bountyMinimumCoverageAmount
          ? `Minimum is ${formatSubmissionRewardAmount(
              bountyMinimumCoverageAmount,
              rewardAsset,
            )} for the selected voter requirements.`
          : null;
  const minimumBountyAmount =
    minimumRewardAmount > bountyMinimumCoverageAmount ? minimumRewardAmount : bountyMinimumCoverageAmount;
  const rewardRequiredVotersValidationError =
    parsedRewardRequiredVoters < MIN_REWARD_POOL_REQUIRED_VOTERS
      ? `Minimum is ${MIN_REWARD_POOL_REQUIRED_VOTERS} voters.`
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
  const estimatedBountyExpiresAtLabel = formatBountyExpiryDate(
    effectiveBountyWindowSeconds,
    bountyExpiryReferenceTimeMs,
  );
  const parsedCustomBountyWindowAmount = parseBountyWindowAmount(customBountyWindowAmount);
  const customBountyWindowAmountMax =
    customBountyWindowUnit === "hours"
      ? Math.floor(Number.MAX_SAFE_INTEGER / SECONDS_PER_HOUR)
      : Math.floor(Number.MAX_SAFE_INTEGER / (24 * SECONDS_PER_HOUR));
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
  const selectedBountyEligibility = BOUNTY_ELIGIBILITY_OPTIONS.find(option => option.id === bountyEligibility)!;
  const selectedFeedbackBonusAmount = parseUsdRewardPoolAmount(feedbackBonusAmount);
  const feedbackBonusUnavailableForBundle = questionCount > 1 && feedbackBonusMode === "enabled";
  const feedbackBonusAmountError =
    feedbackBonusStepAttempted && feedbackBonusMode === "enabled" && selectedFeedbackBonusAmount === null
      ? "Enter a positive USDC feedback bonus amount."
      : null;
  const feedbackBonusSettingsValid =
    feedbackBonusMode === "none" || (!feedbackBonusUnavailableForBundle && selectedFeedbackBonusAmount !== null);
  const bountySettingsValid =
    rewardRequiredVotersValidationError === null &&
    rewardRequiredRoundsValidationError === null &&
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
  const rewardTokenAddress = rewardAsset === "lrep" ? lrepAddress : getDefaultUsdcAddress(targetNetwork.id);
  const feedbackBonusUsdcAddress = getDefaultUsdcAddress(targetNetwork.id);
  const feedbackBonusEscrowAddress = getConfiguredFeedbackBonusEscrowAddress(targetNetwork.id);
  const estimatedFeedbackBonusRecipientAmount =
    feedbackBonusMode === "enabled" && selectedFeedbackBonusAmount
      ? applyEstimatedFrontendFee(selectedFeedbackBonusAmount, frontendFeeBps)
      : 0n;
  const feedbackBonusWindowLabel = estimatedBountyExpiresAtLabel;
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

  const handleTitleChange = (value: string) => {
    setTitle(value);
    patchActiveQuestionDraft({ title: value });
    setTitleError(getContentTitleValidationError(value));
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    patchActiveQuestionDraft({ description: value });
    setDescriptionError(getContentDescriptionValidationError(value));
  };

  const validateQuestionSection = (draft = getActiveQuestionDraft(), applyErrors = true): ValidatedQuestionDraft => {
    const trimmedTitle = draft.title.trim();
    const trimmedDescription = draft.description.trim();
    const trimmedContextUrl = draft.contextUrl.trim();
    const submittedContextUrl = normalizeSubmissionContextUrl(trimmedContextUrl) ?? "";
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
    const nextDescriptionError = trimmedDescription ? getContentDescriptionValidationError(trimmedDescription) : null;
    const blockedContentTags = findBlockedContentTags(draft.selectedSubcategories);
    const submittedTags = serializeTags(draft.selectedSubcategories);
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
      setDescriptionError(nextDescriptionError);
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
      Boolean(nextDescriptionError) ||
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
      trimmedDescription,
      trimmedTitle,
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
      Math.max(MIN_REWARD_POOL_REQUIRED_VOTERS, nextVoterCapMax),
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submissionStep === "question") {
      handleContinueToBounty();
      return;
    }

    if (submissionStep === "bounty") {
      handleGoToFeedbackBonusStep();
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

    if (isAwaitingSponsoredSubmitCalls) {
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
      if (!feedbackBonusUsdcAddress) {
        notification.error("World Chain USDC is not configured for Feedback Bonuses on this network.");
        return;
      }
      if (!selectedFeedbackBonusAmount) {
        setSubmissionStep("feedbackBonus");
        notification.warning("Enter a feedback bonus amount before submitting.");
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

    if (shouldFundFeedbackBonus && selectedFeedbackBonusAmount && feedbackBonusUsdcAddress) {
      try {
        const feedbackBonusBalance = (await readContract(wagmiConfig, {
          address: feedbackBonusUsdcAddress,
          abi: ERC20_APPROVAL_ABI,
          functionName: "balanceOf",
          args: [submitterAddress],
        })) as bigint;
        const requiredUsdcBalance =
          rewardAsset === "usdc" && verifiedRewardTokenAddress.toLowerCase() === feedbackBonusUsdcAddress.toLowerCase()
            ? selectedRewardAmount + selectedFeedbackBonusAmount
            : selectedFeedbackBonusAmount;

        if (feedbackBonusBalance < requiredUsdcBalance) {
          setSubmissionStep("feedbackBonus");
          notification.error(
            `You need ${formatUsdAmount(requiredUsdcBalance)} USDC to fund the selected bounty and Feedback Bonus.`,
          );
          return;
        }
      } catch {
        notification.error("Could not verify your USDC balance for the Feedback Bonus.");
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
      const rewardPoolExpiresAt = getBountyClosesAtFromWindowSeconds(
        effectiveBountyWindowSeconds,
        resolveBountyReferenceNowSeconds(latestBlockTimestamp),
      );
      if (rewardPoolExpiresAt <= 0n) {
        setSubmissionStep("bounty");
        notification.warning("Choose a bounty window before submitting.");
        return;
      }
      const feedbackClosesAt = rewardPoolExpiresAt;

      const bundleQuestions = validatedQuestions.map((question, index) => {
        if (!question.selectedCategory) {
          throw new Error(`Question ${index + 1} is missing a category.`);
        }

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
          description: question.trimmedDescription,
          imageUrls: question.submittedImageUrls,
          roundConfig: selectedRoundConfig,
          study: {
            bundleIndex: index,
          },
          tags: question.submittedTags.split(",").filter(Boolean),
          title: question.trimmedTitle,
          videoUrl: question.submittedVideoUrl,
        });

        return {
          contextUrl: question.submittedContextUrl,
          imageUrls: question.submittedImageUrls,
          videoUrl: question.submittedVideoUrl,
          title: question.trimmedTitle,
          description: question.trimmedDescription,
          tags: question.submittedTags,
          categoryId: question.selectedCategory.id,
          salt: createRandomHex32(),
          spec: {
            questionMetadataHash: spec.questionMetadataHash,
            resultSpecHash: spec.resultSpecHash,
          },
        };
      });
      const rewardTerms = {
        asset: selectedRewardAssetId,
        amount: selectedRewardAmount,
        requiredVoters: selectedRequiredVoters,
        requiredSettledRounds: selectedRequiredSettledRounds,
        bountyClosesAt: rewardPoolExpiresAt,
        feedbackClosesAt,
        bountyEligibility: selectedBountyEligibility.mode,
      } as const;
      const roundConfigAbi = questionRoundConfigToAbi(selectedRoundConfig);
      const isBundleSubmission = bundleQuestions.length > 1;
      const primaryQuestion = bundleQuestions[0];
      if (!primaryQuestion) {
        throw new Error("Question is missing.");
      }
      if (isBundleSubmission) {
        await assertQuestionBundleSubmissionSelector(publicClient, registryAddress);
      }
      const getQuestionSubmissionKey = async (question: (typeof bundleQuestions)[number]) => {
        if (!publicClient) {
          throw new Error("Could not connect to the current network.");
        }

        const [, submissionKey] = (await publicClient.readContract({
          address: registryAddress,
          abi: registryInfo.abi,
          functionName: "previewQuestionSubmissionKey",
          args: [
            question.contextUrl,
            question.imageUrls,
            question.videoUrl,
            question.title,
            question.description,
            question.tags,
            question.categoryId,
          ],
        } as any)) as readonly [bigint, `0x${string}`];

        return submissionKey;
      };
      const revealCommitment = isBundleSubmission
        ? buildQuestionBundleSubmissionRevealCommitment({
            questions: bundleQuestions,
            rewardAmount: selectedRewardAmount,
            rewardAsset: selectedRewardAssetId,
            requiredSettledRounds: selectedRequiredSettledRounds,
            requiredVoters: selectedRequiredVoters,
            rewardPoolExpiresAt,
            feedbackClosesAt,
            bountyEligibility: selectedBountyEligibility.mode,
            roundConfig: selectedRoundConfig,
            submitter: submitterAddress,
          })
        : buildQuestionSubmissionRevealCommitment({
            categoryId: primaryQuestion.categoryId,
            description: primaryQuestion.description,
            imageUrls: primaryQuestion.imageUrls,
            questionMetadataHash: primaryQuestion.spec.questionMetadataHash,
            rewardAmount: selectedRewardAmount,
            rewardAsset: selectedRewardAssetId,
            requiredSettledRounds: selectedRequiredSettledRounds,
            requiredVoters: selectedRequiredVoters,
            resultSpecHash: primaryQuestion.spec.resultSpecHash,
            rewardPoolExpiresAt,
            feedbackClosesAt,
            bountyEligibility: selectedBountyEligibility.mode,
            roundConfig: selectedRoundConfig,
            salt: primaryQuestion.salt,
            submissionKey: await getQuestionSubmissionKey(primaryQuestion),
            submitter: submitterAddress,
            tags: primaryQuestion.tags,
            title: primaryQuestion.title,
            videoUrl: primaryQuestion.videoUrl,
          });

      cancelReservedSubmission = async (revealCommitment: `0x${string}`) => {
        if (canUseSponsoredSubmitCalls) {
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
        if (canUseSponsoredSubmitCalls) {
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

      if (canUseSponsoredSubmitCalls) {
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
                    primaryQuestion.description,
                    primaryQuestion.tags,
                    primaryQuestion.categoryId,
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
            suppressStatusToast: true,
          },
        );

        submittedContentIds = extractSubmittedContentIds((callsResult.receipts ?? []).flatMap(receipt => receipt.logs));
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
                primaryQuestion.description,
                primaryQuestion.tags,
                primaryQuestion.categoryId,
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
        }
      }

      reservedRevealCommitment = null;
      let feedbackBonusFunded = false;
      let feedbackBonusFundingError: string | null = null;
      const primarySubmittedContentId = submittedContentIds[0] ?? null;

      if (
        shouldFundFeedbackBonus &&
        selectedFeedbackBonusAmount &&
        feedbackBonusEscrowAddress &&
        feedbackBonusUsdcAddress &&
        verifiedVotingEngineAddress &&
        primarySubmittedContentId !== null
      ) {
        try {
          const feedbackRoundId = (await readContract(wagmiConfig, {
            address: verifiedVotingEngineAddress,
            abi: RoundVotingEngineAbi,
            functionName: "currentRoundId",
            args: [primarySubmittedContentId],
          })) as bigint;

          if (feedbackRoundId <= 0n) {
            throw new Error("Could not find the open round for the submitted question.");
          }

          const feedbackApproveWrite = {
            address: feedbackBonusUsdcAddress,
            abi: ERC20_APPROVAL_ABI,
            functionName: "approve",
            args: [feedbackBonusEscrowAddress, selectedFeedbackBonusAmount],
          } as const;
          const feedbackApproveTxHash = localE2ETestWalletClient
            ? await localE2ETestWalletClient.writeContract(feedbackApproveWrite as any)
            : await writeContract(wagmiConfig, await prepareDirectWalletWrite(feedbackApproveWrite));

          if (feedbackApproveTxHash) {
            await waitForTransactionReceipt(wagmiConfig, { hash: feedbackApproveTxHash });
          }
          const feedbackApproveNonce = await getSubmittedTransactionNonce(feedbackApproveTxHash);

          const feedbackPoolWrite = {
            address: feedbackBonusEscrowAddress,
            abi: FEEDBACK_BONUS_ESCROW_ABI,
            functionName: "createFeedbackBonusPool",
            args: [
              primarySubmittedContentId,
              feedbackRoundId,
              selectedFeedbackBonusAmount,
              rewardPoolExpiresAt,
              submitterAddress,
            ],
          } as const;
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
        )} voter bounty${feedbackBonusFunded ? ` and a ${formatUsdAmount(selectedFeedbackBonusAmount)} Feedback Bonus` : ""}.`,
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
                  : primarySubmittedQuestion.trimmedDescription,
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
      setDescription("");
      setDescriptionError(null);
      setSelectedCategory(null);
      setSelectedSubcategories([]);
      setCustomSubcategory("");
      setRewardAmount("1");
      setRewardRequiredVoters("3");
      setRewardRequiredRounds("1");
      setBountyWindowPreset(DEFAULT_BOUNTY_WINDOW_PRESET);
      setCustomBountyWindowAmount(DEFAULT_CUSTOM_BOUNTY_WINDOW_AMOUNT);
      setCustomBountyWindowUnit(DEFAULT_CUSTOM_BOUNTY_WINDOW_UNIT);
      setBountyWindowOverridden(false);
      setFeedbackBonusMode("none");
      setFeedbackBonusAmount("2");
      setRoundBlindMinutes(String(Math.max(1, Math.round(roundConfigDefaults.epochDuration / SECONDS_PER_MINUTE))));
      setRoundMaxDurationMinutes(String(Math.max(1, Math.round(roundConfigDefaults.maxDuration / SECONDS_PER_MINUTE))));
      setRoundMinVoters(
        getSyncedSettlementVotersForPaidCompleters(
          "3",
          roundConfigBounds.minSettlementVoters,
          roundConfigBounds.maxSettlementVoters,
        ),
      );
      setRoundMaxVoters(String(roundConfigDefaults.maxVoters));
      setRoundConfigTouched(false);
      setRoundMaxDurationOverridden(false);
      setSettlementVotersOverridden(false);
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

  const questionPreviewCard =
    previewUrl || title || description ? (
      <div className="surface-card rounded-2xl p-4 space-y-3">
        <p className="text-base font-medium uppercase tracking-wider text-base-content/60">Preview</p>
        {title ? <h3 className="line-clamp-2 text-lg font-semibold text-base-content">{title}</h3> : null}
        {previewUrl ? (
          <ContentEmbed
            url={previewUrl}
            title={title}
            description={description}
            thumbnailUrl={contextPreviewThumbnailUrl}
            compact
          />
        ) : null}
        {description ? <p className="text-base text-base-content/70">{description}</p> : null}
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
      ? `Minimum eligible revealed voters required in a round before that round can receive the bounty payout. Counts do not roll over across rounds. Current min: ${MIN_REWARD_POOL_REQUIRED_VOTERS}.`
      : `Minimum eligible completers required in a round set before that set can receive the bounty payout. Each completer must answer every question in the bundle. Current min: ${MIN_REWARD_POOL_REQUIRED_VOTERS}.`;
  const requiredRoundsTooltipText =
    "Each settlement round set requires every bundled question to settle once. Eligible completers can claim a reward for each completed set they fully answered.";
  const roundSettingsTooltipText =
    "Governance sets the allowed range. Urgent bounties can use shorter rounds; broader questions can wait for more voters.";
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
  const bountyExpiryTooltipText = `Bounty and paid feedback match the blind response window by default. Override this if rewards should close at a different time. ${protocolDocFacts.usdcBountyPayoutTimingTooltip}`;
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
          onClick={() => setRewardAsset("usdc")}
          className={`btn btn-sm ${rewardAsset === "usdc" ? "btn-primary" : "btn-outline"}`}
        >
          USDC
        </button>
        <button
          type="button"
          aria-pressed={rewardAsset === "lrep"}
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
            onChange={e => setRewardAmount(e.target.value)}
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
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          {BOUNTY_ELIGIBILITY_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={bountyEligibility === option.id}
              onClick={() => setBountyEligibility(option.id)}
              className={`btn btn-sm ${bountyEligibility === option.id ? "btn-primary" : "btn-outline"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="form-control">
            <span className="label-text flex items-center gap-1.5">
              Min voters per round
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
                  Math.max(MIN_REWARD_POOL_REQUIRED_VOTERS, Number(clampedMaxVoters)),
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
                Advanced round settings
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
                  Bounty window
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
                      setSettlementVotersOverridden(true);
                      setRoundMinVoters(normalizedValue);
                    }
                  }}
                  onBlur={() => {
                    setRoundConfigTouched(true);
                    setSettlementVotersOverridden(true);
                    setRoundMinVoters(current =>
                      clampWholeNumberInput(
                        current,
                        roundConfigBounds.minSettlementVoters,
                        roundConfigBounds.maxSettlementVoters,
                      ),
                    );
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
              Bounty expires
              <InfoTooltip text="Estimated from the selected bounty window and current time. The final timestamp is set when you submit." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">{estimatedBountyExpiresAtLabel}</p>
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
      <button
        type="button"
        onClick={handleGoToFeedbackBonusStep}
        className="btn btn-submit w-full sm:flex-1"
        disabled={isSubmitting}
      >
        Continue
      </button>
    </div>
  );

  const feedbackBonusDetailsCard = (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
          Feedback Bonus <span className="text-base-content/55">(optional)</span>
          <InfoTooltip text="Optional USDC pool for useful hidden feedback from revealed raters. The awarder pays selected feedback after settlement, with the default frontend fee reserved when eligible." />
        </p>
        <p className="text-sm leading-relaxed text-base-content/65">
          Keep this off when you only need a score. Turn it on when written notes, objections, or bug reports should be
          worth extra USDC.
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
          <div className="flex items-center gap-2">
            <label
              className={`input input-bordered flex min-w-0 flex-1 items-center gap-2 bg-base-100 ${
                feedbackBonusAmountError ? "input-error" : ""
              }`}
            >
              <span className="shrink-0 text-base-content/50">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={feedbackBonusAmount}
                onChange={e => setFeedbackBonusAmount(e.target.value)}
                className="grow bg-transparent"
                aria-label="Feedback Bonus amount"
              />
              <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-base-content/50">USDC</span>
            </label>
            <InfoTooltip text="Feedback Bonuses use World Chain USDC. The selected awarder later chooses which eligible feedback to pay." />
          </div>
          {feedbackBonusAmountError ? <p className="text-base text-error">{feedbackBonusAmountError}</p> : null}

          <div className="surface-card-nested rounded-lg p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-base text-base-content/70">
                  Feedback window
                  <InfoTooltip text="For now, the feedback bonus closes with the bounty window selected in the previous step." />
                </p>
                <p className="mt-1 text-base font-medium text-base-content">{feedbackBonusWindowLabel}</p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-base text-base-content/70">
                  Awarder
                  <InfoTooltip text="The connected wallet funds the bonus and is allowed to award it after settlement." />
                </p>
                <p className="mt-1 break-all text-base font-medium text-base-content">
                  {connectedAddress
                    ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
                    : "Connect wallet"}
                </p>
              </div>
            </div>
          </div>

          {!feedbackBonusEscrowAddress ? (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Feedback Bonus funding is not available on this network yet.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="surface-card-nested rounded-lg p-4">
          <p className="text-base text-base-content/70">
            The question will still accept optional rater feedback after votes. There just will not be a separate USDC
            pool for awarding notes.
          </p>
        </div>
      )}
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
                ? `${formatUsdAmount(selectedFeedbackBonusAmount)} USDC`
                : "$0 USDC"}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              After frontend fee
              <InfoTooltip text="Estimated recipient amount if the whole bonus is paid in one award and the default frontend fee applies." />
            </p>
            <p className="mt-1 text-base font-medium text-base-content">
              {feedbackBonusMode === "enabled"
                ? `${formatUsdAmount(estimatedFeedbackBonusRecipientAmount)} USDC`
                : "$0 USDC"}
            </p>
          </div>

          <div>
            <p className="flex items-center gap-1.5 text-base text-base-content/70">
              Feedback closes
              <InfoTooltip text="Matches the bounty expiration for this first version of the creation flow." />
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
      <button
        type="submit"
        className="btn btn-submit w-full sm:flex-1"
        disabled={isSubmitting || isAwaitingSponsoredSubmitCalls || isMissingGasBalance}
      >
        {isSubmitting ? (
          <span className="flex items-center gap-2 text-base-content">
            <span className="loading loading-spinner loading-sm"></span>
            Submitting...
          </span>
        ) : (
          "Submit"
        )}
      </button>
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
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
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
                    placeholder="Add context voters should consider"
                    className={`textarea textarea-bordered h-24 w-full bg-base-100 ${
                      descriptionError ? "textarea-error" : ""
                    }`}
                    value={description}
                    onChange={e => handleDescriptionChange(e.target.value)}
                    maxLength={MAX_CONTENT_DESCRIPTION_LENGTH}
                  />
                  {descriptionError ? <p className="mt-1 text-base text-error">{descriptionError}</p> : null}
                  <div className="mt-1 text-right">
                    <span className="text-base text-base-content/60">
                      {description.length}/{MAX_CONTENT_DESCRIPTION_LENGTH}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    className={`mb-2 flex items-center gap-1.5 text-base font-medium ${
                      contextOrMediaMissing || contextUrlError ? "text-error" : ""
                    }`}
                  >
                    Context Link <span className="font-normal text-base-content/60">(optional with media)</span>
                    <InfoTooltip text="Use the canonical source, product page, article, proposal, or other HTTPS link that voters should judge. If there is no link, add uploaded images or a YouTube link below." />
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
                      Add a context link, image, or YouTube video before submitting.
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
              </div>

              <div className="space-y-4 xl:sticky xl:top-24">
                {questionPreviewCard}
                {prohibitedContentNotice}
                {isMissingGasBalance ? <GasBalanceWarning nativeTokenSymbol={nativeTokenSymbol} /> : null}
                {activeQuestionIndex > 0 ? (
                  <button type="button" onClick={handleGoToPreviousQuestion} className="btn btn-ghost w-full">
                    Back to Q{activeQuestionIndex}
                  </button>
                ) : null}
                <button type="button" onClick={handleContinueToBounty} className="btn btn-primary w-full">
                  {activeQuestionIndex < questionCount - 1
                    ? `Next Question (${activeQuestionIndex + 2}/${questionCount})`
                    : "Continue to Bounty"}
                </button>
              </div>
            </div>
          ) : submissionStep === "bounty" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)] xl:items-start">
              <div className="space-y-4">{bountyDetailsCard}</div>
              <div className="space-y-4 xl:sticky xl:top-24">
                {bountyInsightsCard}
                {isMissingGasBalance ? <GasBalanceWarning nativeTokenSymbol={nativeTokenSymbol} /> : null}
                {bountyActions}
              </div>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)] xl:items-start">
              <div className="space-y-4">{feedbackBonusDetailsCard}</div>
              <div className="space-y-4 xl:sticky xl:top-24">
                {feedbackBonusInsightsCard}
                {isMissingGasBalance ? <GasBalanceWarning nativeTokenSymbol={nativeTokenSymbol} /> : null}
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
