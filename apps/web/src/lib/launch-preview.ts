import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "siumora_store_preview";
export const PREVIEW_TTL_SECONDS = 60 * 60 * 12;

function key(password: string): Buffer {
  return createHash("sha256").update(`siumora-preview-v1\0${password}`).digest();
}

export function previewPasswordIsConfigured(password: string | undefined): password is string {
  return typeof password === "string" && password.length >= 12;
}

export function passwordMatches(candidate: string, password: string): boolean {
  const supplied = createHash("sha256").update(candidate).digest();
  const expected = createHash("sha256").update(password).digest();
  return timingSafeEqual(supplied, expected);
}

export function issuePreviewCookie(password: string, now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + PREVIEW_TTL_SECONDS;
  const payload = `v1.${expiry}`;
  const signature = createHmac("sha256", key(password)).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function validPreviewCookie(value: string | undefined, password: string | undefined, now = Date.now()): boolean {
  if (!value || !previewPasswordIsConfigured(password)) return false;
  const match = /^v1\.(\d{10})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return false;
  const expiry = Number(match[1]);
  const current = Math.floor(now / 1000);
  if (expiry <= current || expiry > current + PREVIEW_TTL_SECONDS) return false;
  const expected = createHmac("sha256", key(password)).update(`v1.${expiry}`).digest();
  return timingSafeEqual(Buffer.from(match[2]!, "hex"), expected);
}

export function publicDuringLaunch(pathname: string): boolean {
  return pathname === "/coming-soon" || pathname === "/privacy" ||
    pathname === "/api/waitlist" || pathname === "/api/preview" ||
    pathname === "/robots.txt" || pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" || pathname === "/opengraph-image" ||
    pathname === "/favicon.ico" || pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/");
}
