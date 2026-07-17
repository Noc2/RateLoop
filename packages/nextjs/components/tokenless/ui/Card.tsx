import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";
import { classNames } from "./classNames";

export type CardVariant = "surface" | "nested" | "marketing";

type CardProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
  variant?: CardVariant;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

const VARIANT_CLASSES: Record<CardVariant, string> = {
  surface: "surface-card",
  nested: "surface-card-nested",
  marketing: "rateloop-surface-card",
};

export function Card<T extends ElementType = "div">({
  as,
  children,
  className,
  variant = "surface",
  ...props
}: CardProps<T>) {
  const Component = as ?? "div";
  return (
    <Component className={classNames(VARIANT_CLASSES[variant], className)} {...props}>
      {children}
    </Component>
  );
}
