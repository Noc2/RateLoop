import assert from "node:assert/strict";
import test from "node:test";
import { complianceError } from "~~/app/api/_support/complianceRoutes";
import { AdvisoryLockUnavailableError } from "~~/lib/db/advisoryLocks";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

test("compliance routes preserve retryable fail-fast coordination errors", async () => {
  const error = new AdvisoryLockUnavailableError();

  assert.deepEqual(tokenlessErrorResponse(error), {
    body: {
      code: "database_coordination_busy",
      message: "Database coordination is busy. Retry the operation.",
      retryable: true,
    },
    status: 503,
  });

  const response = complianceError(error);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    code: "database_coordination_busy",
    message: "Database coordination is busy. Retry the operation.",
    retryable: true,
  });
});

test("compliance routes preserve service errors without accepting generic failures", async () => {
  const serviceResponse = complianceError(new TokenlessServiceError("Retry later.", 409, "retry_later", true));
  assert.equal(serviceResponse.status, 409);
  assert.deepEqual(await serviceResponse.json(), {
    code: "retry_later",
    message: "Retry later.",
    retryable: true,
  });

  const originalError = console.error;
  console.error = () => undefined;
  try {
    const genericResponse = complianceError(new Error("private database detail"));
    assert.equal(genericResponse.status, 500);
    assert.deepEqual(await genericResponse.json(), {
      code: "internal_error",
      message: "Tokenless API request failed.",
      retryable: false,
    });
  } finally {
    console.error = originalError;
  }
});
