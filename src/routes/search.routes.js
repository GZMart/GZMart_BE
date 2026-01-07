import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as searchController from "../controllers/search.controller.js";

const router = express.Router();

// Public routes
router.get("/", asyncHandler(searchController.searchProducts));
router.get("/advanced", asyncHandler(searchController.advancedSearch)); // MongoDB Aggregation
router.get("/suggestions", asyncHandler(searchController.getSearchSuggestions));
router.get("/autocomplete", asyncHandler(searchController.autocomplete));
router.get("/filters", asyncHandler(searchController.getAvailableFilters));

export default router;
