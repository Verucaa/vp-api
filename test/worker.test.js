import assert from "node:assert/strict";
import { once } from "node:events";
import { after, test } from "node:test";
import app from "../src/worker/app.js";
import { safeFetch } from "../src/worker/safe-fetch.js";
import { assertPublicHttpUrl } from "../src/worker/security.js";
import { plugins } from "../src/worker/function.js";
import { createRateLimiter, getRateLimitOptions } from "../src/rate-limit.js";

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const request = (path, options = {}) => fetch(`${baseUrl}${path}`, options);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("Worker registry keeps all 12 routes and labels the 3 unavailable routes", async () => {
  const response = await request("/api/endpoints");
  assert.equal(response.status, 200);
  const registry = (await response.json()).result;
  assert.equal(registry.total, 12);
  const all = Object.values(registry.endpoints).flat();
  assert.equal(all.filter((entry) => entry.enabled === true).length, 9);
  assert.equal(all.filter((entry) => entry.enabled === false).length, 3);
  assert.ok(all.find((entry) => entry.endpoint === "/search/ytsearch")?.unavailable_reason);
  assert.ok(all.find((entry) => entry.endpoint === "/tools/web2apk")?.unavailable_reason);
  assert.ok(all.find((entry) => entry.endpoint === "/bypass/skiplink")?.unavailable_reason);
});

test("Worker unavailable routes return 501 rather than running unsafe or Node-only behavior", async () => {
  for (const path of ["/bypass/skiplink", "/search/ytsearch", "/tools/web2apk"]) {
    const response = await request(path);
    assert.equal(response.status, 501, path);
    assert.match((await response.json()).message, /Nonaktif di Workers|tidak aktif di Cloudflare Workers/i);
  }
});

test("Worker API and OpenAPI expose live routes and explicit limitations", async () => {
  assert.equal((await request("/health")).status, 200);
  const spec = await (await request("/openapi.json")).json();
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.paths["/info/ping"].get);
  assert.equal(spec.paths["/tools/web2apk"].post.responses["501"].description.length > 0, true);
  assert.match(spec.info.description, /100 request.*60 detik/i);
});

test("Worker limiter configuration caps values above 100, resets after 60 seconds, and separates client IPs", () => {
  let now = 10_000;
  const options = getRateLimitOptions({ RATE_LIMIT_MAX: "500", RATE_LIMIT_WINDOW_MS: "120000" });
  assert.deepEqual(options, { windowMs: 60_000, max: 100 });
  const limiter = createRateLimiter({ ...options, now: () => now });

  for (let count = 1; count <= 100; count++) assert.equal(limiter.consume("203.0.113.10").allowed, true);
  const blocked = limiter.consume("203.0.113.10");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["Retry-After"], "60");
  assert.equal(blocked.headers["RateLimit-Limit"], "100");
  assert.equal(limiter.consume("203.0.113.11").allowed, true);

  now += 60_000;
  const reset = limiter.consume("203.0.113.10");
  assert.equal(reset.allowed, true);
  assert.equal(reset.headers["RateLimit-Remaining"], "99");
});

test("Worker ping reports unavailable isolate uptime and memory rather than guessing", async () => {
  const body = await (await request("/info/ping")).json();
  assert.match(body.result.uptime, /tidak tersedia/i);
  assert.match(body.result.memory, /tidak diekspos/i);
});

test("Worker endpoint failures stay generic to clients and correlate with internal logs", async () => {
  const routePath = "/tools/worker-error-fixture";
  plugins.set(routePath, {
    name: "Worker error fixture",
    category: "tools",
    method: ["GET"],
    params: {},
    timeout: 1000,
    execute: async () => { throw new Error("fixture provider detail must remain server-side"); }
  });
  const originalConsoleError = console.error;
  const capturedLogs = [];

  try {
    console.error = (...values) => capturedLogs.push(values.map(String).join(" "));
    const response = await request(routePath);
    const body = await response.json();
    const requestId = response.headers.get("x-request-id");

    assert.equal(response.status, 502);
    assert.equal(body.message, "Endpoint gagal dijalankan");
    assert.match(requestId || "", /^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(JSON.stringify(body), /fixture provider detail/i);
    assert.match(capturedLogs.join("\n"), new RegExp(`request_id=${requestId}`));
    assert.match(capturedLogs.join("\n"), /fixture provider detail must remain server-side/i);
  } finally {
    console.error = originalConsoleError;
    plugins.delete(routePath);
  }
});

test("Workers safeFetch fails closed without explicit provider allowlist", async () => {
  await assert.rejects(safeFetch("https://example.com/"), /explicit provider allowlist/i);
  await assert.rejects(assertPublicHttpUrl("https://127.0.0.1/"), /privat|khusus/i);
  await assert.rejects(assertPublicHttpUrl("https://example.com/", { allowedHosts: ["capcut.com"] }), /Host URL tidak diizinkan/i);
});
