import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FESTIVALS,
  activeFestival,
  daysRemaining,
  istDate,
  type Festival,
} from "./festivals.ts";

const DIWALI = FESTIVALS.find((f) => f.key === "diwali-2026")!;

test("finds the window a date falls inside", () => {
  const found = activeFestival(new Date("2026-11-01T09:00:00+05:30"));
  assert.equal(found?.key, "diwali-2026");
});

test("returns nothing on an ordinary day", () => {
  assert.equal(activeFestival(new Date("2026-07-28T09:00:00+05:30")), undefined);
});

test("includes both ends of the window", () => {
  for (const date of [DIWALI.from, DIWALI.to]) {
    assert.equal(
      activeFestival(new Date(`${date}T12:00:00+05:30`))?.key,
      "diwali-2026",
    );
  }
});

test("reads the date in IST, not the server's timezone", () => {
  // 18:45 UTC on the day before is already the next day in India. A server in
  // UTC comparing raw dates would hold the banner back by an evening — or run
  // it an evening early at the other end.
  const eveningBefore = new Date("2026-10-29T18:45:00Z");
  assert.equal(istDate(eveningBefore), "2026-10-30");
  assert.equal(activeFestival(eveningBefore)?.key, "diwali-2026");
});

test("counts the days left inclusive of today", () => {
  const onLastDay = new Date(`${DIWALI.to}T10:00:00+05:30`);
  assert.equal(daysRemaining(DIWALI, onLastDay), 1);

  const dayBefore = new Date("2026-11-08T10:00:00+05:30");
  assert.equal(daysRemaining(DIWALI, dayBefore), 2);
});

test("never reports negative days after the window closes", () => {
  assert.equal(
    daysRemaining(DIWALI, new Date("2026-12-01T10:00:00+05:30")),
    0,
  );
});

test("the shipped calendar has no overlapping windows", () => {
  // Two active festivals would make the banner arbitrary, and the ordering of
  // the array is not something anyone should have to know about.
  const sorted = [...FESTIVALS].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1] as Festival;
    const current = sorted[i] as Festival;
    assert.ok(
      previous.to < current.from,
      `${previous.key} overlaps ${current.key}`,
    );
  }
});

test("every window runs forwards", () => {
  for (const festival of FESTIVALS) {
    assert.ok(festival.from <= festival.to, festival.key);
  }
});
