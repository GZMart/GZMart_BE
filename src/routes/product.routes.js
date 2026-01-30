import express from "express";
import {
  getProducts,
  getProduct,
  getFeaturedProducts,
  getTrendingProducts,
  getNewArrivals,
  getBestOffers,
  getProductsAdvanced,
  getAvailableFilters,
  getRelatedProducts,
  getVariantByTierIndex,
  getAvailableOptionsForSelection,
  checkStockAvailability,
  createProduct,
  updateProduct,
  deleteProduct,
  getMyProducts,
} from "../controllers/product.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/products:
 *   get:
 *     tags: [Products]
 *     summary: Get all products
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   post:
 *     tags: [Products]
 *     summary: Create product
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Success
 */

/**
 * @swagger
 * /api/products/search:
 *   get:
 *     tags: [Products]
 *     summary: Search products
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/search", asyncHandler(getProducts));

/**
 * @swagger
 * /api/products/advanced:
 *   get:
 *     tags: [Products]
 *     summary: Advanced product search
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/advanced", asyncHandler(getProductsAdvanced));

/**
 * @swagger
 * /api/products/featured:
 *   get:
 *     tags: [Products]
 *     summary: Get featured products
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/featured", asyncHandler(getFeaturedProducts));

/**
 * @swagger
 * /api/products/trending:
 *   get:
 *     tags: [Products]
 *     summary: Get trending products
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/trending", asyncHandler(getTrendingProducts));

/**
 * @swagger
 * /api/products/new-arrivals:
 *   get:
 *     tags: [Products]
 *     summary: Get new arrivals
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/new-arrivals", asyncHandler(getNewArrivals));

/**
 * @swagger
 * /api/products/best-offers:
 *   get:
 *     tags: [Products]
 *     summary: Get best offers
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/best-offers", asyncHandler(getBestOffers));

/**
 * @swagger
 * /api/products/filters:
 *   get:
 *     tags: [Products]
 *     summary: Get available filters
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/filters", asyncHandler(getAvailableFilters));

// Get all products (base route)
router.get("/", asyncHandler(getProducts));

// Create product (Seller/Admin only)
router.post(
  "/",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(createProduct),
);

// Get my products (Seller)
router.get(
  "/my-products",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(getMyProducts),
);

// Product detail routes
/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   put:
 *     tags: [Products]
 *     summary: Update product
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   delete:
 *     tags: [Products]
 *     summary: Delete product
 *     security:
 *       - bearerAuth: []
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
router.get("/:id", asyncHandler(getProduct));

/**
 * @swagger
 * /api/products/{id}/related:
 *   get:
 *     tags: [Products]
 *     summary: Get related products
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
router.get("/:id/related", asyncHandler(getRelatedProducts));

// Update & Delete product (Seller/Admin only)
router.put(
  "/:id",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(updateProduct),
);
router.delete(
  "/:id",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(deleteProduct),
);

// Variant selection routes (POST)
router.post("/:id/variant", asyncHandler(getVariantByTierIndex));
router.post(
  "/:id/available-options",
  asyncHandler(getAvailableOptionsForSelection),
);

// Stock check
router.get("/model/:modelId/stock", asyncHandler(checkStockAvailability));

export default router;
