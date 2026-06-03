"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type Address, type Hex, isAddress } from "viem";
import { useAccount, useConfig, useSignMessage } from "wagmi";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  ShieldCheckIcon,
  TagIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { useRateLoopSwitchNetwork } from "~~/hooks/useRateLoopSwitchNetwork";
import { formatSubmissionRewardAmount, parseSubmissionRewardAmount } from "~~/lib/questionRewardPools";
import {
  DEFAULT_QUESTION_ROUND_CONFIG,
  DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS,
  formatDurationLabel,
  isQuestionRoundMaxDurationValidForEpoch,
} from "~~/lib/questionRoundConfig";
import { notification } from "~~/utils/scaffold-eth";

const ShareModal = dynamic(() => import("~~/components/submit/ShareModal").then(module => module.ShareModal), {
  ssr: false,
});

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
    id?: string;
    phase?: string;
    to?: string;
    value?: string;
    waitAfterMs?: number;
  }>;
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
  paymentMode: "wallet_calls";
  preparedDraftRevision?: number | null;
  publicUrl?: string | null;
  requestBody?: JsonRecord;
  status: string;
  transactionHashes?: string[];
  transactionPlan?: HandoffTransactionPlan | null;
  updatedAt?: string;
  walletAddress: string | null;
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

type ExecutionStep = {
  hash?: string;
  status: "pending" | "sent" | "confirmed";
};

type ImageSignatureStep = {
  assetId: string;
  filename: string;
  status: "pending" | "signed";
};

type QuestionSummary = {
  categoryId: string;
  contextUrl: string;
  description: string;
  tags: string[];
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

type DraftQuestionForm = {
  categoryId: string;
  contextUrl: string;
  description: string;
  tags: string;
  templateId: string;
  title: string;
  videoUrl: string;
};

type DraftForm = {
  bountyAmount: string;
  questions: DraftQuestionForm[];
  roundBlindMinutes: string;
  roundMaxDurationMinutes: string;
  roundMaxVoters: string;
  roundMinVoters: string;
};

type SubmittedContentModalState = {
  description: string;
  id: bigint;
  lastActivityAt: string | null;
  title: string;
};

function sameAddress(left: string | undefined | null, right: string | undefined | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function shortAddress(value: string | null | undefined) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not set";
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readToken(searchParams: URLSearchParams) {
  if (typeof window !== "undefined") {
    const hash = window.location.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const fromHash = hashParams.get("token");
      if (fromHash) return fromHash;
    }
  }
  return searchParams.get("token") ?? "";
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

function readQuestionSummaries(handoff: Handoff | null): QuestionSummary[] {
  return readQuestionRecords(handoff).map((question, index) => ({
    categoryId: readDisplayValue(question.categoryId),
    contextUrl: readString(question.contextUrl),
    description: readString(question.description),
    tags: readQuestionTags(question.tags),
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

function formatUsdcInput(value: bigint | null) {
  if (value === null) return "";
  return formatSubmissionRewardAmount(value, "usdc").replace(/ USDC$/, "");
}

function readRoundSettings(handoff: Handoff | null): RoundSettings {
  const requestBody = handoff?.requestBody ?? null;
  const firstQuestion = readQuestionRecords(handoff)[0];
  const source = isJsonRecord(requestBody?.roundConfig)
    ? requestBody.roundConfig
    : isJsonRecord(firstQuestion?.roundConfig)
      ? firstQuestion.roundConfig
      : null;

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
    maxVoters: readFirstPositiveBigInt(source, ["maxVoters"], DEFAULT_QUESTION_ROUND_CONFIG.maxVoters),
    minVoters: readFirstPositiveBigInt(source, ["minVoters"], DEFAULT_QUESTION_ROUND_CONFIG.minVoters),
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
  return {
    bountyAmount: formatUsdcInput(readBountyAmountAtomic(handoff)),
    questions: questions.length
      ? questions.map(question => ({
          categoryId: question.categoryId,
          contextUrl: question.contextUrl,
          description: question.description,
          tags: question.tags.join(", "),
          templateId: question.templateId,
          title: question.title,
          videoUrl: question.videoUrl,
        }))
      : [
          {
            categoryId: "",
            contextUrl: "",
            description: "",
            tags: "",
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

function parseRoundSecondsFromMinutes(value: string, fieldName: string) {
  return BigInt(parsePositiveInteger(value, fieldName)) * 60n;
}

function parseTagsInput(value: string) {
  return value
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}

function applyDraftQuestion(baseQuestion: JsonRecord, draft: DraftQuestionForm, index: number): JsonRecord {
  const title = draft.title.trim();
  const categoryId = draft.categoryId.trim();
  const tags = parseTagsInput(draft.tags);
  if (!title) throw new Error(`Question ${index + 1} needs a title.`);
  if (!categoryId) throw new Error(`Question ${index + 1} needs a category.`);
  if (tags.length === 0 || tags.length > 3) {
    throw new Error(`Question ${index + 1} needs one to three tags.`);
  }

  const nextQuestion: JsonRecord = {
    ...baseQuestion,
    categoryId,
    description: draft.description.trim(),
    tags,
    title,
  };
  const contextUrl = draft.contextUrl.trim();
  const videoUrl = draft.videoUrl.trim();
  const templateId = draft.templateId.trim();
  if (contextUrl) {
    nextQuestion.contextUrl = contextUrl;
  } else {
    delete nextQuestion.contextUrl;
  }
  if (videoUrl) {
    nextQuestion.videoUrl = videoUrl;
  } else {
    delete nextQuestion.videoUrl;
  }
  if (templateId) {
    nextQuestion.templateId = templateId;
  } else {
    delete nextQuestion.templateId;
  }
  return nextQuestion;
}

function buildDraftRequestBody(handoff: Handoff, form: DraftForm): JsonRecord {
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
    Number(blindSeconds) < DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minEpochDuration ||
    Number(blindSeconds) > DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxEpochDuration
  ) {
    throw new Error(
      `Blind phase must be ${formatDurationLabel(DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minEpochDuration)}-${formatDurationLabel(
        DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxEpochDuration,
      )}.`,
    );
  }
  if (
    Number(maxDurationSeconds) < DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minRoundDuration ||
    Number(maxDurationSeconds) > DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxRoundDuration
  ) {
    throw new Error(
      `Max duration must be ${formatDurationLabel(
        DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minRoundDuration,
      )}-${formatDurationLabel(DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxRoundDuration)}.`,
    );
  }
  if (!isQuestionRoundMaxDurationValidForEpoch(Number(blindSeconds), Number(maxDurationSeconds))) {
    throw new Error("Max duration spans too many blind phases.");
  }
  if (
    minVoters < DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minSettlementVoters ||
    minVoters > DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxSettlementVoters
  ) {
    throw new Error(
      `Min voters must be ${DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minSettlementVoters}-${DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxSettlementVoters}.`,
    );
  }
  if (
    maxVoters < DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minVoterCap ||
    maxVoters > DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxVoterCap
  ) {
    throw new Error(
      `Max voters must be ${DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.minVoterCap}-${DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxVoterCap}.`,
    );
  }

  requestBody.bounty = {
    ...(isJsonRecord(requestBody.bounty) ? requestBody.bounty : {}),
    amount: bountyAmount.toString(),
    asset: "USDC",
  };
  requestBody.roundConfig = {
    epochDuration: blindSeconds.toString(),
    maxDuration: maxDurationSeconds.toString(),
    maxVoters: maxVoters.toString(),
    minVoters: minVoters.toString(),
  };

  if (Array.isArray(requestBody.questions)) {
    requestBody.questions = requestBody.questions.map((question, index) =>
      applyDraftQuestion(isJsonRecord(question) ? question : {}, form.questions[index] ?? form.questions[0], index),
    );
    return requestBody;
  }

  if (isJsonRecord(requestBody.question)) {
    requestBody.question = applyDraftQuestion(requestBody.question, form.questions[0], 0);
    return requestBody;
  }

  return {
    ...requestBody,
    ...applyDraftQuestion(requestBody, form.questions[0], 0),
  };
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
        : (primaryQuestion?.description ?? ""),
    id: contentId,
    lastActivityAt: new Date().toISOString(),
    title: primaryQuestion?.title || readQuestionTitle(handoff),
  };
}

function readBounty(handoff: Handoff | null) {
  const amount = readBountyAmountAtomic(handoff);
  return amount === null ? "Unknown bounty" : formatSubmissionRewardAmount(amount, "usdc");
}

function readDraftBountyLabel(form: DraftForm | null, handoff: Handoff | null) {
  const draftAmount = form?.bountyAmount.trim();
  return draftAmount ? `${draftAmount} USDC` : readBounty(handoff);
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

function assertZeroValue(value: unknown, field: string) {
  if (value === undefined || value === null || value === "" || value === "0" || value === 0 || value === 0n) return 0n;
  if (typeof value === "string" && /^0x0+$/i.test(value)) return 0n;
  throw new Error(`${field} must be zero.`);
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
  const searchParams = useSearchParams();
  const wagmiConfig = useConfig();
  const { address, chain, chainId } = useAccount();
  const { signMessageAsync, isPending: isSigningMessage } = useSignMessage();
  const { switchToChain, switchingChainId } = useRateLoopSwitchNetwork();
  const [token] = useState(() => readToken(searchParams));
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
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [imageSignatureSteps, setImageSignatureSteps] = useState<ImageSignatureStep[]>([]);
  const [submittedContent, setSubmittedContent] = useState<SubmittedContentModalState | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasTokenInQuery = window.location.search.includes("token=");
    const hasTokenInHash = window.location.hash.includes("token=");
    if (!hasTokenInQuery && !hasTokenInHash) return;
    window.history.replaceState(null, "", window.location.pathname);
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

  const isTerminalStatus = handoff?.status === "expired" || handoff?.status === "submitted";
  const isFeedbackBonusStep = handoff?.status === "feedback_bonus_prepared";
  const connectedMismatch = Boolean(handoff?.walletAddress && address && !sameAddress(handoff.walletAddress, address));
  const hasTransactionPlan = Boolean(handoff?.transactionPlan?.calls?.length);
  const connectedChainId = chain?.id ?? chainId ?? null;
  const needsChainSwitch = Boolean(
    hasTransactionPlan && handoff?.chainId && connectedChainId && connectedChainId !== handoff.chainId,
  );
  const isBusy = isPreparing || isExecuting || isSigningMessage || isSavingDraft || switchingChainId !== null;
  const isDraftEditable = Boolean(handoff && (handoff.status === "pending" || handoff.status === "failed"));
  const canEditDraft = Boolean(isDraftEditable && !isBusy);
  const canSaveDraft = Boolean(handoff && draftForm && isDraftEditable && isDraftDirty && !isBusy);
  const canSubmit = Boolean(
    token &&
      address &&
      handoff &&
      !connectedMismatch &&
      !isTerminalStatus &&
      !isBusy &&
      !isDraftDirty &&
      (hasTransactionPlan || (connectedChainId && canPrepareHandoffStatus(handoff.status))),
  );

  const postPrepare = useCallback(
    async (imageSignatures?: Array<{ assetId: string; challengeId: string; signature: Hex }>) => {
      if (!address) throw new Error("Connect a wallet before preparing this ask.");
      if (!connectedChainId) throw new Error("Connect a supported network before preparing this ask.");
      const response = await fetch(`/api/agent/handoffs/${handoffId}/prepare`, {
        body: JSON.stringify({
          chainId: connectedChainId,
          imageSignatures,
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
    [address, connectedChainId, handoffId, token],
  );

  const updateDraftField = useCallback((field: keyof Omit<DraftForm, "questions">, value: string) => {
    setDraftForm(current => (current ? { ...current, [field]: value } : current));
    setDraftError(null);
  }, []);

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

  const handleSaveDraft = useCallback(async () => {
    if (!handoff || !draftForm) return;
    setDraftError(null);
    let requestBody: JsonRecord;
    try {
      requestBody = buildDraftRequestBody(handoff, draftForm);
    } catch (saveError) {
      setDraftError(saveError instanceof Error ? saveError.message : "Draft is invalid.");
      return;
    }

    setIsSavingDraft(true);
    try {
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
      setHandoff(body as Handoff);
      notification.success("Draft saved.");
    } catch (saveError) {
      setDraftError(saveError instanceof Error ? saveError.message : "Failed to save draft.");
    } finally {
      setIsSavingDraft(false);
    }
  }, [draftForm, handoff, handoffId, token]);

  const prepareHandoff = useCallback(async () => {
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
    if (isDraftDirty) {
      notification.error("Save the draft before submitting.");
      return null;
    }

    setIsPreparing(true);
    setSteps([]);
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
        prepared = await postPrepare(imageSignatures);
      }

      setHandoff(prepared);
      setImageSignatureSteps([]);
      return prepared;
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "Failed to prepare handoff.");
      return null;
    } finally {
      setIsPreparing(false);
    }
  }, [address, connectedChainId, connectedMismatch, isDraftDirty, postPrepare, signMessageAsync]);

  const executeHandoff = useCallback(
    async (targetHandoff: Handoff) => {
      const calls = targetHandoff.transactionPlan?.calls ?? [];
      const isExecutingFeedbackBonus = targetHandoff.status === "feedback_bonus_prepared";
      if (!calls.length) {
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
      const hashes: Hex[] = [];
      const nextSteps: ExecutionStep[] = calls.map(() => ({ status: "pending" }));
      setSteps(nextSteps);

      try {
        if (targetHandoff.chainId && connectedChainId !== targetHandoff.chainId) {
          await switchToChain(targetHandoff.chainId);
        }

        const handoffChainId = targetHandoff.chainId ?? undefined;
        for (const [index, call] of calls.entries()) {
          const to = normalizeAddress(call.to, `transactionPlan.calls[${index}].to`);
          const data = normalizeHex(call.data ?? "0x", `transactionPlan.calls[${index}].data`);
          const value = assertZeroValue(call.value, `transactionPlan.calls[${index}].value`);
          const hash = await sendTransaction(wagmiConfig, { chainId: handoffChainId, data, to, value });
          hashes.push(hash);
          setSteps(current =>
            current.map((step, stepIndex) => (stepIndex === index ? { ...step, hash, status: "sent" } : step)),
          );
          await waitForTransactionReceipt(wagmiConfig, { chainId: handoffChainId, hash });
          setSteps(current =>
            current.map((step, stepIndex) => (stepIndex === index ? { ...step, hash, status: "confirmed" } : step)),
          );
          if (call.waitAfterMs && call.waitAfterMs > 0) {
            await delay(call.waitAfterMs);
          }
        }

        const response = await fetch(`/api/agent/handoffs/${handoffId}/complete`, {
          body: JSON.stringify({ token, transactionHashes: hashes }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = (await response.json()) as CompleteResponse | { error?: string; message?: string };
        if (!response.ok) throw new Error(readResponseError(body, "Failed to confirm RateLoop ask."));
        const nextHandoff = body as CompleteResponse;
        setHandoff(current => ({
          ...nextHandoff,
          publicUrl: nextHandoff.publicUrl ?? current?.publicUrl ?? null,
        }));
        setSteps([]);
        if (
          !isExecutingFeedbackBonus &&
          (nextHandoff.status === "submitted" || nextHandoff.status === "feedback_bonus_prepared")
        ) {
          const nextSubmittedContent = readSubmittedContentForShare(targetHandoff, nextHandoff.ask);
          if (nextSubmittedContent) {
            setSubmittedContent(nextSubmittedContent);
          }
        }
        if (nextHandoff.status === "feedback_bonus_prepared") {
          notification.success("Ask submitted. Feedback Bonus funding is ready.");
        } else if (isExecutingFeedbackBonus) {
          notification.success("Feedback Bonus funded.");
        } else {
          notification.success("Ask submitted to RateLoop.");
        }
      } catch (executeError) {
        setError(executeError instanceof Error ? executeError.message : "Failed to execute wallet calls.");
      } finally {
        setIsExecuting(false);
      }
    },
    [address, connectedChainId, connectedMismatch, handoffId, switchToChain, token, wagmiConfig],
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
    if (isDraftDirty) {
      notification.error("Save the draft before submitting.");
      return;
    }

    let executableHandoff = handoff;
    if (!executableHandoff.transactionPlan?.calls?.length) {
      if (isFeedbackBonusStep) {
        notification.error("Feedback Bonus funding is waiting for a transaction plan.");
        return;
      }
      const prepared = await prepareHandoff();
      if (!prepared) return;
      executableHandoff = prepared;
    }

    await executeHandoff(executableHandoff);
  }, [address, connectedMismatch, executeHandoff, handoff, isDraftDirty, isFeedbackBonusStep, prepareHandoff]);

  const handleCloseShareModal = useCallback(() => {
    setSubmittedContent(null);
  }, []);

  const submitLabel = (() => {
    if (isSavingDraft) return "Saving...";
    if (switchingChainId !== null) return "Switching...";
    if (isPreparing || isSigningMessage) return "Preparing...";
    if (isFeedbackBonusStep) return isExecuting ? "Funding..." : "Fund Bonus";
    return isExecuting ? "Submitting..." : "Submit";
  })();
  const confirmedStepCount = steps.filter(step => step.status === "confirmed").length;
  const progressLabel =
    steps.length > 0
      ? confirmedStepCount === steps.length
        ? "Wallet calls confirmed."
        : `Confirming wallet call ${Math.min(confirmedStepCount + 1, steps.length)} of ${steps.length}.`
      : isPreparing || isSigningMessage
        ? "Preparing the ask in your wallet."
        : isDraftDirty
          ? "Save the draft before submitting."
          : null;

  const questionSummaries = readQuestionSummaries(handoff);
  const hasQuestionBundle = (draftForm?.questions.length ?? questionSummaries.length) > 1;

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
          <section className="surface-card rounded-lg p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <WalletIcon className="h-4 w-4" />
                  <span>Funding wallet</span>
                </div>
                <p className="mt-2 font-mono text-sm">{shortAddress(handoff.walletAddress ?? address)}</p>
              </div>
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <ShieldCheckIcon className="h-4 w-4" />
                  <span>Bounty</span>
                </div>
                <p className="mt-2 text-lg font-semibold">{readDraftBountyLabel(draftForm, handoff)}</p>
              </div>
              <div className="surface-card-nested rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-base-content/60">
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>Status</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{handoff.status}</p>
              </div>
            </div>

            {connectedMismatch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This handoff expects {handoff.walletAddress}. You are connected as {address}.
              </p>
            ) : null}
            {needsChainSwitch ? (
              <p className="surface-card-nested mt-4 rounded-lg p-3 text-sm text-warning">
                This prepared ask is on chain {handoff.chainId}. Your wallet is on chain {connectedChainId}.
              </p>
            ) : null}
          </section>

          <section className="surface-card rounded-lg p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <DocumentTextIcon className="h-5 w-5 text-base-content/60" />
                <h2 className="text-lg font-semibold">Ask details</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">
                  Revision {handoff.draftRevision ?? 0}
                </span>
                {handoff.editedByUser ? (
                  <span className="reward-chip reward-chip-muted px-2 py-0.5 text-xs">Edited</span>
                ) : null}
                {isDraftDirty ? <span className="reward-chip px-2 py-0.5 text-xs text-warning">Unsaved</span> : null}
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

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
              <div className="space-y-3">
                {draftForm?.questions.length ? (
                  draftForm.questions.map((question, index) => (
                    <div key={`${index}-${question.title}`} className="surface-card-nested rounded-lg p-4">
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

                      <label className="form-control mt-3">
                        <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                          Description
                        </span>
                        <textarea
                          className="textarea textarea-bordered mt-1 min-h-28 w-full leading-relaxed"
                          disabled={!canEditDraft}
                          value={question.description}
                          onChange={event => updateDraftQuestion(index, { description: event.target.value })}
                        />
                      </label>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="form-control">
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
                        <label className="form-control">
                          <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            Template
                          </span>
                          <input
                            className="input input-bordered mt-1 w-full"
                            disabled={!canEditDraft}
                            value={question.templateId}
                            onChange={event => updateDraftQuestion(index, { templateId: event.target.value })}
                          />
                        </label>
                      </div>

                      <label className="form-control mt-4">
                        <span className="label-text flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/45">
                          <TagIcon className="h-3.5 w-3.5" />
                          <span>Tags</span>
                        </span>
                        <input
                          className="input input-bordered mt-1 w-full"
                          disabled={!canEditDraft}
                          value={question.tags}
                          onChange={event => updateDraftQuestion(index, { tags: event.target.value })}
                        />
                      </label>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="form-control">
                          <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            Context URL
                          </span>
                          <input
                            className="input input-bordered mt-1 w-full"
                            disabled={!canEditDraft}
                            value={question.contextUrl}
                            onChange={event => updateDraftQuestion(index, { contextUrl: event.target.value })}
                          />
                        </label>
                        <label className="form-control">
                          <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                            Video URL
                          </span>
                          <input
                            className="input input-bordered mt-1 w-full"
                            disabled={!canEditDraft}
                            value={question.videoUrl}
                            onChange={event => updateDraftQuestion(index, { videoUrl: event.target.value })}
                          />
                        </label>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="surface-card-nested rounded-lg p-4 text-sm text-base-content/55">
                    Question details are unavailable for this handoff.
                  </div>
                )}
              </div>

              <div className="surface-card-nested rounded-lg p-4">
                <label className="form-control">
                  <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                    Bounty
                  </span>
                  <input
                    className="input input-bordered mt-1 w-full"
                    disabled={!canEditDraft}
                    inputMode="decimal"
                    value={draftForm?.bountyAmount ?? ""}
                    onChange={event => updateDraftField("bountyAmount", event.target.value)}
                  />
                </label>

                <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-base-content/75">
                  <ClockIcon className="h-4 w-4" />
                  <span>Round settings</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                      Blind minutes
                    </span>
                    <input
                      className="input input-bordered mt-1 w-full"
                      disabled={!canEditDraft}
                      inputMode="numeric"
                      min={1}
                      value={draftForm?.roundBlindMinutes ?? ""}
                      onChange={event => updateDraftField("roundBlindMinutes", event.target.value)}
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                      Max minutes
                    </span>
                    <input
                      className="input input-bordered mt-1 w-full"
                      disabled={!canEditDraft}
                      inputMode="numeric"
                      min={1}
                      value={draftForm?.roundMaxDurationMinutes ?? ""}
                      onChange={event => updateDraftField("roundMaxDurationMinutes", event.target.value)}
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                      Min voters
                    </span>
                    <input
                      className="input input-bordered mt-1 w-full"
                      disabled={!canEditDraft}
                      inputMode="numeric"
                      min={1}
                      value={draftForm?.roundMinVoters ?? ""}
                      onChange={event => updateDraftField("roundMinVoters", event.target.value)}
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text text-xs font-semibold uppercase tracking-wide text-base-content/45">
                      Max voters
                    </span>
                    <input
                      className="input input-bordered mt-1 w-full"
                      disabled={!canEditDraft}
                      inputMode="numeric"
                      min={1}
                      value={draftForm?.roundMaxVoters ?? ""}
                      onChange={event => updateDraftField("roundMaxVoters", event.target.value)}
                    />
                  </label>
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
                <p className="mt-1 text-sm text-base-content/60">
                  {isFeedbackBonusStep
                    ? "The question is submitted. Fund the optional Feedback Bonus with the connected wallet."
                    : "The connected wallet signs image uploads first, then funds and submits the ask."}
                </p>
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

            {progressLabel ? <p className="mt-4 text-sm text-base-content/60">{progressLabel}</p> : null}

            {handoff.publicUrl ? (
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
