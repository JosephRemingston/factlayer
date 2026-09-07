import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import { showcase } from "../controllers/showcase.controller.js";

const router = Router();

router.get("/showcase", asyncHandler(showcase));

export default router;
