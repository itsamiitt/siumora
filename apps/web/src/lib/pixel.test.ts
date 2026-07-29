import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldLoadPixel } from "./pixel.ts";

/**
 * The consent gate for the Pixel (eng review 8A). The idle gate is a browser
 * concern exercised by the E2E pass; the consent decision is the part that
 * must never be wrong, so it is pure and pinned here.
 */

const granted = "granted" as const;
const denied = "denied" as const;

test("the pixel loads only on ads consent", () => {
  assert.equal(
    shouldLoadPixel({
      analytics_storage: granted,
      ad_storage: granted,
      ad_user_data: granted,
      ad_personalization: granted,
    }),
    true,
  );

  // Analytics consent alone is not ads consent.
  assert.equal(
    shouldLoadPixel({
      analytics_storage: granted,
      ad_storage: denied,
      ad_user_data: denied,
      ad_personalization: denied,
    }),
    false,
  );

  assert.equal(
    shouldLoadPixel({
      analytics_storage: denied,
      ad_storage: denied,
      ad_user_data: denied,
      ad_personalization: denied,
    }),
    false,
  );
});
