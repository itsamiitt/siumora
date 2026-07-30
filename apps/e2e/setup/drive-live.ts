import { chromium } from "@playwright/test";

/**
 * Drive the live dev servers (localhost:3000/4000) and save screenshots —
 * a look-see harness for /run, not a test. Walks the real buying path.
 */

const OUT = process.env.SHOT_DIR ?? ".";
const BASE = "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function shot(name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`[shot] ${name}`);
}

await page.goto(BASE, { waitUntil: "networkidle" });
const accept = page.getByRole("button", { name: "Accept" });
if (await accept.isVisible({ timeout: 3000 }).catch(() => false)) {
  await accept.click();
}
await shot("1-home");

await page.goto(`${BASE}/products/petal-studs`, { waitUntil: "networkidle" });
await shot("2-pdp");

await page.getByRole("button", { name: "Add to bag" }).first().click();
await page
  .getByText("Added to bag")
  .waitFor({ timeout: 15000 })
  .catch(() => console.log("[warn] add confirmation not seen"));
await page.goto(`${BASE}/cart`, { waitUntil: "networkidle" });
await shot("3-cart");

await page.getByRole("link", { name: "Checkout" }).click();
await page.locator("#name").fill("Asha Menon");
await page.locator("#phone").fill("9876543210");
await page.locator("#pincode").fill("400001");
await page.locator("#city").fill("Mumbai");
await page.locator("#state").selectOption("27");
await page.locator("#address").fill("Flat 3B, Sunrise Apartments, Linking Road");
await page
  .getByText("Cash on delivery")
  .waitFor({ timeout: 15000 })
  .catch(() => {});
await shot("4-checkout");

await browser.close();
console.log("done");
