import { reviewPolicyCopy } from "~~/components/tokenless/agents/reviewPolicyCopy";

/**
 * Validation copy for the agent setup wizard.
 *
 * Every step of the wizard renders labels through `useLocalizedReviewPolicyCopy()`
 * but used to build its errors from template literals and the untranslated
 * `reviewPolicyCopy` constant. A German user therefore met a German label inside
 * an English sentence — worse than plain English, because it reads as a
 * half-finished translation rather than an untranslated product.
 *
 * The builders stay callable without a translator so they remain usable outside a
 * React tree and so their tests keep asserting behaviour rather than wiring. When
 * no localization is supplied every message falls back to exactly the English it
 * produced before.
 *
 * Two namespaces, because the two kinds of message differ:
 *   - `editor` — `reviewEditor`, the generic `{label}`-shaped validators that
 *     AgentHumanReviewEditor already validates the same fields against. Reused
 *     rather than duplicated, so one field cannot acquire two wordings.
 *   - `flow` — `setupFlow`, sentences that only the wizard raises.
 */
export type SetupTranslate = (key: string, values?: Record<string, number | string>) => string;

type Stringy<T> = { [K in keyof T]: T[K] extends string ? string : Stringy<T[K]> };

/** `reviewPolicyCopy` widened so the localized hook's return value also satisfies it. */
export type ReviewPolicyCopyValues = Stringy<typeof reviewPolicyCopy>;

export type SetupLocalization = {
  editor: SetupTranslate;
  flow: SetupTranslate;
  policy: ReviewPolicyCopyValues;
};

export type SetupMessages = ReturnType<typeof setupMessages>;

export function setupMessages(localization?: SetupLocalization) {
  const policy: ReviewPolicyCopyValues = localization?.policy ?? reviewPolicyCopy;
  const editor = localization?.editor;
  const flow = localization?.flow;

  return {
    /** Localized field labels, so a message and the input it names agree. */
    policy,

    // Generic field validators, shared with the review editor.
    required: (label: string) => (editor ? editor("required", { label }) : `${label} is required.`),
    maxLength: (label: string, maximum: number) =>
      editor ? editor("maxLength", { label, maximum }) : `${label} must be ${maximum} characters or fewer.`,
    wholeNumber: (label: string) => (editor ? editor("wholeNumber", { label }) : `${label} must be a whole number.`),
    numberRange: (label: string, minimum: number, maximum: number) =>
      editor
        ? editor("numberRange", { label, minimum, maximum })
        : `${label} must be between ${minimum} and ${maximum}.`,
    percentDecimals: (label: string) =>
      editor ? editor("percentDecimals", { label }) : `${label} must be a percentage with at most two decimal places.`,
    percentRange: (label: string, minimum: number) =>
      editor ? editor("percentRange", { label, minimum }) : `${label} must be between ${minimum}% and 100%.`,
    decimalPlaces: (label: string) =>
      editor ? editor("decimalPlaces", { label }) : `${label} must be a decimal with up to 6 places.`,
    greaterThanZero: (label: string) =>
      editor ? editor("greaterThanZero", { label }) : `${label} must be greater than zero.`,
    amountRange: (label: string) =>
      editor ? editor("amountRange", { label }) : `${label} is outside the supported range.`,
    amountRangeForPanel: (label: string) =>
      editor ? editor("amountRangeForPanel", { label }) : `${label} is outside the supported range for this panel.`,

    // Wizard-specific sentences.
    invalidSensitivity: () => (flow ? flow("invalidSensitivity") : "Choose a valid private-material sensitivity."),
    invalidRationale: () => (flow ? flow("invalidRationale") : "Choose a valid rationale setting."),
    invalidQuestionAuthority: () =>
      flow ? flow("invalidQuestionAuthority") : "Choose who writes each review question.",
    answerLabelsMustDiffer: () => (flow ? flow("answerLabelsMustDiffer") : "Positive and negative labels must differ."),
    hybridSpecialistSeats: () =>
      flow ? flow("hybridSpecialistSeats") : "Hybrid specialist seats are not available yet.",
    chooseSpecialist: () => (flow ? flow("chooseSpecialist") : "Choose at least one specialist area."),
    savedBountyInvalid: () => (flow ? flow("savedBountyInvalid") : "Saved USDC bounty is invalid."),
    savedBountyRange: () => (flow ? flow("savedBountyRange") : "Saved USDC bounty is outside the supported range."),
    invalidAuthority: () => (flow ? flow("invalidAuthority") : "Choose a valid agent authority."),
    invalidCompensation: () => (flow ? flow("invalidCompensation") : "Choose a valid reviewer payment."),
    invalidBonusAwarder: () => (flow ? flow("invalidBonusAwarder") : "Choose a valid Feedback Bonus awarder."),
    bonusAwarderAccountRequired: () =>
      flow
        ? flow("bonusAwarderAccountRequired")
        : "Enter the authenticated account for the designated Feedback Bonus awarder.",
    riskTierFormat: () =>
      flow
        ? flow("riskTierFormat")
        : "Risk levels must be comma-separated names using letters, numbers, hyphens, or underscores.",
    ruleConditionRequired: () =>
      flow ? flow("ruleConditionRequired") : "Add at least one risk level or confidence condition.",
    configurationUnconfirmed: () =>
      flow ? flow("configurationUnconfirmed") : "The saved review configuration could not be confirmed.",
  };
}
