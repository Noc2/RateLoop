import { shouldInspectReservedVoucher } from "./publicSubmissionReceipt";
import assert from "node:assert/strict";
import test from "node:test";

test("a local success receipt suppresses the reserved-voucher recovery lookup", () => {
  assert.equal(shouldInspectReservedVoucher({ alreadyVouchered: true, hasLocalReceipt: true }), false);
  assert.equal(shouldInspectReservedVoucher({ alreadyVouchered: true, hasLocalReceipt: false }), true);
  assert.equal(shouldInspectReservedVoucher({ alreadyVouchered: false, hasLocalReceipt: false }), false);
});
