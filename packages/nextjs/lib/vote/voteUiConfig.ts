import { type VoteUiConfig, resolveVoteUiConfig } from "@rateloop/agents/voteUi";
import type { ContentItem } from "~~/hooks/contentFeed/shared";

export type { VoteUiConfig };

type ContentVoteUiInput = Pick<ContentItem, "resultSpecHash" | "voteUi"> & {
  title?: ContentItem["title"];
  question?: ContentItem["question"];
  description?: ContentItem["description"];
};

function joinUniqueContentText(...parts: Array<string | null | undefined>) {
  const unique: string[] = [];
  for (const part of parts) {
    const trimmed = part?.trim();
    if (!trimmed || unique.includes(trimmed)) continue;
    unique.push(trimmed);
  }
  return unique.join("\n");
}

export function resolveContentVoteUi(item: ContentVoteUiInput): VoteUiConfig {
  if (item.voteUi?.mode === "head_to_head") {
    return item.voteUi;
  }
  const text = joinUniqueContentText(item.question, item.title, item.description);
  return resolveVoteUiConfig({ resultSpecHash: item.resultSpecHash, text });
}

export function getRevealedDirectionLabels(config: VoteUiConfig) {
  if (config.mode === "head_to_head") {
    return { up: config.optionAKey, down: config.optionBKey };
  }
  return { up: "Up", down: "Down" };
}

export function getVoteButtonPresentation(config: VoteUiConfig, direction: "up" | "down") {
  if (config.mode === "head_to_head") {
    const isUp = direction === "up";
    const key = isUp ? config.optionAKey : config.optionBKey;
    const label = isUp ? config.optionALabel : config.optionBLabel;
    return {
      variant: "letters" as const,
      shortLabel: key,
      longLabel: `${key}: ${label}`,
      ariaLabel: `Vote for option ${key} (${label})`,
      tooltip: `${key}: ${label}`,
    };
  }

  return {
    variant: "thumbs" as const,
    shortLabel: direction === "up" ? "Up" : "Down",
    longLabel: direction === "up" ? "Thumbs up" : "Thumbs down",
    ariaLabel: direction === "up" ? "Vote thumbs up" : "Vote thumbs down",
    tooltip: direction === "up" ? "Thumbs up" : "Thumbs down",
  };
}

export function getCrowdForecastLabel(config: VoteUiConfig) {
  return config.mode === "head_to_head" ? `% choosing ${config.optionAKey}` : "% up";
}

const THUMBS_RATING_GUIDANCE_TEXT =
  "The public rating appears after a round settles and is the cumulative share of bounded thumbs-up evidence across settled rounds. Vote thumbs up when the content is useful for the question, thumbs down when it is unhelpful, broken, misleading, or unsafe. Your separate forecast is the expected share of revealed raters choosing thumbs up.";

export function getRatingGuidanceText(config: VoteUiConfig) {
  if (config.mode === "head_to_head") {
    return `The public rating appears after a round settles and is the cumulative share choosing ${config.optionAKey} (${config.optionALabel}) across settled rounds. Vote ${config.optionAKey} to pick ${config.optionALabel}; vote ${config.optionBKey} to pick ${config.optionBLabel}. Your separate forecast is the expected share of revealed raters choosing ${config.optionAKey}.`;
  }
  return THUMBS_RATING_GUIDANCE_TEXT;
}

export function getVoteSubmittedToastMessage(params: {
  config: VoteUiConfig;
  isUp: boolean;
  predictedUpPercent: number;
  stakeStatus: string;
}) {
  const { config, isUp, predictedUpPercent, stakeStatus } = params;
  if (config.mode === "head_to_head") {
    const pick = isUp ? config.optionAKey : config.optionBKey;
    return `Vote submitted: ${pick}, crowd forecast ${predictedUpPercent.toFixed(0)}% choosing ${config.optionAKey}, ${stakeStatus}`;
  }
  return `Vote submitted: ${isUp ? "up" : "down"}, crowd forecast ${predictedUpPercent.toFixed(0)}% up, ${stakeStatus}`;
}

export function getYourVoteTooltip(config: VoteUiConfig) {
  if (config.mode === "head_to_head") {
    return `${config.optionAKey} (${config.optionALabel}) means you prefer ${config.optionALabel}; ${config.optionBKey} (${config.optionBLabel}) means you prefer ${config.optionBLabel}.`;
  }
  return "Thumbs up means you think this content is useful for the question; thumbs down means it is unhelpful, broken, misleading, or unsafe.";
}

export function getExpectedCrowdTooltip(config: VoteUiConfig) {
  if (config.mode === "head_to_head") {
    return `Your forecast of what share of revealed raters will choose ${config.optionAKey} (${config.optionALabel}) this round. This forecast helps determine rewards; it is separate from your own pick.`;
  }
  return "Your forecast of what share of revealed raters will choose thumbs up this round. This forecast helps determine rewards; it is separate from your own thumbs up/down vote.";
}

export function getSignalToneLabel(config: VoteUiConfig, isUp: boolean) {
  if (config.mode === "head_to_head") {
    const presentation = getVoteButtonPresentation(config, isUp ? "up" : "down");
    return presentation.longLabel;
  }
  return isUp ? "Thumbs up" : "Thumbs down";
}
