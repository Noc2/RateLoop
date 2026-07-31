import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

export default async function RatePage({
  searchParams,
  params,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    terms?: string | string[];
    q?: string | string[];
    scope?: string | string[];
  }>;
  params: Promise<{ locale: Locale }>;
}) {
  const [{ locale }, requestedParams] = await Promise.all([params, searchParams]);
  const next = new URLSearchParams();
  for (const key of ["assignment", "terms", "q", "scope"] as const) {
    const value = Array.isArray(requestedParams[key]) ? requestedParams[key]?.[0] : requestedParams[key];
    if (value) next.set(key, value);
  }
  const search = next.toString();
  redirect({ href: `/human/review${search ? `?${search}` : ""}`, locale });
}
