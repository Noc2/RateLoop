import type { ReactNode } from "react";

export function DocsTitle({ children, gradientText }: { children?: ReactNode; gradientText: string }) {
  return (
    <h1>
      {children ? <>{children} </> : null}
      <span className="rateloop-text-gradient">{gradientText}</span>
    </h1>
  );
}
