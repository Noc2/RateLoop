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
    "/api/account/assurance/assignments?q=risk%20review",
  ]);

  pending[0](Response.json({ tasks: [] }));
  pending[1](Response.json({ assignments: [] }));
  assert.deepEqual(await result, [{ tasks: [] }, { assignments: [] }]);
});

test("skips queues excluded by the selected scope", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return Response.json({ tasks: [] });
  }) as typeof fetch;

  assert.deepEqual(await loadAnswerQueues("", "public", fetchImpl), [{ tasks: [] }, { assignments: [] }]);
  assert.deepEqual(requests, ["/api/rater/tasks?q=&scope=public"]);
});
