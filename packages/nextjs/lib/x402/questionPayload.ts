import {
  X402QuestionInputError,
  type X402QuestionOperation,
  type X402QuestionParserOptions,
  type X402QuestionPayload,
  X402_SUBMISSION_REWARD_ASSET_USDC,
  X402_USDC_BY_CHAIN_ID,
  X402_USDC_DECIMALS,
  X402_WORLD_CHAIN_USDC_BY_CHAIN_ID,
  assertSupportedX402BundleBounty,
  buildX402QuestionOperation as buildSharedX402QuestionOperation,
  parseX402QuestionRequest as parseSharedX402QuestionRequest,
} from "@rateloop/agents/x402-question-payload";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";

export {
  X402_SUBMISSION_REWARD_ASSET_USDC,
  X402_USDC_DECIMALS,
  X402_USDC_BY_CHAIN_ID,
  X402_WORLD_CHAIN_USDC_BY_CHAIN_ID,
  X402QuestionInputError,
  assertSupportedX402BundleBounty,
};

export type { X402QuestionOperation, X402QuestionPayload };

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function serverX402QuestionParserOptions(): X402QuestionParserOptions {
  return {
    allowedRateLoopAttachmentOrigins: [
      "https://rateloop.ai",
      "https://www.rateloop.ai",
      normalizeOrigin(process.env.APP_URL),
      normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
      normalizeOrigin(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null),
    ].filter((origin): origin is string => Boolean(origin)),
    allowLocalhostAttachmentOrigins: process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled(),
    questionMetadataBaseUrl: process.env.NEXT_PUBLIC_PONDER_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  };
}

export function parseX402QuestionRequest(value: unknown, fallbackChainId?: number): X402QuestionPayload {
  return parseSharedX402QuestionRequest(value, fallbackChainId, serverX402QuestionParserOptions());
}

export function buildX402QuestionOperation(payload: X402QuestionPayload): X402QuestionOperation {
  return buildSharedX402QuestionOperation(payload, serverX402QuestionParserOptions());
}
