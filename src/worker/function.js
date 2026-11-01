import { configurePluginRuntime } from "../plugin-runtime.js";
import { safeFetch } from "./safe-fetch.js";
import { assertPublicHttpUrl } from "./security.js";
import { activeWorkerPlugins } from "./plugins.js";

const CREATOR = "Veruu";
export const plugins = new Map();
for (const { endpoint, handler } of activeWorkerPlugins) {
  const methods = Array.isArray(handler.method) ? handler.method : [handler.method || "GET"];
  plugins.set(endpoint, {
    ...handler,
    path: endpoint,
    method: [...new Set(methods.map((method) => String(method).toUpperCase()))],
    cache: typeof handler.cache === "number" && handler.cache > 0 ? handler.cache : null,
    timeout: Math.min(Math.max(Number(handler.timeout) || 45_000, 1000), 300_000)
  });
}

configurePluginRuntime({ safeFetch, assertPublicHttpUrl });

export const loadAllPlugins = async () => {};
export const resolveSingleRouteOnDemand = async () => null;
export const sendSuccess = (res, result = null, statusCode = 200) => res.status(statusCode).json({ status: true, creator: CREATOR, result });
export const sendError = (res, message = "Internal Server Error", statusCode = 500) => res.status(statusCode).json({ status: false, creator: CREATOR, message });

const cacheStorage = new Map();
export const getCache = (key) => {
  const cached = cacheStorage.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expireAt) {
    cacheStorage.delete(key);
    return null;
  }
  return cached.data;
};
export const setCache = (key, data, ttlSeconds = 60) => {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
  if (cacheStorage.size >= 1500) {
    const oldest = cacheStorage.keys().next().value;
    if (oldest) cacheStorage.delete(oldest);
  }
  cacheStorage.set(key, { data, expireAt: Date.now() + ttlSeconds * 1000 });
};

export const extractAndValidateInput = (schema, req) => {
  const input = { ...(req.query || {}), ...(req.body || {}) };
  if (!schema || typeof schema !== "object") return { input, error: null };

  for (const [key, configValue] of Object.entries(schema)) {
    const config = configValue && typeof configValue === "object" ? configValue : {};
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      if (config.required) {
        const suffix = config.description ? ` (${config.description})` : "";
        return { input: null, error: `Parameter '${key}' wajib diisi${suffix}` };
      }
      continue;
    }
    if (Array.isArray(value) || typeof value === "object") return { input: null, error: `Parameter '${key}' harus berupa nilai tunggal` };
    if (config.type === "string") {
      if (typeof value !== "string") return { input: null, error: `Parameter '${key}' harus berupa teks` };
      input[key] = value.trim();
      if (config.maxLength && input[key].length > config.maxLength) return { input: null, error: `Parameter '${key}' terlalu panjang` };
      if (config.enum && !config.enum.includes(input[key])) return { input: null, error: `Parameter '${key}' tidak memiliki nilai yang diizinkan` };
    } else if (config.type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number)) return { input: null, error: `Parameter '${key}' harus berupa angka numerik` };
      if (config.minimum !== undefined && number < config.minimum) return { input: null, error: `Parameter '${key}' terlalu kecil` };
      if (config.maximum !== undefined && number > config.maximum) return { input: null, error: `Parameter '${key}' terlalu besar` };
      input[key] = number;
    } else if (config.type === "boolean") {
      if (![true, false, 1, 0, "true", "false", "1", "0"].includes(value)) return { input: null, error: `Parameter '${key}' harus berupa boolean` };
      input[key] = value === true || value === 1 || value === "1" || value === "true";
    }
  }
  return { input, error: null };
};
