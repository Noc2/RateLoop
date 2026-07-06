export function getUnsupportedContentActionScopeMessage(
  item: { chainId?: number | null } | null | undefined,
  targetNetwork: { id: number; name: string },
) {
  const chainId = typeof item?.chainId === "number" && Number.isSafeInteger(item.chainId) ? item.chainId : null;
  if (!chainId || chainId === targetNetwork.id) return null;
  return `This content belongs to chain ${chainId}; actions are only available on ${targetNetwork.name}.`;
}
