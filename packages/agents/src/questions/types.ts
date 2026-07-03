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
  roundConfig?: AgentRoundConfigExample;
  roundPreset?: "pure_agent_fast" | "default" | string;
  videoUrl?: string;
  templateId?: string;
  templateInputs?: JsonValue;
  targetAudience?: JsonValue;
};

export type AgentRoundConfigExample = {
  questionDurationSeconds?: string | number | bigint;
  minVoters?: string | number | bigint;
  maxVoters?: string | number | bigint;
};

export type AgentAskExample = {
  bounty: {
    amount: string | number | bigint;
    asset?: "USDC" | "usdc" | string;
    bountyEligibility?: 0 | 8 | string | number;
    requiredVoters?: string | number | bigint;
  };
  chainId?: number;
  clientRequestId: string;
  feedbackBonus?: {
    amount: string | number | bigint;
    asset?: "USDC" | "usdc" | string;
    awarder?: string;
    executeBy?: string | number | bigint;
  };
  maxPaymentAmount?: string | number | bigint;
  question?: AgentQuestionExample;
  questions?: AgentQuestionExample[];
  roundConfig?: AgentRoundConfigExample;
  roundPreset?: "pure_agent_fast" | "default" | string;
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
