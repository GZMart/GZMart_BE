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
  getProductsBySeller,
} from "../controllers/product.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import upload from "../middlewares/upload.middleware.js";
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

/**
 * @swagger
 * /api/products:
 *   post:
 *     tags: [Products]
 *     summary: Create a new product
 *     description: Create a product with images and variant information. Supports both JSON and FormData.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - categoryId
 *               - models
 *             properties:
 *               name:
 *                 type: string
 *                 description: Product name
 *               categoryId:
 *                 type: string
 *                 description: Category ID
 *               originalPrice:
 *                 type: number
 *                 description: Original price
 *               description:
 *                 type: string
 *                 description: Product description
 *               tags:
 *                 type: string
 *                 description: JSON stringified array of tags
 *                 example: '["tag1", "tag2"]'
 *               attributes:
 *                 type: string
 *                 description: JSON stringified array of attributes with slug, label, value, type
 *                 example: '[{"slug":"material","label":"Chất liệu","value":"Cotton","type":"select"}]'
 *               tiers:
 *                 type: string
 *                 description: JSON stringified array of tiers (Color, Size, etc.)
 *                 example: '[{"name":"Color","options":["Red","Blue"]}]'
 *               models:
 *                 type: string
 *                 description: JSON stringified array of product variants/models
 *                 example: '[{"tierIndex":[0],"price":150000,"stock":50,"sku":"SP001-RED"}]'
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Product images (multiple files)
 *               sizeChart:
 *                 type: string
 *                 format: binary
 *                 description: Size chart image
 *               variantImages[0]:
 *                 type: string
 *                 format: binary
 *                 description: Image for variant with tierIndex [0]
 *               variantImages[0-1]:
 *                 type: string
 *                 format: binary
 *                 description: Image for variant with tierIndex [0,1]
 *     responses:
 *       201:
 *         description: Product created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
// Create product (Seller/Admin only)
router.post(
  "/",
  protect,
  requireRoles("seller", "admin"),
  upload.any(), // Accept all files (sizeChart, images, variantImages[...])
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
 *     description: Update product details. Supports both JSON and FormData for file uploads.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               categoryId:
 *                 type: string
 *               originalPrice:
 *                 type: number
 *               description:
 *                 type: string
 *               tags:
 *                 type: string
 *                 description: JSON stringified array
 *               attributes:
 *                 type: string
 *                 description: JSON stringified array with slug field
 *                 example: '[{"slug":"material","label":"Chất liệu","value":"Cotton","type":"select"}]'
 *               tiers:
 *                 type: string
 *                 description: JSON stringified array
 *               models:
 *                 type: string
 *                 description: JSON stringified array of variants
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               sizeChart:
 *                 type: string
 *                 format: binary
 *               variantImages[0]:
 *                 type: string
 *                 format: binary
 *                 description: Variant image mapped by tierIndex
 *               status:
 *                 type: string
 *                 enum: [draft, active, inactive]
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               categoryId:
 *                 type: string
 *               originalPrice:
 *                 type: number
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               attributes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     slug:
 *                       type: string
 *                     label:
 *                       type: string
 *                     value:
 *                       type: string
 *                     type:
 *                       type: string
 *               models:
 *                 type: array
 *                 items:
 *                   type: object
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
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
// Get products by seller (Public)
router.get("/seller/:sellerId", asyncHandler(getProductsBySeller));

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

/**
 * @swagger
 * /api/products/seller/{sellerId}:
 *   get:
 *     tags: [Products]
 *     summary: Get products by seller ID
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
// Update & Delete product (Seller/Admin only)
router.put(
  "/:id",
  protect,
  requireRoles("seller", "admin"),
  upload.any(), // Accept all files (sizeChart, images, variantImages[...])
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
