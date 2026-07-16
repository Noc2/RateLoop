import type { ReactNode } from "react";

export function SignInSurface({
  children,
  description,
  title,
  titleId,
}: {
  children: ReactNode;
  description?: string;
  title: string;
  titleId: string;
}) {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] grow items-center justify-center px-6 py-16">
      <section className="surface-card w-full max-w-md rounded-2xl p-8 text-center" aria-labelledby={titleId}>
        <h1 id={titleId} className="font-display text-2xl font-semibold text-base-content">
          {title}
        </h1>
        {description ? (
          <p className="mx-auto mb-6 mt-3 max-w-sm text-base leading-6 text-base-content/70">{description}</p>
        ) : null}
        {children}
      </section>
    </div>
  );
}
