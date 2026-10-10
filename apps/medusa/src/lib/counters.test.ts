import assert from "node:assert/strict";
import { test } from "node:test";

import { COUNTER_KEY_PREFIX, createMemoryCounters, createRedisCounters, underCap } from "./counters.ts";
import type { RedisEvalClient } from "./rate-limit.ts";

test("a cap admits up to its limit in a window, then refuses until it rolls", async () => {
  const counters = createMemoryCounters();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await underCap(counters, "otp:ip:1.2.3.0/24", 3, 60_000, t0)).allowed, true);
  }
  const refused = await underCap(counters, "otp:ip:1.2.3.0/24", 3, 60_000, t0 + 1_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 59);
  assert.equal((await underCap(counters, "otp:ip:1.2.3.0/24", 3, 60_000, t0 + 60_000)).allowed, true);
});

test("a zero cap refuses the first hit — SMS off means off", async () => {
  assert.equal((await underCap(createMemoryCounters(), "otp:sms:day", 0, 86_400_000)).allowed, false);
});

test("Redis counts under a namespaced key and falls back when it is down", async () => {
  const seen: string[] = [];
  const up: RedisEvalClient = {
    async eval(_script, _n, key) {
      seen.push(String(key));
      return [4, 30_000];
    },
  };
  const hit = await createRedisCounters(up).hit("otp:phone:abc", 60_000, 0);
  assert.deepEqual(hit, { count: 4, resetAt: 30_000 });
  assert.deepEqual(seen, [`${COUNTER_KEY_PREFIX}otp:phone:abc`]);

  let faults = 0;
  const down: RedisEvalClient = {
    async eval() {
      throw new Error("ECONNREFUSED");
    },
  };
  const counters = createRedisCounters(down, { onError: () => (faults += 1) });
  assert.equal((await counters.hit("k", 60_000, 0)).count, 1);
  assert.equal((await counters.hit("k", 60_000, 0)).count, 2);
  assert.equal(faults, 2);
});
