const JSON_RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu;

export function parseJsonRpcQuantityNumber(value) {
  if (typeof value !== "string" || !JSON_RPC_QUANTITY_PATTERN.test(value)) {
    return null;
  }

  const parsed = BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}
