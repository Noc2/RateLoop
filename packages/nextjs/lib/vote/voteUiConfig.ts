import {
  type HeadToHeadVoteUi,
  type VoteUiConfig,
  getHeadToHeadAbResultSpecHash,
  resolveVoteUiConfig,
} from "@rateloop/agents/voteUi";
import type { ContentItem } from "~~/hooks/contentFeed/shared";

export type { HeadToHeadVoteUi, VoteUiConfig };
export { getHeadToHeadAbResultSpecHash, resolveVoteUiConfig };

export function resolveContentVoteUi(item: Pick<ContentItem, "resultSpecHash" | "voteUi">): VoteUiConfig {
  if (item.voteUi?.mode === "head_to_head") {
    return item.voteUi;
  }
  return resolveVoteUiConfig({ resultSpecHash: item.resultSpecHash });
}

export function isHeadToHeadVoteUi(config: VoteUiConfig): config is HeadToHeadVoteUi {
  return config.mode === "head_to_head";
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
  return config.mode === "head_to_head" ? "% choosing A" : "% up";
}

export function getYourVoteTooltip(config: VoteUiConfig) {
  if (config.mode === "head_to_head") {
    return `${config.optionAKey} (${config.optionALabel}) means you prefer option A; ${config.optionBKey} (${config.optionBLabel}) means you prefer option B.`;
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
