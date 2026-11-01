import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import * as helpers from "./function.js";
import * as security from "./security.js";
import { createApp } from "./app-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trustProxy = process.env.TRUST_PROXY === undefined
  ? (process.env.VERCEL ? 1 : false)
  : (process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY) || false);

const app = createApp({
  ...helpers,
  rateLimitMiddleware: security.createRateLimiter(security.getRateLimitOptions()),
  staticMiddleware: [
    express.static(path.resolve(__dirname, "../public"), { index: "index.html", fallthrough: true }),
    express.static(path.resolve(__dirname, "media"), { fallthrough: true })
  ],
  getCorsOrigins: () => process.env.CORS_ORIGINS || "",
  getUptimeSeconds: () => Math.floor(process.uptime()),
  getMetrics: () => ({
    uptime: `${process.uptime().toFixed(0)}s`,
    memory: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`
  }),
  isProduction: () => process.env.NODE_ENV === "production",
  trustProxy
});

export default app;
