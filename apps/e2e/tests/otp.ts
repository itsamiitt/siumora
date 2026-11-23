import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Shared phone-code helpers for the browser suites.
 *
 * The E2E stack runs with OTP_ECHO=true and no message sender, so the sign-in
 * form shows the code under its "No message sender connected" notice. These
 * helpers read it from there exactly as a developer would.
 */

/**
 * A number of its own for every retry. The OTP route keeps a real per-number
 * resend cooldown, so a retry that asks for a code on the number the failed
 * attempt just used is refused ("Wait 44s…") and can never pass. Shifting one
 * middle digit by the retry count keeps every test's numbers distinct.
 */
export function phoneFor(base: string, testInfo: TestInfo): string {
  if (testInfo.retry === 0) return base;
  const digit = (Number(base[4]) + testInfo.retry) % 10;
  return `${base.slice(0, 4)}${digit}${base.slice(5)}`;
}

/** Waits for the echoed code and returns its six digits. */
export async function readEchoedCode(page: Page): Promise<string> {
  const notice = page.getByText(/This environment shows the code instead/);
  await expect(notice).toBeVisible();
  const text = (await notice.textContent()) ?? "";
  const code = /(\d{6})/.exec(text)?.[1];
  if (!code) throw new Error(`no echoed code in: ${text}`);
  return code;
}

/**
 * The sign-in form's own error line. A bare getByRole("alert") also matches
 * Next.js's route announcer (`#__next-route-announcer__`, role="alert"), and
 * Playwright's strict mode refuses the ambiguity.
 */
export function formAlert(page: Page): Locator {
  return page.locator("p[role=alert]");
}
