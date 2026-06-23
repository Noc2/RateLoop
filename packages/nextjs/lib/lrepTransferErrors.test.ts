import assert from "node:assert/strict";
import test from "node:test";
import { getLrepTransferErrorMessage } from "~~/lib/lrepTransferErrors";

test("getLrepTransferErrorMessage explains sponsored LREP transfer denials", () => {
  const message = getLrepTransferErrorMessage(
    new Error('Error executing 7702 transaction: {"reason":"Transaction not sponsored."}'),
    "ETH",
  );

  assert.equal(message, "LREP transfers are not sponsored. Add some ETH for gas, then retry.");
});

test("getLrepTransferErrorMessage keeps unrelated wallet errors intact", () => {
  assert.equal(getLrepTransferErrorMessage(new Error("User rejected the request.")), "User rejected the request.");
});
