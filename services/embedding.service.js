import { Pinecone } from "@pinecone-database/pinecone";

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
  const vectors = await createEmbeddings(chunks.map((chunk) => chunk.text));
  const records = chunks.map((chunk, index) => ({
    id: chunk.vectorId,
    values: vectors[index],
    metadata: {
      documentId: chunk.documentId.toString(),
      pageId: chunk.pageId.toString(),
      pageNumber: chunk.pageNumber,
      chunkId: chunk._id.toString(),
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
    },
  }));
  await getPineconeIndex().namespace(process.env.PINECONE_NAMESPACE || "factlayer").upsert(records);
};

const deleteChunkVectors = async (vectorIds) => {
  if (!vectorIds.length || !process.env.PINECONE_API_KEY) return;
  await getPineconeIndex().namespace(process.env.PINECONE_NAMESPACE || "factlayer").deleteMany(vectorIds);
};

const upsertFactEmbeddings = async (facts) => {
  if (!facts.length) return;
  const vectors = await createEmbeddings(facts.map((fact) => fact.sourceText));
  const records = facts.map((fact, index) => ({
    id: getFactVectorId(fact._id),
    values: vectors[index],
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
    },
  }));
  await getPineconeIndex().namespace("facts").upsert(records);
};

const deleteFactVectors = async (factIds) => {
  if (!factIds.length || !process.env.PINECONE_API_KEY) return;
  await getPineconeIndex().namespace("facts").deleteMany(factIds.map(getFactVectorId));
};

export {
  upsertChunkEmbeddings,
  deleteChunkVectors,
  upsertFactEmbeddings,
  deleteFactVectors,
  getFactVectorId,
};