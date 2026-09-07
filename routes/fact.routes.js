import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import { getDocumentFacts, getFact, searchFactRecords } from "../controllers/fact.controller.js";

const router = Router();

router.get("/document/:documentId", asyncHandler(getDocumentFacts));
router.get("/search", asyncHandler(searchFactRecords));
router.get("/:factId", asyncHandler(getFact));

export default router;