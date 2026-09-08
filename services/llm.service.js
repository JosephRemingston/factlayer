import { withRetry, getStatus } from "../utils/retry.js";
import { PROVIDER_COOLDOWN_MS } from "../utils/constants.js";

const DEFAULT_MINIMAX_API_BASE = "https://api.minimax.io/v1";
const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

class RateLimitError extends Error {
  constructor(provider, message, retryAfterMs) {
    super(message);
    this.name = "RateLimitError";
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
    this.status = 429;
  }
}

const isRateLimited = (error) => error instanceof RateLimitError
  || getStatus(error) === 429
  || /rate limit|quota|RESOURCE_EXHAUSTED|too many requests/i.test(String(error?.message || ""));

const suggestedDelayMs = (message) => {
  const seconds = String(message).match(/retry in ([\d.]+)s/i)?.[1] ?? String(message).match(/"retryDelay"\s*:\s*"(\d+)s"/)?.[1];
  return seconds ? Math.ceil(Number(seconds) * 1000) + 500 : null;
};

// --- MiniMax: OpenAI-compatible chat completions -------------------------------------------------
const minimaxModel = () => process.env.FACT_EXTRACTION_MODEL || "MiniMax-M3";

const callMiniMax = async (messages, { maxTokens }) => {
  const baseUrl = (process.env.MINIMAX_API_BASE || DEFAULT_MINIMAX_API_BASE).replace(/\/+$/, "");
  const model = minimaxModel();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: Number(process.env.FACT_EXTRACTION_TEMPERATURE ?? 0.1),
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      // MiniMax-M3 thinks by default; structured extraction does not need it.
      ...(/MiniMax-M3/i.test(model) ? { thinking: { type: process.env.MINIMAX_THINKING || "disabled" } } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  const detail = payload?.error?.message || payload?.base_resp?.status_msg || response.statusText;
  if (response.status === 429) throw new RateLimitError("minimax", `MiniMax rate limited: ${detail}`, suggestedDelayMs(detail));
  if (!response.ok) {
    const error = new Error(`MiniMax failed with status ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  // MiniMax reports quota failures inside base_resp with HTTP 200.
  if (payload?.base_resp && payload.base_resp.status_code !== 0) {
    const message = `MiniMax failed: ${payload.base_resp.status_msg} (code ${payload.base_resp.status_code})`;
    if (payload.base_resp.status_code === 1002 || payload.base_resp.status_code === 2062) {
      throw new RateLimitError("minimax", message, suggestedDelayMs(payload.base_resp.status_msg));
    }
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("MiniMax returned an empty completion");
  return { text, model };
};

// --- Gemini: generateContent, with the system turn mapped to systemInstruction --------------------
const geminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

const callGemini = async (messages, { maxTokens }) => {
  const baseUrl = (process.env.GEMINI_API_BASE || DEFAULT_GEMINI_API_BASE).replace(/\/+$/, "");
  const model = geminiModel();
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: Number(process.env.FACT_EXTRACTION_TEMPERATURE ?? 0.1),
        maxOutputTokens: maxTokens,
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  const detail = payload?.error?.message || response.statusText;
  if (response.status === 429) throw new RateLimitError("gemini", `Gemini rate limited: ${detail}`, suggestedDelayMs(JSON.stringify(payload?.error?.details || detail)));
  if (!response.ok) {
    const error = new Error(`Gemini failed with status ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  const candidate = payload?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((part) => part.text || "").join("");
  if (!text.trim()) throw new Error(`Gemini returned an empty completion (finishReason ${candidate?.finishReason})`);
  return { text, model };
};

const PROVIDERS = {
  minimax: { name: "minimax", call: callMiniMax, configured: () => Boolean(process.env.MINIMAX_API_KEY), model: minimaxModel },
  gemini: { name: "gemini", call: callGemini, configured: () => Boolean(process.env.GEMINI_API_KEY), model: geminiModel },
};

// A provider that reports a rate limit is parked until its cooldown expires; work continues on the
// next configured provider, and returns to the first as soon as it is eligible again.
const cooldowns = new Map();
const availableAt = (name) => cooldowns.get(name) ?? 0;
const isCoolingDown = (name) => availableAt(name) > Date.now();

const parkProvider = (name, retryAfterMs) => {
  const until = Date.now() + Math.min(Math.max(retryAfterMs ?? PROVIDER_COOLDOWN_MS, 1000), 300000);
  cooldowns.set(name, until);
  return until;
};

const providerOrder = () => {
  const preferred = (process.env.LLM_PROVIDER || "minimax").toLowerCase();
  const names = [preferred, ...Object.keys(PROVIDERS).filter((name) => name !== preferred)];
  return names.map((name) => PROVIDERS[name]).filter((provider) => provider && provider.configured());
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one chat request, failing over between providers on rate limits. Each call is a unit of work
 * (one chunk, one adjudication batch, one answer), so a provider switch resumes exactly where the
 * previous provider stopped rather than restarting the document.
 */
const callLLM = async (messages, { maxTokens = 8192, label = "LLM call" } = {}) => {
  const providers = providerOrder();
  if (!providers.length) throw new Error("No LLM provider configured; set MINIMAX_API_KEY or GEMINI_API_KEY");
  // Rate limits are a delay, not a failure: keep cycling providers until the budget is spent, so a
  // page is never dropped just because both providers were busy at the same moment.
  const deadline = Date.now() + Number(process.env.LLM_RATE_LIMIT_BUDGET_MS || 300000);
  for (let round = 0; ; round += 1) {
    const ready = providers.filter((provider) => !isCoolingDown(provider.name));
    for (const provider of ready) {
      try {
        // Transient failures retry on the same provider; a rate limit moves to the next one.
        const result = await withRetry(() => provider.call(messages, { maxTokens }), {
          label: `${label} (${provider.name})`,
          retries: 2,
          shouldRetry: (error) => !isRateLimited(error),
        });
        return { ...result, provider: provider.name };
      } catch (error) {
        if (!isRateLimited(error)) throw error;
        const until = parkProvider(provider.name, error.retryAfterMs);
        const next = providers.find((candidate) => candidate.name !== provider.name && !isCoolingDown(candidate.name));
        console.warn(`${label}: ${provider.name} rate limited, paused ${Math.ceil((until - Date.now()) / 1000)}s${next ? `; continuing on ${next.name}` : "; no other provider available"}`);
      }
    }
    // Every provider is parked: wait for the first one to become eligible and try again.
    const soonest = Math.min(...providers.map((provider) => availableAt(provider.name)));
    const waitMs = Math.max(500, soonest - Date.now());
    if (Date.now() + waitMs > deadline) {
      throw new Error(`${label} failed: every provider stayed rate limited for ${Math.round(Number(process.env.LLM_RATE_LIMIT_BUDGET_MS || 300000) / 1000)}s`);
    }
    if (round % 5 === 0) console.warn(`${label}: all providers rate limited, waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
};

const providerStatus = () => providerOrder().map((provider) => ({
  provider: provider.name,
  model: provider.model(),
  available: !isCoolingDown(provider.name),
  availableInSeconds: isCoolingDown(provider.name) ? Math.ceil((availableAt(provider.name) - Date.now()) / 1000) : 0,
}));

const resetProviderCooldowns = () => cooldowns.clear();

export { callLLM, providerStatus, resetProviderCooldowns, isRateLimited, RateLimitError, PROVIDERS };
