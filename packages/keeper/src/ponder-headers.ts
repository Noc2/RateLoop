export function buildPonderRequestHeaders(): Record<string, string> {
  const token = process.env.PONDER_KEEPER_WORK_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}
