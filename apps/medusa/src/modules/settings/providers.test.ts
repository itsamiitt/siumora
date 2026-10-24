import assert from "node:assert/strict";
import { test } from "node:test";
import { providerConfiguration, saveProvider } from "./providers.ts";
import { mergeSettings, validateSettingWrite } from "./settings.ts";

function database() {
  const rows: Array<{ key: string; value: unknown }> = [];
  return { rows, async raw(sql: string, bindings?: ReadonlyArray<string | number | boolean | null>) {
    if (sql.startsWith("INSERT")) {
      const row = { key: String(bindings![0]), value: JSON.parse(String(bindings![1])) as unknown };
      const at = rows.findIndex(r => r.key === row.key);
      if (at >= 0) rows[at] = row; else rows.push(row);
      return { rows: [] };
    }
    return { rows: bindings ? rows.filter(r => r.key === bindings[0]) : rows };
  } };
}
const env = { SETTINGS_ENCRYPTION_KEY: "a-test-key-that-is-longer-than-32-characters", RESEND_API_KEY: "env-key", EMAIL_FROM: "store@example.com" };

test("provider secrets round-trip encrypted and never appear in status or general settings", async () => {
  const pg = database();
  await saveProvider(pg, "email", { enabled: true, fields: { RESEND_API_KEY: "private-test-secret" } }, env);
  assert.ok(!JSON.stringify(pg.rows).includes("private-test-secret"));
  const result = await providerConfiguration(pg, env);
  assert.equal(result.effective.RESEND_API_KEY, "private-test-secret");
  assert.equal(result.providers.email.configured, true);
  assert.ok(!JSON.stringify(result.providers).includes("private-test-secret"));
  assert.ok(!JSON.stringify(mergeSettings(pg.rows)).includes("private-test-secret"));
});

test("channel disable removes credentials at runtime and re-enable preserves them", async () => {
  const pg = database();
  await saveProvider(pg, "email", { enabled: false, fields: {} }, env);
  assert.equal((await providerConfiguration(pg, env)).effective.RESEND_API_KEY, undefined);
  await saveProvider(pg, "email", { enabled: true, fields: {} }, env);
  assert.equal((await providerConfiguration(pg, env)).effective.RESEND_API_KEY, "env-key");
});

test("wrong encryption key disables the affected channel instead of falling back to env", async () => {
  const pg = database();
  await saveProvider(pg, "email", { enabled: true, fields: {} }, env);
  const result = await providerConfiguration(pg, { ...env, SETTINGS_ENCRYPTION_KEY: "a-different-key-longer-than-32-characters" });
  assert.equal(result.effective.RESEND_API_KEY, undefined);
  assert.match(result.providers.email.error!, /Cannot decrypt/);
});

test("writes reject unsupported fields, unsafe endpoints, and missing encryption keys", async () => {
  const pg = database();
  await assert.rejects(saveProvider(pg, "sms", { enabled: true, fields: { arbitrary: "secret" } }, env), /Invalid/);
  await assert.rejects(saveProvider(pg, "whatsapp", { enabled: true, fields: { WHATSAPP_BSP_URL: "http://example.com" } }, env), /HTTPS/);
  await assert.rejects(saveProvider(pg, "email", { enabled: true, fields: {} }, {}), /SETTINGS_ENCRYPTION_KEY/);
  assert.equal(pg.rows.length, 0);
  assert.equal(validateSettingWrite("constructor", {}).ok, false);
});
