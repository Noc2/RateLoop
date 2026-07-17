import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import { classNames } from "./classNames";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

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
  danger: "border border-red-300/20 bg-red-300/[0.06] text-red-100",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "btn-sm px-3",
  md: "px-5",
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
