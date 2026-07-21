const MIME_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

function splitParameters(value: string) {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  let quoted = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      current += character;
      quoted = !quoted;
      continue;
    }
    if (character === ";" && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (quoted || escaped) return null;
  parts.push(current.trim());
  return parts;
}

function validParameterValue(value: string) {
  if (MIME_TOKEN_PATTERN.test(value)) return true;
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2)
    return false;
  const inner = value.slice(1, -1);
  let escaped = false;
  for (const character of inner) {
    const code = character.charCodeAt(0);
    if (escaped) {
      if (code === 9 || (code >= 32 && code <= 126)) {
        escaped = false;
        continue;
      }
      return false;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || code === 127 || (code < 32 && code !== 9))
      return false;
  }
  return !escaped;
}

/**
 * Validates a MIME content type and returns its canonical media type without
 * optional parameters. Artifact rendering and policy decisions intentionally
 * depend on the media type, while transport hints such as `charset` do not.
 */
export function normalizeMimeContentType(value: string) {
  const parts = splitParameters(value.trim());
  if (!parts?.length || !parts[0]) return null;
  const mediaTypeParts = parts[0].split("/");
  if (
    mediaTypeParts.length !== 2 ||
    !MIME_TOKEN_PATTERN.test(mediaTypeParts[0]!) ||
    !MIME_TOKEN_PATTERN.test(mediaTypeParts[1]!)
  ) {
    return null;
  }
  const parameterNames = new Set<string>();
  for (const parameter of parts.slice(1)) {
    const separator = parameter.indexOf("=");
    if (separator <= 0) return null;
    const name = parameter.slice(0, separator).trim().toLowerCase();
    const parameterValue = parameter.slice(separator + 1).trim();
    if (
      !MIME_TOKEN_PATTERN.test(name) ||
      !validParameterValue(parameterValue) ||
      parameterNames.has(name)
    ) {
      return null;
    }
    parameterNames.add(name);
  }
  return `${mediaTypeParts[0]!.toLowerCase()}/${mediaTypeParts[1]!.toLowerCase()}`;
}
