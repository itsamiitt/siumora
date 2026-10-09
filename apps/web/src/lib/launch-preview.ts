import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "siumora_store_preview";
export const PREVIEW_TTL_SECONDS = 60 * 60 * 12;

function key(password: string, secret: string): Buffer {
  // The PIN is deliberately short. A separate server secret prevents cookie
  // forgery by enumerating all 10,000 possible PINs offline.
  return createHmac("sha256", secret).update(`siumora-preview-v2\0${password}`).digest();
}

export function previewPasswordIsConfigured(password: unknown): password is string {
  return typeof password === "string" && password.length === 4 && /^[0-9]{4}$/.test(password);
}

export function previewSecretIsConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export function passwordMatches(candidate: string, password: string): boolean {
  const supplied = createHash("sha256").update(candidate).digest();
  const expected = createHash("sha256").update(password).digest();
  return timingSafeEqual(supplied, expected);
}

export function issuePreviewCookie(password: string, secret: string, now = Date.now()): string {
  if (!previewPasswordIsConfigured(password) || !previewSecretIsConfigured(secret)) {
    throw new Error("Store preview needs a four-digit PIN and a separate signing secret of at least 32 characters.");
  }
  const expiry = Math.floor(now / 1000) + PREVIEW_TTL_SECONDS;
  const payload = `v2.${expiry}`;
  const signature = createHmac("sha256", key(password, secret)).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function validPreviewCookie(value: string | undefined, password: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!value || !previewPasswordIsConfigured(password) || !previewSecretIsConfigured(secret)) return false;
  const match = /^v2\.(\d{10})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return false;
  const expiry = Number(match[1]);
  const current = Math.floor(now / 1000);
  if (expiry <= current || expiry > current + PREVIEW_TTL_SECONDS) return false;
  const expected = createHmac("sha256", key(password, secret)).update(`v2.${expiry}`).digest();
  return timingSafeEqual(Buffer.from(match[2]!, "hex"), expected);
}

export function publicDuringLaunch(pathname: string): boolean {
  return pathname === "/coming-soon" || pathname === "/privacy" ||
    pathname === "/api/waitlist" || pathname === "/api/preview" ||
    pathname === "/robots.txt" || pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" || pathname === "/opengraph-image" ||
    pathname === "/favicon.ico" || pathname === "/coming-soon/atelier.webp" || pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/");
}
