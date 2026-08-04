import { NextRequest } from "next/server";
import { POST as executePayment, GET as preparePayment } from "./asks/[operationKey]/payment/route";
import { GET as waitForResult } from "./asks/[operationKey]/wait/route";
import { POST as createAsk } from "./asks/route";
import { GET as readResult } from "./results/[operationKey]/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { PRIVATE_NO_STORE_CACHE_CONTROL, privateNoStoreJson } from "~~/lib/tokenless/privateHttpResponse";

const context = { params: Promise.resolve({ operationKey: "operation_private_cache_test" }) };
const ORIGINAL_APP_URL = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = "http://localhost";
});

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = ORIGINAL_APP_URL;
});

test("authenticated agent workflow responses share the private no-store cache invariant", async () => {
  const success = privateNoStoreJson({ ok: true });
  const responses = [
    success,
    await createAsk(
      new NextRequest("http://localhost/api/agent/v1/asks", {
        body: "{}",
        headers: { origin: "http://localhost" },
        method: "POST",
      }),
    ),
    await preparePayment(
      new NextRequest("http://localhost/api/agent/v1/asks/operation_private_cache_test/payment"),
      context,
    ),
    await executePayment(
      new NextRequest("http://localhost/api/agent/v1/asks/operation_private_cache_test/payment", {
        body: "{}",
        headers: { origin: "http://localhost" },
        method: "POST",
      }),
      context,
    ),
    await waitForResult(
      new NextRequest("http://localhost/api/agent/v1/asks/operation_private_cache_test/wait?timeoutMs=1000"),
      context,
    ),
    await readResult(new NextRequest("http://localhost/api/agent/v1/results/operation_private_cache_test"), context),
  ];

  assert.equal(success.status, 200);
  assert.ok(responses.slice(1).every(response => response.status === 401));
  assert.ok(responses.every(response => response.headers.get("cache-control") === PRIVATE_NO_STORE_CACHE_CONTROL));
});
