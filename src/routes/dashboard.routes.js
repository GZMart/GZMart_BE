import express from "express";
import {
  getDashboardAnalytics,
  getRevenueStats,
  getRevenueOverTime,
  getBestSellingProducts,
  getLowStockProducts,
  getOrderStats,
  getCustomerStats,
  getProductAnalytics,
  getSalesTrend,
  getComparisonStats,
} from "../controllers/dashboard.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

// Protect all dashboard routes (Seller/Admin only)
router.use(protect);
router.use(authorize("seller", "admin"));

/**
 * @swagger
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard analytics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", asyncHandler(getDashboardAnalytics));

/**
 * @swagger
 * /api/dashboard/revenue:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get revenue stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/revenue", asyncHandler(getRevenueStats));

/**
 * @swagger
 * /api/dashboard/revenue-trend:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get revenue over time
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/revenue-trend", asyncHandler(getRevenueOverTime));

// ============= PRODUCT ANALYTICS =============

/**
 * @route   GET /api/dashboard/best-sellers
 * @desc    Get best selling products
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 5)
 */
router.get("/best-sellers", asyncHandler(getBestSellingProducts));

/**
 * @route   GET /api/dashboard/low-stock
 * @desc    Get low stock products alert
 * @access  Private (Seller, Admin)
 * @query   threshold: number (default: 20), limit: number (default: 10)
 */
router.get("/low-stock", asyncHandler(getLowStockProducts));

/**
 * @route   GET /api/dashboard/product-analytics
 * @desc    Get detailed product analytics
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 10)
 */
router.get("/product-analytics", asyncHandler(getProductAnalytics));

// ============= ORDER STATISTICS =============

/**
 * @route   GET /api/dashboard/order-stats
 * @desc    Get order statistics (total, pending, processing, shipped, delivered, cancelled)
 * @access  Private (Seller, Admin)
 */
router.get("/order-stats", asyncHandler(getOrderStats));

// ============= CUSTOMER STATISTICS =============

/**
 * @route   GET /api/dashboard/customer-stats
 * @desc    Get customer statistics (total, repeat, new, repeat rate)
 * @access  Private (Seller, Admin)
 */
router.get("/customer-stats", asyncHandler(getCustomerStats));

// ============= TREND ANALYSIS =============

/**
 * @route   GET /api/dashboard/sales-trend
 * @desc    Get sales trend
 * @access  Private (Seller, Admin)
 * @query   days: number (default: 30)
 */
router.get("/sales-trend", asyncHandler(getSalesTrend));

/**
 * @route   GET /api/dashboard/comparison
 * @desc    Get comparison stats (current period vs previous)
 * @access  Private (Seller, Admin)
 * @query   period: 'month' | 'week' (default: 'month')
 */
router.get("/comparison", asyncHandler(getComparisonStats));

export default router;
