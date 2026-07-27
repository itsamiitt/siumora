/**
 * Postgres error codes, read through whatever wraps them.
 *
 * Drizzle re-throws driver errors wrapped in its own Error, so the SQLSTATE is
 * on `cause` rather than the top level. Checking only the outer error silently
 * misses every constraint violation and turns an expected 409 into a 500.
 */

/** Unique violation — a constraint we rely on, not an unexpected failure. */
export const UNIQUE_VIOLATION = "23505";

/** Check constraint violation. */
export const CHECK_VIOLATION = "23514";

export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  // Bounded, so a cyclic cause chain cannot spin forever.
  for (let depth = 0; depth < 8 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}
