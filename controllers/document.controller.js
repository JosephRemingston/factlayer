import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { addDocumentProcessingJob } from "../queues/document.queues.js";
import { createDocument, getDocumentById } from "../services/document.service.js";

const uploadDocument = async (req, res) => {
  if (!req.file) throw ApiError.badRequest("A PDF file is required in the document field");
  const document = await createDocument(req.file);
  await addDocumentProcessingJob(document._id);
  return ApiResponse.success(res, "Document uploaded successfully", { document });
};

const getDocument = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.documentId)) throw ApiError.badRequest("Invalid document ID");
  const document = await getDocumentById(req.params.documentId);
  if (!document) throw ApiError.notFound("Document not found");
  return ApiResponse.success(res, "Document retrieved successfully", { document });
};

export { uploadDocument, getDocument };