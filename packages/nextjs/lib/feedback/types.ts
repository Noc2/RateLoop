export const CONTENT_FEEDBACK_TYPES = [
  "evidence",
  "clarification",
  "concern",
  "counterpoint",
  "source_quality",
  "ai_note",
  "vote_rationale",
  "bug_report",
  "repro_steps",
  "environment_note",
  "usability_blocker",
  "other",
] as const;

export type ContentFeedbackType = (typeof CONTENT_FEEDBACK_TYPES)[number];

export const CONTENT_FEEDBACK_PICKER_TYPES = [
  "vote_rationale",
  "evidence",
  "clarification",
  "concern",
  "bug_report",
  "other",
] as const satisfies readonly ContentFeedbackType[];

export const CONTENT_FEEDBACK_TYPE_LABELS: Record<ContentFeedbackType, string> = {
  evidence: "Evidence",
  clarification: "Clarification",
  concern: "Concern",
  counterpoint: "Counterpoint",
  source_quality: "Source quality",
  ai_note: "AI note",
  vote_rationale: "Opinion",
  bug_report: "Bug report",
  repro_steps: "Repro steps",
  environment_note: "Environment note",
  usability_blocker: "Usability blocker",
  other: "Other",
};

export const CONTENT_FEEDBACK_BODY_MAX_LENGTH = 1500;
export const CONTENT_FEEDBACK_SOURCE_URL_MAX_LENGTH = 2048;

export interface ContentFeedbackItem {
  id: number | string;
  contentId: string;
  roundId: string | null;
  chainId: number | null;
  authorAddress: `0x${string}`;
  feedbackType: ContentFeedbackType | string;
  feedbackTypeLabel: string;
  body: string;
  sourceUrl: string | null;
  feedbackHash: string | null;
  clientNonce: string | null;
  moderationStatus: string;
  publicationTxHash: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
  isPublic: boolean;
  feedbackBonusAwards?: ContentFeedbackBonusAward[];
}

export interface ContentFeedbackListResult {
  items: ContentFeedbackItem[];
  count: number;
  publicCount: number;
  settlementComplete: boolean;
  openRoundId: string | null;
  awardableFeedbackBonusPools?: ContentFeedbackBonusPool[];
}

export interface ContentFeedbackBonusPool {
  id: string;
  contentId: string;
  roundId: string;
  awarder: `0x${string}`;
  asset: number;
  currency: "LREP" | "USDC";
  displayCurrency: "LREP" | "USD";
  fundedAmount: string;
  remainingAmount: string;
  awardedAmount: string;
  feedbackClosesAt: string;
  awardDeadline: string;
  frontendFeeBps: number;
}

export interface ContentFeedbackBonusAward {
  id: string;
  poolId: string;
  contentId: string;
  roundId: string;
  recipient: `0x${string}`;
  feedbackHash: `0x${string}`;
  asset: number;
  currency: "LREP" | "USDC";
  displayCurrency: "LREP" | "USD";
  grossAmount: string;
  recipientAmount: string;
  frontendFee: string;
  awardedAt: string;
}
