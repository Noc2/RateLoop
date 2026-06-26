import { HEAD_TO_HEAD_AB_TEMPLATE_ID } from "@rateloop/node-utils/voteUi";
import { findAgentResultTemplate, getAgentResultTemplateBySpecHash } from "./templates";

export {
  HEAD_TO_HEAD_AB_TEMPLATE_ID,
  MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH,
  inferHeadToHeadAbQuestion,
  inferHeadToHeadAbQuestionFromText,
  inferHeadToHeadVoteUiFromText,
  normalizeHeadToHeadOptionKey,
  normalizeInferredHeadToHeadAbQuestion,
  normalizeInferredHeadToHeadAbRequestBody,
  readHeadToHeadTemplateInputs,
  readHeadToHeadVoteUiFromQuestionMetadata,
  resolveVoteUiConfig,
} from "@rateloop/node-utils/voteUi";
export type {
  HeadToHeadVoteUi,
  InferredHeadToHeadAbQuestion,
  VoteUiConfig,
} from "@rateloop/node-utils/voteUi";

export function isHeadToHeadAbResultSpecHash(
  resultSpecHash: string | null | undefined,
): boolean {
  return (
    getAgentResultTemplateBySpecHash(resultSpecHash).id ===
    HEAD_TO_HEAD_AB_TEMPLATE_ID
  );
}

export function getHeadToHeadAbResultSpecHash(): `0x${string}` {
  return (
    findAgentResultTemplate(HEAD_TO_HEAD_AB_TEMPLATE_ID)?.resultSpecHash ??
    ("0x" as `0x${string}`)
  );
}

export {
  HEAD_TO_HEAD_AB_TITLE_MAX_LENGTH,
  VOTE_UP_IF_TITLE_PATTERN,
  buildHeadToHeadAbTitle,
  formatHeadToHeadOptionMarker,
  getHeadToHeadAbTitleLengthError,
  getHeadToHeadAbTitleValidationError,
  isHeadToHeadAbAutoTitle,
  isHeadToHeadAbTitleWithinOptionLabelLimits,
  titleIncludesHeadToHeadOptionMarkers,
} from "./headToHeadTitle.js";
