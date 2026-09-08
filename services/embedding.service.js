import { Pinecone } from "@pinecone-database/pinecone";
import { DEFAULT_OWNER, EMBEDDING_BATCH_SIZE, EMBEDDING_BATCH_TOKEN_BUDGET, EMBEDDING_TOKENS_PER_MINUTE, PINECONE_DELETE_BATCH_SIZE } from "../utils/constants.js";
import { withRetry } from "../utils/retry.js";

const DEFAULT_MINIMAX_API_BASE = "https://api.minimax.io/v1";
const DEFAULT_MINIMAX_EMBEDDING_MODEL = "embo-01";
const DEFAULT_PINECONE_EMBEDDING_MODEL = "llama-text-embed-v2";

let pineconeClient;
let pineconeIndex;
let indexReady;

const getEmbeddingProvider = () => (process.env.EMBEDDING_PROVIDER || "pinecone").toLowerCase();

const getEmbeddingDimension = () => {
  if (!process.env.EMBEDDING_DIMENSION) return null;
  const dimension = Number(process.env.EMBEDDING_DIMENSION);
  if (!Number.isInteger(dimension) || dimension < 1) throw new Error("EMBEDDING_DIMENSION must be a positive integer");
  return dimension;
};

const getPineconeClient = () => {
  if (!pineconeClient) {
    if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
      throw new Error("Pinecone configuration is missing");
    }
    pineconeClient = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  return pineconeClient;
};

// Creates the index on first use when it does not exist, and fails fast when its dimension
// does not match the configured embedding dimension.
const ensureIndex = async () => {
  if (!indexReady) {
    indexReady = (async () => {
      const client = getPineconeClient();
      const name = process.env.PINECONE_INDEX_NAME;
      const dimension = getEmbeddingDimension();
      let description = await client.describeIndex(name).catch((error) => {
        if (error?.name === "PineconeNotFoundError") return null;
        throw error;
      });
      if (!description) {
        if (!dimension) throw new Error(`Pinecone index "${name}" does not exist and EMBEDDING_DIMENSION is not set, so it cannot be created`);
        console.log(`Creating Pinecone index "${name}" with dimension ${dimension}`);
        await client.createIndex({
          name,
          dimension,
          metric: "cosine",
          spec: { serverless: { cloud: process.env.PINECONE_CLOUD || "aws", region: process.env.PINECONE_REGION || "us-east-1" } },
          waitUntilReady: true,
          suppressConflicts: true,
        });
        description = await client.describeIndex(name);
      }
      if (dimension && description.dimension && description.dimension !== dimension) {
        throw new Error(`Pinecone index "${name}" has dimension ${description.dimension} but EMBEDDING_DIMENSION=${dimension}; use a different PINECONE_INDEX_NAME or matching embedding model`);
      }
      pineconeIndex = client.index(name);
    })().catch((error) => {
      indexReady = undefined;
      throw error;
    });
  }
  await indexReady;
  return pineconeIndex;
};

// One namespace pair per workspace keeps each tester's vectors isolated, so retrieval, matching and
// answers never reach across workspaces.
const chunkNamespaceName = (owner) => `chunks__${owner || DEFAULT_OWNER}`;
const factNamespaceName = (owner) => `facts__${owner || DEFAULT_OWNER}`;
const getChunkNamespace = async (owner) => (await ensureIndex()).namespace(chunkNamespaceName(owner));
const getFactNamespace = async (owner) => (await ensureIndex()).namespace(factNamespaceName(owner));

const assertVector = (vector) => {
  const dimension = getEmbeddingDimension();
  if (!Array.isArray(vector) || vector.length === 0) throw new Error("Embedding provider returned an empty vector");
  if (dimension && vector.length !== dimension) {
    throw new Error(`Embedding dimension ${vector.length} does not match EMBEDDING_DIMENSION=${dimension}`);
  }
  return vector;
};

// MiniMax embeddings: POST /v1/embeddings with { model, texts, type } where type is "db" for
// stored documents and "query" for search queries; the response carries a top-level vectors array.
const minimaxEmbed = async (texts, type) => {
  if (!process.env.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is required for embeddings");
  const baseUrl = (process.env.MINIMAX_API_BASE || DEFAULT_MINIMAX_API_BASE).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
    body: JSON.stringify({
      model: process.env.MINIMAX_EMBEDDING_MODEL || DEFAULT_MINIMAX_EMBEDDING_MODEL,
      texts: texts.map((text) => String(text || "").replace(/\s+/g, " ").trim() || " "),
      type,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`MiniMax embeddings failed with status ${response.status}: ${payload?.error?.message || payload?.base_resp?.status_msg || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  if (payload?.base_resp && payload.base_resp.status_code !== 0) {
    const error = new Error(`MiniMax embeddings failed: ${payload.base_resp.status_msg} (code ${payload.base_resp.status_code})`);
    error.status = payload.base_resp.status_code === 1002 ? 429 : 400;
    throw error;
  }
  const vectors = payload?.vectors || payload?.data?.map((item) => item.embedding) || [];
  if (vectors.length !== texts.length) throw new Error(`MiniMax returned ${vectors.length} vectors for ${texts.length} inputs`);
  return vectors;
};

// Pinecone-hosted inference (covered by the Pinecone API key): type "db" maps to input_type
// "passage" and "query" to "query"; llama-text-embed-v2 accepts a dimension parameter.
const pineconeEmbed = async (texts, type) => {
  const model = process.env.PINECONE_EMBEDDING_MODEL || DEFAULT_PINECONE_EMBEDDING_MODEL;
  const dimension = getEmbeddingDimension();
  const response = await getPineconeClient().inference.embed({
    model,
    inputs: texts.map((text) => String(text || "").replace(/\s+/g, " ").trim() || " "),
    parameters: {
      inputType: type === "query" ? "query" : "passage",
      truncate: "END",
      ...(dimension && /llama-text-embed/i.test(model) ? { dimension } : {}),
    },
  });
  return (response.data || []).map((item) => item.values);
};

const embedTexts = async (texts, type) => {
  const provider = getEmbeddingProvider();
  if (provider === "pinecone") return pineconeEmbed(texts, type);
  if (provider === "minimax") return minimaxEmbed(texts, type);
  throw new Error(`Unsupported EMBEDDING_PROVIDER "${provider}"; use "pinecone" or "minimax"`);
};

const createEmbeddings = async (texts) => {
  if (!texts.length) return [];
  await reserveTokens(texts.reduce((sum, text) => sum + estimateTokens(text), 0));
  const vectors = await withRetry(() => embedTexts(texts, "db"), { label: "Document embedding", retries: 8 });
  if (vectors.length !== texts.length) throw new Error(`Embedding provider returned ${vectors.length} vectors for ${texts.length} inputs`);
  return vectors.map(assertVector);
};

const createQueryEmbedding = async (text) => {
  await reserveTokens(estimateTokens(text));
  const [vector] = await withRetry(() => embedTexts([text], "query"), { label: "Query embedding", retries: 8 });
  return assertVector(vector);
};

// Rough token estimate; providers bill embeddings per token and cap them per minute.
const estimateTokens = (text) => Math.ceil(String(text || "").length / 4) + 8;

// Splits texts so no single request exceeds the per-request token budget or the batch count.
const batchByTokens = (items, textOf) => {
  const maxTokens = Number(process.env.EMBEDDING_BATCH_TOKEN_BUDGET || EMBEDDING_BATCH_TOKEN_BUDGET);
  const maxCount = Number(process.env.EMBEDDING_BATCH_SIZE || EMBEDDING_BATCH_SIZE);
  const batches = [];
  let current = [];
  let tokens = 0;
  for (const item of items) {
    const cost = estimateTokens(textOf(item));
    if (current.length && (current.length >= maxCount || tokens + cost > maxTokens)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(item);
    tokens += cost;
  }
  if (current.length) batches.push(current);
  return batches;
};

// Process-wide sliding-window limiter: waits until the last 60 seconds of embedding spend leaves
// room for this request, so concurrent documents cannot exceed the provider's tokens-per-minute cap.
const spendWindow = [];
const reserveTokens = async (tokens) => {
  const limit = Number(process.env.EMBEDDING_TOKENS_PER_MINUTE || EMBEDDING_TOKENS_PER_MINUTE);
  if (!limit) return;
  for (;;) {
    const cutoff = Date.now() - 60000;
    while (spendWindow.length && spendWindow[0].at <= cutoff) spendWindow.shift();
    const used = spendWindow.reduce((sum, entry) => sum + entry.tokens, 0);
    if (used + tokens <= limit || !spendWindow.length) {
      spendWindow.push({ at: Date.now(), tokens });
      return;
    }
    const waitMs = Math.max(250, spendWindow[0].at + 60000 - Date.now());
    console.log(`Embedding rate limiter: waiting ${Math.ceil(waitMs / 1000)}s (${used} tokens used in the last minute)`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
};

const getFactVectorId = (factId) => `fact_${factId.toString()}`;

const upsertChunkEmbeddings = async (chunks, owner) => {
  if (!chunks.length) return;
  const namespace = await getChunkNamespace(owner);
  for (const batch of batchByTokens(chunks, (chunk) => chunk.text)) {
    const vectors = await createEmbeddings(batch.map((chunk) => chunk.text));
    await namespace.upsert({
      records: batch.map((chunk, batchIndex) => ({
        id: chunk.vectorId,
        values: vectors[batchIndex],
        metadata: {
          documentId: chunk.documentId.toString(),
          pageId: chunk.pageId.toString(),
          pageNumber: chunk.pageNumber,
          chunkId: chunk._id.toString(),
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
        },
      })),
    });
  }
};

const deleteVectorsByIds = async (namespace, ids) => {
  for (let index = 0; index < ids.length; index += PINECONE_DELETE_BATCH_SIZE) {
    try {
      await namespace.deleteMany({ ids: ids.slice(index, index + PINECONE_DELETE_BATCH_SIZE) });
    } catch (error) {
      // Serverless indexes return 404 when the namespace has never been written to; nothing to delete.
      if (error?.name === "PineconeNotFoundError") return;
      throw error;
    }
  }
};

const deleteChunkVectors = async (vectorIds, owner) => {
  if (!vectorIds.length || !process.env.PINECONE_API_KEY) return;
  await deleteVectorsByIds(await getChunkNamespace(owner), vectorIds);
};

const upsertFactEmbeddings = async (facts, onProgress = null, owner = undefined) => {
  const vectorsByFactId = new Map();
  if (!facts.length) return vectorsByFactId;
  const namespace = await getFactNamespace(owner ?? facts[0]?.owner);
  let embedded = 0;
  for (const batch of batchByTokens(facts, (fact) => fact.matchText || fact.sourceText)) {
    const vectors = await createEmbeddings(batch.map((fact) => fact.matchText || fact.sourceText));
    batch.forEach((fact, batchIndex) => vectorsByFactId.set(fact._id.toString(), vectors[batchIndex]));
    embedded += batch.length;
    if (onProgress) await onProgress(embedded, facts.length);
    await namespace.upsert({
      records: batch.map((fact, batchIndex) => ({
        id: getFactVectorId(fact._id),
        values: vectors[batchIndex],
        metadata: {
          factId: fact._id.toString(),
          documentId: fact.documentId.toString(),
          pageId: fact.pageId.toString(),
          chunkId: fact.chunkId.toString(),
          subject: fact.subject,
          predicate: fact.predicate,
          value: typeof fact.value === "object" ? JSON.stringify(fact.value) : String(fact.value ?? ""),
          period: fact.period || "",
          scope: fact.scope || "",
          normalizedSubject: fact.normalizedSubject || "",
          normalizedPredicate: fact.normalizedPredicate || "",
          normalizedValue: fact.normalizedValue ?? 0,
          normalizedCurrency: fact.normalizedCurrency || "",
          periodLabel: fact.periodLabel || "",
          normalizedScope: fact.normalizedScope || "",
        },
      })),
    });
  }
  return vectorsByFactId;
};

const deleteFactVectors = async (factIds, owner) => {
  if (!factIds.length || !process.env.PINECONE_API_KEY) return;
  await deleteVectorsByIds(await getFactNamespace(owner), factIds.map(getFactVectorId));
};

const queryFactVectorsByVector = async (vector, topK = 20, owner) => (await getFactNamespace(owner)).query({ vector, topK, includeMetadata: true });

const queryFactVectors = async (text, topK = 20, owner) => queryFactVectorsByVector(await createQueryEmbedding(text), topK, owner);

const queryChunkVectors = async (text, topK = 20, owner) => {
  const vector = await createQueryEmbedding(text);
  return (await getChunkNamespace(owner)).query({ vector, topK, includeMetadata: true });
};

export {
  ensureIndex,
  chunkNamespaceName,
  factNamespaceName,
  batchByTokens,
  estimateTokens,
  upsertChunkEmbeddings,
  deleteChunkVectors,
  upsertFactEmbeddings,
  deleteFactVectors,
  getFactVectorId,
  queryFactVectors,
  queryFactVectorsByVector,
  queryChunkVectors,
};
