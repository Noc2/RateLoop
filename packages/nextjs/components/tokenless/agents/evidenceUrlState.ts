export type EvidenceOutcomeFilter = "all" | "pass" | "fail" | "insufficient";
export type EvidenceDateFilter = "all" | "7" | "30";

export type EvidenceUrlState = {
  query: string;
  outcome: EvidenceOutcomeFilter;
  date: EvidenceDateFilter;
  runId: string | null;
  packetId: string | null;
};

export const DEFAULT_EVIDENCE_URL_STATE: EvidenceUrlState = {
  query: "",
  outcome: "all",
  date: "all",
  runId: null,
  packetId: null,
};

const outcomes = new Set<EvidenceOutcomeFilter>(["all", "pass", "fail", "insufficient"]);
const dates = new Set<EvidenceDateFilter>(["all", "7", "30"]);

function paramsFrom(search: string | URLSearchParams) {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function bounded(value: string | null, maximumLength: number) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, maximumLength) : null;
}

export function parseEvidenceUrlState(search: string | URLSearchParams): EvidenceUrlState {
  const params = paramsFrom(search);
  const requestedOutcome = params.get("outcome") as EvidenceOutcomeFilter | null;
  const requestedDate = params.get("date") as EvidenceDateFilter | null;

  return {
    query: (params.get("q") ?? "").slice(0, 120),
    outcome: requestedOutcome && outcomes.has(requestedOutcome) ? requestedOutcome : "all",
    date: requestedDate && dates.has(requestedDate) ? requestedDate : "all",
    runId: bounded(params.get("run"), 256),
    packetId: bounded(params.get("packet"), 256),
  };
}

export function updateEvidenceUrlSearch(search: string | URLSearchParams, patch: Partial<EvidenceUrlState>) {
  const params = paramsFrom(search);
  const state = { ...parseEvidenceUrlState(params), ...patch };

  if (state.query) params.set("q", state.query.slice(0, 120));
  else params.delete("q");

  if (state.outcome === "all") params.delete("outcome");
  else params.set("outcome", state.outcome);

  if (state.date === "all") params.delete("date");
  else params.set("date", state.date);

  const runId = bounded(state.runId, 256);
  if (runId) params.set("run", runId);
  else params.delete("run");

  const packetId = bounded(state.packetId, 256);
  if (packetId) params.set("packet", packetId);
  else params.delete("packet");

  return params.toString();
}

export function evidenceUrlHref({
  pathname,
  search,
  hash = "",
  patch,
}: {
  pathname: string;
  search: string | URLSearchParams;
  hash?: string;
  patch: Partial<EvidenceUrlState>;
}) {
  const nextSearch = updateEvidenceUrlSearch(search, patch);
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash}`;
}
