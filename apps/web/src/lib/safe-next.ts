/**
 * Where to send someone after signing in — only ever a path on this site
 * (security review: open redirect). Resolved by the URL parser itself, the
 * same way the browser and NextResponse.redirect will read it, so tricks a
 * prefix check misses (`/\evil.com`, `/%09/evil.com`, tabs and newlines the
 * parser strips) fail here too. Pure, for node --test.
 */
const PROBE_ORIGIN = "https://siumora.invalid";

export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // One more pass for paths that decode into another host.
  return path.startsWith("//") || path.startsWith("/\\") ? fallback : path;
}
