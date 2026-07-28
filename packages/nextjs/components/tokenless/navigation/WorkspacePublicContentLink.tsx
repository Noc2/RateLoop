"use client";

import { type ReactNode, Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  workspacePublicContentHref,
  workspaceReturnPathForLocation,
} from "~~/components/tokenless/navigation/workspaceReturnPath";

function ResolvedWorkspacePublicContentLink({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const returnPath = workspaceReturnPathForLocation(pathname, searchParams);
  return (
    <Link className={className} href={returnPath ? workspacePublicContentHref(href, returnPath) : href}>
      {children}
    </Link>
  );
}

export function WorkspacePublicContentLink(props: { children: ReactNode; className?: string; href: string }) {
  return (
    <Suspense
      fallback={
        <Link className={props.className} href={props.href}>
          {props.children}
        </Link>
      }
    >
      <ResolvedWorkspacePublicContentLink {...props} />
    </Suspense>
  );
}
