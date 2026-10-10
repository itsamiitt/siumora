import { expect, test, type Page } from "@playwright/test";

/**
 * Phone sign-in, as a person does it (auth plan phase 1): number, code,
 * signed in; a wrong code; the lockout after too many wrong codes; the
 * resend countdown; sign out, and — on the Medusa backend, the only one with
 * device sessions — sign out everywhere.
 *
 * The E2E stack runs with OTP_ECHO=true and no message sender, so the form
 * shows the code under its "No message sender connected" notice; the tests
 * read it from there exactly as a developer would. Each test signs in a
 * different number: the per-number resend cooldown is real here too.
 */

const backend = process.env.E2E_BACKEND ?? "fastify";

async function acceptConsent(page: Page) {
  const accept = page.getByRole("button", { name: "Accept" });
  if (await accept.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await accept.click();
  }
}

async function requestCode(page: Page, phone: string): Promise<string> {
  await page.goto("/signin");
  await acceptConsent(page);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const notice = page.getByText(/This environment shows the code instead/);
  await expect(notice).toBeVisible();
  const text = (await notice.textContent()) ?? "";
  const code = /(\d{6})/.exec(text)?.[1];
  if (!code) throw new Error(`no echoed code in: ${text}`);
  return code;
}

test("a shopper signs in with the code and lands on their account", async ({ page }) => {
  const code = await requestCode(page, "9811100001");
  // The code field submits itself once all six digits are in.
  await page.getByLabel("Enter the code").fill(code);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(/Signed in as 98/)).toBeVisible();
});

test("a wrong code says so, keeps the form, and the right one still works", async ({ page }) => {
  const code = await requestCode(page, "9811100002");
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel("Enter the code").fill(wrong);
  await expect(page.getByRole("alert")).toContainText(/not right/i);
  await page.getByLabel("Enter the code").fill(code);
  await expect(page).toHaveURL(/\/account$/);
});

test("too many wrong codes lock the code; a fresh one is needed", async ({ page }) => {
  const code = await requestCode(page, "9811100003");
  const wrong = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByLabel("Enter the code").fill(wrong);
    await expect(page.getByRole("alert")).toBeVisible();
  }
  await page.getByLabel("Enter the code").fill(code);
  await expect(page.getByRole("alert")).toContainText(/expired|new one/i);
  await expect(page).toHaveURL(/\/signin/);
});

test("resend counts down before it can be pressed", async ({ page }) => {
  await requestCode(page, "9811100004");
  const resend = page.getByRole("button", { name: /Resend in \d+s/ });
  await expect(resend).toBeVisible();
  await expect(resend).toBeDisabled();
});

test("sign out returns the shopper to the signed-out account page", async ({ page }) => {
  const code = await requestCode(page, "9811100005");
  await page.getByLabel("Enter the code").fill(code);
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page.getByText(/Sign in with your mobile number/)).toBeVisible();
});

test("sign out everywhere ends the session from the security page", async ({ page }) => {
  test.skip(backend !== "medusa", "device sessions exist only on the Medusa backend");

  const code = await requestCode(page, "9811100006");
  await page.getByLabel("Enter the code").fill(code);
  await expect(page).toHaveURL(/\/account$/);

  await page.goto("/account/security");
  await expect(page.getByText(/This device/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await page.getByRole("button", { name: /Yes, sign out everywhere/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page.getByText(/Sign in with your mobile number/)).toBeVisible();
});
