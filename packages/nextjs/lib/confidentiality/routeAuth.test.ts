import { NextRequest } from "next/server";
import { requireConfidentialityJobAuth } from "./routeAuth";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalCronSecret = env.CRON_SECRET;
const originalJobSecret = env.RATELOOP_CONFIDENTIALITY_JOB_SECRET;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function requestWithToken(token: string) {
  return new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile", {
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
}

beforeEach(() => {
  delete env.CRON_SECRET;
  delete env.RATELOOP_CONFIDENTIALITY_JOB_SECRET;
});

after(() => {
  restoreEnv("CRON_SECRET", originalCronSecret);
  restoreEnv("RATELOOP_CONFIDENTIALITY_JOB_SECRET", originalJobSecret);
});

test("confidentiality job auth accepts Vercel CRON_SECRET", () => {
  env.CRON_SECRET = "cron-secret";

  assert.equal(requireConfidentialityJobAuth(requestWithToken("cron-secret")), null);
});

test("confidentiality job auth accepts both configured cron and RateLoop-specific secrets", () => {
  env.CRON_SECRET = "cron-secret";
  env.RATELOOP_CONFIDENTIALITY_JOB_SECRET = "job-secret";

  assert.equal(requireConfidentialityJobAuth(requestWithToken("job-secret")), null);
  assert.equal(requireConfidentialityJobAuth(requestWithToken("cron-secret")), null);
});

test("confidentiality job auth accepts the legacy RateLoop confidentiality header", () => {
  env.RATELOOP_CONFIDENTIALITY_JOB_SECRET = "job-secret";

  const request = new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile", {
    headers: new Headers({ "x-rateloop-confidentiality-secret": "job-secret" }),
  });

  assert.equal(requireConfidentialityJobAuth(request), null);
});
