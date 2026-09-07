import { withRetry } from "../utils/retry.js";
import { FACT_ADJUDICATION_BATCH_SIZE } from "../utils/constants.js";

const DEFAULT_MINIMAX_API_BASE = "https://api.minimax.io/v1";
const EXTRACTION_MODEL = () => process.env.FACT_EXTRACTION_MODEL || "MiniMax-M3";

const extractionSystemPrompt = `You extract meaningful, comparable facts from document chunks.
Return JSON only in the shape {"facts": []}. Do not wrap the JSON in markdown fences and do not add commentary.
Extract the facts a financial analyst would want to compare across documents: financial values, counts, percentages, growth rates, ratios, dates, periods, quantities, and important descriptive business facts such as appointments, resignations, locations, ownership, and stated plans.
Be selective: return at most 15 facts per chunk, preferring the most material and specific ones. Skip boilerplate, table-of-contents lines, disclaimers, page headers, and vague statements with no concrete value or claim.
Each fact is an object with exactly these keys: subject, predicate, object, value, valueType, unit, currency, period, scope, sourceText, confidence.
- subject: the entity the fact is about. Use the organization's actual name (never "the company", "we", "the group", or "the bank") when the document makes it clear which organization is meant.
- predicate: the metric or attribute name (for example "revenue", "revenue growth", "net income", "employee count", "chief executive officer").
- object: a descriptive value for non-numeric facts (for example a person's name, a city, a status), otherwise null.
- value: the numeric value as a number when possible (for example 8142 or 13), otherwise the exact string.
- valueType: one of "number", "currency", "percentage", "date", "text".
- unit: the magnitude or unit word as written (for example "crore", "million", "bn", "employees"), otherwise null.
- currency: the currency code or symbol as written (for example "USD", "Rs", "INR"), otherwise null.
- period: the reporting period as written (for example "FY24", "Q4 2024", "year ended March 31, 2024"), otherwise null.
- scope: the segment, geography, or consolidation basis when stated, otherwise null.
- sourceText: an exact span copied verbatim from the supplied chunk that supports the fact. Never invent evidence.
- confidence: a number between 0 and 1.
Every fact must include subject, predicate, sourceText, confidence, and at least one of value or object.
CRITICAL: distinguish a metric value from a change or growth percentage. In "Revenue increased 25% to $100M", extract revenue = $100M and revenue growth = 25%; never use 25% as the revenue value.
Use null for fields that are not present. Keep values structured and preserve units, currencies, periods, and scope when stated.`;

const buildExtractionPrompt = (chunk, context = {}) => `${extractionSystemPrompt}

Chunk ID: ${chunk._id}
Document ID: ${chunk.documentId}
Page ID: ${chunk.pageId}${context.primaryEntity ? `
Primary organization this document is about: ${context.primaryEntity} (use this name as the subject when the text says "the company", "we", "the group", or similar)` : ""}

CHUNK TEXT:
${chunk.text}`;

// Reasoning models may prefix their answer with <think>...</think>; JSON may also arrive fenced or with prose around it.
const extractJsonText = (text) => {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const unfenced = withoutThinking.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (unfenced.startsWith("{") || unfenced.startsWith("[")) return unfenced;
  const start = Math.min(...["{", "["].map((c) => unfenced.indexOf(c)).filter((i) => i !== -1));
  const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
  return Number.isFinite(start) && end > start ? unfenced.slice(start, end + 1) : unfenced;
};

const parseExtractionResponse = (payload) => {
  let parsed = payload;
  if (typeof payload === "string") parsed = JSON.parse(extractJsonText(payload));
  if (payload?.choices?.[0]?.message?.content) {
    parsed = JSON.parse(extractJsonText(payload.choices[0].message.content));
  }
  if (!parsed || !Array.isArray(parsed.facts)) {
    throw new Error("LLM extraction response must contain a facts array");
  }
  return parsed.facts;
};

// Evidence matching tolerates the differences models introduce when quoting PDF text: quote and dash
// styles, line-break hyphenation, punctuation, and spacing inside numbers. Letters and digits must match.
const normalizeEvidence = (value) => String(value || "")
  .toLowerCase()
  .replace(/[‘’“”]/g, "'")
  .replace(/[‐-―−]/g, "-")
  .replace(/-\s+/g, "")
  .replace(/[^a-z0-9%]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const strictNormalizeEvidence = (value) => normalizeEvidence(value).replace(/\s+/g, "");

const isEvidenceGrounded = (sourceText, chunkText) => {
  const evidence = normalizeEvidence(sourceText);
  const chunk = normalizeEvidence(chunkText);
  if (!evidence || !chunk) return false;
  if (chunk.includes(evidence)) return true;
  // Fall back to a space-insensitive comparison for spans broken by column layouts or wrapped numbers.
  const strictEvidence = strictNormalizeEvidence(sourceText);
  return strictEvidence.length >= 12 && strictNormalizeEvidence(chunkText).includes(strictEvidence);
};

const hasContent = (value) => value !== null && value !== undefined && String(value).trim() !== "";

class FactValidationError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

const validateFact = (fact, chunk) => {
  if (!fact || typeof fact !== "object") throw new FactValidationError("missing_field", "Fact must be an object");
  if (!String(fact.subject || "").trim()) throw new FactValidationError("missing_field", "Fact subject is required");
  if (!String(fact.predicate || "").trim()) throw new FactValidationError("missing_field", "Fact predicate is required");
  if (!String(fact.sourceText || "").trim()) throw new FactValidationError("missing_field", "Fact sourceText is required");
  if (!isEvidenceGrounded(fact.sourceText, chunk.text)) throw new FactValidationError("ungrounded_evidence", "Fact sourceText is not grounded in the chunk");
  if (typeof fact.confidence !== "number" || fact.confidence < 0 || fact.confidence > 1) {
    throw new FactValidationError("invalid_confidence", "Fact confidence must be a number between 0 and 1");
  }
  if (!hasContent(fact.value) && !hasContent(fact.object)) throw new FactValidationError("no_value", "Fact has neither a value nor an object");
  return {
    ...fact,
    subject: fact.subject.trim(),
    predicate: fact.predicate.trim(),
    sourceText: fact.sourceText.trim(),
    documentId: chunk.documentId,
    pageId: chunk.pageId,
    chunkId: chunk._id,
    pageNumber: chunk.pageNumber ?? null,
    extractionModel: EXTRACTION_MODEL(),
  };
};

const validateFacts = (facts, chunk) => facts
  .map((fact) => validateFact(fact, chunk));

const ISSUE_HANDLING = {
  ungrounded_evidence: "Dropped: the quoted evidence does not appear on the page, so the fact cannot be trusted or linked to a source.",
  missing_field: "Dropped: a required field was missing, so the fact could not be identified or grounded.",
  invalid_confidence: "Dropped: the model's confidence was not a number between 0 and 1.",
  no_value: "Dropped: the fact carried neither a value nor a descriptive object, so there was nothing to compare.",
  malformed_json: "Re-requested once with an explicit JSON-only instruction; the repaired reply was used.",
  chunk_failed: "Skipped this page after retries and continued with the rest of the document.",
  adjudication_failed: "Treated the pairs in this batch as different metrics.",
};

// `onIssue` receives every rejected candidate so callers can persist failures as evidence.
const collectValidFacts = (facts, chunk, onIssue = null) => {
  const valid = [];
  for (const fact of facts) {
    try {
      valid.push(validateFact(fact, chunk));
    } catch (error) {
      console.warn(`Skipping fact from chunk ${chunk._id}: ${error.message}`);
      const type = error.type || "missing_field";
      if (onIssue) onIssue({ type, message: error.message, handling: ISSUE_HANDLING[type], candidate: fact });
    }
  }
  return valid;
};

// Optional pacing for providers with per-minute request limits; disabled when unset or 0.
let nextAllowedAt = 0;
const throttle = async () => {
  const rpm = Number(process.env.EXTRACTION_REQUESTS_PER_MINUTE || 0);
  if (!rpm) return;
  const wait = nextAllowedAt - Date.now();
  nextAllowedAt = Math.max(Date.now(), nextAllowedAt) + Math.ceil(60000 / rpm);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
};

const getMinimaxConfig = () => {
  if (!process.env.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is required for fact extraction");
  return {
    apiKey: process.env.MINIMAX_API_KEY,
    baseUrl: (process.env.MINIMAX_API_BASE || DEFAULT_MINIMAX_API_BASE).replace(/\/+$/, ""),
  };
};

// Calls MiniMax's OpenAI-compatible chat completions endpoint and returns the assistant message text.
const invokeMinimax = async (messages, { maxTokens } = {}) => {
  const { apiKey, baseUrl } = getMinimaxConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: EXTRACTION_MODEL(),
      messages,
      temperature: Number(process.env.FACT_EXTRACTION_TEMPERATURE ?? 0.1),
      max_tokens: maxTokens ?? Number(process.env.FACT_EXTRACTION_MAX_TOKENS ?? 8192),
      response_format: { type: "json_object" },
      // MiniMax-M3 thinks by default; structured extraction does not need it, so skip it unless configured.
      ...(/MiniMax-M3/i.test(EXTRACTION_MODEL()) ? { thinking: { type: process.env.MINIMAX_THINKING || "disabled" } } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`MiniMax chat completion failed with status ${response.status}: ${payload?.error?.message || payload?.base_resp?.status_msg || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  // MiniMax reports some failures (quota, invalid key) inside base_resp with HTTP 200.
  if (payload?.base_resp && payload.base_resp.status_code !== 0) {
    const error = new Error(`MiniMax chat completion failed: ${payload.base_resp.status_msg} (code ${payload.base_resp.status_code})`);
    error.status = payload.base_resp.status_code === 1002 ? 429 : 400;
    throw error;
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("MiniMax returned an empty completion");
  return content;
};

const defaultInvoke = async (messages, options) => {
  await throttle();
  return withRetry(() => invokeMinimax(messages, options), { label: "MiniMax completion", retries: 6 });
};

const requestFactExtraction = async (chunk, invokeModel = null, context = {}) => {
  const invoke = invokeModel || defaultInvoke;
  return invoke([
    { role: "system", content: extractionSystemPrompt },
    { role: "user", content: buildExtractionPrompt(chunk, context) },
  ]);
};

const toPayload = (response) => (typeof response === "string" ? response : response?.content ?? response);

// One corrective re-request when the model returns unparseable JSON; models occasionally emit
// trailing commentary, comments, or truncated output despite the instructions.
const extractFactsFromChunk = async (chunk, invokeModel = null, context = {}) => {
  const onIssue = typeof context.onIssue === "function" ? context.onIssue : null;
  const first = await requestFactExtraction(chunk, invokeModel, context);
  try {
    return collectValidFacts(parseExtractionResponse(toPayload(first)), chunk, onIssue);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const snippet = String(toPayload(first) ?? "").slice(0, 200).replace(/\s+/g, " ");
    console.warn(`Chunk ${chunk._id}: unparseable extraction JSON (${error.message}); retrying once. Output began: ${snippet}`);
    if (onIssue) onIssue({ type: "malformed_json", message: error.message, handling: ISSUE_HANDLING.malformed_json, outputPreview: snippet });
  }
  const invoke = invokeModel || defaultInvoke;
  const second = await invoke([
    { role: "system", content: extractionSystemPrompt },
    { role: "user", content: `${buildExtractionPrompt(chunk, context)}\n\nYour previous reply was not valid JSON. Reply with exactly one JSON object of the form {"facts": [...]} and nothing else.` },
  ]);
  return collectValidFacts(parseExtractionResponse(toPayload(second)), chunk, onIssue);
};

// Identifies the organization a document is primarily about from its opening pages, so that
// extraction can resolve "the company" / "we" to a real subject that matches across documents.
const detectPrimaryEntity = async (openingText, invokeModel = null) => {
  const invoke = invokeModel || defaultInvoke;
  const response = await invoke([
    { role: "system", content: 'Identify the single organization a document is primarily about. Return JSON only: {"entity": "<official name without suffixes like Limited, Ltd, Inc, Plc>", "confidence": <0-1>}. If the document is about a country or economy rather than a company (for example a central bank or IMF report about India), return the country or institution name. If unclear, return {"entity": null, "confidence": 0}.' },
    { role: "user", content: `OPENING PAGES:\n${String(openingText || "").slice(0, 6000)}` },
  ], { maxTokens: 200 });
  const parsed = JSON.parse(extractJsonText(toPayload(response)));
  const entity = typeof parsed?.entity === "string" ? parsed.entity.trim() : null;
  return entity && (parsed.confidence ?? 0) >= 0.5 ? entity : null;
};

// Asks the model whether candidate pairs describe the same metric of the same entity. Only pairs whose
// normalized strings differ reach here; the answer decides whether they are compared at all.
const adjudicateFactPairs = async (pairs, invokeModel = null) => {
  const invoke = invokeModel || defaultInvoke;
  const verdicts = new Map();
  for (let index = 0; index < pairs.length; index += FACT_ADJUDICATION_BATCH_SIZE) {
    const batch = pairs.slice(index, index + FACT_ADJUDICATION_BATCH_SIZE);
    const listing = batch.map((pair, i) => `${i + 1}. A: subject="${pair.factA.subject}", metric="${pair.factA.predicate}", period="${pair.factA.period ?? ""}", scope="${pair.factA.scope ?? ""}", evidence="${String(pair.factA.sourceText).slice(0, 220)}"
   B: subject="${pair.factB.subject}", metric="${pair.factB.predicate}", period="${pair.factB.period ?? ""}", scope="${pair.factB.scope ?? ""}", evidence="${String(pair.factB.sourceText).slice(0, 220)}"`).join("\n");
    const response = await invoke([
      { role: "system", content: 'You decide whether two extracted facts describe the same metric or attribute of the same entity, so that their values can be compared. Differences in period, scope, units, or the values themselves do NOT matter here; only whether subject and metric are the same thing expressed differently (for example "Delhivery" vs "the company", "revenue from services" vs "revenue from operations", "net income" vs "profit after tax"). Return JSON only: {"verdicts": [{"pair": <number>, "same": <true|false>, "reason": "<short>"}]} with one entry per pair.' },
      { role: "user", content: `PAIRS:\n${listing}` },
    ], { maxTokens: 2048 });
    let parsed;
    try {
      parsed = JSON.parse(extractJsonText(toPayload(response)));
    } catch (error) {
      console.warn(`Adjudication batch returned unparseable JSON (${error.message}); treating ${batch.length} pairs as different`);
      continue;
    }
    for (const verdict of parsed?.verdicts || []) {
      const pair = batch[Number(verdict.pair) - 1];
      if (pair) verdicts.set(pair.key, { same: verdict.same === true, reason: String(verdict.reason || "").slice(0, 200) });
    }
  }
  return verdicts;
};

export {
  ISSUE_HANDLING,
  FactValidationError,
  invokeMinimax,
  defaultInvoke,
  buildExtractionPrompt,
  extractJsonText,
  parseExtractionResponse,
  requestFactExtraction,
  isEvidenceGrounded,
  validateFact,
  validateFacts,
  collectValidFacts,
  extractFactsFromChunk,
  detectPrimaryEntity,
  adjudicateFactPairs,
};
