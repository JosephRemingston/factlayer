import { Pinecone } from "@pinecone-database/pinecone";
import { EMBEDDING_BATCH_SIZE } from "../utils/constants.js";

let pineconeIndex;

const getPineconeIndex = () => {
  if (!pineconeIndex) {
    if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
      throw new Error("Pinecone configuration is missing");
    }
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  }
  return pineconeIndex;
};

const getFactVectorId = (factId) => `fact_${factId.toString()}`;

const createEmbeddings = async (texts) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for embeddings");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: process.env.EMBEDDING_MODEL || "text-embedding-3-small", input: texts }),
  });
  if (!response.ok) throw new Error(`Embedding provider failed with status ${response.status}`);
  const payload = await response.json();
  return payload.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
};

const upsertChunkEmbeddings = async (chunks) => {
  if (!chunks.length) return;
  const namespace = getPineconeIndex().namespace(process.env.PINECONE_NAMESPACE || "factlayer");
  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    const vectors = await createEmbeddings(batch.map((chunk) => chunk.text));
    await namespace.upsert(batch.map((chunk, batchIndex) => ({
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
    })));
  }
};

const deleteChunkVectors = async (vectorIds) => {
  if (!vectorIds.length || !process.env.PINECONE_API_KEY) return;
  await getPineconeIndex().namespace(process.env.PINECONE_NAMESPACE || "factlayer").deleteMany(vectorIds);
};

const upsertFactEmbeddings = async (facts) => {
  if (!facts.length) return;
  const namespace = getPineconeIndex().namespace("facts");
  for (let index = 0; index < facts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = facts.slice(index, index + EMBEDDING_BATCH_SIZE);
    const vectors = await createEmbeddings(batch.map((fact) => fact.sourceText));
    await namespace.upsert(batch.map((fact, batchIndex) => ({
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
    })));
  }
};

const deleteFactVectors = async (factIds) => {
  if (!factIds.length || !process.env.PINECONE_API_KEY) return;
  await getPineconeIndex().namespace("facts").deleteMany(factIds.map(getFactVectorId));
};

const queryFactVectors = async (text, topK = 20) => {
  const [vector] = await createEmbeddings([text]);
  return getPineconeIndex().namespace("facts").query({
    vector,
    topK,
    includeMetadata: true,
  });
};

const queryChunkVectors = async (text, topK = 20) => {
  const [vector] = await createEmbeddings([text]);
  return getPineconeIndex().namespace(process.env.PINECONE_NAMESPACE || "factlayer").query({
    vector,
    topK,
    includeMetadata: true,
  });
};

export {
  upsertChunkEmbeddings,
  deleteChunkVectors,
  upsertFactEmbeddings,
  deleteFactVectors,
  getFactVectorId,
  queryFactVectors,
  queryChunkVectors,
};