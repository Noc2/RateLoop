import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { EnvelopeVault, type KeyWrappingProvider, type WrappedDataKey } from "~~/lib/privacy/vault";
import { withZeroizedBytes } from "~~/lib/privacy/zeroize";
import {
  __artifactPrivacyTestUtils,
  readEncryptedArtifact,
  storeEncryptedArtifact,
  storeEncryptedPrivateReviewArtifacts,
} from "~~/lib/tokenless/artifactPrivacy";

const AAD = "customer_artifact:workspace_1:project_1:artifact_1";
const VAULT_CONTEXT = {
  homeRegion: "eu" as const,
  purpose: "paid_eligibility",
  recordId: "eligibility_123",
  tenantId: "workspace_123",
};

function wrappedDataKey(): WrappedDataKey {
  return {
    authTag: null,
    ciphertext: "wrapped",
    keyResource: "test://data-key",
    keyVersion: "test-v1",
    nonce: null,
    provider: "retaining-test",
  };
}

function assertZeroized(bytes: Uint8Array | undefined) {
  assert.ok(bytes, "the provider must retain the exact data-key buffer");
  assert.deepEqual(
    [...bytes],
    Array.from({ length: bytes.byteLength }, () => 0),
  );
}

function retainingProvider(input: {
  failWrap?: boolean;
  unwrappedKey?: Uint8Array;
  onRetain: (key: Uint8Array) => void;
}): KeyWrappingProvider {
  return {
    keyResource: "test://data-key",
    keyVersion: "test-v1",
    provider: "retaining-test",
    async wrap(dataKey) {
      input.onRetain(dataKey);
      if (input.failWrap) throw new Error("simulated wrapping failure");
      return wrappedDataKey();
    },
    async unwrap() {
      const dataKey = input.unwrappedKey ?? Buffer.alloc(32, 19);
      input.onRetain(dataKey);
      return dataKey;
    },
  };
}

function encryptedFixture(dataKey: Uint8Array) {
  const nonce = Buffer.alloc(12, 5);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  cipher.setAAD(Buffer.from(AAD));
  const ciphertext = Buffer.concat([cipher.update("confidential"), cipher.final()]);
  return {
    contentAuthTag: cipher.getAuthTag().toString("base64url"),
    contentNonce: nonce.toString("base64url"),
    ciphertext,
  };
}

test("the shared data-key guard zeroizes retained buffers on success and failure", async () => {
  for (const fail of [false, true]) {
    const retained = Buffer.alloc(32, 7);
    const operation = withZeroizedBytes(retained, () => {
      if (fail) throw new Error("simulated operation failure");
      return "complete";
    });
    if (fail) await assert.rejects(operation, /simulated operation failure/u);
    else assert.equal(await operation, "complete");
    assertZeroized(retained);
  }
});

test("artifact store and batch encryption zeroize a provider-retained key after wrap success and failure", async () => {
  for (const failWrap of [false, true]) {
    let retained: Uint8Array | undefined;
    const operation = __artifactPrivacyTestUtils.encryptAndWrapArtifact({
      aad: AAD,
      bytes: new TextEncoder().encode("confidential"),
      keyProvider: retainingProvider({ failWrap, onRetain: key => (retained = key) }),
      keyVersion: "test-v1",
    });
    if (failWrap) await assert.rejects(operation, /simulated wrapping failure/u);
    else await operation;
    assertZeroized(retained);
  }
});

test("artifact reads zeroize a provider-retained unwrapped key after decrypt success and failure", async () => {
  for (const corruptTag of [false, true]) {
    let retained: Uint8Array | undefined;
    const fixtureKey = Buffer.alloc(32, 19);
    const fixture = encryptedFixture(fixtureKey);
    const operation = __artifactPrivacyTestUtils.unwrapAndDecryptArtifact({
      aad: AAD,
      ...fixture,
      contentAuthTag: corruptTag ? Buffer.alloc(16).toString("base64url") : fixture.contentAuthTag,
      keyProvider: retainingProvider({
        onRetain: key => (retained = key),
        unwrappedKey: Buffer.from(fixtureKey),
      }),
      wrappedDataKey: wrappedDataKey(),
    });
    if (corruptTag) await assert.rejects(operation);
    else assert.equal(new TextDecoder().decode(await operation), "confidential");
    assertZeroized(retained);
  }
});

test("envelope sealing zeroizes a provider-retained key after wrap success and failure", async () => {
  for (const failWrap of [false, true]) {
    let retained: Uint8Array | undefined;
    const vault = new EnvelopeVault(retainingProvider({ failWrap, onRetain: key => (retained = key) }));
    const operation = vault.seal(new TextEncoder().encode("confidential"), VAULT_CONTEXT);
    if (failWrap) await assert.rejects(operation, /simulated wrapping failure/u);
    else await operation;
    assertZeroized(retained);
  }
});

test("all audited artifact consumers delegate data-key handling to the tested guards", () => {
  assert.match(storeEncryptedArtifact.toString(), /encryptAndWrapArtifact/u);
  assert.match(storeEncryptedPrivateReviewArtifacts.toString(), /encryptAndWrapArtifact/u);
  assert.match(readEncryptedArtifact.toString(), /unwrapAndDecryptArtifact/u);
  for (const consumer of [storeEncryptedArtifact, storeEncryptedPrivateReviewArtifacts, readEncryptedArtifact]) {
    assert.doesNotMatch(consumer.toString(), /dataKey\.fill\(0\)/u);
  }
});
