import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import { ask } from "../controllers/answer.controller.js";

const router = Router();

router.post("/ask", asyncHandler(ask));
router.get("/ask", asyncHandler(ask));

export default router;
