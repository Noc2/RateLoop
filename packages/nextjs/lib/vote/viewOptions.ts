import { DISCOVER_FEED_MODE_OPTIONS, type DiscoverFeedMode } from "~~/lib/vote/feedModes";

export type ScopedVoteViewOption = "watched" | "my_votes" | "my_submissions" | "zero_lrep_vote" | "followed_curators";
export type VoteView = DiscoverFeedMode | ScopedVoteViewOption;

interface VoteViewOption {
  value: VoteView;
  label: string;
  description?: string;
}

interface VoteViewGroup {
  label: string;
  options: VoteViewOption[];
}

const ACTIVITY_VIEW_OPTIONS: VoteViewOption[] = [
  { value: "watched", label: "Watched" },
  { value: "my_votes", label: "My Votes" },
  { value: "my_submissions", label: "My Questions" },
  { value: "followed_curators", label: "Curators You Follow" },
];

const ZERO_LREP_RATE_OPTION: VoteViewOption = { value: "zero_lrep_vote", label: "0 LREP Vote" };

const SCOPED_VIEW_VALUES = new Set<ScopedVoteViewOption>([
  "watched",
  "my_votes",
  "my_submissions",
  "zero_lrep_vote",
  "followed_curators",
]);

export function isScopedVoteViewOption(value: VoteView): value is ScopedVoteViewOption {
  return SCOPED_VIEW_VALUES.has(value as ScopedVoteViewOption);
}

export function resolveSupportedVoteView(params: {
  view: VoteView;
  hasWallet: boolean;
  hasResolvedLrepBalance: boolean;
  hasZeroLrepBalance: boolean;
}): VoteView {
  if (!params.hasWallet && isScopedVoteViewOption(params.view)) {
    return "for_you";
  }

  if (params.hasResolvedLrepBalance && params.view === "zero_lrep_vote" && !params.hasZeroLrepBalance) {
    return "for_you";
  }

  return params.view;
}

export function getVoteViewGroups(hasWallet: boolean, canUseZeroLrepVote = hasWallet): VoteViewGroup[] {
  const rateOptions: VoteViewOption[] = DISCOVER_FEED_MODE_OPTIONS.filter(option => option.value !== "contested").map(
    option => ({
      value: option.value,
      label: option.label,
      description: option.description,
    }),
  );
  if (hasWallet && canUseZeroLrepVote) {
    rateOptions.push(ZERO_LREP_RATE_OPTION);
  }

  const groups: VoteViewGroup[] = [
    {
      label: "Rate",
      options: rateOptions,
    },
  ];

  if (hasWallet) {
    groups.push({
      label: "Your Activity",
      options: ACTIVITY_VIEW_OPTIONS,
    });
  }

  return groups;
}
