import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { desc, schema } from "@siumora/db";

import { requirePermission } from "../lib/auth.ts";

const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
}).strict();

export async function registerWaitlistRoutes(server: FastifyInstance) {
  server.post("/waitlist", async (request, reply) => {
    const input = signupSchema.parse(request.body);
    // An existing subscriber receives the same answer. The unique index handles
    // concurrent submissions without overwriting the first name they gave us.
    await server.db.insert(schema.waitlistEntries).values(input).onConflictDoNothing();
    reply.header("Cache-Control", "no-store");
    return { ok: true, message: "You're on the list. We'll be in touch when Siumora opens." };
  });

  server.get("/admin/waitlist", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "audit:read");
    if (!viewer) return;
    const { page } = z.object({ page: z.coerce.number().int().min(0).max(100000).default(0) }).parse(request.query);
    const pageSize = 50;

    const rows = await server.db.select({
      id: schema.waitlistEntries.id,
      name: schema.waitlistEntries.name,
      email: schema.waitlistEntries.email,
      createdAt: schema.waitlistEntries.createdAt,
    }).from(schema.waitlistEntries).orderBy(desc(schema.waitlistEntries.createdAt), desc(schema.waitlistEntries.id))
      .limit(pageSize + 1).offset(page * pageSize);

    reply.header("Cache-Control", "private, no-store");
    return { entries: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page };
  });
}
