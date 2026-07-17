import type { ReactNode } from "react";
import { RateLoopLogo } from "~~/components/RateLoopLogo";
import { Card } from "~~/components/tokenless/ui/Card";

export type SignInSurfaceLayout = "centered" | "embedded";

export function SignInSurface({
  branded = false,
  children,
  description,
  headingLevel = 1,
  layout = "centered",
  title,
  titleId,
}: {
  branded?: boolean;
  children: ReactNode;
  description?: string;
  headingLevel?: 1 | 2;
  layout?: SignInSurfaceLayout;
  title: string;
  titleId: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h1";

  return (
    <div
      className={
        layout === "centered"
          ? "flex min-h-[calc(100vh-9rem)] grow items-center justify-center px-6 py-16"
          : "flex w-full justify-center"
      }
    >
      <Card as="section" className="w-full max-w-md rounded-2xl p-8 text-center" aria-labelledby={titleId}>
        {branded ? (
          <div className="mb-8">
            <RateLoopLogo className="mx-auto h-20 w-20" idPrefix="sign-in-brand" />
            <p className="mt-4 font-display text-2xl font-semibold leading-tight text-base-content">
              The Human Assurance Loop
            </p>
          </div>
        ) : null}
        <Heading
          id={titleId}
          className={`font-display text-2xl font-semibold ${branded ? "rateloop-text-gradient" : "text-base-content"}`}
        >
          {title}
        </Heading>
        {description ? (
          <p className="mx-auto mb-6 mt-3 max-w-sm text-base leading-6 text-base-content/70">{description}</p>
        ) : null}
        {children}
      </Card>
    </div>
  );
}
