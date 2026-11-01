import assert from "node:assert/strict";
import { once } from "node:events";
import { after, test } from "node:test";

process.env.RATE_LIMIT_MAX = "1000";
process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "https://ui.example";

const [{ default: app }, functionModule, securityModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/function.js"),
  import("../src/security.js")
]);
const { plugins, extractAndValidateInput, safeFetch } = functionModule;
const { assertPublicHttpUrl, createRateLimiter, getRateLimitOptions, isPublicIp } = securityModule;
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const request = (path, options = {}) => fetch(`${baseUrl}${path}`, options);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("public health, endpoint registry, and OpenAPI are available without authentication", async () => {
  const pageResponse = await request("/");
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /styles\.css/);
  assert.match(page, /config\.js/);
  assert.match(page, /app\.js/);
  assert.match(page, /id="primary-nav"/);
  assert.match(page, /href="\/docs\.html"/);
  assert.match(page, /href="\/how-to\.html"/);
  assert.doesNotMatch(page, /id="api-key-input"|Authorization:/i);
  assert.match(page, /tanpa API key/i);
  assert.doesNotMatch(page, /id="request-form"/);

  const docsResponse = await request("/docs.html");
  assert.equal(docsResponse.status, 200);
  assert.match(await docsResponse.text(), /endpoint-container/);
  const tutorialResponse = await request("/how-to.html");
  assert.equal(tutorialResponse.status, 200);
  assert.match(await tutorialResponse.text(), /TypeScript/);

  const uiConfigResponse = await request("/config.js");
  assert.equal(uiConfigResponse.status, 200);
  assert.match(await uiConfigResponse.text(), /announcement/);
  assert.equal((await request("/styles.css")).status, 200);
  assert.equal((await request("/app.js")).status, 200);

  const healthResponse = await request("/health");
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).result.status, "ok");

  const registryResponse = await request("/api/endpoints");
  assert.equal(registryResponse.status, 200);
  const registry = (await registryResponse.json()).result;
  assert.equal(registry.total, 12);
  const paths = Object.values(registry.endpoints).flat().map((endpoint) => endpoint.endpoint);
  assert.ok(paths.includes("/info/ping"));
  assert.ok(paths.includes("/info/ip"));
  assert.ok(paths.includes("/tools/web2apk"));
  assert.ok(!paths.includes("/tools/ping"));

  const openApiResponse = await request("/openapi.json");
  assert.equal(openApiResponse.status, 200);
  const spec = await openApiResponse.json();
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "1.2.0");
  assert.deepEqual(spec.paths["/tools/web2apk"].post.security, []);
  assert.deepEqual(spec.paths["/info/ip"].get.security, []);
  assert.equal(spec.components.securitySchemes, undefined);
  assert.deepEqual(spec.paths["/tools/tempmail"].get.parameters, []);
  assert.ok(spec.paths["/tools/tempmail"].post.requestBody.content["application/json"].schema.properties.token);
  assert.match(spec.info.description, /100 request.*60 detik/i);
  assert.ok(spec.paths["/info/ping"].get.responses["429"].headers["RateLimit-Reset"]);
  assert.ok(spec.paths["/info/ping"].get.responses["429"].headers["Retry-After"]);
});

test("IP endpoint returns the connection address locally and exposes rate-limit headers to configured UI origins", async () => {
  const response = await request("/info/ip", { headers: { Origin: "https://ui.example" } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result.client_ip);
  assert.match(body.result.client_ip, /127\.0\.0\.1/);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://ui.example");
  assert.match(response.headers.get("access-control-expose-headers") || "", /RateLimit-Remaining/i);
  assert.equal(response.headers.get("ratelimit-limit"), "100");
});

test("plugin routes work without API keys and ignore authentication headers", async () => {
  const noKey = await request("/info/ping");
  assert.equal(noKey.status, 200);
  assert.equal((await noKey.json()).result.timestamp !== undefined, true);

  const queryKey = await request("/info/ping?api_key=test-only-api-key");
  assert.equal(queryKey.status, 400);
  const wrongKey = await request("/info/ping", { headers: { Authorization: "Bearer wrong" } });
  assert.equal(wrongKey.status, 200);

  const bearer = await request("/info/ping", { headers: { Authorization: "Bearer any-value" } });
  assert.equal(bearer.status, 200);
  assert.equal((await bearer.json()).result.timestamp !== undefined, true);
  const headerKey = await request("/info/ping", { headers: { "X-API-Key": "any-value" } });
  assert.equal(headerKey.status, 200);
});

test("wrong method and unknown endpoint retain useful HTTP statuses", async () => {
  const methodResponse = await request("/info/ping", { method: "POST" });
  assert.equal(methodResponse.status, 405);
  assert.match(methodResponse.headers.get("allow"), /GET/);
  const missingResponse = await request("/unknown/route");
  assert.equal(missingResponse.status, 404);
});

test("plugin execution is bounded even if a plugin ignores cancellation", async () => {
  const route = "/testonly/never-resolves";
  plugins.set(route, {
    name: "Timeout test",
    category: "testonly",
    method: ["GET"],
    description: "test-only timeout fixture",
    params: {},
    timeout: 25,
    cache: null,
    execute: () => new Promise(() => {})
  });
  try {
    const response = await request(route);
    assert.equal(response.status, 504);
    assert.match((await response.json()).message, /waktu/i);
  } finally {
    plugins.delete(route);
  }
});

test("input validation rejects arrays, malformed numbers, and out-of-range values", () => {
  const schema = {
    q: { type: "string", required: true, maxLength: 5 },
    limit: { type: "number", minimum: 1, maximum: 10 }
  };
  assert.match(extractAndValidateInput(schema, { query: { q: ["a", "b"] }, body: {} }).error, /nilai tunggal/);
  assert.match(extractAndValidateInput(schema, { query: { q: "abcdef", limit: "2" }, body: {} }).error, /terlalu panjang/);
  assert.match(extractAndValidateInput(schema, { query: { q: "abc", limit: "nope" }, body: {} }).error, /angka/);
  assert.match(extractAndValidateInput(schema, { query: { q: "abc", limit: "20" }, body: {} }).error, /terlalu besar/);
  assert.deepEqual(extractAndValidateInput(schema, { query: { q: "abc", limit: "3" }, body: {} }).input, { q: "abc", limit: 3 });
});

test("SSRF checks block local and special-use networks and permit public IP literals", async () => {
  for (const address of ["127.0.0.1", "10.0.0.8", "169.254.169.254", "192.168.1.2", "::1", "fc00::1", "fe80::1"]) {
    assert.equal(isPublicIp(address), false, `${address} should be private`);
  }
  assert.equal(isPublicIp("1.1.1.1"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
  await assert.rejects(assertPublicHttpUrl("https://127.0.0.1"), /privat|khusus/i);
  await assert.rejects(assertPublicHttpUrl("http://1.1.1.1"), /HTTPS/);
  await assert.rejects(assertPublicHttpUrl("https://localhost"), /lokal|privat/i);
  await assert.rejects(safeFetch("https://127.0.0.1/", {}, 1000), /privat|khusus/i);
  const publicUrl = await assertPublicHttpUrl("https://1.1.1.1/dns-query");
  assert.equal(publicUrl.hostname, "1.1.1.1");
});

test("rate limiter returns 429 per IP without consuming another IP's quota", () => {
  let now = 10_000;
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => now });
  const headers = {};
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { headers[name] = value; },
    json(body) { this.body = body; return this; }
  };
  const req = { ip: "192.0.2.10", socket: { remoteAddress: "192.0.2.10" } };
  let nextCalled = 0;
  limiter(req, response, () => nextCalled++);
  assert.equal(nextCalled, 1);
  limiter(req, response, () => nextCalled++);
  assert.equal(response.statusCode, 429);
  assert.equal(headers["Retry-After"], "1");
  assert.equal(headers["RateLimit-Limit"], "1");
  assert.equal(headers["RateLimit-Remaining"], "0");

  limiter({ ip: "192.0.2.11", socket: { remoteAddress: "192.0.2.11" } }, response, () => nextCalled++);
  assert.equal(nextCalled, 2);

  now += 1001;
  limiter(req, response, () => nextCalled++);
  assert.equal(nextCalled, 3);
});

test("default and over-limit configuration enforce 100 requests per fixed 60-second IP window", () => {
  let now = 120_000;
  const options = getRateLimitOptions({ RATE_LIMIT_MAX: "1000", RATE_LIMIT_WINDOW_MS: "120000" });
  assert.deepEqual(options, { windowMs: 60_000, max: 100 });
  const limiter = createRateLimiter({ ...options, now: () => now });
  const send = (ip) => {
    const headers = {};
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    let nextCalled = false;
    limiter({ ip }, response, () => { nextCalled = true; });
    return { response, headers, nextCalled };
  };

  let hundredth;
  for (let count = 1; count <= 100; count++) hundredth = send("192.0.2.100");
  assert.equal(hundredth.response.statusCode, 200);
  assert.equal(hundredth.nextCalled, true);
  assert.equal(hundredth.headers["RateLimit-Limit"], "100");
  assert.equal(hundredth.headers["RateLimit-Remaining"], "0");

  const overLimit = send("192.0.2.100");
  assert.equal(overLimit.response.statusCode, 429);
  assert.equal(overLimit.nextCalled, false);
  assert.equal(overLimit.headers["Retry-After"], "60");
  assert.equal(overLimit.headers["RateLimit-Remaining"], "0");

  now += 59_999;
  assert.equal(send("192.0.2.100").response.statusCode, 429);
  now += 1;
  const reset = send("192.0.2.100");
  assert.equal(reset.response.statusCode, 200);
  assert.equal(reset.headers["RateLimit-Remaining"], "99");
  assert.equal(reset.headers["RateLimit-Reset"], "240");
});

test("a different client IP has an independent 100-request quota", () => {
  const limiter = createRateLimiter({ max: 1000, windowMs: 60_000, now: () => 10_000 });
  const firstIp = limiter.consume("192.0.2.10");
  const secondIp = limiter.consume("192.0.2.11");
  assert.equal(firstIp.allowed, true);
  assert.equal(firstIp.headers["RateLimit-Limit"], "100");
  assert.equal(secondIp.allowed, true);
  assert.equal(secondIp.headers["RateLimit-Remaining"], "99");
});

test("sensitive tempmail token query values are rejected before upstream calls", async () => {
  const response = await request("/tools/tempmail?token=secret-value");
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /body POST/);
});
