/**
 * Load test for the sign-in routes (auth plan phase 3 gate): the OTP send
 * and verify routes at 10x launch traffic.
 *
 * Run against STAGING with OTP_ECHO=true (no real messages, no SMS bill)
 * and rate limits ON — the point is to see the caps hold and the database
 * keep up, not to measure an unlimited server:
 *
 *   k6 run -e BASE_URL=https://staging-api.siumora.in \
 *          -e PUBLISHABLE_KEY=pk_... tooling/load/otp-routes.k6.js
 *
 * Launch assumption: 2 sign-ins a second at peak (a festival sale
 * evening). 10x = 20 code requests a second for 5 minutes, each followed
 * by a verify. Every virtual user signs in a different number (98xxxxxxxx
 * drawn from the VU and iteration), from k6's own address — so expect the
 * per-IP hourly cap (otp_max_sends_per_ip_hour) to start refusing with 429
 * unless staging raises it for the run. Both outcomes are measured.
 *
 * Pass bar:
 *   - p95 send < 800 ms, p95 verify < 600 ms (the provider call is echoed,
 *     so this is our own code and database)
 *   - zero 5xx
 *   - every refusal is a 429 with Retry-After (the caps holding), never a
 *     timeout
 */

import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:9000";
const KEY = __ENV.PUBLISHABLE_KEY || "";
const RATE = Number(__ENV.RATE || 20);

export const options = {
  scenarios: {
    signin: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: RATE * 2,
      maxVUs: RATE * 6,
    },
  },
  thresholds: {
    "http_req_duration{step:send}": ["p(95)<800"],
    "http_req_duration{step:verify}": ["p(95)<600"],
    server_errors: ["count==0"],
  },
};

const serverErrors = new Counter("server_errors");
const refused = new Counter("rate_limited");
const verifyTime = new Trend("verify_ms");

const headers = { "content-type": "application/json", "x-publishable-api-key": KEY };

function phoneFor(vu, iteration) {
  // 98 + 8 digits, distinct per VU and iteration.
  return `98${String((vu * 100000 + iteration) % 100000000).padStart(8, "0")}`;
}

export default function () {
  const phone = phoneFor(__VU, __ITER);

  const send = http.post(`${BASE}/store/siumora-auth/otp`, JSON.stringify({ phone }), {
    headers,
    tags: { step: "send" },
  });
  if (send.status >= 500) serverErrors.add(1);
  if (send.status === 429) {
    refused.add(1);
    check(send, { "429 carries Retry-After": (r) => Boolean(r.headers["Retry-After"]) });
    return;
  }
  if (!check(send, { "code issued": (r) => r.status === 200 })) return;

  const code = send.json("code");
  if (!code) return; // staging without OTP_ECHO: nothing to verify with

  const verify = http.post(`${BASE}/store/siumora-auth/verify`, JSON.stringify({ phone, code }), {
    headers,
    tags: { step: "verify" },
  });
  verifyTime.add(verify.timings.duration);
  if (verify.status >= 500) serverErrors.add(1);
  if (verify.status === 429) refused.add(1);
  check(verify, { "signed in or capped": (r) => r.status === 200 || r.status === 429 });
}
