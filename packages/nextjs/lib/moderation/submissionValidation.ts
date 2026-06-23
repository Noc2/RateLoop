import {
  findBlockedContentTags,
  getContentTagValidationError,
  getContentTitleValidationError,
} from "@rateloop/node-utils/submissionValidation";
import { getQuestionReferenceValidationError } from "~~/lib/questionReferences";
import { containsBlockedText } from "~~/utils/contentFilter";

export { findBlockedContentTags, getContentTagValidationError, getContentTitleValidationError };

const MAX_CONTENT_DESCRIPTION_LENGTH = 280;

export function getContentDescriptionValidationError(value: string): string | null {
  if (value.length > MAX_CONTENT_DESCRIPTION_LENGTH) {
    return `Description must be ${MAX_CONTENT_DESCRIPTION_LENGTH} characters or fewer`;
  }

  const check = containsBlockedText(value);
  if (check.blocked) {
    return "Your description contains prohibited content";
  }

  return getQuestionReferenceValidationError(value);
}
