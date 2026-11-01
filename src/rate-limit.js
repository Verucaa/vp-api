export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 100;

const normalizeMax = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return RATE_LIMIT_MAX;
  return Math.min(RATE_LIMIT_MAX, Math.max(1, Math.floor(parsed)));
};

export const getRateLimitOptions = (env = {}) => ({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: normalizeMax(env.RATE_LIMIT_MAX ?? RATE_LIMIT_MAX)
});

export const createRateLimiter = ({ windowMs = RATE_LIMIT_WINDOW_MS, max = RATE_LIMIT_MAX, now = Date.now } = {}) => {
  const duration = Math.max(1000, Number(windowMs) || RATE_LIMIT_WINDOW_MS);
  const limit = normalizeMax(max);
  const buckets = new Map();
  let nextCleanupAt = 0;

  const consume = (identity) => {
    const key = String(identity || "unknown");
    const current = now();
    if (current >= nextCleanupAt) {
      for (const [bucketKey, bucket] of buckets) {
        if (current >= bucket.resetAt) buckets.delete(bucketKey);
      }
      nextCleanupAt = current + Math.max(1000, Math.min(duration, RATE_LIMIT_WINDOW_MS));
    }

    let bucket = buckets.get(key);
    if (!bucket || current >= bucket.resetAt) {
      if (!bucket && buckets.size >= 10_000) {
        const removeCount = Math.max(1, Math.ceil(buckets.size * 0.1));
        const oldestKeys = buckets.keys();
        for (let index = 0; index < removeCount; index++) buckets.delete(oldestKeys.next().value);
      }
      bucket = { count: 0, resetAt: current + duration };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const headers = {
      "RateLimit-Limit": String(limit),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000))
    };
    const allowed = bucket.count <= limit;
    if (!allowed) headers["Retry-After"] = String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)));
    return { allowed, headers, statusCode: allowed ? 200 : 429 };
  };

  const middleware = (req, res, next) => {
    const key = String(req.ip || req.socket?.remoteAddress || "unknown");
    const result = consume(key);
    for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    if (!result.allowed) {
      return res.status(429).json({ status: false, creator: "Veruu", message: "Terlalu banyak request; coba lagi setelah jeda" });
    }
    return next();
  };

  middleware.consume = consume;
  return middleware;
};
