export function shouldInspectReservedVoucher(input: { alreadyVouchered: boolean; hasLocalReceipt: boolean }) {
  return input.alreadyVouchered && !input.hasLocalReceipt;
}
