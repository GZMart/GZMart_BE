import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as searchController from "../controllers/search.controller.js";
import { uploadMemory } from "../middlewares/uploadMemory.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/search:
 *   get:
 *     tags: [Search]
 *     summary: Search products
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", asyncHandler(searchController.searchProducts));

/**
 * @swagger
 * /api/search/advanced:
 *   get:
 *     tags: [Search]
 *     summary: Advanced search
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/advanced", asyncHandler(searchController.advancedSearch));

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     tags: [Search]
 *     summary: Get search suggestions
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/suggestions", asyncHandler(searchController.getSearchSuggestions));

/**
 * @swagger
 * /api/search/autocomplete:
 *   get:
 *     tags: [Search]
 *     summary: Autocomplete search
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/autocomplete", asyncHandler(searchController.autocomplete));

/**
 * @swagger
 * /api/search/filters:
 *   get:
 *     tags: [Search]
 *     summary: Get available filters
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/filters", asyncHandler(searchController.getAvailableFilters));

/**
 * @swagger
 * /api/search/image:
 *   post:
 *     tags: [Search]
 *     summary: Search by Image
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/image", uploadMemory.single("image"), asyncHandler(searchController.imageSearch));

export default router;
