import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import {
  getChunk,
  getChunksForDocument,
  getPage,
  getPagesForDocument,
} from "../controllers/evidence.controller.js";

const router = Router();

router.get("/documents/:documentId/pages", asyncHandler(getPagesForDocument));
router.get("/documents/:documentId/chunks", asyncHandler(getChunksForDocument));
router.get("/pages/:pageId", asyncHandler(getPage));
router.get("/chunks/:chunkId", asyncHandler(getChunk));

export default router;