/**
 * Resolves the public "Book demo" destination.
 *
 * The value is an external scheduler booking page (a Google Calendar appointment schedule today).
 * It is deliberately a plain link rather than an embed: an embedded scheduler would need its origin
 * added to the Content Security Policy and would load third-party storage on page view, which would
 * contradict the cookie notice's statement that RateLoop places no non-essential storage.
 *
 * An unset or malformed value resolves to null so the caller can fall back to the existing mailto,
 * which keeps an unconfigured environment working rather than rendering a dead control.
 */
export function resolveDemoBookingUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.TOKENLESS_DEMO_BOOKING_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  // A booking link is handed to prospects from a public page; credentials in the URL would be
  // copied into referrer logs and bookmarks.
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}
