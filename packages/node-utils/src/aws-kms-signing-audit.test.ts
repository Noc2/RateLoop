import assert from "node:assert/strict";
import test from "node:test";
import {
  EvmKmsSigningError,
  awsKmsRequestId,
  classifyEvmKmsSigningFailure,
  normalizeEvmKmsSigningError,
} from "./aws-kms-signing-audit";

test("shared KMS signing taxonomy distinguishes retryable incidents from operator action", () => {
  assert.equal(
    classifyEvmKmsSigningFailure(
      Object.assign(new Error(), { name: "AbortError" }),
    ),
    "timeout",
  );
  assert.equal(
    classifyEvmKmsSigningFailure(
      Object.assign(new Error(), { name: "ThrottlingException" }),
    ),
    "throttling",
  );
  assert.equal(
    classifyEvmKmsSigningFailure(
      Object.assign(new Error(), { name: "AccessDeniedException" }),
    ),
    "access_or_key_configuration",
  );
  assert.equal(
    classifyEvmKmsSigningFailure(new Error("network unavailable")),
    "outage",
  );

  const access = normalizeEvmKmsSigningError(
    Object.assign(new Error(), { name: "NotFoundException" }),
  );
  assert.equal(access.retryable, false);
  const outage = normalizeEvmKmsSigningError(new Error("connection reset"));
  assert.equal(outage.retryable, true);
});

test("shared KMS signing errors carry AWS request identity without exposing provider messages", () => {
  const providerError = Object.assign(
    new Error("secret-bearing provider detail"),
    {
      name: "ThrottlingException",
      $metadata: { requestId: "aws-request-123" },
    },
  );
  assert.equal(awsKmsRequestId(providerError), "aws-request-123");
  const normalized = normalizeEvmKmsSigningError(providerError);
  assert.equal(normalized.awsRequestId, "aws-request-123");
  assert.equal(normalized.message, "Managed EVM signer is unavailable.");

  const malformed = new EvmKmsSigningError(
    "Managed EVM signer returned an invalid response.",
    "malformed_response_or_recovery",
  );
  assert.equal(malformed.retryable, false);

  const enriched = normalizeEvmKmsSigningError(malformed, {
    awsRequestId: "aws-request-recovery",
  });
  assert.equal(enriched.errorClass, "malformed_response_or_recovery");
  assert.equal(enriched.awsRequestId, "aws-request-recovery");
});
