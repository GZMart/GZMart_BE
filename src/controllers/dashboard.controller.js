import * as dashboardService from '../services/dashboard.service.js';
import { asyncHandler } from '../middlewares/async.middleware.js';
import { ErrorResponse } from '../utils/errorResponse.js';

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
  const { period } = req.query; // 'daily', 'weekly', 'monthly'

  const revenueData = await dashboardService.getRevenueOverTime(
    req.user._id,
    period || 'daily'
  );

  res.status(200).json({
    success: true,
    period: period || 'daily',
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
    parseInt(limit) || 5
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
    parseInt(limit) || 10
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
    parseInt(limit) || 10
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
    parseInt(days) || 30
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
  const { period } = req.query; // 'month', 'week'

  const comparison = await dashboardService.getComparisonStats(
    req.user._id,
    period || 'month'
  );

  res.status(200).json({
    success: true,
    period: period || 'month',
    data: comparison,
  });
});
