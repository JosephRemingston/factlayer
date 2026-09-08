import { Router } from "express";
import upload from "../middlewares/upload.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { uploadRateLimiter } from "../middlewares/rateLimit.middleware.js";
import { completeUpload, createUploadUrls, getDocument, getDocuments, reprocessDocument, uploadDocument } from "../controllers/document.controller.js";

const router = Router();

router.get("/", asyncHandler(getDocuments));
// Direct-to-S3 upload: avoids the host request-body limit for large PDFs.
router.post("/upload-url", uploadRateLimiter, asyncHandler(createUploadUrls));
router.post("/:documentId/uploaded", uploadRateLimiter, asyncHandler(completeUpload));
// Legacy path: sends the bytes through the API, limited by the host body size.
router.post("/upload", uploadRateLimiter, upload.fields([{ name: "document", maxCount: 20 }, { name: "documents", maxCount: 20 }]), asyncHandler(uploadDocument));
router.get("/:documentId", asyncHandler(getDocument));
router.post("/:documentId/reprocess", uploadRateLimiter, asyncHandler(reprocessDocument));

export default router;
