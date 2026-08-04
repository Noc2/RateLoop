import { rateRedirectHref } from "~~/components/tokenless/human/humanNavigation";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

export default async function RatePage({
  searchParams,
  params,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    terms?: string | string[];
    invite?: string | string[];
    q?: string | string[];
    scope?: string | string[];
    source?: string | string[];
  }>;
  params: Promise<{ locale: Locale }>;
}) {
  const [{ locale }, requestedParams] = await Promise.all([params, searchParams]);
  redirect({ href: rateRedirectHref(requestedParams), locale });
}
