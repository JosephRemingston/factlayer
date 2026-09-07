import { Router } from "express";
import upload from "../middlewares/upload.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { getDocument, uploadDocument } from "../controllers/document.controller.js";

const router = Router();

router.post("/upload", upload.single("document"), asyncHandler(uploadDocument));
router.get("/:documentId", asyncHandler(getDocument));

export default router;