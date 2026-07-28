function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const agentTitles: Record<string, string> = {
  agents: "Connection",
  connect: "Connection",
  evaluations: "Evaluations",
  evidence: "Evidence",
  groups: "Reviews",
  inbox: "Inbox",
  overview: "Workspace",
  registry: "Reviews",
};

export function agentPageTitle(tab: string | string[] | undefined) {
  return agentTitles[firstQueryValue(tab) ?? "overview"] ?? agentTitles.overview;
}

export function humanPageTitle(params: {
  assignment?: string | string[];
  invite?: string | string[];
  tab?: string | string[];
  view?: string | string[];
}) {
  if (firstQueryValue(params.assignment)) return "Complete review";
  if (firstQueryValue(params.invite) === "1") return "Reviewer invitation";
  if (firstQueryValue(params.tab) === "profile") return "Reviewer profile";
  if (firstQueryValue(params.tab) === "settings") return "Account settings";
  if (firstQueryValue(params.view) === "history") return "Review history";
  return "To review";
}
