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
  getProfitLossAnalysis,
  getExpenseAnalysis,
  getTopSellingProductsWithProfit,
  getOverviewStats,
  getTopProducts,
  getRecentOrders,
  getCategorySales,
  getRevenueData,
  getUserGrowth,
  getQuickStats,
  getAllDashboardData,
  getSellerOrderCounts,
  getSellerRecentOrders,
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

// ============= PROFIT & LOSS ANALYSIS =============

/**
 * @route   GET /api/dashboard/profit-loss
 * @desc    Get profit and loss analysis by period
 * @access  Private (Seller, Admin)
 * @query   period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' (default: 'daily')
 * @returns Array of { _id, revenue, cost, quantity, orders, profit } grouped by period
 */
router.get("/profit-loss", asyncHandler(getProfitLossAnalysis));

/**
 * @route   GET /api/dashboard/expense
 * @desc    Get expense analysis (product cost vs shipping cost)
 * @access  Private (Seller, Admin)
 * @query   period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' (default: 'monthly')
 * @returns Object with { totalProductCost, totalShippingCost, totalExpense, breakdownByType }
 */
router.get("/expense", asyncHandler(getExpenseAnalysis));

/**
 * @route   GET /api/dashboard/top-products-profit
 * @desc    Get top selling products ranked by quantity with profit analysis
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 10), period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' (default: 'monthly')
 * @returns Array of { _id, name, totalQuantity, totalRevenue, cost, profit, profitMargin }
 */
router.get(
  "/top-products-profit",
  asyncHandler(getTopSellingProductsWithProfit),
);

// ============= ADMIN DASHBOARD ENDPOINTS =============

/**
 * @swagger
 * /api/dashboard/overview-stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get overview statistics (Admin only)
 *     description: Returns total revenue, orders, users, products with trends
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/overview-stats",
  authorize("admin"),
  asyncHandler(getOverviewStats),
);

/**
 * @swagger
 * /api/dashboard/top-products:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get top selling products (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of products to return (default 5)
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/top-products", authorize("admin"), asyncHandler(getTopProducts));

/**
 * @swagger
 * /api/dashboard/recent-orders:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get recent orders (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of orders to return (default 5)
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/recent-orders", authorize("admin"), asyncHandler(getRecentOrders));

/**
 * @swagger
 * /api/dashboard/category-sales:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get sales by category (Admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/category-sales",
  authorize("admin"),
  asyncHandler(getCategorySales),
);

/**
 * @swagger
 * /api/dashboard/revenue-data:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get revenue data by period (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [monthly, yearly]
 *         description: Period type (default monthly)
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/revenue-data", authorize("admin"), asyncHandler(getRevenueData));

/**
 * @swagger
 * /api/dashboard/user-growth:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get user growth by period (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [monthly, yearly]
 *         description: Period type (default monthly)
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/user-growth", authorize("admin"), asyncHandler(getUserGrowth));

/**
 * @swagger
 * /api/dashboard/quick-stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get quick statistics (Admin only)
 *     description: Returns pending orders, low stock items, new users today, and customer satisfaction
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/quick-stats", authorize("admin"), asyncHandler(getQuickStats));

/**
 * @swagger
 * /api/dashboard/admin/all:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get all dashboard data in one request (Admin only)
 *     description: Batch endpoint that returns all dashboard data at once to reduce API calls
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: topProductsLimit
 *         schema:
 *           type: integer
 *           default: 5
 *       - in: query
 *         name: recentOrdersLimit
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Success with all dashboard data
 */
router.get("/admin/all", authorize("admin"), asyncHandler(getAllDashboardData));

/**
 * @route   GET /api/dashboard/seller-order-counts
 * @desc    Get seller order counts by status (pending, confirmed, packing, shipping, toShip, cancellation, RMA)
 * @access  Private (Seller, Admin)
 */
router.get("/seller-order-counts", asyncHandler(getSellerOrderCounts));

/**
 * @route   GET /api/dashboard/seller-recent-orders
 * @desc    Get recent orders filtered by seller products
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 20)
 */
router.get("/seller-recent-orders", asyncHandler(getSellerRecentOrders));

export default router;
