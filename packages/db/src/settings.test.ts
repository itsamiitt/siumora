import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createDb, createPool, type Database } from "./client.ts";
import { migrate } from "./migrate.ts";
import {
  SETTING_DEFAULTS,
  readSettings,
  updateSetting,
} from "./settings-repository.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

const url = process.env.DATABASE_URL;
const dbTest = url ? test : test.skip;

let testDb: TestDatabase | undefined;
let pool: ReturnType<typeof createPool>;
let db: Database;

before(async () => {
  if (!url) return;
  testDb = await createTestDatabase("settings");
  pool = createPool({ connectionString: testDb!.url });
  await migrate(pool);
  db = createDb(pool);
});

beforeEach(async () => {
  if (!url) return;
  await pool.query("DELETE FROM settings");
});

after(async () => {
  if (!pool) return;
  await pool.end();
});

dbTest("an empty table reads as the compiled defaults", async () => {
  assert.deepEqual(await readSettings(db), SETTING_DEFAULTS);
});

dbTest("a write is read back merged over the defaults", async () => {
  const result = await updateSetting(db, "payments_enabled", false);
  assert.equal(result.ok, true);

  const settings = await readSettings(db);
  assert.equal(settings.paymentsEnabled, false);
  // Untouched keys stay at their defaults.
  assert.equal(settings.codMaxOrder, SETTING_DEFAULTS.codMaxOrder);
});

dbTest("writing the same key twice keeps one row and the latest value", async () => {
  await updateSetting(db, "cod_max_order", 300000);
  await updateSetting(db, "cod_max_order", 700000);

  assert.equal((await readSettings(db)).codMaxOrder, 700000);
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM settings WHERE key = 'cod_max_order'",
  );
  assert.equal(rows[0].n, 1);
});

dbTest("refuses an unknown key", async () => {
  const result = await updateSetting(db, "free_money", true);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /unknown setting/);
});

dbTest("refuses a wrong-shaped value", async () => {
  const notBool = await updateSetting(db, "payments_enabled", "yes");
  assert.equal(notBool.ok, false);

  const float = await updateSetting(db, "cod_fee", 49.5);
  assert.equal(float.ok, false);

  const negative = await updateSetting(db, "cod_min_order", -1);
  assert.equal(negative.ok, false);
});

dbTest("refuses a floor above the cap, whichever side moves", async () => {
  const floorUp = await updateSetting(db, "cod_min_order", 600000);
  assert.equal(floorUp.ok, false);
  assert.match(floorUp.ok ? "" : floorUp.error, /must not exceed/);

  const capDown = await updateSetting(db, "cod_max_order", 10000);
  assert.equal(capDown.ok, false);
});

dbTest("a malformed stored value degrades to the default, not a crash", async () => {
  // Written past the validation on purpose — a migration bug or a manual
  // UPDATE is exactly how a bad value would really arrive.
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('cod_max_order', '"lots"'::jsonb)`,
  );

  const settings = await readSettings(db);
  assert.equal(settings.codMaxOrder, SETTING_DEFAULTS.codMaxOrder);
});
