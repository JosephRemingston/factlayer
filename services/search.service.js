import Fact from "../models/fact.models.js";
import Chunk from "../models/chunk.models.js";
import mongoose from "mongoose";
import { queryChunkVectors, queryFactVectors } from "./embedding.service.js";

const orderedResults = (matches, records, idField, resultKey) => {
  const byId = new Map(records.map((record) => [record._id.toString(), record]));
  return matches
    .map((match) => {
      const id = match.metadata?.[idField];
      const record = byId.get(id);
      return record ? { score: match.score ?? 0, [resultKey]: record } : null;
    })
    .filter(Boolean);
};

const searchFacts = async (query, topK) => {
  const result = await queryFactVectors(query, topK);
  const ids = (result.matches || [])
    .map((match) => match.metadata?.factId)
    .filter((id) => mongoose.isValidObjectId(id));
  const facts = await Fact.find({ _id: { $in: ids } })
    .populate("documentId")
    .populate("pageId")
    .populate("chunkId")
    .lean();
  return orderedResults(result.matches || [], facts, "factId", "fact");
};

const searchChunks = async (query, topK) => {
  const result = await queryChunkVectors(query, topK);
  const ids = (result.matches || [])
    .map((match) => match.metadata?.chunkId)
    .filter((id) => mongoose.isValidObjectId(id));
  const chunks = await Chunk.find({ _id: { $in: ids } })
    .populate("documentId")
    .populate("pageId")
    .lean();
  return orderedResults(result.matches || [], chunks, "chunkId", "chunk");
};

export { searchFacts, searchChunks };