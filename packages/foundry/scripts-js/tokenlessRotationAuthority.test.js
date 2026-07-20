import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTokenlessRotationAuthority } from "./tokenlessRotationAuthority.js";

const AUTHORITY = "0x1111111111111111111111111111111111111111";
const OWNERS = [
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
];

function client({ bytecode = "0x6000", owners = OWNERS, threshold = 2n, readError } = {}) {
  return {
    async getBytecode() {
      return bytecode;
    },
    async readContract({ functionName }) {
      if (readError) throw readError;
      return functionName === "getOwners" ? owners : threshold;
    },
  };
}

test("rejects an EOA before the deployment account is unlocked", async () => {
  await assert.rejects(
    validateTokenlessRotationAuthority({ client: client({ bytecode: "0x" }), authority: AUTHORITY }),
    /has no deployed bytecode.*appears to be an EOA.*deployed Safe-compatible contract/s,
  );
});

test("rejects contracts without the Safe policy views", async () => {
  await assert.rejects(
    validateTokenlessRotationAuthority({
      client: client({ readError: new Error("execution reverted") }),
      authority: AUTHORITY,
    }),
    /does not expose.*getOwners\(\).*getThreshold\(\)/s,
  );
});

test("rejects insufficient Safe thresholds and owner sets", async () => {
  await assert.rejects(
    validateTokenlessRotationAuthority({ client: client({ threshold: 1n }), authority: AUTHORITY }),
    /threshold 1; the minimum is two/,
  );
  await assert.rejects(
    validateTokenlessRotationAuthority({
      client: client({ owners: OWNERS.slice(0, 2) }),
      authority: AUTHORITY,
    }),
    /has 2 owners and threshold 2/,
  );
});

test("rejects zero and duplicate Safe owners", async () => {
  await assert.rejects(
    validateTokenlessRotationAuthority({
      client: client({ owners: [OWNERS[0], OWNERS[0], OWNERS[2]] }),
      authority: AUTHORITY,
    }),
    /contains a zero or duplicate owner/,
  );
  await assert.rejects(
    validateTokenlessRotationAuthority({
      client: client({ owners: [OWNERS[0], OWNERS[1], "0x0000000000000000000000000000000000000000"] }),
      authority: AUTHORITY,
    }),
    /contains a zero or duplicate owner/,
  );
});

test("accepts a deployed two-of-three Safe-compatible authority", async () => {
  assert.deepEqual(
    await validateTokenlessRotationAuthority({ client: client(), authority: AUTHORITY }),
    { authority: AUTHORITY, owners: OWNERS, threshold: 2n },
  );
});
