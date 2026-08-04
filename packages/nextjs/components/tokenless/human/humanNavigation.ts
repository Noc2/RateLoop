export type HumanTab = "discover" | "inbox" | "profile" | "settings";
export type HumanNavigation = HumanTab | "history";
export type HumanSection = "review" | "history" | "inbox" | "profile" | "settings";

export type NavigationSearchParams = Record<string, string | string[] | undefined>;

const REVIEW_QUERY_KEYS = ["assignment", "terms", "invite"] as const;

const humanSectionByNavigation: Record<HumanNavigation, HumanSection> = {
  discover: "review",
  history: "history",
  inbox: "inbox",
  profile: "profile",
  settings: "settings",
};

const humanNavigationBySection = new Map<string, HumanNavigation>([
  ...Object.entries(humanSectionByNavigation).map(
    ([navigation, section]) => [section, navigation as HumanNavigation] as const,
  ),
  ["discover", "discover"],
  ["reviews", "discover"],
]);

function navigationSearchParams(input?: URLSearchParams | NavigationSearchParams) {
  if (!input) return new URLSearchParams();
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

function firstNavigationValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function humanSectionForNavigation(navigation: HumanNavigation): HumanSection {
  return humanSectionByNavigation[navigation];
}

export function humanNavigationForSection(section?: string): HumanNavigation | null {
  return section ? (humanNavigationBySection.get(section) ?? null) : null;
}

export function canonicalReviewSearchParams(input?: URLSearchParams | NavigationSearchParams) {
  const current = navigationSearchParams(input);
  const canonical = new URLSearchParams();
  for (const key of REVIEW_QUERY_KEYS) {
    const value = current.get(key);
    if (value) canonical.set(key, value);
  }
  return canonical;
}

export function rateRedirectHref(searchParams: NavigationSearchParams) {
  const search = canonicalReviewSearchParams(searchParams).toString();
  return `/human/review${search ? `?${search}` : ""}`;
}

export function humanSectionHref(
  navigation: HumanNavigation,
  currentSearch?: URLSearchParams | NavigationSearchParams,
) {
  let params = navigationSearchParams(currentSearch);
  if (humanSectionForNavigation(navigation) === "review") {
    params = canonicalReviewSearchParams(params);
  } else {
    params.delete("tab");
    params.delete("q");
    params.delete("scope");
    params.delete("source");
    if (navigation === "history") params.delete("view");
  }
  const search = params.toString();
  return `/human/${humanSectionForNavigation(navigation)}${search ? `?${search}` : ""}`;
}

export function legacyHumanRouteHref(searchParams: NavigationSearchParams) {
  const params = navigationSearchParams(searchParams);
  const requestedTab = firstNavigationValue(searchParams.tab);
  let navigation: HumanNavigation =
    requestedTab === "inbox" || requestedTab === "profile" || requestedTab === "settings" ? requestedTab : "discover";

  if (requestedTab === "earnings") {
    navigation = "profile";
    if (!params.has("section")) params.set("section", "earnings");
  } else if (navigation === "discover" && firstNavigationValue(searchParams.view) === "history") {
    navigation = "history";
  }

  return humanSectionHref(navigation, params);
}
