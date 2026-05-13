import { ChartBarIcon } from "@heroicons/react/24/outline";
import { TooltipAnchor } from "~~/components/ui/InfoTooltip";
import type { TooltipPosition } from "~~/lib/ui/tooltipPosition";

interface CuryoPredictButtonProps {
  disabled?: boolean;
  onClick: () => void;
  size?: "default" | "sm";
  attention?: boolean;
  tooltipPosition?: TooltipPosition;
}

export function CuryoPredictButton({
  disabled = false,
  onClick,
  size = "default",
  attention = false,
  tooltipPosition = "bottom",
}: CuryoPredictButtonProps) {
  const isSmall = size === "sm";
  const label = "Predict final rating";
  const iconClassName = isSmall ? "h-5 w-5" : "h-[20px] w-[20px]";

  return (
    <TooltipAnchor text={label} position={tooltipPosition}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={`btn border-none action-orange-control ${
          isSmall ? "h-11 min-h-11 w-11 rounded-full p-0" : "min-h-11 rounded-full px-4 text-sm"
        } ${attention ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-base-100" : ""}`}
      >
        <ChartBarIcon className={iconClassName} aria-hidden />
        {!isSmall ? <span className="font-semibold">Predict</span> : null}
      </button>
    </TooltipAnchor>
  );
}
