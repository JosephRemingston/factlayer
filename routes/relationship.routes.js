import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import { getDocumentRelationships, getRelationship } from "../controllers/relationship.controller.js";

const router = Router();

router.get("/document/:documentId", asyncHandler(getDocumentRelationships));
router.get("/:relationshipId", asyncHandler(getRelationship));

export default router;