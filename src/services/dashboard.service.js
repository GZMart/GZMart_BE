import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Product from '../models/Product.js';
import { ErrorResponse } from '../utils/errorResponse.js';

/**
 * Get overall dashboard analytics
 * Returns: Revenue, Best sellers, Order stats, Customer stats
 */
export const getDashboardAnalytics = async (sellerId) => {
  if (!sellerId) {
    throw new ErrorResponse('Seller ID is required', 400);
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
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  // Get seller's products
  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return {
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      thisYear: 0,
      total: 0,
    };
  }

  // Get orders with seller's products
  // Count revenue from completed/delivered orders (regardless of payment status)
  const orders = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: yearAgo },
        status: { $in: ['completed', 'delivered', 'delivered_pending_confirmation'] }, // Count completed/delivered orders
      },
    },
    {
      $lookup: {
        from: 'orderitems',
        localField: '_id',
        foreignField: 'orderId',
        as: 'items',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.productId': { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: null,
        today: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', today] }, '$items.subtotal', 0],
          },
        },
        thisWeek: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', weekAgo] }, '$items.subtotal', 0],
          },
        },
        thisMonth: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', monthAgo] }, '$items.subtotal', 0],
          },
        },
        thisYear: {
          $sum: '$items.subtotal',
        },
        total: {
          $sum: '$items.subtotal',
        },
      },
    },
  ]);

  return orders[0] || { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, total: 0 };
};

/**
 * Get revenue over time (daily, weekly, monthly)
 */
export const getRevenueOverTime = async (sellerId, period = 'daily') => {
  // period: 'daily', 'weekly', 'monthly'
  const now = new Date();
  let startDate;
  let dateFormat;

  if (period === 'daily') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30); // Last 30 days
    dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  } else if (period === 'weekly') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90); // Last 90 days (13 weeks)
    dateFormat = {
      $dateToString: { format: '%Y-W%V', date: '$createdAt' },
    };
  } else if (period === 'monthly') {
    startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1); // Last 12 months
    dateFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  }

  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const revenueData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ['completed', 'delivered', 'delivered_pending_confirmation'] }, // Count completed/delivered orders
      },
    },
    {
      $lookup: {
        from: 'orderitems',
        localField: '_id',
        foreignField: 'orderId',
        as: 'items',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.productId': { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: dateFormat,
        revenue: { $sum: '$items.subtotal' },
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
  const sellerProducts = await Product.find({ sellerId }).select('_id name originalPrice images');

  if (sellerProducts.length === 0) {
    return [];
  }

  const sellerProductIds = sellerProducts.map(p => p._id);

  const bestSellers = await OrderItem.aggregate([
    {
      $match: {
        productId: { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: '$productId',
        totalSold: { $sum: '$quantity' },
        totalRevenue: { $sum: '$subtotal' },
        averagePrice: { $avg: '$price' },
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
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $unwind: '$product',
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: '$product.name',
        originalPrice: '$product.originalPrice',
        totalSold: 1,
      },
    },
  ]);

  return bestSellers;
};

/**
 * Get low stock products
 */
export const getLowStockProducts = async (sellerId, threshold = 20, limit = 10) => {
  const lowStockProducts = await Product.aggregate([
    {
      $match: {
        sellerId: sellerId,
      },
    },
    {
      $unwind: '$models',
    },
    {
      $match: {
        'models.stock': { $lt: threshold },
        'models.isActive': true,
      },
    },
    {
      $group: {
        _id: '$_id',
        name: { $first: '$name' },
        sku: { $first: '$models.sku' },
        price: { $first: '$models.price' },
        stock: { $sum: '$models.stock' },
        images: { $first: '$images' },
        models: { $push: '$models' },
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
        totalModels: { $size: '$models' },
        activeModels: {
          $size: {
            $filter: {
              input: '$models',
              as: 'model',
              cond: { $eq: ['$$model.isActive', true] },
            },
          },
        },
        images: 1,
        lowestStockModel: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$models',
                as: 'model',
                cond: { $eq: ['$$model.isActive', true] },
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
  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return {
      total: 0,
    };
  }

  // Get stats by order status
  const orderStats = await Order.aggregate([
    {
      $lookup: {
        from: 'orderitems',
        localField: '_id',
        foreignField: 'orderId',
        as: 'items',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.productId': { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
      },
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
        from: 'orderitems',
        localField: '_id',
        foreignField: 'orderId',
        as: 'items',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.productId': { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: '$userId',
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
  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const analytics = await OrderItem.aggregate([
    {
      $match: {
        productId: { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: '$productId',
        quantitySold: { $sum: '$quantity' },
        revenue: { $sum: '$subtotal' },
        averagePrice: { $avg: '$price' },
        numberOfOrders: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $unwind: '$product',
    },
    {
      $project: {
        _id: 1,
        name: '$product.name',
        originalPrice: '$product.originalPrice',
        quantitySold: 1,
        revenue: 1,
        averagePrice: 1,
        numberOfOrders: 1,
        profit: {
          $subtract: ['$revenue', { $multiply: ['$product.originalPrice', '$quantitySold'] }],
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

  return analytics;
};

/**
 * Get sales trend (last N days)
 */
export const getSalesTrend = async (sellerId, days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return [];
  }

  const trend = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ['completed', 'delivered', 'delivered_pending_confirmation'] }, // Count completed/delivered orders
      },
    },
    {
      $lookup: {
        from: 'orderitems',
        localField: '_id',
        foreignField: 'orderId',
        as: 'items',
      },
    },
    {
      $unwind: '$items',
    },
    {
      $match: {
        'items.productId': { $in: sellerProductIds },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        sales: { $sum: 1 },
        revenue: { $sum: '$items.subtotal' },
        quantity: { $sum: '$items.quantity' },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  return trend;
};

/**
 * Get comparison stats (current period vs previous period)
 */
export const getComparisonStats = async (sellerId, period = 'month') => {
  const now = new Date();
  let currentStart, currentEnd, previousStart, previousEnd;

  if (period === 'month') {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === 'week') {
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
  }

  const sellerProducts = await Product.find({ sellerId }).select('_id');
  const sellerProductIds = sellerProducts.map(p => p._id);

  if (sellerProductIds.length === 0) {
    return {
      currentPeriod: { orders: 0, revenue: 0, quantity: 0 },
      previousPeriod: { orders: 0, revenue: 0, quantity: 0 },
      growth: { orders: 0, revenue: 0, quantity: 0 },
    };
  }

  const getStatsByDateRange = async (start, end) => {
    const stats = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          status: { $in: ['completed', 'delivered', 'delivered_pending_confirmation'] }, // Count completed/delivered orders
        },
      },
      {
        $lookup: {
          from: 'orderitems',
          localField: '_id',
          foreignField: 'orderId',
          as: 'items',
        },
      },
      {
        $unwind: '$items',
      },
      {
        $match: {
          'items.productId': { $in: sellerProductIds },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: '$items.subtotal' },
          quantity: { $sum: '$items.quantity' },
        },
      },
    ]);

    return stats[0] || { orders: 0, revenue: 0, quantity: 0 };
  };

  const currentStats = await getStatsByDateRange(currentStart, currentEnd);
  const previousStats = await getStatsByDateRange(previousStart, previousEnd);

  const growth = {
    orders: previousStats.orders > 0 ? Math.round(((currentStats.orders - previousStats.orders) / previousStats.orders) * 100) : 0,
    revenue: previousStats.revenue > 0 ? Math.round(((currentStats.revenue - previousStats.revenue) / previousStats.revenue) * 100) : 0,
    quantity: previousStats.quantity > 0 ? Math.round(((currentStats.quantity - previousStats.quantity) / previousStats.quantity) * 100) : 0,
  };

  return {
    currentPeriod: currentStats,
    previousPeriod: previousStats,
    growth,
  };
};
