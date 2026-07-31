import type { ComponentProps } from "react";
import NextLink from "next/link";
import type { Locale } from "~~/i18n/config";
import { getPathname } from "~~/i18n/navigation";

export function PublicLink({ href, locale = "en", ...props }: ComponentProps<typeof NextLink> & { locale?: Locale }) {
  const localizedHref =
    typeof href === "string" && href.startsWith("/") && !href.startsWith("/api/")
      ? getPathname({ href, locale })
      : href;

  return <NextLink {...props} href={localizedHref} />;
}
