import { createServer } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";
import { createRateLimiter, getRateLimitOptions } from "../rate-limit.js";
import app from "./app.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RATE_LIMIT_MAX?: string;
  CORS_ORIGINS?: string;
}

const NODE_PORT = 8787;
const server = createServer(app as any);
server.listen(NODE_PORT);

let limiter: ReturnType<typeof createRateLimiter> | undefined;
let limiterSignature = "";
const getLimiter = (env: Env) => {
  const { windowMs, max } = getRateLimitOptions(env);
  const signature = `${windowMs}:${max}`;
  if (!limiter || signature !== limiterSignature) {
    limiter = createRateLimiter({ windowMs, max });
    limiterSignature = signature;
  }
  return limiter;
};

const isApiPath = (pathname: string) =>
  pathname === "/health" || pathname === "/openapi.json" || pathname === "/api" ||
  pathname.startsWith("/api/") || pathname.startsWith("/info/") ||
  pathname.startsWith("/bypass/") || pathname.startsWith("/downloader/") ||
  pathname.startsWith("/search/") || pathname.startsWith("/tools/");

const addLimitHeaders = (response: Response, headersToAdd: Record<string, string>, request: Request, env: Env) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(headersToAdd)) headers.set(name, value);
  const origin = request.headers.get("Origin");
  const allowedOrigins = String(env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-Request-ID");
    headers.append("Vary", "Origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const limitedResponse = (headers: Record<string, string>, request: Request, env: Env) => {
  const responseHeaders = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
  const origin = request.headers.get("Origin");
  const allowedOrigins = String(env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    responseHeaders.set("Access-Control-Allow-Origin", origin);
    responseHeaders.set("Access-Control-Expose-Headers", "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-Request-ID");
    responseHeaders.append("Vary", "Origin");
  }
  return new Response(JSON.stringify({ status: false, creator: "Veruu", message: "Terlalu banyak request; coba lagi setelah jeda" }), {
    status: 429,
    headers: responseHeaders
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
    const limit = getLimiter(env).consume(clientIp);
    if (!limit.allowed) return limitedResponse(limit.headers, request, env);

    const pathname = new URL(request.url).pathname;
    if (!isApiPath(pathname) && ["GET", "HEAD"].includes(request.method) && env.ASSETS) {
      const assetUrl = new URL(request.url);
      if (pathname === "/") assetUrl.pathname = "/index.html";
      const assetRequest = pathname === "/"
        ? new Request(assetUrl, { method: request.method, headers: request.headers })
        : request;
      const asset = await env.ASSETS.fetch(assetRequest);
      if (asset.status !== 404) return addLimitHeaders(asset, limit.headers, request, env);
    }

    const headers = new Headers(request.headers);
    headers.delete("x-wolf-client-ip");
    headers.delete("x-wolf-cors-origins");
    headers.set("x-wolf-client-ip", clientIp);
    headers.set("x-wolf-cors-origins", env.CORS_ORIGINS || "");
    const workerRequest = new Request(request, { headers });
    const response = await handleAsNodeRequest(NODE_PORT, workerRequest);
    return addLimitHeaders(response, limit.headers, request, env);
  }
};
