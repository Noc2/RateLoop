export type AnswerScope = "all" | "public" | "private" | "submitted";

export class AnswerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export type AnswerQueueResponse = {
  body: Record<string, unknown>;
  error: AnswerRequestError | null;
};

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
      typeof body.code === "string" ? body.code : null,
    );
  }
  return body;
}

async function settle(request: Promise<Record<string, unknown>>): Promise<AnswerQueueResponse> {
  try {
    return { body: await request, error: null };
  } catch (error) {
    if (error instanceof AnswerRequestError) return { body: {}, error };
    return {
      body: {},
      error: new AnswerRequestError(error instanceof Error ? error.message : "Answer queue request failed.", 0, null),
    };
  }
}

export function loadAnswerQueues(
  query: string,
  scope: AnswerScope,
  fetchImpl: typeof fetch = fetch,
  privateView: "active" | "history" = "active",
): Promise<[AnswerQueueResponse, AnswerQueueResponse]> {
  const encodedQuery = encodeURIComponent(query);
  return Promise.all([
    settle(
      scope === "private" || scope === "submitted"
        ? Promise.resolve({ tasks: [] })
        : fetchJson(`/api/rater/tasks?q=${encodedQuery}&scope=public`, fetchImpl),
    ),
    settle(
      scope === "public" || scope === "submitted"
        ? Promise.resolve({ assignments: [] })
        : fetchJson(`/api/account/assurance/assignments?q=${encodedQuery}&view=${privateView}`, fetchImpl),
    ),
  ]);
}
