"use client";

import { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { SignInSurface, type SignInSurfaceLayout } from "./SignInSurface";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

export function SignedOutGate({
  description,
  headingLevel = 1,
  layout = "centered",
  preview,
  secondaryAction,
  title,
  titleId,
}: {
  description: string;
  headingLevel?: 1 | 2;
  layout?: SignInSurfaceLayout;
  preview?: ReactNode;
  secondaryAction?: ReactNode;
  title: string;
  titleId: string;
}) {
  const router = useRouter();

  return (
    <SignInSurface
      description={description}
      headingLevel={headingLevel}
      layout={layout}
      title={title}
      titleId={titleId}
    >
      {preview ? <div className="mb-5">{preview}</div> : null}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <div className="inline-flex">
          <ThirdwebSessionButton
            compact
            onSessionChange={authenticated => {
              if (authenticated) router.refresh();
            }}
          />
        </div>
        {secondaryAction}
      </div>
    </SignInSurface>
  );
}
