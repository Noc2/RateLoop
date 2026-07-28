function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const agentTitles: Record<string, string> = {
  agents: "Connections",
  approvals: "Approvals",
  billing: "Billing & settings",
  connect: "Connections",
  connections: "Connections",
  evaluations: "Results",
  evidence: "Evidence",
  groups: "Review setup",
  inbox: "Approvals",
  overview: "Overview",
  registry: "Review setup",
  "review-setup": "Review setup",
  results: "Results",
};

export function agentPageTitle(tab: string | string[] | undefined) {
  return agentTitles[firstQueryValue(tab) ?? "overview"] ?? agentTitles.overview;
}

export function humanPageTitle(params: {
  assignment?: string | string[];
  invite?: string | string[];
  routeSection?: string | string[];
  tab?: string | string[];
  view?: string | string[];
}) {
  if (firstQueryValue(params.assignment)) return "Complete review";
  if (firstQueryValue(params.invite) === "1") return "Reviewer invitation";
  if (firstQueryValue(params.routeSection) === "history") return "Review history";
  if (firstQueryValue(params.routeSection) === "inbox") return "Reviewer notifications";
  if (firstQueryValue(params.routeSection) === "profile") return "Reviewer profile";
  if (firstQueryValue(params.routeSection) === "settings") return "Account settings";
  if (firstQueryValue(params.tab) === "inbox") return "Reviewer notifications";
  if (firstQueryValue(params.tab) === "profile") return "Reviewer profile";
  if (firstQueryValue(params.tab) === "settings") return "Account settings";
  if (firstQueryValue(params.view) === "history") return "Review history";
  return "To review";
}
