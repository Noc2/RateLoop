import type { ReactNode } from "react";
import { classNames } from "~~/components/tokenless/ui/classNames";

export function SetupActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={classNames(
        "mt-8 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
