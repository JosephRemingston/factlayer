import ApiError from "../utils/ApiError.js";

/**
 * Fixed-window limiter kept in process memory. Model-backed endpoints cost real money and provider
 * quota, so they are capped per workspace: one person cannot exhaust the shared providers for
 * everyone else. Not a security control, and it resets when the server restarts.
 */
const createRateLimiter = ({ windowMs, max, name = "requests" }) => {
  const hits = new Map();
  // Drop windows that are already over so the map cannot grow without bound.
  const sweep = (now) => {
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  };
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 500) sweep(now);
    const key = req.owner || req.ip || "anonymous";
    const entry = hits.get(key);
    const limited = Boolean(entry) && entry.resetAt > now && entry.count >= max;
    if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
    else if (!limited) entry.count += 1;

    const current = hits.get(key);
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(Math.max(0, max - current.count)));
    res.set("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));
    if (limited) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      throw ApiError.tooManyRequests(`Too many ${name}. You can send ${max} every ${Math.round(windowMs / 1000)}s; try again in ${retryAfter}s.`);
    }
    next();
  };
};

// Each question is one LLM call plus retrieval, so this is deliberately tight.
const askRateLimiter = createRateLimiter({
  windowMs: Number(process.env.ASK_RATE_WINDOW_MS || 60000),
  max: Number(process.env.ASK_RATE_MAX || 10),
  name: "questions",
});

// Uploads start long, expensive pipelines.
const uploadRateLimiter = createRateLimiter({
  windowMs: Number(process.env.UPLOAD_RATE_WINDOW_MS || 60000),
  max: Number(process.env.UPLOAD_RATE_MAX || 10),
  name: "uploads",
});

export { createRateLimiter, askRateLimiter, uploadRateLimiter };
