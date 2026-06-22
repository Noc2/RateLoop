"use client";

import { type MouseEvent, memo, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
import { ConfidentialContextGate } from "~~/components/vote/ConfidentialContextGate";
import { getVisibleContentRating } from "~~/hooks/contentFeed/shared";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { type GatedContextManifest, useGatedContextManifest } from "~~/hooks/useGatedContextManifest";
import type { SubmitterProfile } from "~~/hooks/useSubmitterProfiles";
import { appendGatedContextAddress, appendOptionalGatedContextAddress } from "~~/lib/attachments/gatedContextFetchUrls";
import { type ContentMediaItem, buildFallbackMediaItems, isUploadedImageUrl } from "~~/lib/contentMedia";
import { isPrivateContextMetadata } from "~~/lib/vote/confidentialContext";
import { getVisibleFeedbackBonusAmount, getVisibleRewardPoolAmount } from "~~/lib/vote/discoverFeedFilter";
import { detectPlatform } from "~~/utils/platforms";

const ShareContentModal = dynamic(
  () => import("~~/components/shared/ShareContentModal").then(m => m.ShareContentModal),
  { ssr: false },
);
const LAPTOP_VOTE_CARD_MEDIA_QUERY = "(min-width: 1024px) and (max-width: 1535px)";
const MOBILE_VOTE_CARD_MEDIA_QUERY = "(max-width: 767px)";
const MOBILE_DESCRIPTION_PREVIEW_WORDS = 12;
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

function getManifestMediaItems(manifest?: GatedContextManifest): ContentMediaItem[] {
  return (
    manifest?.images.map((image, index) => ({
      mediaIndex: image.mediaIndex ?? index,
      mediaType: image.mediaType,
      url: image.url,
      canonicalUrl: image.url,
      urlHost: null,
    })) ?? []
  );
}

function getCardMediaItems(item: ContentItem, manifest?: GatedContextManifest): ContentMediaItem[] {
  const manifestMedia = getManifestMediaItems(manifest);
  if (manifestMedia.length > 0) return manifestMedia;
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
  const usesIntrinsicMediaHeight = platformType === "youtube";
  const usesNaturalImageHeight = platformType === "image";
  const flushMediaEdges = platformType === "image";
  const mediaHeightClassName = usesNaturalImageHeight
    ? "w-full"
    : usesIntrinsicMediaHeight
      ? "w-full"
      : isMobileViewport
        ? "w-full min-h-[14rem] max-h-[46svh] flex-1"
        : isLaptopCompact
          ? "w-full h-[clamp(18rem,50vh,24rem)]"
          : "w-full h-[clamp(20rem,56vh,32rem)]";
  const imageContextClickOpensExternally = platformType === "image";
  const contentIntentEnabled = Boolean(item.url) && platformType !== "youtube" && !imageContextClickOpensExternally;

  return (
    <div className="flex min-h-0 flex-col">
      <div
        data-testid="vote-content-card-shell"
        data-content-id={item.id.toString()}
        className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-base-200"
      >
        <FeedContentHeader item={item} titleId={titleId} compact={useCompactCard} flushMediaEdges={flushMediaEdges} />
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
            isActive={isActive}
            compact={useCompactEmbed}
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
          flushMediaEdges={flushMediaEdges}
        />
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
  flushMediaEdges?: boolean;
}

interface FeedContentHeaderProps {
  item: ContentItem;
  titleId?: string;
  compact?: boolean;
  flushMediaEdges?: boolean;
}

function FeedContentHeader({ item, titleId, compact, flushMediaEdges = false }: FeedContentHeaderProps) {
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
      className={`${flushMediaEdges ? "" : "border-b border-base-content/10"} bg-base-200 ${
        compact ? "px-4 py-3" : "px-5 py-4 xl:px-4 xl:py-3"
      }`}
    >
      <h2
        id={titleId}
        className={`text-balance break-words text-center font-sans font-semibold tracking-normal text-base-content ${headlineSizeClassName}`}
      >
        {questionText}
      </h2>
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
  return (
    <ConfidentialContextGate item={item}>
      {({ walletAddress }) => (
        <UnlockedContentMediaCarousel
          item={item}
          compact={compact}
          isActive={isActive}
          interactionMode={interactionMode}
          walletAddress={walletAddress}
        />
      )}
    </ConfidentialContextGate>
  );
}

function PrivateContextMediaStatus({ error, isLoading }: { error?: string | null; isLoading?: boolean }) {
  return (
    <div className="flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-3 bg-base-100 p-6 text-center">
      {isLoading ? <span className="loading loading-spinner loading-md text-primary" /> : null}
      <p className={`max-w-sm text-sm leading-relaxed ${error ? "text-error" : "text-base-content/65"}`}>
        {error ?? (isLoading ? "Loading private context..." : "No private media is attached.")}
      </p>
    </div>
  );
}

function UnlockedContentMediaCarousel({
  item,
  compact,
  isActive,
  interactionMode,
  walletAddress,
}: {
  item: ContentItem;
  compact: boolean;
  isActive: boolean;
  interactionMode: "default" | "vote";
  walletAddress?: string;
}) {
  const privateContext = isPrivateContextMetadata(item);
  const manifestQuery = useGatedContextManifest({
    chainId: item.chainId,
    contentId: item.id,
    contentRegistryAddress: item.contentRegistryAddress,
    deploymentKey: item.deploymentKey,
    enabled: privateContext && Boolean(walletAddress),
    walletAddress,
  });
  const mediaItems = getCardMediaItems(item, privateContext ? manifestQuery.data : undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMedia = mediaItems[activeIndex] ?? mediaItems[0] ?? null;
  const hasCarouselControls = mediaItems.length > 1;
  const contextUrl = item.url.trim();
  const embedUrl = activeMedia?.url.trim() || contextUrl;
  const activeMediaIsImage = activeMedia && getMediaPlatformType(activeMedia) === "image";
  const hasPublicFallback = item.media.length > 0 || Boolean(item.thumbnailUrl) || contextUrl.length > 0;

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

  if (privateContext && !hasPublicFallback && manifestQuery.isLoading) {
    return <PrivateContextMediaStatus isLoading />;
  }

  if (privateContext && !hasPublicFallback && manifestQuery.error) {
    return (
      <PrivateContextMediaStatus
        error={manifestQuery.error instanceof Error ? manifestQuery.error.message : "Private context is not available."}
      />
    );
  }

  if (privateContext && !hasPublicFallback && !embedUrl) {
    return <PrivateContextMediaStatus />;
  }

  return (
    <>
      <ContentEmbed
        url={appendGatedContextAddress(embedUrl, walletAddress)}
        thumbnailUrl={appendOptionalGatedContextAddress(item.thumbnailUrl, walletAddress)}
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

function GatedQuestionDescription({
  className,
  description,
  isMobileViewport,
  item,
  referencedContentById,
  walletAddress,
}: {
  className?: string;
  description: string;
  isMobileViewport?: boolean;
  item: ContentItem;
  referencedContentById?: ReadonlyMap<string, QuestionReferenceContentSummary>;
  walletAddress?: string;
}) {
  const privateContext = isPrivateContextMetadata(item);
  const manifestQuery = useGatedContextManifest({
    chainId: item.chainId,
    contentId: item.id,
    contentRegistryAddress: item.contentRegistryAddress,
    deploymentKey: item.deploymentKey,
    enabled: privateContext && Boolean(walletAddress),
    walletAddress,
  });
  const primaryDetails = privateContext ? manifestQuery.data?.details[0] : null;

  return (
    <QuestionDescription
      description={description}
      detailsHash={primaryDetails?.sha256 ?? item.detailsHash}
      detailsUrl={
        privateContext
          ? (primaryDetails?.url ?? appendOptionalGatedContextAddress(item.detailsUrl, walletAddress))
          : item.detailsUrl
      }
      referencedContentById={referencedContentById}
      previewWordLimit={isMobileViewport ? MOBILE_DESCRIPTION_PREVIEW_WORDS : undefined}
      previewLayout={isMobileViewport ? "inline-toggle" : undefined}
      expandBehavior={isMobileViewport ? "modal" : "inline"}
      className={className}
    />
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
  flushMediaEdges = false,
}: FeedContentMetaCardProps) {
  const [showShare, setShowShare] = useState(false);
  const hasFollowButton = !(normalizedAddress && item.submitter.toLowerCase() === normalizedAddress);
  const description = item.description.trim();
  const contextUrl = item.url.trim();
  const contextLabel = getSourceLabel(contextUrl);
  const privateContext = isPrivateContextMetadata(item);
  const hasDescription = description.length > 0 || Boolean(item.detailsUrl) || privateContext;
  const hasContextLink = !privateContext && contextUrl.length > 0 && contextLabel.trim().length > 0;
  const rewardPoolTotal = getVisibleRewardPoolAmount(item);
  const rewardPoolCurrency = item.rewardPoolSummary?.currency;
  const feedbackBonusTotal = getVisibleFeedbackBonusAmount(item);
  const feedbackBonusCurrency = item.feedbackBonusSummary?.currency;
  const hasVisibleReward = rewardPoolTotal > 0n || feedbackBonusTotal > 0n;
  const hideDockedActionButtons = isMobileViewport;
  const actionRowClassName = `flex items-center justify-between gap-3 ${compact ? "mt-3" : "mt-4"}`;
  const embeddedBorderClassName = flushMediaEdges ? "" : "border-t border-base-content/10";
  const wrapperClassName = embedded
    ? compact
      ? `${embeddedBorderClassName} px-3 py-3`
      : `${embeddedBorderClassName} p-4`
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
      {!hasVisibleReward ? <NoRewardChip /> : null}
    </>
  );
  const questionDescription = (walletAddress?: string) => (
    <GatedQuestionDescription
      description={description}
      isMobileViewport={isMobileViewport}
      item={item}
      referencedContentById={referencedContentById}
      className="text-base leading-relaxed text-base-content/85"
      walletAddress={walletAddress}
    />
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
            {privateContext ? (
              <ConfidentialContextGate item={item} variant="inline">
                {({ walletAddress }) => questionDescription(walletAddress)}
              </ConfidentialContextGate>
            ) : (
              questionDescription()
            )}
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
