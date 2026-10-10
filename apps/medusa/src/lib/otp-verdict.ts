import type { PhoneOtpAuthenticationResponse } from "../modules/phone-auth/service";

/**
 * A failed code check, as the HTTP answer the Fastify /auth/verify gives:
 * 401 wrong_code (retryable, with attempts left), 410 code_unusable
 * (expired, consumed, locked, never issued — deliberately one answer), 400
 * for malformed input. Shared by sign-in, step-up and the Google link.
 */
export function otpFailure(result: PhoneOtpAuthenticationResponse): {
  status: number;
  body: Record<string, unknown>;
} {
  switch (result.errorCode) {
    case "wrong_code":
      return {
        status: 401,
        body: {
          error: "wrong_code",
          message: result.error ?? "That code is not right.",
          ...(result.attemptsRemaining !== undefined
            ? { attemptsRemaining: result.attemptsRemaining }
            : {}),
        },
      };
    case "code_unusable":
      return {
        status: 410,
        body: { error: "code_unusable", message: result.error ?? "That code has expired. Ask for a new one." },
      };
    case "invalid_phone":
    case "invalid_code":
      return { status: 400, body: { error: result.errorCode, message: result.error } };
    default:
      return { status: 400, body: { error: "auth_error", message: result.error ?? "Could not verify that code." } };
  }
}
