import mongoose from "mongoose";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Product from "../models/Product.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import InventoryItem from "../models/InventoryItem.js";
import User from "../models/User.js";
import Category from "../models/Category.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * Get overall dashboard analytics
 * Returns: Revenue, Best sellers, Order stats, Customer stats
 */
export const getDashboardAnalytics = async (sellerId) => {
  if (!sellerId) {
    throw new ErrorResponse("Seller ID is required", 400);
  }

  // Fetch all data in parallel
  const [revenue, bestSellers, orderStats, customerStats] = await Promise.all([
    getRevenueStats(sellerId),
    getBestSellingProducts(sellerId, 5),
    getOrderStats(sellerId),
    getCustomerStats(sellerId),
  ]);

  return {
    revenue,
    bestSellers,
    orderStats,
    customerStats,
  };
};

/**
 * Get revenue statistics (Today, This Week, This Month, This Year)
 */
export const getRevenueStats = async (sellerId) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  // THIS MONTH: From 1st day of current month to today
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // LAST YEAR: From same date last year to today
  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  // Get seller's products only
  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return {
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      thisYear: 0,
      total: 0,
    };
  }

  // Get orders with all relevant products
  // Count revenue from completed/delivered orders (regardless of payment status)
  const orders = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: yearAgo },
        status: { $in: ['completed', 'delivered'] }, // Finance logic: completed/delivered only
      },
    },
    {
      $lookup: {
        from: "orderitems",
        localField: "_id",
        foreignField: "orderId",
        as: "items",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.productId": { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: null,
        today: {
          $sum: {
            $cond: [{ $gte: ["$createdAt", today] }, "$items.subtotal", 0],
          },
        },
        thisWeek: {
          $sum: {
            $cond: [{ $gte: ["$createdAt", weekAgo] }, "$items.subtotal", 0],
          },
        },
        thisMonth: {
          $sum: {
            $cond: [{ $gte: ["$createdAt", monthStart] }, "$items.subtotal", 0],
          },
        },
        thisYear: {
          $sum: "$items.subtotal",
        },
        total: {
          $sum: "$items.subtotal",
        },
      },
    },
  ]);

  return (
    orders[0] || { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, total: 0 }
  );
};

/**
 * Get revenue over time (daily, weekly, monthly, quarterly, yearly)
 */
export const getRevenueOverTime = async (sellerId, period = "daily") => {
  // period: 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
  const now = new Date();
  let startDate;
  let dateFormat;

  if (period === "daily") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30); // Last 30 days
    dateFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  } else if (period === "weekly") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90); // Last 90 days (13 weeks)
    dateFormat = {
      $dateToString: { format: "%Y-W%V", date: "$createdAt" },
    };
  } else if (period === "monthly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1); // Last 12 months
    dateFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  } else if (period === "quarterly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1); // Last 12 months
    dateFormat = {
      $dateToString: { format: "%Y-Q", date: "$createdAt" },
    };
  } else if (period === "yearly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 5); // Last 5 years
    dateFormat = { $dateToString: { format: "%Y", date: "$createdAt" } };
  }

  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const revenueData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ['completed', 'delivered'] },
      },
    },
    {
      $lookup: {
        from: "orderitems",
        localField: "_id",
        foreignField: "orderId",
        as: "items",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.productId": { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: { date: dateFormat, orderId: "$_id" },
        revenue: { $sum: "$items.subtotal" },
      },
    },
    {
      $group: {
        _id: "$_id.date",
        revenue: { $sum: "$revenue" },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  return revenueData;
};

/**
 * Get best selling products
 */
export const getBestSellingProducts = async (sellerId, limit = 5) => {
  const sellerProducts = await Product.find({ sellerId }).select(
    "_id name originalPrice images models",
  );

  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const bestSellers = await OrderItem.aggregate([
    {
      $match: {
        productId: { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: "$productId",
        totalSold: { $sum: "$quantity" },
        totalRevenue: { $sum: "$subtotal" },
        averagePrice: { $avg: "$price" },
      },
    },
    {
      $sort: { totalSold: -1 },
    },
    {
      $limit: limit,
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: '$product.name',
        originalPrice: '$product.originalPrice',
        minPrice: { $ifNull: [{ $min: '$product.models.price' }, '$product.originalPrice'] },
        maxPrice: { $ifNull: [{ $max: '$product.models.price' }, '$product.originalPrice'] },
        totalSold: 1,
      },
    },
  ]);

  return bestSellers;
};

/**
 * Get low stock products
 */
export const getLowStockProducts = async (
  sellerId,
  threshold = 20,
  limit = 10,
) => {
  const lowStockProducts = await Product.aggregate([
    {
      $match: {
        sellerId: sellerId,
      },
    },
    {
      $unwind: "$models",
    },
    {
      $match: {
        "models.stock": { $lt: threshold },
        "models.isActive": true,
      },
    },
    {
      $group: {
        _id: "$_id",
        name: { $first: "$name" },
        sku: { $first: "$models.sku" },
        price: { $first: "$models.price" },
        stock: { $sum: "$models.stock" },
        images: { $first: "$images" },
        tiers: { $first: "$tiers" },
        models: { $push: "$models" },
      },
    },
    {
      $match: {
        stock: { $lt: threshold },
      },
    },
    {
      $sort: { stock: 1 },
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 1,
        name: 1,
        stock: 1,
        totalModels: { $size: "$models" },
        activeModels: {
          $size: {
            $filter: {
              input: "$models",
              as: "model",
              cond: { $eq: ["$$model.isActive", true] },
            },
          },
        },
        images: 1,
        tiers: 1,
        models: 1,
        lowestStockModel: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$models",
                as: "model",
                cond: { $eq: ["$$model.isActive", true] },
              },
            },
            0,
          ],
        },
      },
    },
  ]);

  return lowStockProducts;
};

/**
 * Get order statistics
 */
export const getOrderStats = async (sellerId) => {
  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return {
      total: 0,
    };
  }

  // Count distinct orders with items from this seller's products
  // Using OrderItem to find distinct orders, not counting items
  const orderStats = await OrderItem.aggregate([
    {
      $match: {
        productId: { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: "$orderId", // Group by orderId to get distinct orders
      },
    },
    {
      $count: "total", // Count the number of distinct orders
    },
  ]);

  const total = orderStats[0]?.total || 0;

  return {
    total,
  };
};

/**
 * Get customer statistics
 */
export const getCustomerStats = async (sellerId) => {
  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return {
      repeatedPurchaseRate: 0,
    };
  }

  // Get all orders with seller products using aggregation
  const orders = await Order.aggregate([
    {
      $lookup: {
        from: "orderitems",
        localField: "_id",
        foreignField: "orderId",
        as: "items",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.productId": { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: { userId: '$userId', orderId: '$_id' },
      },
    },
    {
      $group: {
        _id: '$_id.userId',
        orderCount: { $sum: 1 },
      },
    },
  ]);

  // Calculate repeat customers
  const totalCustomers = orders.length;
  const repeatCustomers = orders.filter(order => order.orderCount > 1).length;
  const repeatedPurchaseRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100 * 100) / 100 : 0;

  return {
    repeatedPurchaseRate,
  };
};

/**
 * Get detailed product analytics
 */
export const getProductAnalytics = async (sellerId, limit = 10) => {
  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  // Get product analytics with correct order count
  const correctAnalytics = await OrderItem.aggregate([
    {
      $match: {
        productId: { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: { productId: "$productId", orderId: "$orderId" },
        quantity: { $first: "$quantity" },
        subtotal: { $first: "$subtotal" },
        price: { $first: "$price" },
      },
    },
    {
      $group: {
        _id: "$_id.productId",
        numberOfOrders: { $sum: 1 },
        quantitySold: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
        averagePrice: { $avg: "$price" },
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $project: {
        _id: 1,
        name: "$product.name",
        originalPrice: "$product.originalPrice",
        quantitySold: 1,
        revenue: 1,
        averagePrice: 1,
        numberOfOrders: 1,
        profit: {
          $subtract: [
            "$revenue",
            { $multiply: ["$product.originalPrice", "$quantitySold"] },
          ],
        },
      },
    },
    {
      $sort: { revenue: -1 },
    },
    {
      $limit: limit,
    },
  ]);

  return correctAnalytics;
};

/**
 * Get sales trend (last N days)
 */
export const getSalesTrend = async (sellerId, days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const trend = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ['completed', 'delivered'] },
      },
    },
    {
      $lookup: {
        from: "orderitems",
        localField: "_id",
        foreignField: "orderId",
        as: "items",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.productId": { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orderId: "$_id",
        },
        dateRevenue: { $sum: "$items.subtotal" },
        dateQuantity: { $sum: "$items.quantity" },
      },
    },
    {
      $group: {
        _id: "$_id.date",
        sales: { $sum: 1 }, // Count distinct orders per day
        revenue: { $sum: "$dateRevenue" },
        quantity: { $sum: "$dateQuantity" },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  return trend;
};

/** Same rolling windows as getRevenueOverTime — keeps chart totals and order KPIs aligned */
const ROLLING_COMPARISON_PERIODS = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

/**
 * Get comparison stats (current period vs previous period)
 * @param {string} period - Calendar: 'month', 'week'. Rolling (matches revenue-trend): 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
 */
export const getComparisonStats = async (sellerId, period = "month") => {
  const now = new Date();
  let currentStart;
  let currentEnd;
  let previousStart;
  let previousEnd;
  /** Previous rolling window ends strictly before currentStart (non-overlapping, equal length) */
  let previousEndExclusive = false;

  if (ROLLING_COMPARISON_PERIODS.has(period)) {
    currentEnd = new Date(now);
    currentStart = new Date(now);
    if (period === "daily") {
      currentStart.setDate(currentStart.getDate() - 30);
    } else if (period === "weekly") {
      currentStart.setDate(currentStart.getDate() - 90);
    } else if (period === "monthly" || period === "quarterly") {
      currentStart.setFullYear(currentStart.getFullYear() - 1);
    } else if (period === "yearly") {
      currentStart.setFullYear(currentStart.getFullYear() - 5);
    }
    const windowMs = currentEnd.getTime() - currentStart.getTime();
    previousStart = new Date(currentStart.getTime() - windowMs);
    previousEnd = currentStart;
    previousEndExclusive = true;
  } else if (period === "month") {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === "week") {
    const currentDay = now.getDate();
    const currentDayOfWeek = now.getDay();
    currentStart = new Date(now);
    currentStart.setDate(currentDay - currentDayOfWeek);
    currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + 6);
    previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 7);
    previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);
  } else {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  }

  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return {
      currentPeriod: { orders: 0, revenue: 0, quantity: 0, profit: 0 },
      previousPeriod: { orders: 0, revenue: 0, quantity: 0, profit: 0 },
      growth: { orders: 0, revenue: 0, quantity: 0, profit: 0 },
    };
  }

  const getStatsByDateRange = async (start, end, { endExclusive = false } = {}) => {
    const createdAtFilter = endExclusive
      ? { $gte: start, $lt: end }
      : { $gte: start, $lte: end };
    const stats = await Order.aggregate([
      {
        $match: {
          createdAt: createdAtFilter,
          status: { $in: ['completed', 'delivered'] },
        },
      },
      {
        $lookup: {
          from: "orderitems",
          localField: "_id",
          foreignField: "orderId",
          as: "items",
        },
      },
      {
        $unwind: "$items",
      },
      {
        $match: {
          "items.productId": { $in: sellerProductIds },
        },
      },
      {
        $lookup: {
          from: "inventoryitems",
          let: { pid: "$items.productId", mid: "$items.modelId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$productId", "$$pid"] },
                    { $eq: ["$modelId", "$$mid"] },
                  ],
                },
              },
            },
            { $project: { costPrice: 1, _id: 0 } },
          ],
          as: "invItem",
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "items.productId",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $addFields: {
          unitCost: {
            $ifNull: [
              { $arrayElemAt: ["$invItem.costPrice", 0] },
              { $arrayElemAt: ["$product.originalPrice", 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$_id",
          revenue: { $sum: "$items.subtotal" },
          quantity: { $sum: "$items.quantity" },
          cost: { $sum: { $multiply: ["$unitCost", "$items.quantity"] } },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 }, // Count distinct orders
          revenue: { $sum: "$revenue" },
          quantity: { $sum: "$quantity" },
          cost: { $sum: "$cost" },
        },
      },
      {
        $project: {
          _id: 0,
          orders: 1,
          revenue: 1,
          quantity: 1,
          profit: { $subtract: ["$revenue", "$cost"] },
        },
      },
    ]);

    const row = stats[0];
    if (!row) {
      return { orders: 0, revenue: 0, quantity: 0, profit: 0 };
    }
    const profit =
      typeof row.profit === "number" && !Number.isNaN(row.profit)
        ? row.profit
        : 0;
    return {
      orders: row.orders ?? 0,
      revenue: row.revenue ?? 0,
      quantity: row.quantity ?? 0,
      profit,
    };
  };

  const currentStats = await getStatsByDateRange(currentStart, currentEnd);
  const previousStats = await getStatsByDateRange(previousStart, previousEnd, {
    endExclusive: previousEndExclusive,
  });

  /**
   * % change vs previous window. If the baseline was 0 and the current window has
   * activity, return +100 instead of 0 (avoids implying “no change” when it’s new data).
   */
  const percentGrowthVsPrevious = (previous, current) => {
    if (previous > 0) {
      return Math.round(((current - previous) / previous) * 100);
    }
    if (previous <= 0 && current > 0) {
      return 100;
    }
    return 0;
  };

  const profitGrowthVsPrevious = (previous, current) => {
    if (previous !== 0) {
      return Math.round(
        ((current - previous) / Math.abs(previous)) * 100,
      );
    }
    if (current > 0) return 100;
    if (current < 0) return -100;
    return 0;
  };

  const growth = {
    orders: percentGrowthVsPrevious(
      previousStats.orders,
      currentStats.orders,
    ),
    revenue: percentGrowthVsPrevious(
      previousStats.revenue,
      currentStats.revenue,
    ),
    quantity: percentGrowthVsPrevious(
      previousStats.quantity,
      currentStats.quantity,
    ),
    profit: profitGrowthVsPrevious(
      previousStats.profit,
      currentStats.profit,
    ),
  };

  return {
    currentPeriod: currentStats,
    previousPeriod: previousStats,
    growth,
  };
};

/**
 * Get profit and loss analysis
 * Calculate revenue, cost, profit/loss by period
 */
/**
 * Get P&L analysis (revenue, cost, profit over time) for a seller
 * Revenue  = sum(OrderItem.subtotal) for completed/delivered orders
 * Cost     = sum(OrderItem.quantity × InventoryItem.costPrice) from completed POs
 * Profit   = Revenue - Cost
 *
 * Falls back to Product.originalPrice if no InventoryItem cost exists.
 */
export const getProfitLossAnalysis = async (sellerId, period = "daily") => {
  const now = new Date();
  let startDate;
  let dateFormat;

  if (period === "daily") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30);
    dateFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  } else if (period === "weekly") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
    dateFormat = { $dateToString: { format: "%Y-W%V", date: "$createdAt" } };
  } else if (period === "monthly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
    dateFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  } else if (period === "quarterly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
    dateFormat = { $dateToString: { format: "%Y-Q", date: "$createdAt" } };
  } else if (period === "yearly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 5);
    dateFormat = { $dateToString: { format: "%Y", date: "$createdAt" } };
  }

  const sellerProducts = await Product.find({ sellerId }).select("_id originalPrice");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const analysisData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ["completed", "delivered"] },
      },
    },
    {
      $lookup: {
        from: "orderitems",
        localField: "_id",
        foreignField: "orderId",
        as: "items",
      },
    },
    {
      $unwind: "$items",
    },
    {
      $match: {
        "items.productId": { $in: sellerProductIds },
      },
    },
    {
      $lookup: {
        from: "inventoryitems",
        let: { pid: "$items.productId", mid: "$items.modelId" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$productId", "$$pid"] },
            { $eq: ["$modelId",  "$$mid"] },
          ] } } },
          { $project: { costPrice: 1, _id: 0 } },
        ],
        as: "invItem",
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "items.productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $addFields: {
        // Priority: InventoryItem.costPrice (from PO) → Product.originalPrice (fallback)
        unitCost: {
          $ifNull: [
            { $arrayElemAt: ["$invItem.costPrice", 0] },
            { $arrayElemAt: ["$product.originalPrice", 0] },
          ],
        },
      },
    },
    {
      $group: {
        _id: dateFormat,
        totalRevenue: { $sum: "$items.subtotal" },
        totalQuantity: { $sum: "$items.quantity" },
        totalItems:    { $sum: 1 },
        totalCost: {
          $sum: { $multiply: ["$unitCost", "$items.quantity"] },
        },
      },
    },
    {
      $project: {
        _id: 1,
        revenue: "$totalRevenue",
        cost:    "$totalCost",
        quantity: "$totalQuantity",
        orders:  "$totalItems",
        profit: {
          $subtract: ["$totalRevenue", "$totalCost"],
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  return analysisData;
};

/**
 * Get expense and cost breakdown
 */
/**
 * Get expense (COGS + Shipping) analysis for a seller
 * COGS = landed cost from COMPLETED PurchaseOrders (totalAmount + all landed cost components)
 * Shipping = domestic last-mile shipping from completed Orders (Order.shippingCost)
 *
 * @param {String} sellerId
 * @param {String} period - daily | weekly | monthly | quarterly | yearly
 */
export const getExpenseAnalysis = async (sellerId, period = "monthly") => {
  const now = new Date();
  let startDate;

  if (period === "daily") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30);
  } else if (period === "weekly") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
  } else if (period === "monthly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else if (period === "quarterly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else if (period === "yearly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 5);
  }

  // ── COGS: landed cost from COMPLETED PurchaseOrders ──────────────────────
  // A COMPLETED PO has finalAmount = totalAmount + buyingFee + shipping + tax + other + fixed costs (all in VND)
  // Use completedAt (populated on transition) OR receivedDate (fallback for pre-migration POs)
  const poCosts = await PurchaseOrder.aggregate([
    {
      $match: {
        createdBy: new mongoose.Types.ObjectId(sellerId),
        status: { $in: ["COMPLETED", "Completed"] },
        $or: [
          { completedAt: { $gte: startDate } },
          { completedAt: null, receivedDate: { $gte: startDate } },
        ],
      },
    },
    {
      $lookup: {
        from: "products",
        let: { poItems: "$items" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$poItems.productId"] } } },
          { $project: { _id: 1, cost: 1 } },
        ],
        as: "linkedProducts",
      },
    },
    {
      $group: {
        _id: null,
        // finalAmount includes everything: totalAmount + shipping + tax + other + fixed costs
        totalProductCost: { $sum: "$finalAmount" },
        // break down for display
        totalGoodsValue:    { $sum: "$totalAmount" },
        totalBuyingFee:     { $sum: { $multiply: ["$totalAmount", { $ifNull: ["$importConfig.buyingServiceFeeRate", 0] }] } },
        totalIntlShipping:  { $sum: { $ifNull: ["$shippingCost", 0] } },
        totalTax:           { $sum: { $ifNull: ["$taxAmount", 0] } },
        totalCnDomestic:    { $sum: { $multiply: [{ $ifNull: ["$fixedCosts.cnDomesticShippingCny", 0] }, { $ifNull: ["$importConfig.exchangeRate", 3500] }] } },
        totalPackaging:     { $sum: { $ifNull: ["$fixedCosts.packagingCostVnd", 0] } },
        totalVnDomestic:    { $sum: { $ifNull: ["$fixedCosts.vnDomesticShippingVnd", 0] } },
        totalOtherCost:     { $sum: { $ifNull: ["$otherCost", 0] } },
        poCount:            { $sum: 1 },
      },
    },
  ]);

  const poCostData = poCosts[0] || {};
  const productCost = poCostData.totalProductCost || 0;

  // ── Last-mile domestic shipping: Order.shippingCost of completed orders ──
  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  let shippingCost = 0;
  if (sellerProductIds.length > 0) {
    const shippingData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ["completed", "delivered"] },
        },
      },
      { $lookup: { from: "orderitems", localField: "_id", foreignField: "orderId", as: "items" } },
      { $match: { "items.productId": { $in: sellerProductIds } } },
      { $group: { _id: null, totalShipping: { $sum: { $ifNull: ["$shippingCost", 0] } } } },
    ]);
    shippingCost = shippingData[0]?.totalShipping || 0;
  }

  const goodsValue    = Math.round(poCostData.totalGoodsValue    || 0);
  const buyingFee     = Math.round(poCostData.totalBuyingFee     || 0);
  const intlShipping = Math.round(poCostData.totalIntlShipping || 0);
  const tax           = Math.round(poCostData.totalTax           || 0);
  const cnDomestic    = Math.round(poCostData.totalCnDomestic    || 0);
  const packaging     = Math.round(poCostData.totalPackaging     || 0);
  const vnDomestic   = Math.round(poCostData.totalVnDomestic   || 0);
  const otherCost     = Math.round(poCostData.totalOtherCost    || 0);

  // Each cost component becomes a distinct slice — zero-value entries are dropped
  const breakdownByType = [
    { type: "Goods Value (PO)",          amount: goodsValue    },
    { type: "Buying Service Fee",         amount: buyingFee     },
    { type: "Intl Freight (CN→VN)",      amount: intlShipping  },
    { type: "Import Tax",                 amount: tax          },
    { type: "CN Domestic Shipping",       amount: cnDomestic   },
    { type: "Packaging / Insurance",      amount: packaging    },
    { type: "VN Last-Mile (PO→Warehouse)", amount: vnDomestic },
    { type: "Other Costs",               amount: otherCost    },
    { type: "Last-Mile Delivery (Order)", amount: shippingCost },
  ].filter((x) => x.amount > 0);

  const totalProductCost = goodsValue + buyingFee + intlShipping + tax + cnDomestic + packaging + vnDomestic + otherCost;

  return {
    totalProductCost,
    totalShippingCost: shippingCost,
    totalExpense: totalProductCost + shippingCost,
    breakdownByType,
    poDetail: {
      totalGoodsValue:    goodsValue,
      totalBuyingFee:     buyingFee,
      totalIntlShipping:  intlShipping,
      totalTax:           tax,
      totalCnDomestic:    cnDomestic,
      totalPackaging:     packaging,
      totalVnDomestic:   vnDomestic,
      totalOtherCost:     otherCost,
      poCount:            poCostData.poCount || 0,
    },
  };
};

/**
 * Get product analytics grouped by category
 * Shows revenue, quantity sold, profit, margin for each category
 * Uses InventoryItem.costPrice (from PO landed cost) for profit calculation
 *
 * @param {String} sellerId
 * @param {String} period - daily | weekly | monthly | quarterly | yearly
 * @param {Number} limit - max number of categories to return
 */
export const getProductAnalyticsByCategory = async (sellerId, period = "monthly", limit = 8) => {
  const now = new Date();
  let startDate;

  if (period === "daily") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30);
  } else if (period === "weekly") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
  } else if (period === "monthly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else if (period === "quarterly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else if (period === "yearly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 5);
  }

  const sellerProducts = await Product.find({ sellerId }).select("_id name categoryId originalPrice images");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return {
      categories: [],
      totalRevenue: 0,
      totalQuantity: 0,
      totalProfit: 0,
      period,
    };
  }

  // Aggregate sales data by category using OrderItem + Order
  const categorySales = await OrderItem.aggregate([
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "_id",
        as: "order",
      },
    },
    {
      $unwind: "$order",
    },
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $match: {
        productId: { $in: sellerProductIds },
        "order.createdAt": { $gte: startDate },
        "order.status": { $in: ["completed", "delivered"] },
      },
    },
    {
      $group: {
        _id: "$product.categoryId",
        categoryName: { $first: "$product.categoryId" },
        totalQuantity: { $sum: "$quantity" },
        totalRevenue: { $sum: "$subtotal" },
        totalCost: {
          $sum: { $multiply: ["$product.originalPrice", "$quantity"] },
        },
        orderCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $unwind: {
        path: "$category",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 1,
        categoryName: { $ifNull: ["$category.name", "Không phân loại"] },
        totalQuantity: 1,
        totalRevenue: 1,
        totalCost: 1,
        orderCount: 1,
        profit: {
          $subtract: ["$totalRevenue", "$totalCost"],
        },
        profitMargin: {
          $cond: {
            if: { $gt: ["$totalRevenue", 0] },
            then: {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ["$totalRevenue", "$totalCost"] },
                    "$totalRevenue",
                  ],
                },
                100,
              ],
            },
            else: 0,
          },
        },
      },
    },
    {
      $sort: { totalRevenue: -1 },
    },
    {
      $limit: limit,
    },
  ]);

  const totalRevenue = categorySales.reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
  const totalQuantity = categorySales.reduce((sum, c) => sum + (c.totalQuantity || 0), 0);
  const totalProfit = categorySales.reduce((sum, c) => sum + (c.profit || 0), 0);

  // Add percentage of total revenue for each category
  const categories = categorySales.map((c) => ({
    ...c,
    totalRevenue: Math.round(c.totalRevenue || 0),
    totalCost: Math.round(c.totalCost || 0),
    profit: Math.round(c.profit || 0),
    profitMargin: typeof c.profitMargin === 'number' ? Math.round(c.profitMargin * 10) / 10 : 0,
    revenuePercent:
      totalRevenue > 0 ? Math.round(((c.totalRevenue || 0) / totalRevenue) * 1000) / 10 : 0,
  }));

  return {
    categories,
    totalRevenue: Math.round(totalRevenue),
    totalQuantity,
    totalProfit: Math.round(totalProfit),
    period,
  };
};

/**
 * Get top selling products with profit analysis
 * Uses InventoryItem.costPrice (from PO landed cost) instead of Product.cost
 *
 * @param {String} sellerId
 * @param {Number} limit - max number of products to return
 * @param {String} period - daily | weekly | monthly | quarterly | yearly
 */
export const getTopSellingProductsWithProfit = async (sellerId, limit = 10, period = "monthly") => {
  const now = new Date();
  let startDate;

  if (period === "daily") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30);
  } else if (period === "weekly") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
  } else if (period === "monthly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else if (period === "quarterly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else if (period === "yearly") {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 5);
  }

  const sellerProducts = await Product.find({ sellerId }).select("_id name originalPrice images");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const topProducts = await OrderItem.aggregate([
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "_id",
        as: "order",
      },
    },
    {
      $unwind: "$order",
    },
    {
      $match: {
        productId: { $in: sellerProductIds },
        "order.createdAt": { $gte: startDate },
        "order.status": { $in: ["completed", "delivered"] },
      },
    },
    {
      $group: {
        _id: { productId: "$productId", orderId: "$orderId" },
        quantity: { $first: "$quantity" },
        subtotal: { $first: "$subtotal" },
        price: { $first: "$price" },
        modelId: { $first: "$modelId" },
      },
    },
    {
      $group: {
        _id: "$_id.productId",
        totalQuantity: { $sum: "$quantity" },
        totalRevenue: { $sum: "$subtotal" },
        averagePrice: { $avg: "$price" },
        totalOrders: { $sum: 1 },
        modelId: { $first: "$modelId" },
      },
    },
    {
      $lookup: {
        from: "inventoryitems",
        let: { pid: "$_id", mid: "$modelId" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$productId", "$$pid"] },
            { $eq: ["$modelId", "$$mid"] },
          ] } } },
          { $project: { costPrice: 1, _id: 0 } },
        ],
        as: "invItem",
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $addFields: {
        unitCost: {
          $ifNull: [
            { $arrayElemAt: ["$invItem.costPrice", 0] },
            "$product.originalPrice",
          ],
        },
      },
    },
    {
      $sort: { totalQuantity: -1 },
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 1,
        name: "$product.name",
        totalQuantity: 1,
        totalRevenue: 1,
        averagePrice: 1,
        totalOrders: 1,
        unitCost: 1,
        cost: { $multiply: ["$unitCost", "$totalQuantity"] },
        profit: {
          $subtract: ["$totalRevenue", { $multiply: ["$unitCost", "$totalQuantity"] }],
        },
        profitMargin: {
          $cond: [
            { $gt: ["$totalRevenue", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ["$totalRevenue", { $multiply: ["$unitCost", "$totalQuantity"] }] },
                    "$totalRevenue",
                  ],
                },
                100,
              ],
            },
            0,
          ],
        },
      },
    },
  ]);

  return topProducts;
};

// ============= ADMIN DASHBOARD SERVICES =============

/**
 * Get overview statistics for admin dashboard
 * Returns total revenue, orders, users, products with trends
 */
export const getOverviewStats = async () => {
  const now = new Date();
  const lastMonth = new Date(now);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  // Get current and previous month stats for accurate trend calculation
  const [
    totalRevenue,
    lastMonthRevenue,
    previousMonthRevenue,
    totalOrders,
    lastMonthOrders,
    previousMonthOrders,
    totalUsers,
    lastMonthUsers,
    previousMonthUsers,
    totalProducts,
    lastMonthProducts,
    previousMonthProducts,
  ] = await Promise.all([
    // Total revenue (all time)
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // Last month revenue
    Order.aggregate([
      { $match: { paymentStatus: "paid", createdAt: { $gte: lastMonth } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // Previous month revenue (for trend calculation)
    Order.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          createdAt: { $gte: twoMonthsAgo, $lt: lastMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // Total orders
    Order.countDocuments(),
    // Last month orders
    Order.countDocuments({ createdAt: { $gte: lastMonth } }),
    // Previous month orders
    Order.countDocuments({ createdAt: { $gte: twoMonthsAgo, $lt: lastMonth } }),
    // Total users
    User.countDocuments(),
    // Last month users
    User.countDocuments({ createdAt: { $gte: lastMonth } }),
    // Previous month users
    User.countDocuments({ createdAt: { $gte: twoMonthsAgo, $lt: lastMonth } }),
    // Total products
    Product.countDocuments(),
    // Last month products
    Product.countDocuments({ createdAt: { $gte: lastMonth } }),
    // Previous month products
    Product.countDocuments({
      createdAt: { $gte: twoMonthsAgo, $lt: lastMonth },
    }),
  ]);

  const revenue = totalRevenue[0]?.total || 0;
  const lastMonthRev = lastMonthRevenue[0]?.total || 0;
  const prevMonthRev = previousMonthRevenue[0]?.total || 0;

  // Calculate trends (percentage change between last month and previous month)
  const calculateTrend = (lastMonth, previousMonth) => {
    if (previousMonth === 0) return lastMonth > 0 ? 100 : 0;
    return (((lastMonth - previousMonth) / previousMonth) * 100).toFixed(1);
  };

  return [
    {
      title: "Total Revenue",
      value: revenue,
      trend: calculateTrend(lastMonthRev, prevMonthRev),
      isPositive: lastMonthRev >= prevMonthRev,
    },
    {
      title: "Total Orders",
      value: totalOrders,
      trend: calculateTrend(lastMonthOrders, previousMonthOrders),
      isPositive: lastMonthOrders >= previousMonthOrders,
    },
    {
      title: "Total Users",
      value: totalUsers,
      trend: calculateTrend(lastMonthUsers, previousMonthUsers),
      isPositive: lastMonthUsers >= previousMonthUsers,
    },
    {
      title: "Total Products",
      value: totalProducts,
      trend: calculateTrend(lastMonthProducts, previousMonthProducts),
      isPositive: lastMonthProducts >= previousMonthProducts,
    },
  ];
};

/**
 * Get top selling products (admin)
 */
export const getTopProducts = async (limit = 5) => {
  const topProducts = await OrderItem.aggregate([
    {
      $group: {
        _id: "$productId",
        sold: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
      },
    },
    {
      $sort: { sold: -1 },
    },
    {
      $limit: limit,
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $lookup: {
        from: "categories",
        localField: "product.categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
    },
    {
      $lookup: {
        from: "inventoryitems",
        localField: "_id",
        foreignField: "productId",
        as: "inventory",
      },
    },
    {
      $project: {
        name: "$product.name",
        category: "$category.name",
        sold: 1,
        revenue: 1,
        stock: { $sum: "$inventory.quantity" },
      },
    },
  ]);

  return topProducts;
};

/**
 * Get recent orders (admin)
 */
export const getRecentOrders = async (limit = 5) => {
  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("userId", "name email")
    .select("orderNumber totalAmount orderStatus createdAt userId")
    .lean();

  return recentOrders.map((order) => ({
    orderId: order.orderNumber || `#ORD-${order._id.toString().slice(-8)}`,
    customer: order.userId?.name || "Unknown",
    total: order.totalAmount,
    status: order.orderStatus,
    date: order.createdAt.toISOString().split("T")[0],
  }));
};

/**
 * Get category sales distribution (admin)
 */
export const getCategorySales = async () => {
  const categorySales = await OrderItem.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $lookup: {
        from: "categories",
        localField: "product.categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
    },
    {
      $group: {
        _id: "$category._id",
        name: { $first: "$category.name" },
        sales: { $sum: "$subtotal" },
      },
    },
    {
      $sort: { sales: -1 },
    },
    {
      $limit: 5,
    },
  ]);

  const totalSales = categorySales.reduce((sum, cat) => sum + cat.sales, 0);

  return categorySales.map((cat) => ({
    name: cat.name || "Uncategorized",
    sales: cat.sales,
    percentage:
      totalSales > 0 ? ((cat.sales / totalSales) * 100).toFixed(0) : 0,
  }));
};

/**
 * Get revenue data by period (monthly or yearly)
 */
export const getRevenueData = async (period = "monthly") => {
  const now = new Date();
  let startDate;
  let dateFormat;
  let periodLabels;

  if (period === "monthly") {
    // Last 12 months
    startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 11);
    startDate.setDate(1);
    dateFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };

    // Generate labels for last 12 months
    periodLabels = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleString("en-US", { month: "short" });
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      periodLabels.push({ key, label });
    }
  } else {
    // Last 5 years
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 4);
    startDate.setMonth(0, 1);
    dateFormat = { $dateToString: { format: "%Y", date: "$createdAt" } };

    // Generate labels for last 5 years
    periodLabels = [];
    for (let i = 4; i >= 0; i--) {
      const year = now.getFullYear() - i;
      periodLabels.push({ key: String(year), label: String(year) });
    }
  }

  const revenueData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        paymentStatus: "paid",
      },
    },
    {
      $group: {
        _id: dateFormat,
        revenue: { $sum: "$totalAmount" },
        orders: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Create map for easy lookup
  const dataMap = new Map(revenueData.map((item) => [item._id, item]));

  // Fill in missing periods with zeros
  return periodLabels.map(({ key, label }) => ({
    period: label,
    revenue: dataMap.get(key)?.revenue || 0,
    orders: dataMap.get(key)?.orders || 0,
  }));
};

/**
 * Get user growth data by period (monthly or yearly)
 */
export const getUserGrowth = async (period = "monthly") => {
  const now = new Date();
  let startDate;
  let dateFormat;
  let periodLabels;

  if (period === "monthly") {
    // Last 12 months
    startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 11);
    startDate.setDate(1);
    dateFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };

    periodLabels = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleString("en-US", { month: "short" });
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      periodLabels.push({ key, label });
    }
  } else {
    // Last 5 years
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 4);
    startDate.setMonth(0, 1);
    dateFormat = { $dateToString: { format: "%Y", date: "$createdAt" } };

    periodLabels = [];
    for (let i = 4; i >= 0; i--) {
      const year = now.getFullYear() - i;
      periodLabels.push({ key: String(year), label: String(year) });
    }
  }

  const userGrowth = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: dateFormat,
        users: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Create map for easy lookup
  const dataMap = new Map(userGrowth.map((item) => [item._id, item]));

  // Fill in missing periods with zeros and accumulate
  let cumulative = 0;
  return periodLabels.map(({ key, label }) => {
    cumulative += dataMap.get(key)?.users || 0;
    return {
      period: label,
      users: cumulative,
    };
  });
};

/**
 * Get quick statistics (admin)
 * Returns: Pending orders, low stock items, new users today, customer satisfaction
 */
export const getQuickStats = async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    pendingOrders,
    lowStockCount,
    newUsersToday,
    totalOrders,
    deliveredOrders,
  ] = await Promise.all([
    // Pending orders count
    Order.countDocuments({ orderStatus: { $in: ["pending", "processing"] } }),

    // Low stock items count (stock < 20)
    Product.aggregate([
      {
        $lookup: {
          from: "inventoryitems",
          localField: "_id",
          foreignField: "productId",
          as: "inventory",
        },
      },
      {
        $project: {
          totalStock: { $sum: "$inventory.quantity" },
        },
      },
      {
        $match: {
          totalStock: { $lt: 20, $gt: 0 },
        },
      },
      {
        $count: "count",
      },
    ]),

    // New users today
    User.countDocuments({ createdAt: { $gte: today } }),

    // Total orders for satisfaction calculation
    Order.countDocuments(),

    // Delivered orders for satisfaction calculation
    Order.countDocuments({ orderStatus: "delivered" }),
  ]);

  // Calculate customer satisfaction (% of delivered orders)
  const satisfaction =
    totalOrders > 0 ? ((deliveredOrders / totalOrders) * 100).toFixed(1) : 0;

  return {
    pendingOrders,
    lowStockItems: lowStockCount[0]?.count || 0,
    newUsersToday,
    customerSatisfaction: `${satisfaction}%`,
  };
};

/**
 * Get seller order counts grouped by status
 * Used by Seller Dashboard "Immediate To-Do" section
 * Returns: pending, confirmed, packing, shipping, toShip, cancellationCount, rmaCount
 */
export const getSellerOrderCounts = async (sellerId) => {
  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return {
      pending: 0,
      confirmed: 0,
      packing: 0,
      shipping: 0,
      toShip: 0,
      cancellationCount: 0,
      rmaCount: 0,
    };
  }

  const orderItems = await OrderItem.find({ productId: { $in: sellerProductIds } }).select("orderId");
  const orderIds = [
    ...new Set(orderItems.map((item) => item.orderId.toString())),
  ].map((id) => new mongoose.Types.ObjectId(id));

  if (orderIds.length === 0) {
    return {
      pending: 0,
      confirmed: 0,
      packing: 0,
      shipping: 0,
      toShip: 0,
      cancellationCount: 0,
      rmaCount: 0,
    };
  }

  const orderCounts = await Order.aggregate([
    { $match: { _id: { $in: orderIds } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const counts = {};
  for (const item of orderCounts) {
    counts[item._id] = item.count;
  }

  const toShip =
    (counts.confirmed || 0) +
    (counts.packing || 0) +
    (counts.shipping || 0) +
    (counts.processing || 0);
  const cancellationCount = counts.cancelled || 0;

  const rmaCounts = await ReturnRequest.aggregate([
    { $match: { isActive: true } },
    {
      $lookup: {
        from: "orderitems",
        localField: "items.orderItemId",
        foreignField: "_id",
        as: "orderItems",
      },
    },
    {
      $match: {
        "orderItems.productId": { $in: sellerProductIds },
        status: { $in: ["pending", "approved", "items_returned", "processing"] },
      },
    },
    { $count: "count" },
  ]);

  return {
    pending: counts.pending || 0,
    confirmed: counts.confirmed || 0,
    packing: counts.packing || 0,
    shipping: counts.shipping || 0,
    toShip,
    cancellationCount,
    rmaCount: rmaCounts[0]?.count || 0,
  };
};

/**
 * Get recent orders for a specific seller
 * Filters orders by products belonging to the seller
 * Returns order summary with customer name and status
 */
export const getSellerRecentOrders = async (sellerId, limit = 20) => {
  const sellerProducts = await Product.find({ sellerId }).select("_id");
  const sellerProductIds = sellerProducts.map((p) => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const orderItems = await OrderItem.find({
    productId: { $in: sellerProductIds },
  }).select("orderId quantity subtotal productId modelId");

  const orderIds = [
    ...new Set(orderItems.map((item) => item.orderId.toString())),
  ].map((id) => new mongoose.Types.ObjectId(id));

  if (orderIds.length === 0) {
    return [];
  }

  const STATUS_LABELS = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    packing: "Đang đóng gói",
    shipping: "Đang vận chuyển",
    shipped: "Đã giao ĐVVC",
    delivered: "Đã giao",
    delivered_pending_confirmation: "Chờ xác nhận giao",
    completed: "Hoàn thành",
    processing: "Đang xử lý",
    cancelled: "Đã hủy",
    refunded: "Đã hoàn tiền",
    refund_pending: "Chờ hoàn tiền",
    under_investigation: "Đang xem xét",
  };

  const STATUS_COLORS = {
    pending: "default",
    confirmed: "processing",
    packing: "warning",
    shipping: "warning",
    shipped: "warning",
    delivered: "success",
    delivered_pending_confirmation: "success",
    completed: "success",
    processing: "processing",
    cancelled: "error",
    refunded: "error",
    refund_pending: "warning",
    under_investigation: "warning",
  };

  const orders = await Order.find({ _id: { $in: orderIds } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("userId", "name email phone")
    .lean();

  const itemMap = {};
  orderItems.forEach((item) => {
    const oid = item.orderId.toString();
    if (!itemMap[oid]) itemMap[oid] = [];
    itemMap[oid].push(item);
  });

  return orders.map((order) => {
    const items = itemMap[order._id.toString()] || [];
    const sellerSubtotal = items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
    return {
      _id: order._id,
      orderNumber: order.orderNumber || `#ORD-${order._id.toString().slice(-8)}`,
      customer: order.userId?.name || "—",
      email: order.userId?.email || "—",
      phone: order.userId?.phone || "—",
      totalPrice: sellerSubtotal,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status] || order.status,
      statusColor: STATUS_COLORS[order.status] || "default",
      itemsCount: items.length,
      createdAt: order.createdAt,
      createdAtStr: new Date(order.createdAt).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  });
};
