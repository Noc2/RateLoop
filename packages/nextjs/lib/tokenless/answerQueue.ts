export type AnswerScope = "all" | "public" | "private" | "submitted";

export class AnswerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchJson(url: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new AnswerRequestError(
      typeof body.message === "string" ? body.message : "Answer queue request failed.",
      response.status,
    );
  }
  return body;
}

export function loadAnswerQueues(
  query: string,
  scope: AnswerScope,
  fetchImpl: typeof fetch = fetch,
): Promise<[Record<string, unknown>, Record<string, unknown>]> {
  const encodedQuery = encodeURIComponent(query);
  return Promise.all([
    scope === "private" || scope === "submitted"
      ? Promise.resolve({ tasks: [] })
      : fetchJson(`/api/rater/tasks?q=${encodedQuery}&scope=public`, fetchImpl),
    scope === "public" || scope === "submitted"
      ? Promise.resolve({ assignments: [] })
      : fetchJson(`/api/account/assurance/assignments?q=${encodedQuery}`, fetchImpl),
  ]);
}
