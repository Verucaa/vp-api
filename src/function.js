import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import chokidar from "chokidar";
import { assertPublicHttpUrl, isPublicIp } from "./security.js";
import { configurePluginRuntime } from "./plugin-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREATOR = "Veruu";
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
];

export const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

export const getPluginsDir = () => {
  const possibleDirs = [
    path.join(process.cwd(), "src", "plugins"),
    path.join(process.cwd(), "plugins"),
    path.resolve(__dirname, "plugins"),
    path.resolve(__dirname, "../src/plugins")
  ];
  return possibleDirs.find((dir) => {
    try { return fs.existsSync(dir); } catch { return false; }
  }) || possibleDirs[0];
};

export const plugins = new Map();

export const sendSuccess = (res, result = null, statusCode = 200) => {
  return res.status(statusCode).json({ status: true, creator: CREATOR, result });
};

export const sendError = (res, message = "Internal Server Error", statusCode = 500) => {
  return res.status(statusCode).json({ status: false, creator: CREATOR, message });
};

let dnsRotation = 0;
const safeDnsLookup = (hostname, options, callback) => {
  const opts = typeof options === "number" ? { family: options } : (options || {});
  lookup(hostname, { all: true, verbatim: true })
    .then((records) => {
      if (!records.length || records.some(({ address }) => !isPublicIp(address))) {
        throw new Error("Outbound request blocked: DNS returned a private or special-use address");
      }
      const filtered = opts.family ? records.filter((record) => record.family === opts.family) : records;
      if (!filtered.length) throw new Error("No public DNS address is available for the requested address family");
      const preferredFamily = opts.family || (filtered.some((record) => record.family === 4) ? 4 : 6);
      const preferred = filtered.filter((record) => record.family === preferredFamily);
      const rest = filtered.filter((record) => record.family !== preferredFamily);
      const offset = preferred.length ? dnsRotation++ % preferred.length : 0;
      const ordered = [...preferred.slice(offset), ...preferred.slice(0, offset), ...rest];
      if (opts.all) callback(null, ordered);
      else callback(null, ordered[0].address, ordered[0].family);
    })
    .catch((error) => callback(error));
};

const outboundAgent = new Agent({ connect: { lookup: safeDnsLookup, timeout: 8_000 } });

const withTimedBody = (response, controller, timeoutMs, state) => {
  const clear = () => {
    clearTimeout(state.timer);
    state.signal?.removeEventListener("abort", state.onAbort);
  };
  if (!response.body) {
    clear();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clear();
          streamController.close();
        } else {
          streamController.enqueue(value);
        }
      } catch (error) {
        clear();
        streamController.error(state.timedOut ? new Error(`Request timed out after ${timeoutMs} ms`) : error);
      }
    },
    async cancel(reason) {
      clear();
      await reader.cancel(reason);
    }
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

/**
 * Fetch an HTTPS URL after rejecting local/private destinations. DNS lookups used
 * by the actual socket are checked again and pinned to public addresses, including
 * after redirects. Timeout covers response headers and body consumption.
 */
export const safeFetch = async (input, options = {}, timeoutMs = 20_000) => {
  const { allowedHosts, allowHttp = false, maxRedirects = 4, ...fetchOptions } = options;
  const controller = new AbortController();
  const externalSignal = fetchOptions.signal;
  const state = { timedOut: false, signal: externalSignal, onAbort: null, timer: null };
  let rejectTimeout;
  const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
  state.onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else externalSignal?.addEventListener("abort", state.onAbort, { once: true });

  state.timer = setTimeout(() => {
    state.timedOut = true;
    const timeoutError = new Error(`Request timed out after ${timeoutMs} ms`);
    controller.abort(timeoutError);
    rejectTimeout(timeoutError);
  }, timeoutMs);

  let currentUrl;
  try {
    currentUrl = await Promise.race([assertPublicHttpUrl(input, { allowedHosts, allowHttp }), timeoutPromise]);
    const method = String(fetchOptions.method || "GET").toUpperCase();
    let headers = {
      "User-Agent": getRandomUserAgent(),
      ...(fetchOptions.headers || {})
    };
    let response;

    for (let redirectCount = 0; ; redirectCount++) {
      const requestOptions = {
        ...fetchOptions,
        method,
        headers,
        redirect: "manual",
        dispatcher: outboundAgent,
        signal: controller.signal
      };
      for (let attempt = 0; ; attempt++) {
        try {
          response = await Promise.race([fetch(currentUrl, requestOptions), timeoutPromise]);
          break;
        } catch (error) {
          const code = error?.cause?.code || error?.code;
          const retryable = ["GET", "HEAD"].includes(method) && attempt < 2 && !controller.signal.aborted &&
            ["UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code);
          if (!retryable) throw error;
        }
      }

      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      if (redirectCount >= maxRedirects) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Terlalu banyak pengalihan URL");
      }
      if (!["GET", "HEAD"].includes(method)) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Pengalihan tidak diizinkan untuk request non-GET/HEAD");
      }
      const nextUrl = new URL(location, currentUrl);
      if (currentUrl.protocol === "https:" && nextUrl.protocol !== "https:") {
        await response.body?.cancel().catch(() => {});
        throw new Error("Pengalihan ke koneksi non-HTTPS ditolak");
      }
      if (nextUrl.origin !== currentUrl.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) =>
          !["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase())
        ));
      }
      await response.body?.cancel().catch(() => {});
      currentUrl = await Promise.race([assertPublicHttpUrl(nextUrl.href, { allowedHosts, allowHttp }), timeoutPromise]);
    }

    return withTimedBody(response, controller, timeoutMs, state);
  } catch (error) {
    clearTimeout(state.timer);
    externalSignal?.removeEventListener("abort", state.onAbort);
    if (state.timedOut) throw new Error(`Request timed out after ${timeoutMs} ms`);
    throw error;
  }
};

export const pipeStream = async (url, res, options = {}, timeoutMs = 30_000) => {
  const response = await safeFetch(url, options, timeoutMs);
  if (!response.ok) throw new Error(`Gagal membuka stream media (${response.status})`);
  const contentType = response.headers.get("content-type");
  const contentLength = response.headers.get("content-length");
  if (contentType) res.setHeader("Content-Type", contentType);
  if (contentLength) res.setHeader("Content-Length", contentLength);
  res.setHeader("Accept-Ranges", "bytes");
  const readable = Readable.fromWeb(response.body);
  readable.pipe(res);
  return new Promise((resolve, reject) => {
    readable.on("end", resolve);
    readable.on("error", reject);
    res.on("close", () => { readable.destroy(); resolve(); });
  });
};

export const downloadBuffer = async (url, options = {}, timeoutMs = 30_000) => {
  const response = await safeFetch(url, options, timeoutMs);
  if (!response.ok) throw new Error(`Failed to download buffer (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
};

const cacheStorage = new Map();
export const getCache = (key) => {
  const cached = cacheStorage.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expireAt) { cacheStorage.delete(key); return null; }
  return cached.data;
};

export const setCache = (key, data, ttlSeconds = 60) => {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
  if (cacheStorage.size > 1500 || process.memoryUsage().rss / 1024 / 1024 > 180) {
    const purgeCount = Math.max(1, Math.floor(cacheStorage.size * 0.3));
    const iterator = cacheStorage.keys();
    for (let i = 0; i < purgeCount; i++) {
      const nextKey = iterator.next().value;
      if (nextKey) cacheStorage.delete(nextKey);
    }
  }
  cacheStorage.set(key, { data, expireAt: Date.now() + ttlSeconds * 1000 });
};

export const purgeAllCache = () => { const size = cacheStorage.size; cacheStorage.clear(); return size; };
const cleanTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cacheStorage) if (now > value.expireAt) cacheStorage.delete(key);
  if (process.memoryUsage().rss / 1024 / 1024 > 220) cacheStorage.clear();
}, 180_000);
cleanTimer.unref?.();

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

const parsePluginPath = (filePath, baseDir) => {
  const fullPath = path.resolve(filePath);
  const relative = path.relative(baseDir, fullPath).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
  const parts = relative.split("/");
  if (parts.some((part) => !/^[a-zA-Z0-9_-]+\.(js|mjs)$/i.test(part) && part.includes("."))) return null;
  if (parts.length === 1) {
    const name = parts[0].replace(/\.(js|mjs)$/i, "").toLowerCase();
    return { category: "general", name, routePath: `/general/${name}` };
  }
  const category = parts[0].toLowerCase();
  const name = parts.slice(1).join("/").replace(/\.(js|mjs)$/i, "").toLowerCase();
  return { category, name, routePath: `/${category}/${name}` };
};

/**
 * Register a plugin that declares `routes: { ... }` on its default export.
 * Each sub-route becomes an independent entry in the `plugins` Map so the
 * existing app-core / registry / OpenAPI code sees N routes without changes.
 */
const registerMultiRoutePlugin = (parsed, handler) => {
  const baseMethods = Array.isArray(handler.method) ? handler.method : [handler.method || "GET"];
  const baseTimeout = Math.min(Math.max(Number(handler.timeout) || 45_000, 1000), 300_000);
  const baseCache = typeof handler.cache === "number" && handler.cache > 0 ? handler.cache : null;
  const registered = [];

  for (const [sub, def] of Object.entries(handler.routes)) {
    if (!/^[a-z0-9_-]+$/.test(sub)) {
      console.error(`[Plugin Route Skipped] ${parsed.routePath}/${sub}: nama sub-route harus [a-z0-9_-]`);
      continue;
    }
    if (!def || typeof def.execute !== "function") {
      console.error(`[Plugin Route Skipped] ${parsed.routePath}/${sub}: execute bukan function`);
      continue;
    }
    const defMethods = Array.isArray(def.method) ? def.method : [def.method || baseMethods[0]];
    const routePath = `${parsed.routePath}/${sub}`;
    const plugin = {
      name: def.name || `${handler.name || parsed.name} ${sub}`,
      category: handler.category || parsed.category,
      path: routePath,
      method: [...new Set(defMethods.map((m) => String(m).toUpperCase()))],
      description: def.description || handler.description || "",
      params: def.params || {},
      cache: typeof def.cache === "number" && def.cache > 0 ? def.cache : baseCache,
      timeout: Math.min(Math.max(Number(def.timeout) || baseTimeout, 1000), 300_000),
      execute: def.execute,
    };
    plugins.set(routePath, plugin);
    registered.push(plugin);
  }
  return registered[0] || null;
};

export const loadPlugin = async (filePath) => {
  if (!filePath.endsWith(".js") && !filePath.endsWith(".mjs")) return null;
  const baseDir = getPluginsDir();
  const parsed = parsePluginPath(filePath, baseDir);
  if (!parsed) return null;
  try {
    const fullPath = path.resolve(filePath);
    const module = await import(`${pathToFileURL(fullPath).href}?v=${Date.now()}`);
    const handler = module.default || module;
    if (!handler) return null;

    // Multi-route: plugin dengan `routes: { ... }` tanpa top-level `execute`
    if (handler.routes && typeof handler.routes === "object" && typeof handler.execute !== "function") {
      return registerMultiRoutePlugin(parsed, handler);
    }

    // Single route (perilaku lama, tidak berubah)
    if (typeof handler.execute !== "function") return null;
    const methods = Array.isArray(handler.method) ? handler.method : [handler.method || "GET"];
    const plugin = {
      name: handler.name || parsed.name,
      category: handler.category || parsed.category,
      path: parsed.routePath,
      method: [...new Set(methods.map((method) => String(method).toUpperCase()))],
      description: handler.description || "",
      params: handler.params || {},
      cache: typeof handler.cache === "number" && handler.cache > 0 ? handler.cache : null,
      timeout: Math.min(Math.max(Number(handler.timeout) || 45_000, 1000), 300_000),
      execute: handler.execute
    };
    plugins.set(parsed.routePath, plugin);
    return plugin;
  } catch (error) {
    console.error(`[Plugin Load Failed] ${filePath}:`, error.message);
    return null;
  }
};

export const unloadPlugin = (filePath) => {
  const parsed = parsePluginPath(filePath, getPluginsDir());
  if (!parsed) return;
  plugins.delete(parsed.routePath);
  // Hapus semua sub-route yang di-expand dari file ini
  const prefix = `${parsed.routePath}/`;
  for (const key of [...plugins.keys()]) {
    if (key.startsWith(prefix)) plugins.delete(key);
  }
};

const getFiles = (directory) => {
  let results = [];
  try {
    if (!fs.existsSync(directory)) return results;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, item.name);
      if (item.isDirectory()) results = results.concat(getFiles(fullPath));
      else if (item.isFile() && /\.(js|mjs)$/i.test(item.name)) results.push(fullPath);
    }
  } catch (error) { console.error("[ReadDir Error]:", error.message); }
  return results;
};

export const loadAllPlugins = async () => {
  for (const file of getFiles(getPluginsDir())) await loadPlugin(file);
};

export const resolveSingleRouteOnDemand = async (category, pluginName) => {
  if (!/^[a-z0-9_-]+$/i.test(category) || !/^[a-z0-9_/-]+$/i.test(pluginName)) return null;
  const baseDir = getPluginsDir();
  const normalizedPlugin = pluginName.split("/").filter(Boolean);
  if (normalizedPlugin.length !== pluginName.split("/").length) return null;

  // 1. Coba file persis (single-route atau sub-route file yang benar-benar ada)
  const candidates = [
    path.join(baseDir, category, ...normalizedPlugin) + ".js",
    path.join(baseDir, category, ...normalizedPlugin) + ".mjs",
    ...(normalizedPlugin.length === 1 ? [path.join(baseDir, normalizedPlugin[0] + ".js")] : [])
  ];
  for (const filePath of candidates) {
    const relative = path.relative(baseDir, filePath);
    if (relative.startsWith("../") || path.isAbsolute(relative)) continue;
    try { if (fs.existsSync(filePath)) return await loadPlugin(filePath); } catch {}
  }

  // 2. Fallback: multi-route plugin di parent (mis. /film/7reels/homepage → film/7reels.js)
  if (normalizedPlugin.length > 1) {
    const parentName = normalizedPlugin[0];
    const parentCandidates = [
      path.join(baseDir, category, parentName) + ".js",
      path.join(baseDir, category, parentName) + ".mjs",
    ];
    for (const filePath of parentCandidates) {
      const relative = path.relative(baseDir, filePath);
      if (relative.startsWith("../") || path.isAbsolute(relative)) continue;
      try {
        if (fs.existsSync(filePath)) {
          await loadPlugin(filePath); // expand semua sub-route ke `plugins`
          const requested = plugins.get(`/${category}/${pluginName}`);
          if (requested) return requested;
        }
      } catch {}
    }
  }
  return null;
};

export const watchPlugins = () => {
  const directory = getPluginsDir();
  if (!fs.existsSync(directory)) return null;
  return chokidar.watch(directory, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  }).on("add", loadPlugin).on("change", loadPlugin).on("unlink", unloadPlugin);
};

configurePluginRuntime({ safeFetch, assertPublicHttpUrl });
