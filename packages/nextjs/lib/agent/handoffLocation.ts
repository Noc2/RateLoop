type HandoffLocationLike = {
  hash: string;
  pathname: string;
  search: string;
};

function stripPrefix(value: string, prefix: string) {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function readParamToken(value: string, prefix: string) {
  const params = new URLSearchParams(stripPrefix(value, prefix));
  return params.get("token")?.trim() ?? "";
}

export function readHandoffTokenFromLocation(location: Pick<HandoffLocationLike, "hash" | "search"> | null) {
  if (!location) return "";

  const fromHash = readParamToken(location.hash, "#");
  if (fromHash) return fromHash;

  return readParamToken(location.search, "?");
}

export function buildCleanHandoffLocationPath(location: HandoffLocationLike) {
  const searchParams = new URLSearchParams(stripPrefix(location.search, "?"));
  const hasTokenInQuery = searchParams.has("token");
  searchParams.delete("token");

  let nextHash = location.hash;
  const hashParams = new URLSearchParams(stripPrefix(location.hash, "#"));
  const hasTokenInHash = hashParams.has("token");
  if (hasTokenInHash) {
    hashParams.delete("token");
    const nextHashParams = hashParams.toString();
    nextHash = nextHashParams ? `#${nextHashParams}` : "";
  }

  if (!hasTokenInQuery && !hasTokenInHash) return null;

  const nextSearchParams = searchParams.toString();
  return `${location.pathname}${nextSearchParams ? `?${nextSearchParams}` : ""}${nextHash}`;
}
