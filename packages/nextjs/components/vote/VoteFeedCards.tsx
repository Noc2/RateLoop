"use client";

import { type MouseEvent, type ReactNode, memo, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { ShareIcon } from "@heroicons/react/24/outline";
import { ContentEmbed } from "~~/components/content/ContentEmbed";
import { QuestionDescription, type QuestionReferenceContentSummary } from "~~/components/content/QuestionDescription";
import { SubmitterBadge } from "~~/components/content/SubmitterBadge";
import { FollowProfileButton } from "~~/components/shared/FollowProfileButton";
import { SafeExternalLink } from "~~/components/shared/SafeExternalLink";
import {
  FeedbackBonusAmountDisplay,
  RewardPoolAmountDisplay,
  VotingQuestionContextDetails,
} from "~~/components/shared/VotingQuestionCard";
import { WatchContentButton } from "~~/components/shared/WatchContentButton";
import { getVisibleContentRating } from "~~/hooks/contentFeed/shared";
import type { ContentItem } from "~~/hooks/useContentFeed";
import type { SubmitterProfile } from "~~/hooks/useSubmitterProfiles";
import { useWalletMessageSigner } from "~~/hooks/useWalletMessageSigner";
import { type ContentMediaItem, buildFallbackMediaItems, isUploadedImageUrl } from "~~/lib/contentMedia";
import { getVisibleFeedbackBonusAmount, getVisibleRewardPoolAmount } from "~~/lib/vote/discoverFeedFilter";
import { detectPlatform } from "~~/utils/platforms";
import { notification } from "~~/utils/scaffold-eth";

const ShareContentModal = dynamic(
  () => import("~~/components/shared/ShareContentModal").then(m => m.ShareContentModal),
  { ssr: false },
);
const LAPTOP_VOTE_CARD_MEDIA_QUERY = "(min-width: 1024px) and (max-width: 1535px)";
const MOBILE_VOTE_CARD_MEDIA_QUERY = "(max-width: 767px)";
const CONTENT_INTENT_INTERACTIVE_SELECTOR =
  "a[href],button,input,select,textarea,summary,iframe,[role='button'],[role='link']";

function getSourceLabel(url: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(CONTENT_INTENT_INTERACTIVE_SELECTOR) !== null;
}

function getQuestionText(item: ContentItem) {
  return item.question?.trim() || item.title;
}

function isPrivateContextItem(item: ContentItem) {
  return item.contextAccess === "gated" || item.contextVisibility === "gated";
}

function PrivateContextBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-warning/15 font-semibold text-warning ${
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      }`}
    >
      <LockClosedIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      Private context
    </span>
  );
}

function getCardMediaItems(item: ContentItem): ContentMediaItem[] {
  if (item.media.length > 0) return item.media;
  if (item.thumbnailUrl) {
    return [
      {
        mediaIndex: 0,
        mediaType: "image",
        url: item.thumbnailUrl,
        canonicalUrl: item.thumbnailUrl,
        urlHost: null,
      },
    ];
  }
  return buildFallbackMediaItems(item.url);
}

function getPrimaryMediaItem(item: ContentItem): ContentMediaItem | null {
  return getCardMediaItems(item)[0] ?? null;
}

function getMediaPlatformType(media: ContentMediaItem | null) {
  if (!media?.url) return "text";
  if (media.mediaType === "video") return "youtube";
  if (media.mediaType === "image" || isUploadedImageUrl(media.url)) return "image";
  return detectPlatform(media.url).type;
}

function NoRewardChip() {
  return (
    <div
      className="reward-chip reward-chip-label bg-error text-error-content"
      aria-label="No active bounty or Feedback Bonus"
    >
      No active bounty
    </div>
  );
}

function topAudienceBucketValues(
  buckets: ContentItem["audienceContext"] extends { fields: infer Fields } ? Fields[keyof Fields] : unknown,
) {
  if (!Array.isArray(buckets)) return [];
  return buckets
    .filter((bucket): bucket is { total: number; value: string } =>
      Boolean(
        bucket && typeof bucket === "object" && typeof bucket.value === "string" && typeof bucket.total === "number",
      ),
    )
    .slice()
    .sort((a, b) => b.total - a.total || a.value.localeCompare(b.value))
    .slice(0, 3)
    .map(bucket => bucket.value);
}

function AudienceContextSummary({ compact, item }: { compact: boolean; item: ContentItem }) {
  const context = item.audienceContext;
  if (!context || !context.fields || Number(item.ratingSettledRounds ?? 0) <= 0) return null;
  const rows = [
    { label: "Languages", values: topAudienceBucketValues(context.fields.languages) },
    { label: "Roles", values: topAudienceBucketValues(context.fields.roles) },
    { label: "Countries", values: topAudienceBucketValues(context.fields.residenceCountry) },
    { label: "Age", values: topAudienceBucketValues(context.fields.ageGroup) },
    { label: "Nationalities", values: topAudienceBucketValues(context.fields.nationalities) },
  ].filter(row => row.values.length > 0);
  if (rows.length === 0) return null;

  return (
    <div
      className={compact ? "mt-3 border-t border-base-content/10 pt-3" : "mt-4 border-t border-base-content/10 pt-4"}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-base-content/55">Revealed cohort</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {rows.map(row => (
          <span key={row.label} className="rounded-full bg-base-300 px-2.5 py-1 text-xs text-base-content/75">
            <span className="font-semibold text-base-content/85">{row.label}:</span> {row.values.join(", ")}
          </span>
        ))}
      </div>
      <div className="mt-2 text-xs leading-snug text-base-content/50">Self-reported and unverified.</div>
    </div>
  );
}

interface FeedVoteCardProps {
  item: ContentItem;
  submitterProfile?: SubmitterProfile;
  titleId?: string;
  isActive?: boolean;
  onContentIntent?: (item: ContentItem) => void;
  onOpenFeedback?: (item: ContentItem) => void;
  onSourceOpen?: (item: ContentItem) => void;
  onToggleWatch: (id: bigint) => void;
  onToggleFollow: (address: string) => void;
  watched: boolean;
  watchPending: boolean;
  following: boolean;
  followPending: boolean;
  normalizedAddress?: string;
  referencedContentById?: ReadonlyMap<string, QuestionReferenceContentSummary>;
}

export const FeedVoteCard = memo(function FeedVoteCard({
  item,
  submitterProfile,
  titleId,
  isActive = true,
  onContentIntent,
  onOpenFeedback,
  onSourceOpen,
  onToggleWatch,
  onToggleFollow,
  watched,
  watchPending,
  following,
  followPending,
  normalizedAddress,
  referencedContentById,
}: FeedVoteCardProps) {
  const [isLaptopCompact, setIsLaptopCompact] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const primaryMedia = getPrimaryMediaItem(item);
  const platformType = getMediaPlatformType(primaryMedia);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(LAPTOP_VOTE_CARD_MEDIA_QUERY);
    const updateCompactMode = () => {
      setIsLaptopCompact(mediaQuery.matches);
    };

    updateCompactMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateCompactMode);
      return () => {
        mediaQuery.removeEventListener("change", updateCompactMode);
      };
    }

    mediaQuery.addListener(updateCompactMode);
    return () => {
      mediaQuery.removeListener(updateCompactMode);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(MOBILE_VOTE_CARD_MEDIA_QUERY);
    const updateMobileMode = () => {
      setIsMobileViewport(mediaQuery.matches);
    };

    updateMobileMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateMobileMode);
      return () => {
        mediaQuery.removeEventListener("change", updateMobileMode);
      };
    }

    mediaQuery.addListener(updateMobileMode);
    return () => {
      mediaQuery.removeListener(updateMobileMode);
    };
  }, []);

  const useCompactCard = isLaptopCompact || isMobileViewport;
  const useCompactEmbed = isMobileViewport;
  const contentStackClassName = useCompactCard ? "gap-2" : "gap-3 xl:gap-2.5";
  const contentGridClassName = "grid min-h-0 flex-1 grid-cols-1 gap-3";
  const usesIntrinsicMediaHeight = platformType === "youtube";
  const mediaHeightClassName = usesIntrinsicMediaHeight
    ? "w-full"
    : isMobileViewport
      ? "w-full min-h-[14rem] max-h-[46svh] flex-1"
      : isLaptopCompact
        ? "w-full h-[clamp(18rem,50vh,24rem)]"
        : "w-full h-[clamp(20rem,56vh,32rem)]";
  const imageContextClickOpensExternally = platformType === "image";
  const contentIntentEnabled = Boolean(item.url) && platformType !== "youtube" && !imageContextClickOpensExternally;

  return (
    <div className={`flex min-h-0 flex-col ${contentStackClassName}`}>
      <FeedContentHeader item={item} titleId={titleId} compact={useCompactCard} />

      <div className={contentGridClassName}>
        <div
          data-testid="vote-content-card-shell"
          data-content-id={item.id.toString()}
          className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-base-200"
        >
          <div
            className={`${mediaHeightClassName} relative overflow-hidden`}
            data-testid="vote-content-surface"
            onClickCapture={event => {
              if (!contentIntentEnabled || !onContentIntent) return;

              const target = event.target;
              if (!(target instanceof Element)) return;

              const contentIntentSurface = target.closest<HTMLElement>("[data-content-intent-surface='true']");
              if (contentIntentSurface) {
                event.stopPropagation();
                onContentIntent(item);
                return;
              }

              const anchor = target.closest<HTMLAnchorElement>("a[href]");
              if (!anchor) return;
              if (anchor.dataset.allowExternalOpen === "true") return;

              const href = anchor.getAttribute("href");
              if (!href || href.startsWith("/") || href.startsWith("#")) return;

              event.preventDefault();
              event.stopPropagation();
              onContentIntent(item);
            }}
            onClick={event => {
              if (!contentIntentEnabled || !onContentIntent) return;
              if (isInteractiveTarget(event.target)) return;
              onContentIntent(item);
            }}
          >
            <ContentMediaCarousel
              item={item}
              compact={useCompactEmbed}
              isActive={isActive}
              interactionMode={contentIntentEnabled ? "vote" : "default"}
            />
          </div>
          <FeedContentMetaCard
            item={item}
            submitterProfile={submitterProfile}
            onOpenFeedback={onOpenFeedback}
            onSourceOpen={onSourceOpen}
            normalizedAddress={normalizedAddress}
            following={following}
            followPending={followPending}
            watched={watched}
            watchPending={watchPending}
            onToggleFollow={onToggleFollow}
            onToggleWatch={onToggleWatch}
            referencedContentById={referencedContentById}
            compact={useCompactCard}
            isMobileViewport={isMobileViewport}
            isActive={isActive}
            embedded
          />
        </div>
      </div>
    </div>
  );
});

interface FeedContentMetaCardProps {
  item: ContentItem;
  submitterProfile?: SubmitterProfile;
  onOpenFeedback?: (item: ContentItem) => void;
  onSourceOpen?: (item: ContentItem) => void;
  normalizedAddress?: string;
  following: boolean;
  followPending: boolean;
  watched: boolean;
  watchPending: boolean;
  onToggleWatch: (id: bigint) => void;
  onToggleFollow: (address: string) => void;
  referencedContentById?: ReadonlyMap<string, QuestionReferenceContentSummary>;
  compact?: boolean;
  isMobileViewport?: boolean;
  isActive?: boolean;
  embedded?: boolean;
}

interface FeedContentHeaderProps {
  item: ContentItem;
  titleId?: string;
  compact?: boolean;
}

function FeedContentHeader({ item, titleId, compact }: FeedContentHeaderProps) {
  const questionText = getQuestionText(item);
  const isLongQuestion = questionText.length > 90;
  const headlineSizeClassName = compact
    ? isLongQuestion
      ? "text-lg leading-snug sm:text-xl xl:text-lg"
      : "text-xl leading-tight sm:text-2xl xl:text-xl"
    : isLongQuestion
      ? "text-xl leading-snug sm:text-2xl xl:text-xl"
      : "text-2xl leading-tight sm:text-3xl xl:text-2xl";

  return (
    <div
      data-testid="vote-content-header"
      className={`rounded-lg bg-base-200 ${compact ? "px-4 py-3" : "px-5 py-4 xl:px-4 xl:py-3"}`}
    >
      <h2
        id={titleId}
        className={`text-balance break-words text-center font-sans font-semibold tracking-normal text-base-content ${headlineSizeClassName}`}
      >
        {questionText}
      </h2>
      {isPrivateContextItem(item) ? (
        <div className="mt-2 flex justify-center">
          <PrivateContextBadge compact={compact} />
        </div>
      ) : null}
    </div>
  );
}

function ConfidentialContextGate({ children, item }: { children: ReactNode; item: ContentItem }) {
  const gated = isPrivateContextItem(item);
  const { address } = useAccount();
  const { isPending: isSigning, signMessageAsync } = useWalletMessageSigner({ address });
  const [accepted, setAccepted] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    setAccepted(false);
  }, [item.id]);

  useEffect(() => {
    if (!gated || !address) return;
    let cancelled = false;
    setIsChecking(true);
    const params = new URLSearchParams({
      address,
      contentId: item.id.toString(),
    });
    fetch(`/api/confidentiality/terms/session?${params.toString()}`, {
      credentials: "include",
    })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!cancelled && body?.hasSession === true) setAccepted(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, gated, item.id]);

  const acceptTerms = async () => {
    if (!address) {
      notification.warning("Connect a wallet to view private context.");
      return;
    }
    setIsAccepting(true);
    try {
      const payload = {
        address,
        contentHash: item.contentHash,
        contentId: item.id.toString(),
        detailsHash: item.detailsHash ?? undefined,
        questionMetadataHash: item.questionMetadataHash ?? undefined,
      };
      const challengeResponse = await fetch("/api/confidentiality/terms/challenge", {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok || typeof challenge.message !== "string" || typeof challenge.challengeId !== "string") {
        throw new Error(challenge.error || "Could not create confidentiality challenge.");
      }
      const signature = await signMessageAsync({ message: challenge.message });
      const acceptResponse = await fetch("/api/confidentiality/terms", {
        body: JSON.stringify({
          ...payload,
          challengeId: challenge.challengeId,
          signature,
          termsVersion: challenge.termsVersion,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const acceptedBody = await acceptResponse.json();
      if (!acceptResponse.ok || acceptedBody.accepted !== true) {
        throw new Error(acceptedBody.error || "Could not record confidentiality acceptance.");
      }
      setAccepted(true);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not unlock private context.");
    } finally {
      setIsAccepting(false);
    }
  };

  if (!gated || accepted) return <>{children}</>;

  return (
    <div className="flex h-full min-h-[16rem] w-full flex-col items-center justify-center gap-4 bg-base-300 p-6 text-center">
      <PrivateContextBadge />
      <div className="max-w-md space-y-2">
        <p className="text-base font-semibold text-base-content">Confidential context is locked</p>
        <p className="text-sm leading-relaxed text-base-content/65">
          Accept the question confidentiality terms with your wallet to view hosted context for this rating.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={acceptTerms}
        disabled={isChecking || isAccepting || isSigning}
      >
        {isChecking || isAccepting || isSigning ? <span className="loading loading-spinner loading-xs" /> : null}
        Accept terms
      </button>
    </div>
  );
}

function ContentMediaCarousel({
  item,
  compact,
  isActive,
  interactionMode,
}: {
  item: ContentItem;
  compact: boolean;
  isActive: boolean;
  interactionMode: "default" | "vote";
}) {
  const mediaItems = getCardMediaItems(item);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMedia = mediaItems[activeIndex] ?? mediaItems[0] ?? null;
  const hasCarouselControls = mediaItems.length > 1;
  const contextUrl = item.url.trim();
  const embedUrl = activeMedia?.url.trim() || contextUrl;
  const activeMediaIsImage = activeMedia && getMediaPlatformType(activeMedia) === "image";

  useEffect(() => {
    setActiveIndex(0);
  }, [item.id, mediaItems.length]);

  const showPrevious = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveIndex(current => (current - 1 + mediaItems.length) % mediaItems.length);
  };

  const showNext = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveIndex(current => (current + 1) % mediaItems.length);
  };

  return (
    <>
      <ConfidentialContextGate item={item}>
        <ContentEmbed
          url={embedUrl}
          thumbnailUrl={item.thumbnailUrl}
          title={item.title}
          description={item.description}
          compact={compact}
          showTextHeading={false}
          isActive={isActive}
          interactionMode={interactionMode}
          imageFit="contain"
          enableImageLightbox={Boolean(activeMediaIsImage)}
          imageLightboxTriggerLabel="Open question image"
          imageLightboxModalLabel={item.title ? `Image for ${item.title}` : "Question image"}
        />
      </ConfidentialContextGate>
      {hasCarouselControls ? (
        <>
          <button
            type="button"
            onClick={showPrevious}
            aria-label="Show previous image"
            className="btn btn-circle btn-sm absolute left-3 top-1/2 z-10 -translate-y-1/2 border-0 bg-base-300/85 text-base-content/85 shadow hover:bg-base-content/20 hover:text-primary"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={showNext}
            aria-label="Show next image"
            className="btn btn-circle btn-sm absolute right-3 top-1/2 z-10 -translate-y-1/2 border-0 bg-base-300/85 text-base-content/85 shadow hover:bg-base-content/20 hover:text-primary"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <span
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-base-300/85 px-2.5 py-1 text-xs font-semibold leading-none text-base-content/80"
            aria-live="polite"
          >
            {activeIndex + 1} / {mediaItems.length}
          </span>
        </>
      ) : null}
    </>
  );
}

function FeedContentMetaCard({
  item,
  submitterProfile,
  onOpenFeedback,
  onSourceOpen,
  normalizedAddress,
  following,
  followPending,
  watched,
  watchPending,
  onToggleWatch,
  onToggleFollow,
  referencedContentById,
  compact = false,
  isMobileViewport = false,
  isActive = true,
  embedded = false,
}: FeedContentMetaCardProps) {
  const [showShare, setShowShare] = useState(false);
  const hasFollowButton = !(normalizedAddress && item.submitter.toLowerCase() === normalizedAddress);
  const description = item.description.trim();
  const hasDescription = description.length > 0 || Boolean(item.detailsUrl);
  const contextUrl = item.url.trim();
  const contextLabel = getSourceLabel(contextUrl);
  const privateContext = isPrivateContextItem(item);
  const hasContextLink = !privateContext && contextUrl.length > 0 && contextLabel.trim().length > 0;
  const rewardPoolTotal = getVisibleRewardPoolAmount(item);
  const rewardPoolCurrency = item.rewardPoolSummary?.currency;
  const feedbackBonusTotal = getVisibleFeedbackBonusAmount(item);
  const feedbackBonusCurrency = item.feedbackBonusSummary?.currency;
  const hasVisibleReward = rewardPoolTotal > 0n || feedbackBonusTotal > 0n;
  const hideDockedActionButtons = isMobileViewport;
  const actionRowClassName = `flex items-center justify-between gap-3 ${compact ? "mt-3" : "mt-4"}`;
  const wrapperClassName = embedded
    ? compact
      ? "border-t border-base-content/10 px-3 py-3"
      : "border-t border-base-content/10 p-4"
    : `rounded-lg bg-base-200 ${compact ? "p-3" : "p-4 xl:p-3"}`;
  const actionButtons = (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
      {hasFollowButton ? (
        <FollowProfileButton
          following={following}
          pending={followPending}
          onClick={() => onToggleFollow(item.submitter)}
        />
      ) : null}
      <WatchContentButton watched={watched} pending={watchPending} onClick={() => onToggleWatch(item.id)} />
      {onOpenFeedback && !hideDockedActionButtons ? (
        <button
          type="button"
          onClick={() => onOpenFeedback(item)}
          className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:text-base-content xl:hidden"
          aria-label="Open feedback"
        >
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
        </button>
      ) : null}
      {!hideDockedActionButtons ? (
        <button
          type="button"
          onClick={() => setShowShare(true)}
          className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:text-base-content"
          aria-label="Share content"
        >
          <ShareIcon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
  const rewardStatusChips = (
    <>
      {rewardPoolTotal > 0n ? <RewardPoolAmountDisplay amount={rewardPoolTotal} currency={rewardPoolCurrency} /> : null}
      {feedbackBonusTotal > 0n ? (
        <FeedbackBonusAmountDisplay amount={feedbackBonusTotal} currency={feedbackBonusCurrency} />
      ) : null}
      {privateContext ? <PrivateContextBadge compact /> : null}
      {!hasVisibleReward ? <NoRewardChip /> : null}
    </>
  );

  return (
    <>
      <div className={wrapperClassName}>
        <div className={compact ? "space-y-2.5" : "space-y-3"}>
          <VotingQuestionContextDetails
            contentId={item.id}
            categoryId={item.categoryId}
            openRound={item.openRound}
            roundConfig={item.roundConfig}
            compact={compact}
            active={isActive}
            statusChips={rewardStatusChips}
            statusActions={actionButtons}
          />
        </div>

        {hasDescription ? (
          <div className={compact ? "mt-3 space-y-2" : "mt-4 space-y-2"}>
            <QuestionDescription
              description={description}
              detailsHash={item.detailsHash}
              detailsUrl={item.detailsUrl}
              referencedContentById={referencedContentById}
              className="text-base leading-relaxed text-base-content/85"
            />
          </div>
        ) : null}

        <AudienceContextSummary item={item} compact={compact} />

        <div className={actionRowClassName}>
          <div className="min-w-0 flex-1">
            <SubmitterBadge address={item.submitter} username={submitterProfile?.username} size="sm" />
          </div>
          {hasContextLink ? (
            <SafeExternalLink
              href={contextUrl}
              allowExternalOpen
              testId="content-source-link"
              title={`Open context: ${contextLabel}`}
              ariaLabel={`Open context: ${contextLabel}`}
              onClick={() => onSourceOpen?.(item)}
              className="inline-flex shrink-0 items-center gap-1.5 text-base font-semibold leading-snug text-primary underline-offset-4 transition-colors hover:text-primary-focus hover:underline"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0" />
              <span>Context</span>
            </SafeExternalLink>
          ) : null}
        </div>
      </div>

      {showShare ? (
        <ShareContentModal
          contentId={item.id}
          title={item.title}
          description={item.description}
          rating={getVisibleContentRating(item)}
          ratingBps={item.ratingBps !== undefined ? Number(item.ratingBps) : undefined}
          ratingSettledRounds={item.ratingSettledRounds}
          totalVotes={item.totalVotes}
          lastActivityAt={item.lastActivityAt}
          openRound={
            item.openRound
              ? {
                  voteCount: item.openRound.voteCount,
                }
              : null
          }
          onClose={() => setShowShare(false)}
        />
      ) : null}
    </>
  );
}
