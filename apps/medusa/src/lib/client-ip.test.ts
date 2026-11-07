import assert from "node:assert/strict";
import { test } from "node:test";

import { CLIENT_IP_HEADER, CLIENT_IP_SIG_HEADER, clientIp, signClientIp } from "./client-ip.ts";

const SECRET = "s".repeat(32);
const STOREFRONT = "10.0.0.5";

const signed = (ip: string, sig = signClientIp(ip, SECRET)) => ({
  ip: STOREFRONT,
  headers: { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_SIG_HEADER]: sig },
});

test("a correctly signed forwarded IP is the client IP", () => {
  assert.equal(clientIp(signed("203.0.113.9"), SECRET), "203.0.113.9");
  assert.equal(clientIp(signed("2001:db8::1"), SECRET), "2001:db8::1");
});

test("a forged or missing signature falls back to req.ip", () => {
  assert.equal(clientIp(signed("203.0.113.9", "0".repeat(64)), SECRET), STOREFRONT);
  assert.equal(clientIp(signed("203.0.113.9", "short"), SECRET), STOREFRONT);
  assert.equal(
    clientIp({ ip: STOREFRONT, headers: { [CLIENT_IP_HEADER]: "203.0.113.9" } }, SECRET),
    STOREFRONT,
  );
  // Signed for one IP, replayed with another.
  assert.equal(clientIp(signed("203.0.113.10", signClientIp("203.0.113.9", SECRET)), SECRET), STOREFRONT);
});

test("without a secret the header is never trusted", () => {
  assert.equal(clientIp(signed("203.0.113.9"), undefined), STOREFRONT);
  assert.equal(clientIp(signed("203.0.113.9"), ""), STOREFRONT);
});

test("a signed value that is not an IP is ignored", () => {
  assert.equal(clientIp(signed("not-an-ip"), SECRET), STOREFRONT);
});

test("no headers at all: req.ip, then the socket", () => {
  assert.equal(clientIp({ ip: "198.51.100.1" }, SECRET), "198.51.100.1");
  assert.equal(clientIp({ socket: { remoteAddress: "198.51.100.2" } }, SECRET), "198.51.100.2");
  assert.equal(clientIp({}, SECRET), undefined);
});
