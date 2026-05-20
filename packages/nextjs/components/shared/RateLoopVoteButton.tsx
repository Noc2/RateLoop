import { HandThumbDownIcon, HandThumbUpIcon } from "@heroicons/react/24/outline";
import { TooltipAnchor } from "~~/components/ui/InfoTooltip";
import type { TooltipPosition } from "~~/lib/ui/tooltipPosition";

interface RateLoopVoteButtonProps {
  direction: "up" | "down";
  disabled?: boolean;
  onClick: () => void;
  size?: "default" | "sm";
  attention?: boolean;
  tooltipPosition?: TooltipPosition;
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
}: RateLoopVoteButtonProps) {
  const isUp = direction === "up";
  const label = isUp ? "Thumbs up" : "Thumbs down";
  const directionLabel = isUp ? "Up" : "Down";
  const isSmall = size === "sm";
  const iconClassName = isSmall ? "h-5 w-5 drop-shadow-sm" : "h-5 w-5 drop-shadow-sm";

  return (
    <TooltipAnchor text={label} position={tooltipPosition}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={isUp ? "Vote thumbs up" : "Vote thumbs down"}
        title={label}
        className={`vote-btn ${isSmall ? "vote-btn-sm" : ""} ${isUp ? "vote-yes" : "vote-no"} ${
          attention ? "vote-btn-attention" : ""
        }`}
      >
        <span className="vote-bg" />
        <span className="vote-symbol">
          <VoteDirectionIcon direction={direction} className={iconClassName} />
          {!isSmall ? <span className="vote-label">{directionLabel}</span> : null}
        </span>
      </button>
    </TooltipAnchor>
  );
}
