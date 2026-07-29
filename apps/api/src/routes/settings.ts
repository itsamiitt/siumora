import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { updateSetting } from "@siumora/db";

import { audit, requirePermission } from "../lib/auth.ts";

/**
 * Runtime settings (eng review 5A).
 *
 * `/config` is the public face: the storefront reads it per request to decide
 * whether checkout is open, so it must never be cached by anything between
 * the API and the page — a kill-switch behind a CDN TTL is not a kill-switch.
 *
 * The admin surface is owner-only. These four values stop revenue or move
 * money exposure; they are levers, not preferences.
 */
export async function registerSettingsRoutes(server: FastifyInstance): Promise<void> {
  server.get("/config", async (_request, reply) => {
    const settings = await server.settings.get();
    reply.header("Cache-Control", "no-store");
    return { paymentsEnabled: settings.paymentsEnabled };
  });

  server.get("/admin/settings", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "settings:write");
    if (!viewer) return;

    return { settings: await server.settings.get() };
  });

  const patchSchema = z.object({
    key: z.string(),
    value: z.unknown(),
  });

  server.patch("/admin/settings", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "settings:write");
    if (!viewer) return;

    const body = patchSchema.parse(request.body);
    const result = await updateSetting(server.db, body.key, body.value);
    if (!result.ok) {
      return reply.code(400).send({ error: "invalid_setting", message: result.error });
    }

    // The write is done; make this instance see it immediately. The audit
    // entry records the lever and who pulled it — a kill-switch flip during an
    // incident is exactly the sort of action someone reconstructs later.
    server.settings.invalidate();
    await audit(request, viewer, "settings.update", {
      subject: body.key,
      detail: { value: body.value },
    });

    return { settings: result.settings };
  });
}
