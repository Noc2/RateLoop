import { loadAnswerQueues } from "./answerQueue";
import assert from "node:assert/strict";
import test from "node:test";

test("starts public and private queue requests together so either rejection is observed", async () => {
  const requests: string[] = [];
  const pending: Array<(response: Response) => void> = [];
  const fetchImpl = ((input: string | URL | Request) => {
    requests.push(String(input));
    return new Promise<Response>(resolve => pending.push(resolve));
  }) as typeof fetch;

  const result = loadAnswerQueues("risk review", "all", fetchImpl);

  assert.deepEqual(requests, [
    "/api/rater/tasks?q=risk%20review&scope=public",
    "/api/account/assurance/assignments?q=risk%20review&view=active",
  ]);

  pending[0](Response.json({ tasks: [] }));
  pending[1](Response.json({ assignments: [] }));
  assert.deepEqual(await result, [
    { body: { tasks: [] }, error: null },
    { body: { assignments: [] }, error: null },
  ]);
});

test("skips queues excluded by the selected scope", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return Response.json({ tasks: [] });
  }) as typeof fetch;

  assert.deepEqual(await loadAnswerQueues("", "public", fetchImpl), [
    { body: { tasks: [] }, error: null },
    { body: { assignments: [] }, error: null },
  ]);
  assert.deepEqual(requests, ["/api/rater/tasks?q=&scope=public"]);
});

test("history fetches only terminal private assignments", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return Response.json({ assignments: [] });
  }) as typeof fetch;

  assert.deepEqual(await loadAnswerQueues("", "private", fetchImpl, "history"), [
    { body: { tasks: [] }, error: null },
    { body: { assignments: [] }, error: null },
  ]);
  assert.deepEqual(requests, ["/api/account/assurance/assignments?q=&view=history"]);
});

test("preserves one queue when the other queue returns an expected API error", async () => {
  const fetchImpl = (async (input: string | URL | Request) =>
    String(input).startsWith("/api/rater/tasks")
      ? Response.json({ code: "payout_wallet_required", message: "Add a payout wallet." }, { status: 409 })
      : Response.json({ assignments: [{ assignmentId: "haas_1" }] })) as typeof fetch;

  const [publicQueue, privateQueue] = await loadAnswerQueues("", "all", fetchImpl);
  assert.equal(publicQueue.error?.code, "payout_wallet_required");
  assert.deepEqual(publicQueue.body, {});
  assert.deepEqual(privateQueue, {
    body: { assignments: [{ assignmentId: "haas_1" }] },
    error: null,
  });
});
