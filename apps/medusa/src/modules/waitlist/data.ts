import { randomUUID } from "node:crypto";

export interface SqlClient {
  raw(sql: string, bindings: ReadonlyArray<string | number>): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  customerId: string | null;
  orderCount: number;
  latestOrderId: string | null;
}

export function parseSignup(body: unknown): { name: string; email: string } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const input = body as Record<string, unknown>;
  if (typeof input.name !== "string" || typeof input.email !== "string") return;
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  return { name, email };
}

export async function joinWaitlist(pg: SqlClient, input: { name: string; email: string }): Promise<void> {
  await pg.raw(
    `insert into siumora_waitlist_entry (id, name, email, created_at, updated_at)
     values (?, ?, ?, now(), now()) on conflict (email) do nothing`,
    [`siwait_${randomUUID().replaceAll("-", "")}`, input.name, input.email],
  );
}

export async function listWaitlist(pg: SqlClient, page: number, pageSize = 50): Promise<{ entries: WaitlistEntry[]; hasMore: boolean; page: number }> {
  const result = await pg.raw(
    `select w.id, w.name, w.email, w.created_at,
       (select c.id from customer c
        where lower(c.email) = w.email and c.deleted_at is null
        order by c.created_at desc, c.id desc limit 1) as customer_id,
       (select count(*) from "order" o
        where lower(o.email) = w.email and o.deleted_at is null) as order_count,
       (select o.id from "order" o
        where lower(o.email) = w.email and o.deleted_at is null
        order by o.created_at desc, o.id desc limit 1) as latest_order_id
     from siumora_waitlist_entry w
     order by w.created_at desc, w.id desc limit ? offset ?`,
    [pageSize + 1, page * pageSize],
  );
  return {
    entries: result.rows.slice(0, pageSize).map((row) => ({
      id: String(row.id), name: String(row.name), email: String(row.email),
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      customerId: row.customer_id == null ? null : String(row.customer_id),
      orderCount: Number(row.order_count),
      latestOrderId: row.latest_order_id == null ? null : String(row.latest_order_id),
    })),
    hasMore: result.rows.length > pageSize,
    page,
  };
}
