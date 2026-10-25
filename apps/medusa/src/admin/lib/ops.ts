/**
 * Fetch helper for the Siumora ops surfaces inside the Admin dashboard.
 *
 * Plain fetch with credentials: the dashboard holds a Medusa user session
 * cookie, and the /admin/siumora routes authenticate it through the
 * dual-actor middleware (src/api/middlewares.ts). Errors surface as thrown
 * OpsError carrying the route's { error, message } envelope — and its
 * `errors` list when a route names several problems (a pincode file) — so
 * pages can render the refusal wording the API chose.
 */

export class OpsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: string[];

  constructor(status: number, code: string, message: string, errors?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    if (errors) this.errors = errors;
  }
}

export async function opsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errors = Array.isArray(body.errors)
      ? body.errors.filter((line): line is string => typeof line === "string")
      : undefined;
    throw new OpsError(
      response.status,
      typeof body.error === "string" ? body.error : "error",
      typeof body.message === "string" ? body.message : `Request failed (${response.status})`,
      errors,
    );
  }
  return body as T;
}
