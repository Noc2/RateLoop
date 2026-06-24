import { HandThumbDownIcon, HandThumbUpIcon } from "@heroicons/react/24/outline";
import { TooltipAnchor } from "~~/components/ui/InfoTooltip";
import type { TooltipPosition } from "~~/lib/ui/tooltipPosition";
import { type VoteUiConfig, getVoteButtonPresentation } from "~~/lib/vote/voteUiConfig";

interface RateLoopVoteButtonProps {
  direction: "up" | "down";
  disabled?: boolean;
  onClick: () => void;
  size?: "default" | "sm";
  attention?: boolean;
  tooltipPosition?: TooltipPosition;
  showTooltip?: boolean;
  voteUiConfig?: VoteUiConfig;
}

interface VoteDirectionIconProps {
  direction: "up" | "down";
  className?: string;
}

function VoteDirectionIcon({ direction, className = "h-[22px] w-[22px] drop-shadow-sm" }: VoteDirectionIconProps) {
  const Icon = direction === "up" ? HandThumbUpIcon : HandThumbDownIcon;

  return <Icon className={className} aria-hidden />;
}

export function RateLoopVoteButton({
  direction,
  disabled = false,
  onClick,
  size = "default",
  attention = false,
  tooltipPosition = "bottom",
  showTooltip = true,
  voteUiConfig = { mode: "thumbs" },
}: RateLoopVoteButtonProps) {
  const isUp = direction === "up";
  const presentation = getVoteButtonPresentation(voteUiConfig, direction);
  const isSmall = size === "sm";
  const iconClassName = isSmall ? "h-5 w-5 drop-shadow-sm" : "h-5 w-5 drop-shadow-sm";
  const showTextLabel = !isSmall || presentation.variant === "letters";

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={presentation.ariaLabel}
      data-testid={isUp ? "vote-button-up" : "vote-button-down"}
      title={showTooltip ? presentation.tooltip : undefined}
      className={`vote-btn ${isSmall ? "vote-btn-sm" : ""} ${isUp ? "vote-yes" : "vote-no"} ${
        attention ? "vote-btn-attention" : ""
      } ${presentation.variant === "letters" ? "vote-btn-letter" : ""}`}
    >
      <span className="vote-bg" />
      <span className="vote-symbol">
        {presentation.variant === "thumbs" ? (
          <VoteDirectionIcon direction={direction} className={iconClassName} />
        ) : (
          <span className={`vote-letter ${isSmall ? "vote-letter-sm" : ""}`} aria-hidden>
            {presentation.shortLabel}
          </span>
        )}
        {showTextLabel && presentation.variant === "thumbs" ? (
          <span className="vote-label">{presentation.shortLabel}</span>
        ) : null}
      </span>
    </button>
  );

  return showTooltip ? (
    <TooltipAnchor text={presentation.tooltip} position={tooltipPosition}>
      {button}
    </TooltipAnchor>
  ) : (
    button
  );
}
