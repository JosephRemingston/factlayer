import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import {
  getChunkById,
  getDocumentChunks,
  getDocumentPages,
  getPageById,
} from "../services/evidence.service.js";

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

export { getPagesForDocument, getChunksForDocument, getPage, getChunk };