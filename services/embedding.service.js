import { Pinecone } from "@pinecone-database/pinecone";
import { EMBEDDING_BATCH_SIZE, PINECONE_DELETE_BATCH_SIZE } from "../utils/constants.js";
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

const getChunkNamespace = async () => (await ensureIndex()).namespace(process.env.PINECONE_NAMESPACE || "factlayer");
const getFactNamespace = async () => (await ensureIndex()).namespace("facts");

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
  const vectors = await withRetry(() => embedTexts(texts, "db"), { label: "Document embedding" });
  if (vectors.length !== texts.length) throw new Error(`Embedding provider returned ${vectors.length} vectors for ${texts.length} inputs`);
  return vectors.map(assertVector);
};

const createQueryEmbedding = async (text) => {
  const [vector] = await withRetry(() => embedTexts([text], "query"), { label: "Query embedding" });
  return assertVector(vector);
};

const getFactVectorId = (factId) => `fact_${factId.toString()}`;

const upsertChunkEmbeddings = async (chunks) => {
  if (!chunks.length) return;
  const namespace = await getChunkNamespace();
  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
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

const deleteChunkVectors = async (vectorIds) => {
  if (!vectorIds.length || !process.env.PINECONE_API_KEY) return;
  await deleteVectorsByIds(await getChunkNamespace(), vectorIds);
};

const upsertFactEmbeddings = async (facts, onProgress = null) => {
  const vectorsByFactId = new Map();
  if (!facts.length) return vectorsByFactId;
  const namespace = await getFactNamespace();
  for (let index = 0; index < facts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = facts.slice(index, index + EMBEDDING_BATCH_SIZE);
    const vectors = await createEmbeddings(batch.map((fact) => fact.matchText || fact.sourceText));
    batch.forEach((fact, batchIndex) => vectorsByFactId.set(fact._id.toString(), vectors[batchIndex]));
    if (onProgress) await onProgress(Math.min(index + batch.length, facts.length), facts.length);
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

const deleteFactVectors = async (factIds) => {
  if (!factIds.length || !process.env.PINECONE_API_KEY) return;
  await deleteVectorsByIds(await getFactNamespace(), factIds.map(getFactVectorId));
};

const queryFactVectorsByVector = async (vector, topK = 20) => (await getFactNamespace()).query({ vector, topK, includeMetadata: true });

const queryFactVectors = async (text, topK = 20) => queryFactVectorsByVector(await createQueryEmbedding(text), topK);

const queryChunkVectors = async (text, topK = 20) => {
  const vector = await createQueryEmbedding(text);
  return (await getChunkNamespace()).query({ vector, topK, includeMetadata: true });
};

export {
  ensureIndex,
  upsertChunkEmbeddings,
  deleteChunkVectors,
  upsertFactEmbeddings,
  deleteFactVectors,
  getFactVectorId,
  queryFactVectors,
  queryFactVectorsByVector,
  queryChunkVectors,
};
