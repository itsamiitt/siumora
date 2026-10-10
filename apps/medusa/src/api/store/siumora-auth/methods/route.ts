/**
 * GET /store/siumora-auth/methods — which sign-in methods the storefront
 * should offer (auth plan phase 4). Phone is always on. Google is on only
 * when the server has its credentials AND the owner switched it on, and
 * `googlePercent` is the share of shoppers the storefront shows it to —
 * the A/B arm against phone-only, judged on checkout completion.
 *
 * A separate route from /store/siumora/config on purpose: that envelope's
 * keys are pinned by the recorded SDK contract.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { pgOf } from "../../../../lib/customer-signin";
import { settingsCache } from "../../../../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../../../../modules/settings/read";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const settings = await settingsCache(() =>
    readSettings(pgOf(req) as unknown as SettingsSqlClient),
  ).get();
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  // Short cache: a lever flip shows within a minute, a page view costs nothing.
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    phone: true,
    google: configured && settings.googleSignInEnabled,
    googlePercent: settings.googleSignInPercent,
  });
}
