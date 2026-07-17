import { type ReactNode } from "react";
import { classNames } from "./classNames";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-base-content/65",
  success: "border-0 bg-emerald-300/10 text-emerald-100",
  warning: "border-0 bg-amber-300/10 text-amber-100",
  danger: "border-0 bg-red-300/[0.06] text-red-100",
  info: "border-0 bg-blue-300/10 text-blue-100",
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
