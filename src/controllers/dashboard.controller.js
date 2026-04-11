import * as dashboardService from "../services/dashboard.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * @desc    Get complete dashboard analytics
 * @route   GET /api/dashboard
 * @access  Private (Seller, Admin)
 */
export const getDashboardAnalytics = asyncHandler(async (req, res) => {
  const analytics = await dashboardService.getDashboardAnalytics(req.user._id);

  res.status(200).json({
    success: true,
    data: analytics,
  });
});

/**
 * @desc    Get revenue statistics (today, week, month, year)
 * @route   GET /api/dashboard/revenue
 * @access  Private (Seller, Admin)
 */
export const getRevenueStats = asyncHandler(async (req, res) => {
  const revenue = await dashboardService.getRevenueStats(req.user._id);

  res.status(200).json({
    success: true,
    data: revenue,
  });
});

/**
 * @desc    Get revenue over time
 * @route   GET /api/dashboard/revenue-trend
 * @access  Private (Seller, Admin)
 */
export const getRevenueOverTime = asyncHandler(async (req, res) => {
  const { period, startDate, endDate } = req.query;

  const customRange = startDate && endDate
    ? { startDate, endDate }
    : null;

  const revenueData = await dashboardService.getRevenueOverTime(
    req.user._id,
    period || "daily",
    customRange,
  );

  res.status(200).json({
    success: true,
    period: period || "daily",
    customRange,
    data: revenueData,
  });
});

/**
 * @desc    Get best selling products
 * @route   GET /api/dashboard/best-sellers
 * @access  Private (Seller, Admin)
 */
export const getBestSellingProducts = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const bestSellers = await dashboardService.getBestSellingProducts(
    req.user._id,
    parseInt(limit) || 5,
  );

  res.status(200).json({
    success: true,
    count: bestSellers.length,
    data: bestSellers,
  });
});

/**
 * @desc    Get low stock products
 * @route   GET /api/dashboard/low-stock
 * @access  Private (Seller, Admin)
 */
export const getLowStockProducts = asyncHandler(async (req, res) => {
  const { threshold, limit } = req.query;

  const lowStock = await dashboardService.getLowStockProducts(
    req.user._id,
    parseInt(threshold) || 20,
    parseInt(limit) || 10,
  );

  res.status(200).json({
    success: true,
    count: lowStock.length,
    data: lowStock,
  });
});

/**
 * @desc    Get order statistics
 * @route   GET /api/dashboard/order-stats
 * @access  Private (Seller, Admin)
 */
export const getOrderStats = asyncHandler(async (req, res) => {
  const orderStats = await dashboardService.getOrderStats(req.user._id);

  res.status(200).json({
    success: true,
    data: orderStats,
  });
});

/**
 * @desc    Get customer statistics
 * @route   GET /api/dashboard/customer-stats
 * @access  Private (Seller, Admin)
 */
export const getCustomerStats = asyncHandler(async (req, res) => {
  const customerStats = await dashboardService.getCustomerStats(req.user._id);

  res.status(200).json({
    success: true,
    data: customerStats,
  });
});

/**
 * @desc    Get detailed product analytics
 * @route   GET /api/dashboard/product-analytics
 * @access  Private (Seller, Admin)
 */
export const getProductAnalytics = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const analytics = await dashboardService.getProductAnalytics(
    req.user._id,
    parseInt(limit) || 10,
  );

  res.status(200).json({
    success: true,
    count: analytics.length,
    data: analytics,
  });
});

/**
 * @desc    Get sales trend
 * @route   GET /api/dashboard/sales-trend
 * @access  Private (Seller, Admin)
 */
export const getSalesTrend = asyncHandler(async (req, res) => {
  const { days } = req.query;

  const trend = await dashboardService.getSalesTrend(
    req.user._id,
    parseInt(days) || 30,
  );

  res.status(200).json({
    success: true,
    period: `Last ${parseInt(days) || 30} days`,
    count: trend.length,
    data: trend,
  });
});

/**
 * @desc    Get comparison stats (current vs previous period)
 * @route   GET /api/dashboard/comparison
 * @access  Private (Seller, Admin)
 */
export const getComparisonStats = asyncHandler(async (req, res) => {
  const { period } = req.query; // calendar: month, week — rolling (aligns with revenue-trend): daily, weekly, monthly, quarterly, yearly

  const comparison = await dashboardService.getComparisonStats(
    req.user._id,
    period || "month",
  );

  res.status(200).json({
    success: true,
    period: period || "month",
    data: comparison,
  });
});

/**
 * @desc    Get growth comparison with optional custom date range
 * @route   GET /api/dashboard/growth-comparison
 * @access  Private (Seller, Admin)
 */
export const getGrowthComparison = asyncHandler(async (req, res) => {
  const { period, startDate, endDate } = req.query;

  const customRange = startDate && endDate
    ? { startDate, endDate }
    : null;

  const comparison = await dashboardService.getGrowthComparison(
    req.user._id,
    period || "week",
    customRange,
  );

  res.status(200).json({
    success: true,
    period: period || "week",
    customRange,
    data: comparison,
  });
});

/**
 * @desc    Get profit and loss analysis
 * @route   GET /api/dashboard/profit-loss
 * @access  Private (Seller, Admin)
 */
export const getProfitLossAnalysis = asyncHandler(async (req, res) => {
  const { period, startDate, endDate } = req.query;

  const customRange = startDate && endDate
    ? { startDate, endDate }
    : null;

  const analysis = await dashboardService.getProfitLossAnalysis(
    req.user._id,
    period || "daily",
    customRange,
  );

  res.status(200).json({
    success: true,
    period: period || "daily",
    customRange,
    data: analysis,
  });
});

/**
 * @desc    Get expense analysis
 * @route   GET /api/dashboard/expense
 * @access  Private (Seller, Admin)
 */
export const getExpenseAnalysis = asyncHandler(async (req, res) => {
  const { period, startDate, endDate } = req.query;

  const customRange = startDate && endDate
    ? { startDate, endDate }
    : null;

  const analysis = await dashboardService.getExpenseAnalysis(
    req.user._id,
    period || "monthly",
    customRange,
  );

  res.status(200).json({
    success: true,
    period: period || "monthly",
    customRange,
    data: analysis,
  });
});

/**
 * @desc    Get top selling products with profit analysis
 * @route   GET /api/dashboard/top-products-profit
 * @access  Private (Seller, Admin)
 */
export const getTopSellingProductsWithProfit = asyncHandler(async (req, res) => {
  const { limit, period } = req.query;

  const products = await dashboardService.getTopSellingProductsWithProfit(
    req.user._id,
    parseInt(limit) || 10,
    period || "monthly",
  );

  res.status(200).json({
    success: true,
    count: products.length,
    period: period || "monthly",
    data: products,
  });
});

/**
 * @desc    Get product analytics grouped by category
 * @route   GET /api/dashboard/product-by-category
 * @access  Private (Seller, Admin)
 */
export const getProductAnalyticsByCategory = asyncHandler(async (req, res) => {
  const { period, limit } = req.query;

  const analytics = await dashboardService.getProductAnalyticsByCategory(
    req.user._id,
    period || "monthly",
    parseInt(limit) || 8,
  );

  res.status(200).json({
    success: true,
    period: period || "monthly",
    data: analytics,
  });
});

/**
 * @desc    Get overview stats (revenue, orders, users, products with trends)
 * @route   GET /api/dashboard/overview-stats
 * @access  Private (Admin only)
 */
export const getOverviewStats = asyncHandler(async (req, res) => {
  const stats = await dashboardService.getOverviewStats();

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Get top selling products
 * @route   GET /api/dashboard/top-products
 * @access  Private (Admin only)
 */
export const getTopProducts = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const topProducts = await dashboardService.getTopProducts(
    parseInt(limit) || 5,
  );

  res.status(200).json({
    success: true,
    count: topProducts.length,
    data: topProducts,
  });
});

/**
 * @desc    Get recent orders
 * @route   GET /api/dashboard/recent-orders
 * @access  Private (Admin only)
 */
export const getRecentOrders = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const recentOrders = await dashboardService.getRecentOrders(
    parseInt(limit) || 5,
  );

  res.status(200).json({
    success: true,
    count: recentOrders.length,
    data: recentOrders,
  });
});

/**
 * @desc    Get category sales distribution
 * @route   GET /api/dashboard/category-sales
 * @access  Private (Admin only)
 */
export const getCategorySales = asyncHandler(async (req, res) => {
  const categorySales = await dashboardService.getCategorySales();

  res.status(200).json({
    success: true,
    count: categorySales.length,
    data: categorySales,
  });
});

/**
 * @desc    Get revenue data by period
 * @route   GET /api/dashboard/revenue-data
 * @access  Private (Admin only)
 */
export const getRevenueData = asyncHandler(async (req, res) => {
  const { period } = req.query; // 'monthly' or 'yearly'

  const revenueData = await dashboardService.getRevenueData(
    period || "monthly",
  );

  res.status(200).json({
    success: true,
    period: period || "monthly",
    count: revenueData.length,
    data: revenueData,
  });
});

/**
 * @desc    Get user growth data by period
 * @route   GET /api/dashboard/user-growth
 * @access  Private (Admin only)
 */
export const getUserGrowth = asyncHandler(async (req, res) => {
  const { period } = req.query; // 'monthly' or 'yearly'

  const userGrowth = await dashboardService.getUserGrowth(period || "monthly");

  res.status(200).json({
    success: true,
    period: period || "monthly",
    count: userGrowth.length,
    data: userGrowth,
  });
});

/**
 * @desc    Get quick statistics
 * @route   GET /api/dashboard/quick-stats
 * @access  Private (Admin only)
 */
export const getQuickStats = asyncHandler(async (req, res) => {
  const quickStats = await dashboardService.getQuickStats();

  res.status(200).json({
    success: true,
    data: quickStats,
  });
});

/**
 * @desc    Get all dashboard data in one request (batch)
 * @route   GET /api/dashboard/admin/all
 * @access  Private (Admin only)
 */
export const getAllDashboardData = asyncHandler(async (req, res) => {
  const {
    topProductsLimit = 5,
    recentOrdersLimit = 5,
    revenueDataPeriod = "monthly",
    userGrowthPeriod = "monthly",
  } = req.query;

  const [
    overviewStats,
    topProducts,
    recentOrders,
    categorySales,
    revenueDataMonthly,
    revenueDataYearly,
    userGrowthDataMonthly,
    userGrowthDataYearly,
    quickStats,
  ] = await Promise.all([
    dashboardService.getOverviewStats(),
    dashboardService.getTopProducts(parseInt(topProductsLimit)),
    dashboardService.getRecentOrders(parseInt(recentOrdersLimit)),
    dashboardService.getCategorySales(),
    dashboardService.getRevenueData("monthly"),
    dashboardService.getRevenueData("yearly"),
    dashboardService.getUserGrowth("monthly"),
    dashboardService.getUserGrowth("yearly"),
    dashboardService.getQuickStats(),
  ]);

  res.status(200).json({
    success: true,
    data: {
      overviewStats,
      topProducts,
      recentOrders,
      categorySales,
      revenueData: {
        monthly: revenueDataMonthly,
        yearly: revenueDataYearly,
      },
      userGrowth: {
        monthly: userGrowthDataMonthly,
        yearly: userGrowthDataYearly,
      },
      quickStats,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * @desc    Get seller order counts by status
 * @route   GET /api/dashboard/seller-order-counts
 * @access  Private (Seller, Admin)
 */
export const getSellerOrderCounts = asyncHandler(async (req, res) => {
  const counts = await dashboardService.getSellerOrderCounts(req.user._id);

  res.status(200).json({
    success: true,
    data: counts,
  });
});

/**
 * @desc    Get recent orders for seller
 * @route   GET /api/dashboard/seller-recent-orders
 * @access  Private (Seller, Admin)
 */
export const getSellerRecentOrders = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const orders = await dashboardService.getSellerRecentOrders(
    req.user._id,
    parseInt(limit) || 20,
  );

  res.status(200).json({
    success: true,
    count: orders.length,
    data: orders,
  });
});

/**
 * @desc    Get seller wallet balance and earnings summary
 * @route   GET /api/dashboard/seller-balance
 * @access  Private (Seller, Admin)
 */
export const getSellerBalance = asyncHandler(async (req, res) => {
  const balance = await dashboardService.getSellerBalance(req.user._id);

  res.status(200).json({
    success: true,
    data: balance,
  });
});

/**
 * @desc    Get seller wallet transaction history
 * @route   GET /api/dashboard/seller-wallet-transactions
 * @access  Private (Seller, Admin)
 */
export const getSellerWalletTransactions = asyncHandler(async (req, res) => {
  const { limit = 10, skip = 0 } = req.query;

  const result = await dashboardService.getSellerWalletTransactions(
    req.user._id,
    parseInt(limit),
    parseInt(skip),
  );

  res.status(200).json({
    success: true,
    data: result.transactions,
    total: result.total,
  });
});

/**
 * @desc    Tạo yêu cầu rút balance để chuyển thành reward_point
 * @route   POST /api/dashboard/reward-point-withdrawal/request
 * @access  Private (Seller, Admin)
 * @body    { amount, rewardPointAmount, targetUserId, conversionRate, withdrawalMethod, bankAccount, requestNote }
 */
export const requestRewardPointWithdrawal = asyncHandler(async (req, res) => {
  const {
    amount,
    rewardPointAmount,
    targetUserId,
    conversionRate,
    withdrawalMethod,
    bankAccount,
    requestNote,
  } = req.body;

  const transaction = await dashboardService.requestRewardPointWithdrawal(
    req.user._id,
    {
      amount: Number(amount),
      rewardPointAmount: Number(rewardPointAmount),
      targetUserId,
      conversionRate: conversionRate ? Number(conversionRate) : 1,
      withdrawalMethod,
      bankAccount,
      requestNote,
    },
  );

  res.status(201).json({
    success: true,
    message: "Yêu cầu rút reward_point đã được tạo thành công",
    data: transaction,
  });
});

/**
 * @desc    Lấy danh sách yêu cầu rút reward_point của seller
 * @route   GET /api/dashboard/reward-point-withdrawals
 * @access  Private (Seller, Admin)
 * @query   limit: number (default: 10), skip: number (default: 0)
 */
export const getRewardPointWithdrawals = asyncHandler(async (req, res) => {
  const { limit = 10, skip = 0 } = req.query;

  const result = await dashboardService.getRewardPointWithdrawals(
    req.user._id,
    parseInt(limit),
    parseInt(skip),
  );

  res.status(200).json({
    success: true,
    data: result.transactions,
    total: result.total,
  });
});

/**
 * @desc    Lấy danh sách tất cả yêu cầu rút reward_point (Admin)
 * @route   GET /api/dashboard/admin/reward-point-withdrawals
 * @access  Private (Admin only)
 * @query   status, sellerId, startDate, endDate, limit, skip
 */
export const getAllRewardPointWithdrawals = asyncHandler(async (req, res) => {
  const { status, sellerId, startDate, endDate, limit = 20, skip = 0 } = req.query;

  const result = await dashboardService.getAllRewardPointWithdrawals({
    status,
    sellerId,
    startDate,
    endDate,
    limit: parseInt(limit),
    skip: parseInt(skip),
  });

  res.status(200).json({
    success: true,
    data: result.transactions,
    total: result.total,
  });
});

/**
 * @desc    Xử lý yêu cầu rút reward_point (approve/reject) - Admin
 * @route   PUT /api/dashboard/admin/reward-point-withdrawals/:transactionId/process
 * @access  Private (Admin only)
 * @body    { action: "approve" | "reject", rejectedReason }
 */
export const processRewardPointWithdrawal = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;
  const { action, rejectedReason } = req.body;

  if (!["approve", "reject"].includes(action)) {
    throw new ErrorResponse('Action must be "approve" or "reject"', 400);
  }

  const transaction = await dashboardService.processRewardPointWithdrawal(
    transactionId,
    req.user._id,
    action,
    rejectedReason,
  );

  res.status(200).json({
    success: true,
    message: action === "approve"
      ? "Yêu cầu đã được duyệt, reward_point đã được cộng cho user"
      : "Yêu cầu đã bị từ chối, số dư đã được hoàn",
    data: transaction,
  });
});
