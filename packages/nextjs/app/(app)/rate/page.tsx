import { redirect } from "next/navigation";

export default async function RatePage({
  searchParams,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    terms?: string | string[];
    q?: string | string[];
    scope?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams({ tab: "discover" });
  for (const key of ["assignment", "terms", "q", "scope"] as const) {
    const value = Array.isArray(params[key]) ? params[key]?.[0] : params[key];
    if (value) next.set(key, value);
  }
  redirect(`/human?${next.toString()}`);
}
