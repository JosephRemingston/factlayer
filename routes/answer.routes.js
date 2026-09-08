import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import { askRateLimiter } from "../middlewares/rateLimit.middleware.js";
import { ask, providers } from "../controllers/answer.controller.js";

const router = Router();

// Answering costs a model call, so it is rate limited per workspace.
router.post("/ask", askRateLimiter, asyncHandler(ask));
router.get("/ask", askRateLimiter, asyncHandler(ask));
router.get("/providers", asyncHandler(providers));

export default router;
