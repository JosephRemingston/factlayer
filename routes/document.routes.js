import { Router } from "express";
import upload from "../middlewares/upload.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { getDocument, getDocuments, reprocessDocument, uploadDocument } from "../controllers/document.controller.js";

const router = Router();

router.get("/", asyncHandler(getDocuments));
router.post("/upload", upload.fields([{ name: "document", maxCount: 20 }, { name: "documents", maxCount: 20 }]), asyncHandler(uploadDocument));
router.get("/:documentId", asyncHandler(getDocument));
router.post("/:documentId/reprocess", asyncHandler(reprocessDocument));

export default router;
