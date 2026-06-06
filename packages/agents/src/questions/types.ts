export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = Record<string, unknown>;

export type AgentQuestionExample = {
  title: string;
  description?: string;
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
    bountyEligibility?:
      | 0
      | 2
      | 4
      | 6
      | 8
      | 10
      | 12
      | 14
      | 130
      | 132
      | 134
      | 136
      | 138
      | 140
      | 142
      | string
      | number;
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
};

export type QuestionLintFinding = {
  level: "error" | "warning";
  message: string;
  path: string;
};
