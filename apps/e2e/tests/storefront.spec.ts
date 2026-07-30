import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL } from "../playwright.config.ts";

/**
 * Browser truth (plan 6A). The API integration suite already proves the
 * webhook replay, the authorized-drop capture and the OTP channel matrix;
 * these tests prove what only a browser can — that a person can actually buy
 * something, that the kill-switch reaches the page without a rebuild, and
 * that the purchase event rides the dataLayer exactly once with the shared
 * dedup id.
 */

// Client-side throws end in the error boundary with nothing in any server
// log — surface them in the report or a failure here is unexplainable.
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    console.log(`[pageerror] ${error.message}\n${error.stack ?? ""}`);
  });
});

async function acceptConsent(page: Page) {
  const accept = page.getByRole("button", { name: "Accept" });
  if (await accept.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await accept.click();
    await expect(accept).toBeHidden();
  }
}

/**
 * Add and WAIT for the confirmation line — the add is a server action, and
 * navigating away mid-flight aborts it.
 *
 * Known wart, tracked in TODOS.md: the action's flight stream occasionally
 * dies with "Connection closed." (Next 16 canary + next start on Windows;
 * the pageerror hook above prints it). The action itself has usually landed
 * before the stream drops, so the recovery is exactly what a person does —
 * check the bag, and only retry the add if it is genuinely missing.
 */
async function addToBag(page: Page, productTitle: string) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByRole("button", { name: "Add to bag" }).first().click();

    const outcome = await Promise.race([
      page
        .getByText("Added to bag")
        .waitFor({ timeout: 15_000 })
        .then(() => "added" as const),
      page
        .getByRole("heading", { name: /couldn.t load/ })
        .waitFor({ timeout: 15_000 })
        .then(() => "boundary" as const),
    ]).catch(() => "timeout" as const);

    if (outcome === "added") return;

    console.log(
      `[addToBag] attempt ${attempt}: ${outcome} — action stream dropped; checking the bag like a person would`,
    );
    await page.goto("/cart");
    const inBag = await page
      .getByText(productTitle)
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (inBag) return;

    await page.goBack();
  }
  throw new Error("Add to bag failed twice — not the stream flake, investigate");
}

/**
 * The operator session, minted through the same OTP flow a person uses —
 * once per run: the OTP route carries a real resend cooldown, and a second
 * mint seconds after the first is exactly what it exists to refuse.
 */
let cachedToken: string | undefined;
async function operatorToken(request: APIRequestContext): Promise<string> {
  if (cachedToken) return cachedToken;
  const issued = await request.post(`${API_URL}/auth/otp`, {
    data: { phone: "9000000001" },
  });
  const { code } = (await issued.json()) as { code: string };
  const verified = await request.post(`${API_URL}/auth/verify`, {
    data: { phone: "9000000001", code },
  });
  const { token } = (await verified.json()) as { token: string };
  cachedToken = token;
  return token;
}

async function setPaymentsEnabled(request: APIRequestContext, value: boolean) {
  const token = await operatorToken(request);
  const response = await request.patch(`${API_URL}/admin/settings`, {
    headers: { authorization: `Bearer ${token}` },
    data: { key: "payments_enabled", value },
  });
  expect(response.ok()).toBe(true);
}

test("a person can buy the Petal Studs cash on delivery, end to end", async ({
  page,
}) => {
  await page.goto("/products/petal-studs");
  await acceptConsent(page);

  await addToBag(page, "Petal Studs");
  await page.goto("/cart");
  await page.getByRole("link", { name: "Checkout" }).click();

  await page.locator("#name").fill("Asha Menon");
  await page.locator("#phone").fill("9876543210");
  await page.locator("#pincode").fill("400001");
  await page.locator("#city").fill("Mumbai");
  await page.locator("#state").selectOption("27");
  await page.locator("#address").fill("Flat 3B, Sunrise Apartments, Linking Road");

  // The quote decides the terms before the method is picked — wait for it.
  await expect(page.getByText("Cash on delivery")).toBeVisible();
  await page.getByText("Cash on delivery").click();

  await page.getByRole("button", { name: /Place order/ }).click();
  await page.waitForURL(/\/orders\/SIU-\d{5}/, { timeout: 30_000 });

  const orderNumber = page.url().match(/SIU-\d{5}/)![0];

  // A held COD order self-confirms in this environment — the stand-in for
  // the WhatsApp reply. Either way the page must end on a real state.
  const confirm = page.getByRole("button", { name: "Confirm order" });
  if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirm.click();
  }
  await expect(page.getByText(`Order ${orderNumber}`)).toBeVisible();

  // The purchase rode the dataLayer exactly once, carrying the shared dedup
  // id and the order number — the browser half of the GA4+CAPI dedup pair.
  const purchases = await page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: Array<Record<string, unknown>> })
      .dataLayer;
    return (layer ?? []).filter((entry) => entry.event === "purchase");
  });
  expect(purchases).toHaveLength(1);
  expect(purchases[0]!.transaction_id).toBe(orderNumber);
  expect(typeof purchases[0]!.event_id).toBe("string");
  expect(String(purchases[0]!.event_id).length).toBeGreaterThan(10);
});

test("COD is withheld where the pincode does not serve it", async ({ page }) => {
  await page.goto("/products/kernel-pendant");
  await acceptConsent(page);
  await addToBag(page, "Kernel Pendant");

  await page.goto("/cart");
  await expect(page.getByText("Kernel Pendant").first()).toBeVisible();
  await page.getByRole("link", { name: "Checkout" }).click();

  await page.locator("#phone").fill("9876543210");
  // Guwahati: serviceable, but the pincode table says no COD.
  await page.locator("#pincode").fill("781001");

  // The option exists, says so, and cannot be picked — a money decision made
  // server-side and rendered honestly.
  const cod = page.getByRole("radio", { name: /Cash on delivery/ });
  await expect(cod).toBeDisabled({ timeout: 15_000 });
  await expect(page.getByText("Not available", { exact: false })).toBeVisible();
});

test("the kill-switch pauses checkout live, without a rebuild", async ({
  page,
  request,
}) => {
  await setPaymentsEnabled(request, false);
  try {
    await page.goto("/checkout");
    await expect(page.getByText("Checkout is paused")).toBeVisible();
    // The storefront keeps serving — this is a paused page, not an outage.
    await page.goto("/products/petal-studs");
    await expect(page.getByRole("button", { name: "Add to bag" }).first()).toBeVisible();
  } finally {
    await setPaymentsEnabled(request, true);
  }

  await page.goto("/checkout");
  await expect(page.getByText("Checkout is paused")).toBeHidden();
});
