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
  getGrowthComparison,
  getProfitLossAnalysis,
  getExpenseAnalysis,
  getTopSellingProductsWithProfit,
  getProductAnalyticsByCategory,
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
  getSellerBalance,
  getSellerWalletTransactions,
  requestRewardPointWithdrawal,
  getRewardPointWithdrawals,
  getAllRewardPointWithdrawals,
  processRewardPointWithdrawal,
  getCustomerAgeAnalytics,
  getCustomerAgeAnalyticsByProduct,
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

/**
 * @route   GET /api/dashboard/growth-comparison
 * @desc    Get growth comparison with optional custom date range
 * @access  Private (Seller, Admin)
 * @query   period: 'week' | 'month' | 'year' (default: 'week')
 * @query   startDate: ISO date string (required for custom range)
 * @query   endDate: ISO date string (required for custom range)
 * @returns Object with revenueGrowth, profitGrowth, ordersGrowth, current/previous values
 */
router.get("/growth-comparison", asyncHandler(getGrowthComparison));

// ============= PROFIT & LOSS ANALYSIS =============

/**
 * @route   GET /api/dashboard/profit-loss
 * @desc    Get profit and loss analysis by period
 * @access  Private (Seller, Admin)
 * @query   period: '7days' | '30days' | '90days' | '12months' | 'yearly' (default: '30days')
 * @returns Array of { _id, revenue, cost, quantity, orders, profit } grouped by period
 */
router.get("/profit-loss", asyncHandler(getProfitLossAnalysis));

/**
 * @route   GET /api/dashboard/expense
 * @desc    Get expense analysis (product cost vs shipping cost)
 * @access  Private (Seller, Admin)
 * @query   period: '7days' | '30days' | '90days' | '12months' | 'yearly' (default: '12months')
 * @returns Object with { totalProductCost, totalShippingCost, totalExpense, breakdownByType }
 */
router.get("/expense", asyncHandler(getExpenseAnalysis));

/**
 * @route   GET /api/dashboard/top-products-profit
 * @desc    Get top selling products ranked by quantity with profit analysis
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 10), period: '7days' | '30days' | '90days' | '12months' | 'yearly' (default: '12months')
 * @returns Array of { _id, name, totalQuantity, totalRevenue, cost, profit, profitMargin }
 */
router.get(
  "/top-products-profit",
  asyncHandler(getTopSellingProductsWithProfit),
);

/**
 * @route   GET /api/dashboard/product-by-category
 * @desc    Get product analytics grouped by category (revenue, quantity, profit, margin)
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 8), period: '7days' | '30days' | '90days' | '12months' | 'yearly' (default: '12months')
 * @returns { categories: [], totalRevenue, totalQuantity, totalProfit, period }
 */
router.get(
  "/product-by-category",
  asyncHandler(getProductAnalyticsByCategory),
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

/**
 * @route   GET /api/dashboard/seller-balance
 * @desc    Get seller wallet balance and earnings summary
 * @access  Private (Seller, Admin)
 * @returns { availableBalance, pendingBalance, totalBalance, totalEarning, totalRefund, totalPayout, totalOrders, completedOrders, pendingOrders }
 */
router.get("/seller-balance", asyncHandler(getSellerBalance));

/**
 * @route   GET /api/dashboard/seller-wallet-transactions
 * @desc    Get seller wallet transaction history
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 10), skip: number (default: 0)
 */
router.get("/seller-wallet-transactions", asyncHandler(getSellerWalletTransactions));

/**
 * @route   POST /api/dashboard/reward-point-withdrawal/request
 * @desc    Tạo yêu cầu rút balance để chuyển thành reward_point cho user
 * @access  Private (Seller, Admin)
 * @body    { amount, rewardPointAmount, targetUserId, conversionRate, withdrawalMethod, bankAccount, requestNote }
 */
router.post("/reward-point-withdrawal/request", asyncHandler(requestRewardPointWithdrawal));

/**
 * @route   GET /api/dashboard/reward-point-withdrawals
 * @desc    Lấy danh sách yêu cầu rút reward_point của seller
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 10), skip: number (default: 0)
 */
router.get("/reward-point-withdrawals", asyncHandler(getRewardPointWithdrawals));

/**
 * @route   GET /api/dashboard/admin/reward-point-withdrawals
 * @desc    Lấy danh sách tất cả yêu cầu rút reward_point (Admin)
 * @access  Private (Admin only)
 * @query   status, sellerId, startDate, endDate, limit, skip
 */
router.get(
  "/admin/reward-point-withdrawals",
  authorize("admin"),
  asyncHandler(getAllRewardPointWithdrawals),
);

/**
 * @route   PUT /api/dashboard/admin/reward-point-withdrawals/:transactionId/process
 * @desc    Xử lý yêu cầu rút reward_point (approve/reject) - Admin
 * @access  Private (Admin only)
 * @body    { action: "approve" | "reject", rejectedReason }
 */
router.put(
  "/admin/reward-point-withdrawals/:transactionId/process",
  authorize("admin"),
  asyncHandler(processRewardPointWithdrawal),
);

/**
 * @route   GET /api/dashboard/customer-age-analytics
 * @desc    Get customer age analytics for shop (overall)
 * @access  Private (Seller, Admin)
 * @query   period: '7days' | '30days' | '90days' | '12months' | 'yearly' (default: '12months')
 * @query   startDate: ISO date string (custom range)
 * @query   endDate: ISO date string (custom range)
 */
router.get("/customer-age-analytics", asyncHandler(getCustomerAgeAnalytics));

/**
 * @route   GET /api/dashboard/customer-age-analytics-by-product
 * @desc    Get customer age analytics grouped by product
 * @access  Private (Seller, Admin)
 * @query   period: '7days' | '30days' | '90days' | '12months' | 'yearly' (default: '12months')
 * @query   startDate: ISO date string (custom range)
 * @query   endDate: ISO date string (custom range)
 * @query   limit: number (default: 10)
 */
router.get("/customer-age-analytics-by-product", asyncHandler(getCustomerAgeAnalyticsByProduct));

export default router;
