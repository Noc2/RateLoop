import { type ComponentPropsWithRef, type ElementType, type ReactNode } from "react";
import { classNames } from "./classNames";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/**
 * `none` emits no geometry at all.
 *
 * It exists because the codebase reached this component with five button heights
 * in use (btn-xs, btn-sm, min-h-9, min-h-10, min-h-11, min-h-12) and three named
 * sizes to land them on. Whether a given height survives depends on cascade order
 * between DaisyUI's `--btn-p`/`--size` variables, `.rateloop-gradient-action`'s
 * own `min-height: 3rem`, and Tailwind's utility layer — which no unit test in
 * this repo can settle.
 *
 * So adoption and convergence are separated. A converted call site that does not
 * already match `sm`, `md` or `lg` asks for `none` and keeps its exact classes,
 * which makes the move onto this component provably style-preserving. Collapsing
 * those onto the named steps is then a change to this one file plus the removal
 * of `none`, instead of an edit to a hundred call sites.
 */
export type ButtonSize = "sm" | "md" | "lg" | "none";

type ButtonProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  /** Full width. Alignment stays with the call site: `.rateloop-gradient-action`
   *  already centres its content, so folding `justify-center` in here would have
   *  silently added it to eight controls that never asked for it. */
  block?: boolean;
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  // With-ref rather than without: React 19 passes `ref` as an ordinary prop, and
  // two converted call sites measure their own button, so dropping it from the
  // type would have forced them to stay hand-rolled.
} & Omit<ComponentPropsWithRef<T>, "as" | "children" | "className">;

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "rateloop-gradient-action",
  secondary: "rateloop-secondary-action",
  ghost: "btn-ghost",
  danger: "border border-error/20 bg-error/[0.06] text-error",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "btn-sm px-3",
  md: "px-5",
  none: "",
  // The geometry of a full-size branded action: 3rem tall with 1rem bold text, the
  // same as `.rateloop-gradient-action` produces. Naming it means call sites that
  // need to sit beside a primary can ask for the size instead of hand-copying
  // heights and type, which is how the sign-in pair drifted apart.
  lg: "min-h-12 px-5 text-base font-bold leading-none",
};

export function Button<T extends ElementType = "button">({
  as,
  block = false,
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
      className={classNames("btn", VARIANT_CLASSES[variant], SIZE_CLASSES[size], block ? "w-full" : "", className)}
      {...defaultButtonProps}
      {...props}
    >
      {children}
    </Component>
  );
}
