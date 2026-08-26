/**
 * Fetch helper for the Siumora ops surfaces inside the Admin dashboard.
 *
 * Plain fetch with credentials: the dashboard holds a Medusa user session
 * cookie, and the /admin/siumora routes authenticate it through the
 * dual-actor middleware (src/api/middlewares.ts). Errors surface as thrown
 * OpsError carrying the route's { error, message } envelope so pages can
 * render the refusal wording the API chose.
 */

export class OpsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function opsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new OpsError(
      response.status,
      typeof body.error === "string" ? body.error : "error",
      typeof body.message === "string" ? body.message : `Request failed (${response.status})`,
    );
  }
  return body as T;
}

/** Integer paise to the rupee string the desks render. */
export function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
