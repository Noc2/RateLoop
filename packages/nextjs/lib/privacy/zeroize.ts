export async function withZeroizedBytes<T>(
  bytes: Uint8Array,
  operation: (bytes: Uint8Array) => Promise<T> | T,
): Promise<T> {
  try {
    return await operation(bytes);
  } finally {
    bytes.fill(0);
  }
}
