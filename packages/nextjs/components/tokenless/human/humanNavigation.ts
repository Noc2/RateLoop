export type HumanTab = "discover" | "inbox" | "profile" | "settings";
export type HumanNavigation = HumanTab | "history";
export type HumanSection = "review" | "history" | "inbox" | "profile" | "settings";

type NavigationSearchParams = Record<string, string | string[] | undefined>;

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

export function humanSectionHref(
  navigation: HumanNavigation,
  currentSearch?: URLSearchParams | NavigationSearchParams,
) {
  const params = navigationSearchParams(currentSearch);
  params.delete("tab");
  if (navigation === "history") params.delete("view");
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
