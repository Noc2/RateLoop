import { HttpJsonError, readJson } from "./http";
import assert from "node:assert/strict";
import test from "node:test";

test("readJson returns typed successful JSON", async () => {
  const body = await readJson<{ value: number }>(Response.json({ value: 7 }));
  assert.deepEqual(body, { value: 7 });
});

test("readJson preserves endpoint fallback policy, status, and code", async () => {
  await assert.rejects(
    () =>
      readJson(new Response(JSON.stringify({ error: "hidden", code: "expired" }), { status: 410 }), {
        errorFields: ["message"],
        fallbackMessage: "Answer request failed.",
      }),
    error =>
      error instanceof HttpJsonError &&
      error.message === "Answer request failed." &&
      error.status === 410 &&
      error.code === "expired",
  );
});

test("readJson prefers configured response messages and handles invalid error bodies", async () => {
  await assert.rejects(
    () => readJson(Response.json({ message: "Specific failure", error: "Generic failure" }, { status: 400 })),
    error => error instanceof HttpJsonError && error.message === "Specific failure" && error.status === 400,
  );
  await assert.rejects(
    () => readJson(new Response("not-json", { status: 502 }), { fallbackMessage: "Service unavailable." }),
    error => error instanceof HttpJsonError && error.message === "Service unavailable." && error.status === 502,
  );
});
