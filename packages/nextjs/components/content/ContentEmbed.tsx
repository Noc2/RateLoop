"use client";

import React from "react";
import dynamic from "next/dynamic";
import { GenericLinkCard } from "./embeds";
import { ContentImageLightbox } from "~~/components/shared/ContentImageLightbox";
import { ExternalLinkBehaviorProvider, SafeExternalLink } from "~~/components/shared/SafeExternalLink";
import { isUploadedImageUrl } from "~~/lib/contentMedia";
import { detectPlatform } from "~~/utils/platforms";

const EmbedSpinner = () => (
  <div className="flex h-full w-full items-center justify-center p-8">
    <span className="loading loading-spinner loading-md text-base-content/60" />
  </div>
);

const YouTubeEmbed = dynamic(() => import("./embeds/YouTubeEmbed").then(m => m.YouTubeEmbed), {
  loading: EmbedSpinner,
});

interface ContentEmbedProps {
  url?: string | null;
  title?: string;
  description?: string;
  thumbnailUrl?: string | null;
  compact?: boolean;
  showTextHeading?: boolean;
  isActive?: boolean;
  interactionMode?: "default" | "vote";
  imageFit?: "cover" | "contain";
  imageLinkUrl?: string | null;
  onImageLinkClick?: React.MouseEventHandler<HTMLElement>;
  enableImageLightbox?: boolean;
  imageLightboxTriggerLabel?: string;
  imageLightboxModalLabel?: string;
}

/** Error boundary that catches render errors in embed components and falls back to a link card. */
class EmbedErrorBoundary extends React.Component<
  { url: string; compact: boolean; thumbnailUrl?: string | null; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <GenericLinkCard url={this.props.url} compact={this.props.compact} thumbnailUrl={this.props.thumbnailUrl} />
      );
    }
    return this.props.children;
  }
}

/**
 * Renders platform-appropriate embedded content.
 * Embeds are code-split via next/dynamic — only the needed embed is loaded.
 */
export function ContentEmbed({
  url,
  title,
  description,
  thumbnailUrl,
  compact = false,
  showTextHeading = true,
  isActive = true,
  interactionMode = "default",
  imageFit = "cover",
  imageLinkUrl,
  onImageLinkClick,
  enableImageLightbox = false,
  imageLightboxTriggerLabel,
  imageLightboxModalLabel,
}: ContentEmbedProps) {
  if (!url?.trim()) {
    return (
      <div className={`flex h-full min-h-[12rem] flex-col justify-center bg-base-100 ${compact ? "p-4" : "p-6"}`}>
        {showTextHeading && title ? (
          <p className="text-sm font-semibold uppercase text-base-content/60">Question</p>
        ) : null}
        {showTextHeading && title ? (
          <h3 className="mt-2 text-xl font-semibold leading-tight text-base-content">{title}</h3>
        ) : null}
        {description ? (
          <p
            className={`whitespace-pre-wrap break-words text-base leading-relaxed text-base-content/75 ${
              showTextHeading && title ? "mt-3" : ""
            }`}
          >
            {description}
          </p>
        ) : null}
      </div>
    );
  }

  const disableExternalNavigation = interactionMode === "vote";
  const platformInfo = detectPlatform(url);

  if (isUploadedImageUrl(url)) {
    const imageAlt = title || "Question media";
    const imageClassName = `h-full w-full ${imageFit === "contain" ? "object-contain" : "object-cover"}`;

    if (enableImageLightbox) {
      return (
        <ContentImageLightbox
          src={url}
          alt={imageAlt}
          imageClassName={imageClassName}
          loading={isActive ? "eager" : "lazy"}
          triggerLabel={imageLightboxTriggerLabel}
          modalLabel={imageLightboxModalLabel}
          modalImageClassName="sm:max-w-[92vw]"
        />
      );
    }

    const image = <img src={url} alt={imageAlt} className={imageClassName} loading={isActive ? "eager" : "lazy"} />;

    if (imageLinkUrl?.trim()) {
      return (
        <SafeExternalLink
          href={imageLinkUrl}
          allowExternalOpen
          className="block h-full w-full cursor-pointer"
          title={title ? `Open context for ${title}` : "Open context"}
          ariaLabel={title ? `Open context for ${title}` : "Open context"}
          onClick={onImageLinkClick}
        >
          {image}
        </SafeExternalLink>
      );
    }

    return image;
  }

  let embed: React.ReactNode;
  switch (platformInfo.type) {
    case "youtube":
      embed = <YouTubeEmbed key={url} info={platformInfo} compact={compact} isActive={isActive} />;
      break;
    default:
      return (
        <ExternalLinkBehaviorProvider disableNavigation={disableExternalNavigation}>
          <GenericLinkCard url={url} compact={compact} thumbnailUrl={thumbnailUrl} />
        </ExternalLinkBehaviorProvider>
      );
  }

  return (
    <ExternalLinkBehaviorProvider disableNavigation={disableExternalNavigation}>
      <EmbedErrorBoundary key={url} url={url} compact={compact} thumbnailUrl={thumbnailUrl}>
        {embed}
      </EmbedErrorBoundary>
    </ExternalLinkBehaviorProvider>
  );
}
