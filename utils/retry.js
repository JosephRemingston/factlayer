const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const getStatus = (error) => {
  const message = String(error?.message || "");
  const fromMessage = message.match(/\[(\d{3})\s*\]/)?.[1] ?? message.match(/Status:\s*(\d{3})/i)?.[1] ?? message.match(/"status"\s*:\s*(\d{3})/)?.[1];
  return Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? fromMessage);
};

const getSuggestedDelayMs = (error) => {
  const message = String(error?.message || "");
  const match = message.match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 500;
  // Per-minute token or request windows (Pinecone inference, MiniMax) clear within a minute.
  if (/per minute|RESOURCE_EXHAUSTED|\(RPM\)/i.test(message)) return 20000;
  return null;
};

const isRetryable = (error) => RETRYABLE_STATUSES.has(getStatus(error))
  || /quota|rate limit|RESOURCE_EXHAUSTED|per minute|ECONNRESET|ETIMEDOUT|fetch failed/i.test(String(error?.message || ""));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async (operation, { retries = 6, baseDelayMs = 2000, maxDelayMs = 60000, label = "operation" } = {}) => {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryable(error)) throw error;
      const delay = Math.min(getSuggestedDelayMs(error) ?? baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      console.warn(`${label} failed (attempt ${attempt}/${retries}); retrying in ${Math.round(delay / 1000)}s: ${String(error.message).split("\n")[0].slice(0, 160)}`);
      await sleep(delay);
    }
  }
};

export { withRetry, isRetryable, getStatus };
