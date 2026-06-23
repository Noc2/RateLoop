export const ASK_ROUTE = "/ask";
export const ASK_ROUTE_TAB_PARAM = "tab";
export const ASK_MANUAL_ROUTE_TAB = "manual";
export const ASK_AGENT_ROUTE_TAB = "agent";
export const ASK_SUBMISSIONS_ROUTE_TAB = "submissions";
export type AskRouteTab = typeof ASK_MANUAL_ROUTE_TAB | typeof ASK_AGENT_ROUTE_TAB | typeof ASK_SUBMISSIONS_ROUTE_TAB;

export const RATE_ROUTE = "/rate";
export const RATE_WAIT_FOR_CONTENT_PARAM = "waitForContent";

export const GOVERNANCE_ROUTE = "/governance";

const DOCS_ROUTE = "/docs";
export const DOCS_AI_ROUTE = `${DOCS_ROUTE}/ai`;

export const SETTINGS_ROUTE = "/settings";
export const SETTINGS_FRONTEND_HASH = "frontend";
export const SETTINGS_FRONTEND_ROUTE = `${SETTINGS_ROUTE}#${SETTINGS_FRONTEND_HASH}`;

type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined;

export function buildRouteWithSearchParams(route: string, searchParams?: SearchParamsLike) {
  const params = new URLSearchParams();

  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });
  } else if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (Array.isArray(value)) {
        value.forEach(item => params.append(key, item));
      } else if (value !== undefined) {
        params.set(key, value);
      }
    }
  }

  const query = params.toString();
  return query ? `${route}?${query}` : route;
}

export const ASK_AGENT_ROUTE = buildRouteWithSearchParams(ASK_ROUTE, { [ASK_ROUTE_TAB_PARAM]: ASK_AGENT_ROUTE_TAB });
export const ASK_SUBMISSIONS_ROUTE = buildRouteWithSearchParams(ASK_ROUTE, {
  [ASK_ROUTE_TAB_PARAM]: ASK_SUBMISSIONS_ROUTE_TAB,
});

export function buildRateContentHref(
  contentId: string | number | bigint,
  options?: {
    waitForContent?: boolean;
  },
) {
  return buildRouteWithSearchParams(RATE_ROUTE, {
    content: contentId.toString(),
    ...(options?.waitForContent ? { [RATE_WAIT_FOR_CONTENT_PARAM]: "1" } : {}),
  });
}

export function parseAskRouteTab(tab: string | null | undefined): AskRouteTab {
  if (tab === ASK_AGENT_ROUTE_TAB) return ASK_AGENT_ROUTE_TAB;
  if (tab === ASK_SUBMISSIONS_ROUTE_TAB) return ASK_SUBMISSIONS_ROUTE_TAB;
  return ASK_MANUAL_ROUTE_TAB;
}
