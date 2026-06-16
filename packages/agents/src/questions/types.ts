export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = Record<string, unknown>;

export type AgentQuestionConfidentialityExample = {
  visibility?: "public" | "gated";
  disclosurePolicy?:
    | "after_settlement"
    | "private_until_settlement"
    | "private_forever";
  bond?: {
    amount?: string | number | bigint;
    asset?: "LREP" | "lrep" | "USDC" | "usdc" | string;
  } | null;
};

export type AgentQuestionExample = {
  title: string;
  description?: string;
  confidentiality?: AgentQuestionConfidentialityExample;
  contextUrl?: string;
  categoryId: string | number | bigint;
  detailsHash?: string;
  detailsUrl?: string;
  tags: string[] | string;
  imageUrls?: string[];
  videoUrl?: string;
  templateId?: string;
  templateInputs?: JsonValue;
  targetAudience?: JsonValue;
};

export type AgentAskExample = {
  bounty: {
    amount: string | number | bigint;
    asset?: "USDC" | "usdc" | string;
    bountyEligibility?: 0 | 8 | string | number;
    bountyStartBy?: string | number | bigint;
    bountyWindowSeconds?: string | number | bigint;
    feedbackWindowSeconds?: string | number | bigint;
    requiredSettledRounds?: string | number | bigint;
    requiredVoters?: string | number | bigint;
  };
  chainId?: number;
  clientRequestId: string;
  maxPaymentAmount?: string | number | bigint;
  question?: AgentQuestionExample;
  questions?: AgentQuestionExample[];
  roundConfig?: Record<string, string | number | bigint>;
  templateId?: string;
  templateInputs?: JsonValue;
  templateVersion?: number;
  confidentiality?: AgentQuestionConfidentialityExample;
};

export type QuestionLintFinding = {
  level: "error" | "warning";
  message: string;
  path: string;
};
