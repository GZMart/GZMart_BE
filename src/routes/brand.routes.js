import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import brandController from "../controllers/brand.controller.js";

const router = express.Router();

/**
 * @swagger
 * /api/brands:
 *   get:
 *     tags: [Brands]
 *     summary: Get all brands
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", asyncHandler(brandController.getBrands.bind(brandController)));

/**
 * @swagger
 * /api/brands/top:
 *   get:
 *     tags: [Brands]
 *     summary: Get top brands
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/top",
  asyncHandler(brandController.getTopBrands.bind(brandController)),
);

/**
 * @swagger
 * /api/brands/{id}:
 *   get:
 *     tags: [Brands]
 *     summary: Get brand by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/:id",
  asyncHandler(brandController.getBrandById.bind(brandController)),
);

/**
 * @swagger
 * /api/brands/{id}/products:
 *   get:
 *     tags: [Brands]
 *     summary: Get products by brand
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/:id/products",
  asyncHandler(brandController.getBrandProducts.bind(brandController)),
);

export default router;
