/**
 * Event identity: dedup ids and hashed user identifiers.
 *
 * Two jobs, both load-bearing for ad measurement:
 *
 * 1. `event_id` — the same id goes to the browser pixel and the server event so
 *    Meta collapses them into one conversion ("1 event from 2 sources"). Mint
 *    it once at the source and reuse it across retries; a fresh id per attempt
 *    double-counts revenue.
 * 2. Identifier hashing — ad platforms match on SHA-256 of *normalised* values.
 *    Normalisation is not cosmetic: "+91 98765 43210" and "919876543210" hash
 *    to different digests, and an unnormalised phone simply fails to match,
 *    which shows up as a low Event Match Quality score and worse targeting.
 */

/** Mint a dedup id. One per user action, reused across every send of it. */
export function mintEventId(): string {
  return crypto.randomUUID();
}

/**
 * Normalise an Indian phone number to E.164 without the leading `+`.
 *
 * Meta and Google both expect country code included and no punctuation, e.g.
 * `919876543210`. Returns undefined when the input is not a usable number, so
 * callers send no `ph` rather than a digest of garbage.
 */
export function normalisePhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");

  // Strip a 0 trunk prefix, then accept either a bare 10-digit mobile or one
  // already carrying the 91 country code.
  const local = digits.replace(/^0+/, "");
  if (/^[6-9]\d{9}$/.test(local)) return `91${local}`;
  if (/^91[6-9]\d{9}$/.test(local)) return local;
  return undefined;
}

/** Normalise an email: trim and lowercase. Returns undefined if not an email. */
export function normaliseEmail(raw: string): string | undefined {
  const value = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

/** SHA-256 hex digest. Async because WebCrypto is the only shared primitive. */
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface RawIdentity {
  phone?: string;
  email?: string;
  /** Internal customer id. Hashed before it leaves. */
  customerId?: string;
  /** Meta browser cookies. Sent unhashed — they are already pseudonymous. */
  fbp?: string;
  fbc?: string;
  /** GA4 client id, captured in the browser and stored on the order. */
  gaClientId?: string;
  clientIp?: string;
  userAgent?: string;
}

export interface HashedIdentity {
  ph?: string;
  em?: string;
  external_id?: string;
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

/**
 * Hash an identity for transmission to ad platforms.
 *
 * Only hashed identifiers leave; raw values never appear in a payload. Fields
 * that normalise to nothing are omitted entirely rather than sent empty, which
 * would drag the match rate down.
 */
export async function hashIdentity(raw: RawIdentity): Promise<HashedIdentity> {
  const out: HashedIdentity = {};

  const phone = raw.phone ? normalisePhone(raw.phone) : undefined;
  if (phone) out.ph = await sha256(phone);

  const email = raw.email ? normaliseEmail(raw.email) : undefined;
  if (email) out.em = await sha256(email);

  if (raw.customerId) out.external_id = await sha256(raw.customerId.trim());

  // Cookies and network metadata pass through unhashed by design.
  if (raw.fbp) out.fbp = raw.fbp;
  if (raw.fbc) out.fbc = raw.fbc;
  if (raw.clientIp) out.client_ip_address = raw.clientIp;
  if (raw.userAgent) out.client_user_agent = raw.userAgent;

  return out;
}
