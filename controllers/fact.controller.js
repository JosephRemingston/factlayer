import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import Fact from "../models/fact.models.js";

const getDocumentFacts = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.documentId)) throw ApiError.badRequest("Invalid document ID");
  const facts = await Fact.find({ documentId: req.params.documentId }).sort({ createdAt: 1 }).lean();
  return ApiResponse.success(res, "Document facts retrieved successfully", { facts });
};

const getFact = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.factId)) throw ApiError.badRequest("Invalid fact ID");
  const fact = await Fact.findById(req.params.factId)
    .populate("documentId")
    .populate("pageId")
    .populate("chunkId")
    .lean();
  if (!fact) throw ApiError.notFound("Fact not found");
  return ApiResponse.success(res, "Fact retrieved successfully", {
    fact,
    sourceDocument: fact.documentId,
    page: fact.pageId,
    chunk: fact.chunkId,
    sourceEvidence: fact.sourceText,
  });
};

export { getDocumentFacts, getFact };