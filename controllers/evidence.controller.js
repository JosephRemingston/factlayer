import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import {
  getChunkById,
  getDocumentChunks,
  getDocumentPages,
  getPageById,
} from "../services/evidence.service.js";
import { searchChunks } from "../services/search.service.js";

const validateObjectId = (value, label) => {
  if (!mongoose.isValidObjectId(value)) throw ApiError.badRequest(`Invalid ${label}`);
};

const getPagesForDocument = async (req, res) => {
  validateObjectId(req.params.documentId, "document ID");
  const pages = await getDocumentPages(req.params.documentId);
  return ApiResponse.success(res, "Document pages retrieved successfully", { pages });
};

const getChunksForDocument = async (req, res) => {
  validateObjectId(req.params.documentId, "document ID");
  const chunks = await getDocumentChunks(req.params.documentId);
  return ApiResponse.success(res, "Document chunks retrieved successfully", { chunks });
};

const getPage = async (req, res) => {
  validateObjectId(req.params.pageId, "page ID");
  const page = await getPageById(req.params.pageId);
  if (!page) throw ApiError.notFound("Page not found");
  return ApiResponse.success(res, "Page retrieved successfully", { page });
};

const getChunk = async (req, res) => {
  validateObjectId(req.params.chunkId, "chunk ID");
  const chunk = await getChunkById(req.params.chunkId);
  if (!chunk) throw ApiError.notFound("Chunk not found");
  return ApiResponse.success(res, "Chunk retrieved successfully", {
    chunk,
    sourceDocument: chunk.documentId,
    page: chunk.pageId,
    sourceEvidence: chunk.text,
  });
};

const searchChunkRecords = async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) throw ApiError.badRequest("The q query parameter is required");
  const topK = Number(req.query.topK || 10);
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw ApiError.badRequest("topK must be an integer between 1 and 100");
  const results = await searchChunks(query, topK);
  return ApiResponse.success(res, "Chunk search completed successfully", { query, results });
};

export { getPagesForDocument, getChunksForDocument, getPage, getChunk, searchChunkRecords };