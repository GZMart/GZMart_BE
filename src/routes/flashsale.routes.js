import express from "express";
import {
  createFlashSale,
  getFlashSales,
  getFlashSaleDetail,
  getActiveFlashSales,
  addProductsToFlashSale,
  getFlashSaleProducts,
  getFlashSaleProduct,
  updateFlashSale,
  updateFlashSaleProduct,
  removeProductFromFlashSale,
  deleteFlashSale,
  getFlashSaleStats,
  searchFlashSaleProducts,
} from "../controllers/flashsale.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/flash-sales/active:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Get active flash sales
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/active", asyncHandler(getActiveFlashSales));

/**
 * @swagger
 * /api/flash-sales:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Get all flash sales
 *     responses:
 *       200:
 *         description: Success
 *   post:
 *     tags: [Flash Sales]
 *     summary: Create flash sale
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Success
 */
router.get("/", asyncHandler(getFlashSales));

router.post(
  "/",
  protect,
  authorize("seller", "admin"),
  asyncHandler(createFlashSale),
);

// ============= SPECIFIC ROUTES BEFORE PARAMETERIZED ROUTES =============

/**
 * @route   GET /api/flash-sales/:flashSaleId/stats
 * @desc    Get flash sale statistics (views, sold, revenue, discount)
 * @access  Private (Seller, Admin)
 */
router.get(
  "/:flashSaleId/stats",
  protect,
  authorize("seller", "admin"),
  asyncHandler(getFlashSaleStats),
);

/**
 * @route   GET /api/flash-sales/:flashSaleId/search
 * @desc    Search in flash sale
 * @access  Public
 */
router.get("/:flashSaleId/search", asyncHandler(searchFlashSaleProducts));

// ============= PARAMETERIZED ROUTES =============

/**
 * @route   GET /api/flash-sales/:flashSaleId
 * @desc    Get flash sale detail
 * @access  Public
 */
router.get("/:flashSaleId", asyncHandler(getFlashSaleDetail));

/**
 * @route   PUT /api/flash-sales/:flashSaleId
 * @desc    Update flash sale
 * @access  Private (Seller, Admin)
 */
router.put(
  "/:flashSaleId",
  protect,
  authorize("seller", "admin"),
  asyncHandler(updateFlashSale),
);

/**
 * @route   DELETE /api/flash-sales/:flashSaleId
 * @desc    Delete flash sale
 * @access  Private (Seller, Admin)
 */
router.delete(
  "/:flashSaleId",
  protect,
  authorize("seller", "admin"),
  asyncHandler(deleteFlashSale),
);

export default router;
