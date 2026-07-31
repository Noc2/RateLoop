import { type ReactNode } from "react";
import { classNames } from "./classNames";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "border-base-content/10 bg-base-content/[0.04] text-base-content/65",
  success: "border-0 bg-success/10 text-success",
  warning: "border-0 bg-warning/10 text-warning",
  danger: "border-0 bg-error/[0.06] text-error",
  info: "border-0 bg-info/10 text-info",
};

export function Badge({
  children,
  className,
  variant = "neutral",
}: {
  children: ReactNode;
  className?: string;
  variant?: BadgeVariant;
}) {
  return <span className={classNames("badge", VARIANT_CLASSES[variant], className)}>{children}</span>;
}
