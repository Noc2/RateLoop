function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type HeaderSource = Headers | Record<string, string> | Array<{ name: string; value: string }>;

function getHeaderValue(headers: HeaderSource, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    return headers.find(header => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? null;
}

function getSetCookieValues(headers: HeaderSource): string[] {
  if (Array.isArray(headers)) {
    return headers.filter(header => header.name.toLowerCase() === "set-cookie").map(header => header.value);
  }

  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
  if (values.length > 0) return values;

  const combined = getHeaderValue(headers, "set-cookie");
  return combined ? [combined] : [];
}

export function getNamedSetCookie(headers: HeaderSource, cookieName: string): string | undefined {
  const cookiePattern = new RegExp(`(?:^|[,\\n]\\s*)${escapeRegExp(cookieName)}=([^;]+)`);

  for (const value of getSetCookieValues(headers)) {
    const match = value.match(cookiePattern);
    if (match?.[1]) {
      return `${cookieName}=${match[1]}`;
    }
  }

  return undefined;
}
