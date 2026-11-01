import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

export const createApp = (runtime) => {
  const {
    plugins,
    loadAllPlugins,
    resolveSingleRouteOnDemand,
    sendSuccess,
    sendError,
    extractAndValidateInput,
    getCache,
    setCache,
    rateLimitMiddleware,
    staticMiddleware = [],
    disabledEndpoints = [],
    getCorsOrigins = () => "",
    getUptimeSeconds = () => null,
    getMetrics = () => null,
    isProduction = () => false,
    trustProxy = false
  } = runtime;
  const disabledByPath = new Map(disabledEndpoints.map((endpoint) => [endpoint.endpoint.toLowerCase(), endpoint]));
  const app = express();
  app.disable("x-powered-by");
  app.set("json spaces", 2);
  app.set("trust proxy", trustProxy);

  app.use((req, res, next) => {
    req.wolfRequestId = randomUUID();
    res.setHeader("X-Request-ID", req.wolfRequestId);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    const workerIp = req.get("x-wolf-client-ip");
    if (workerIp) req.wolfClientIp = workerIp;
    next();
  });

  app.use(cors((req, callback) => {
    const origin = req.get("Origin");
    const allowed = String(getCorsOrigins(req) || "").split(",").map((value) => value.trim()).filter(Boolean);
    callback(null, {
      origin: origin && allowed.includes(origin) ? origin : false,
      credentials: false,
      exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After", "X-Request-ID"]
    });
  }));
  if (rateLimitMiddleware) app.use(rateLimitMiddleware);
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb", parameterLimit: 100 }));
  for (const middleware of staticMiddleware) app.use(middleware);

  let initialized = false;
  let initializationPromise;
  const ensurePluginsLoaded = async () => {
    if (initialized) return;
    initializationPromise ||= loadAllPlugins().then(() => { initialized = true; }).catch((error) => {
      initializationPromise = null;
      throw error;
    });
    await initializationPromise;
  };

  app.get("/health", (_req, res) => sendSuccess(res, { status: "ok", uptime_seconds: getUptimeSeconds() }));

  app.get("/api/endpoints", async (_req, res, next) => {
    try { await ensurePluginsLoaded(); } catch (error) { return next(error); }
    const endpoints = {};
    for (const [routePath, data] of plugins.entries()) {
      const category = data.category || "general";
      (endpoints[category] ||= []).push({
        name: data.name,
        category,
        endpoint: routePath,
        method: data.method,
        description: data.description,
        params: data.params,
        enabled: true
      });
    }
    for (const data of disabledEndpoints) {
      const category = data.category || "general";
      (endpoints[category] ||= []).push({
        name: data.name,
        category,
        endpoint: data.endpoint,
        method: data.method,
        description: data.description,
        params: data.params || {},
        enabled: false,
        unavailable_reason: data.unavailable_reason
      });
    }
    return sendSuccess(res, { total: plugins.size + disabledEndpoints.length, endpoints });
  });

  const openApiType = (type) => ({ string: "string", number: "number", integer: "integer", boolean: "boolean", array: "array", object: "object" }[type] || "string");
  const buildOpenApiDocument = () => {
    const paths = {};
    for (const [routePath, endpoint] of plugins.entries()) {
      const pathItem = paths[routePath] ||= {};
      for (const methodName of endpoint.method) {
        const method = methodName.toLowerCase();
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const parameters = method === "get" ? Object.entries(endpoint.params || {}).filter(([name]) => !/token|secret|password|api[_-]?key/i.test(name)).map(([name, configValue]) => {
          const config = configValue && typeof configValue === "object" ? configValue : {};
          return {
            name,
            in: "query",
            required: Boolean(config.required),
            description: config.description || "",
            schema: {
              type: openApiType(config.type),
              ...(config.enum ? { enum: config.enum } : {}),
              ...(config.minimum !== undefined ? { minimum: config.minimum } : {}),
              ...(config.maximum !== undefined ? { maximum: config.maximum } : {}),
              ...(config.maxLength !== undefined ? { maxLength: config.maxLength } : {})
            }
          };
        }) : [];
        const operation = {
          tags: [endpoint.category || "general"],
          summary: endpoint.name,
          description: endpoint.description,
          operationId: `${endpoint.category || "general"}_${endpoint.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
          security: [],
          parameters,
          responses: {
            "200": { description: "Successful response", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } } },
            "400": { description: "Invalid parameters" },
            "429": {
              description: "Batas 100 request per client IP dalam jendela tetap 60 detik yang berlaku gabungan untuk semua endpoint. Jendela reset otomatis; tunggu sesuai Retry-After.",
              headers: {
                "RateLimit-Limit": { description: "Jumlah maksimum request dalam jendela", schema: { type: "integer", example: 100 } },
                "RateLimit-Remaining": { description: "Request tersisa dalam jendela saat ini", schema: { type: "integer", example: 0 } },
                "RateLimit-Reset": { description: "Waktu reset sebagai Unix timestamp dalam detik", schema: { type: "integer" } },
                "Retry-After": { description: "Detik sebelum jendela kuota IP ini direset", schema: { type: "integer", example: 60 } }
              },
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } }
            },
            "502": { description: "Upstream endpoint failed" },
            "504": { description: "Execution timed out" }
          }
        };
        if (method !== "get" && Object.keys(endpoint.params || {}).length) {
          operation.requestBody = {
            required: Object.values(endpoint.params).some((item) => item?.required),
            content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(Object.entries(endpoint.params).map(([name, configValue]) => {
              const config = configValue && typeof configValue === "object" ? configValue : {};
              return [name, { type: openApiType(config.type), description: config.description || "" }];
            })), required: Object.entries(endpoint.params).filter(([, config]) => config?.required).map(([name]) => name) } } }
          };
        }
        pathItem[method] = operation;
      }
    }
    for (const endpoint of disabledEndpoints) {
      const pathItem = paths[endpoint.endpoint] ||= {};
      for (const methodName of endpoint.method || ["GET"]) {
        const method = String(methodName).toLowerCase();
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        pathItem[method] = {
          tags: [endpoint.category || "general"],
          summary: endpoint.name,
          description: `${endpoint.description}\n\nTidak aktif pada Cloudflare Workers: ${endpoint.unavailable_reason}`,
          operationId: `${endpoint.category || "general"}_${endpoint.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
          security: [],
          responses: { "501": { description: endpoint.unavailable_reason } }
        };
      }
    }
    paths["/health"] = { get: { summary: "Health check", security: [], responses: { "200": { description: "Service is healthy" } } } };
    paths["/api/endpoints"] = { get: { summary: "List registered endpoints", security: [], responses: { "200": { description: "Endpoint registry" } } } };
    paths["/openapi.json"] = { get: { summary: "OpenAPI specification", security: [], responses: { "200": { description: "OpenAPI 3.1 document" } } } };
    return {
      openapi: "3.1.0",
      info: { title: "VP API", version: "1.2.0", description: "VP API modular REST API tanpa API key. Maksimum 100 request per alamat IP dalam jendela tetap 60 detik, dihitung gabungan untuk seluruh endpoint. Jendela setiap IP reset otomatis 60 detik setelah request pertama. Respons mengirim RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, dan Retry-After." },
      servers: [{ url: "/" }],
      paths,
      components: {
        schemas: {
          SuccessResponse: { type: "object", properties: { status: { type: "boolean", const: true }, creator: { type: "string" }, result: {} }, required: ["status", "creator", "result"] },
          ErrorResponse: { type: "object", properties: { status: { type: "boolean", const: false }, creator: { type: "string" }, message: { type: "string" } }, required: ["status", "creator", "message"] }
        }
      }
    };
  };

  app.get("/openapi.json", async (_req, res, next) => {
    try { await ensurePluginsLoaded(); } catch (error) { return next(error); }
    return res.json(buildOpenApiDocument());
  });

  app.all("/:category/:plugin(*)", async (req, res, next) => {
    try { await ensurePluginsLoaded(); } catch (error) { return next(error); }
    const routePath = `/${req.params.category}/${req.params.plugin}`.toLowerCase();
    const disabled = disabledByPath.get(routePath);
    if (disabled) {
      res.setHeader("Allow", (disabled.method || []).join(", "));
      return sendError(res, `Endpoint tidak aktif di Cloudflare Workers: ${disabled.unavailable_reason}`, 501);
    }
    let target = plugins.get(routePath);
    if (!target) target = await resolveSingleRouteOnDemand(req.params.category, req.params.plugin);
    if (!target) return sendError(res, `Endpoint '${routePath}' not found`, 404);

    const sensitiveQueryParam = Object.keys(req.query || {}).find((key) => /token|secret|password|api[_-]?key/i.test(key) && req.query[key] !== "");
    if (sensitiveQueryParam) return sendError(res, `Parameter '${sensitiveQueryParam}' harus dikirim melalui body POST, bukan query URL`, 400);

    if (!target.method.includes(req.method)) {
      res.setHeader("Allow", target.method.join(", "));
      return sendError(res, `Method ${req.method} not allowed`, 405);
    }
    const { input, error } = extractAndValidateInput(target.params, req);
    if (error) return sendError(res, error, 400);

    const cacheKey = `${req.method}:${req.originalUrl}`;
    if (target.cache && req.method === "GET") {
      const cached = getCache(cacheKey);
      if (cached !== null) return sendSuccess(res, cached);
    }

    const controller = new AbortController();
    let timedOut = false;
    let rejectTimeout;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    const disconnectPromise = new Promise((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        if (!timedOut) reject(new Error("Client disconnected"));
      }, { once: true });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      const timeoutError = new Error("Request execution timed out");
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, target.timeout);
    const onResponseClose = () => { if (!res.writableEnded) controller.abort(new Error("Client disconnected")); };
    res.on("close", onResponseClose);

    try {
      const execution = Promise.resolve().then(() => target.execute(req, res, {
        input,
        query: req.query || {},
        body: req.body || {},
        params: req.params || {},
        signal: controller.signal,
        metrics: getMetrics()
      }));
      const result = await Promise.race([execution, timeoutPromise, disconnectPromise]);
      if (!res.headersSent && !res.writableEnded) {
        if (target.cache && req.method === "GET") setCache(cacheKey, result, target.cache);
        return sendSuccess(res, result ?? null);
      }
    } catch (error) {
      if (res.headersSent || res.writableEnded || controller.signal.aborted && !timedOut) return;
      if (timedOut || error?.name === "TimeoutError" || /timed out/i.test(error?.message || "")) {
        return sendError(res, "Request melewati batas waktu eksekusi", 504);
      }
      console.error(`[Endpoint Error] request_id=${req.wolfRequestId} ${routePath}:`, error?.message || error);
      const message = isProduction() ? "Endpoint gagal dijalankan" : (error?.message || "Endpoint gagal dijalankan");
      return sendError(res, message, 502);
    } finally {
      clearTimeout(timer);
      res.off("close", onResponseClose);
    }
  });

  app.use((_req, res) => sendError(res, "Endpoint not found", 404));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    if (error?.type === "entity.too.large") return sendError(res, "Request body terlalu besar", 413);
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) return sendError(res, "JSON body tidak valid", 400);
    console.error(`[Request Error] request_id=${_req.wolfRequestId}:`, error?.message || error);
    return sendError(res, "Terjadi kesalahan pada server", 500);
  });

  return app;
};
