import { type ButtonHTMLAttributes, type ReactNode } from "react";

export type GradientActionMotion = "idle" | "intro" | "processing";
export type GradientActionSize = "sm" | "default" | "lg";

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function getGradientActionClassName(className?: string) {
  return joinClassNames("rateloop-gradient-action", className);
}

export function getGradientActionMotion(isProcessing: boolean, restingMotion: GradientActionMotion = "idle") {
  return isProcessing ? "processing" : restingMotion;
}

export function GradientActionInner({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={joinClassNames("rateloop-gradient-action-inner", className)}>{children}</span>;
}

type GradientActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  fullWidth?: boolean;
  innerClassName?: string;
  motion?: GradientActionMotion;
  pill?: boolean;
  size?: GradientActionSize;
};

export function GradientActionButton({
  children,
  className,
  disabled,
  fullWidth = false,
  innerClassName,
  motion = "idle",
  pill = false,
  size = "default",
  type = "button",
  ...buttonProps
}: GradientActionButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      className={getGradientActionClassName(
        joinClassNames(
          fullWidth && "rateloop-gradient-action-full",
          pill && "rateloop-gradient-action-pill",
          className,
        ),
      )}
      data-motion={motion}
      data-size={size}
      disabled={disabled}
      aria-busy={motion === "processing" || undefined}
    >
      <GradientActionInner className={innerClassName}>{children}</GradientActionInner>
    </button>
  );
}
