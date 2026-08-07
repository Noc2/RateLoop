import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import { classNames } from "./classNames";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "rateloop-gradient-action",
  secondary: "rateloop-secondary-action",
  ghost: "btn-ghost",
  danger: "border border-error/20 bg-error/[0.06] text-error",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "btn-sm px-3",
  md: "px-5",
  // The geometry of a full-size branded action: 3rem tall with 1rem bold text, the
  // same as `.rateloop-gradient-action` produces. Naming it means call sites that
  // need to sit beside a primary can ask for the size instead of hand-copying
  // heights and type, which is how the sign-in pair drifted apart.
  lg: "min-h-12 px-5 text-base font-bold leading-none",
};

export function Button<T extends ElementType = "button">({
  as,
  children,
  className,
  size = "md",
  variant = "primary",
  ...props
}: ButtonProps<T>) {
  const Component = as ?? "button";
  const defaultButtonProps = Component === "button" && !("type" in props) ? { type: "button" as const } : {};
  return (
    <Component
      className={classNames("btn", VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      {...defaultButtonProps}
      {...props}
    >
      {children}
    </Component>
  );
}
