import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import {
  createDocument,
  createDirectUpload,
  confirmDirectUpload,
  getDocumentById,
  isDocumentBusy,
  listDocuments,
  startDocumentProcessing,
  withProgress,
} from "../services/document.service.js";

// Accepts one or many PDFs in the `document` (or `documents`) field. Each file becomes its own document
// and starts processing immediately; the response lists them in upload order.
const uploadDocument = async (req, res) => {
  const files = [...(req.files?.document || []), ...(req.files?.documents || []), ...(req.file ? [req.file] : [])];
  if (!files.length) throw ApiError.badRequest("At least one PDF file is required in the document field");
  const documents = [];
  for (const file of files) {
    const { document, buffer } = await createDocument(file, req.owner);
    // Processing runs in this process; the response returns as soon as the files are stored.
    startDocumentProcessing(document._id, { buffer });
    documents.push(withProgress(document.toObject()));
  }
  const message = documents.length === 1 ? "Document uploaded successfully" : `${documents.length} documents uploaded successfully`;
  return ApiResponse.success(res, message, { document: documents[0], documents });
};

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// Step 1 of a direct upload: register the files and hand back one presigned S3 URL each.
const createUploadUrls = async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) throw ApiError.badRequest("Provide files: [{ name, size }] to upload");
  if (files.length > 20) throw ApiError.badRequest("Upload at most 20 PDF files per request");
  const uploads = [];
  for (const file of files) {
    const name = String(file?.name || "").trim();
    const size = Number(file?.size || 0);
    if (!name.toLowerCase().endsWith(".pdf")) throw ApiError.badRequest(`Only PDF files are allowed: ${name || "unnamed file"}`);
    if (!Number.isFinite(size) || size <= 0) throw ApiError.badRequest(`Missing file size for ${name}`);
    if (size > MAX_UPLOAD_BYTES) throw ApiError.badRequest(`File size must not exceed 200 MB: ${name}`);
    uploads.push(await createDirectUpload({ name, size }, req.owner));
  }
  return ApiResponse.success(res, "Upload URLs created successfully", { uploads });
};

// Step 2: the browser reports the PUT finished, and processing starts from the object in S3.
const completeUpload = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.documentId)) throw ApiError.badRequest("Invalid document ID");
  const document = await confirmDirectUpload(req.params.documentId, req.owner);
  if (!document) throw ApiError.notFound("Document not found");
  startDocumentProcessing(document._id);
  return ApiResponse.success(res, "Document upload completed successfully", { document: withProgress(document.toObject()) });
};

const getDocument = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.documentId)) throw ApiError.badRequest("Invalid document ID");
  const document = await getDocumentById(req.params.documentId, req.owner);
  if (!document) throw ApiError.notFound("Document not found");
  return ApiResponse.success(res, "Document retrieved successfully", { document });
};

const getDocuments = async (req, res) => {
  const documents = await listDocuments(req.owner);
  return ApiResponse.success(res, "Documents retrieved successfully", { documents });
};

// Re-runs processing. By default it resumes (only unfinished chunks are extracted); pass ?reset=true
// to discard all derived data and start from the PDF again.
const reprocessDocument = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.documentId)) throw ApiError.badRequest("Invalid document ID");
  const document = await getDocumentById(req.params.documentId, req.owner);
  if (!document) throw ApiError.notFound("Document not found");
  if (isDocumentBusy(document)) throw ApiError.badRequest("Document is already being processed");
  const reset = String(req.query.reset || "").toLowerCase() === "true";
  startDocumentProcessing(document._id, { reset });
  return ApiResponse.success(res, reset ? "Document reprocessing started" : "Document processing resumed", { document: { ...document, status: "processing" } });
};

export { uploadDocument, createUploadUrls, completeUpload, getDocument, getDocuments, reprocessDocument };
