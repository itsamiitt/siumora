import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "@siumora/db";

import { buildApp, type App } from "./app.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";

const dbUrl = process.env.DATABASE_URL;
const dbTest = dbUrl ? test : test.skip;
let database: TestDatabase | undefined;
let app: App;

before(async () => {
  if (!dbUrl) return;
  database = await createTestDatabase("waitlist");
  app = await buildApp({ connectionString: database!.url, adminPhones: "9000000001", otpEcho: true,
    rateLimiter: createRateLimiter([]) });
});

after(async () => {
  if (!database) return;
  await app.server.close();
  await app.pool.end();
  await database.drop();
});

dbTest("waitlist validates, deduplicates, and requires an operator to read", async () => {
  const invalid = await app.server.inject({ method: "POST", url: "/waitlist",
    payload: { name: "   ", email: "bad" } });
  assert.equal(invalid.statusCode, 400);

  const first = await app.server.inject({ method: "POST", url: "/waitlist",
    payload: { name: "Asha", email: "ASHA@example.com" } });
  const duplicate = await app.server.inject({ method: "POST", url: "/waitlist",
    payload: { name: "Different", email: "asha@example.com" } });
  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(JSON.parse(first.body), JSON.parse(duplicate.body));

  const anonymous = await app.server.inject({ method: "GET", url: "/admin/waitlist" });
  assert.equal(anonymous.statusCode, 401);

  const issued = await app.server.inject({ method: "POST", url: "/auth/otp", payload: { phone: "9000000001" } });
  const code = JSON.parse(issued.body).code as string;
  const verified = await app.server.inject({ method: "POST", url: "/auth/verify",
    payload: { phone: "9000000001", code } });
  const token = JSON.parse(verified.body).token as string;
  const list = await app.server.inject({ method: "GET", url: "/admin/waitlist",
    headers: { authorization: `Bearer ${token}` } });
  assert.equal(list.statusCode, 200);
  const entries = JSON.parse(list.body).entries as Array<{ name: string; email: string }>;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, "Asha");
  assert.equal(entries[0]?.email, "asha@example.com");
});
