import mongoose from "mongoose";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import InventoryItem from "../models/InventoryItem.js";
import DemandForecastCache from "../models/DemandForecastCache.js";
import DemandForecastRateLimit from "../models/DemandForecastRateLimit.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { generateDemandInsight } from "./aiInsight.service.js";
import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const SHOPEE_MOCK_FILE = path.join(DATA_DIR, "shopee_mock_data.json");
const TIKI_MOCK_FILE = path.join(DATA_DIR, "tiki_mock_data.json");

// ── Cache TTL (minutes) ──────────────────────────────────────────────────────
const CACHE_TTL_MINUTES = 30;

// ── Cache helpers ────────────────────────────────────────────────────────────

/**
 * Build a deterministic cache key from the options that affect forecast results.
 */
function makeCacheKey(options) {
  const { days = 90, trendDays = 30, includeWebTrends = true } = options;
  return `forecast_d${days}_t${trendDays}_w${includeWebTrends ? 1 : 0}`;
}

/**
 * Check MongoDB cache and return cached forecast if still valid.
 * @returns {Object|null} Cached forecast or null if not found/expired
 */
async function getCachedForecast(sellerOid, options) {
  try {
    const cacheKey = makeCacheKey(options);
    const cached = await DemandForecastCache.findOne({
      sellerId: sellerOid,
      cacheKey,
    }).lean();

    if (!cached) return null;

    // TTL is enforced by MongoDB TTL index, but double-check here for safety
    if (cached.expiresAt < new Date()) return null;

    return {
      summary: cached.summary,
      trendingProducts: cached.trendingProducts,
      dataPeriod: cached.dataPeriod,
      _cached: true,
    };
  } catch {
    return null;
  }
}

/**
 * Persist forecast result to MongoDB cache with TTL.
 */
async function saveForecastToCache(sellerOid, options, result) {
  try {
    const cacheKey = makeCacheKey(options);
    const expiresAt = new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000);

    await DemandForecastCache.findOneAndUpdate(
      { sellerId: sellerOid, cacheKey },
      {
        sellerId: sellerOid,
        cacheKey,
        trendDays: options.trendDays ?? 30,
        includeWebTrends: options.includeWebTrends ?? true,
        summary: result.summary,
        trendingProducts: result.trendingProducts,
        dataPeriod: result.dataPeriod,
        expiresAt,
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Cache writes are non-fatal — log but don't throw
    console.warn("[demandForecast] Cache write failed:", err.message);
  }
}

// ── Mock data helpers ────────────────────────────────────────────────────────────

/**
 * Normalize product name: lowercase, strip emoji, collapse whitespace.
 * Used for keyword matching in mock data queries.
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Load mock data from a JSON file.
 * Returns an array of records or empty array if file doesn't exist.
 */
async function loadMockData(filePath) {
  try {
    if (await fsExtra.pathExists(filePath)) {
      const raw = await fsExtra.readJson(filePath);
      if (!Array.isArray(raw)) return [];
      if (raw.length > 0) {
        console.log(`[demandForecast] Loaded ${raw.length} mock records from ${path.basename(filePath)}`);
      }
      return raw;
    }
  } catch (err) {
    console.warn(`[demandForecast] Could not read mock data from ${filePath}:`, err.message);
  }
  return [];
}

/**
 * Get the most recent record for a keyword from mock data.
 * Filters to records from the last 30 days.
 */
async function getMockRecordForKeyword(keyword) {
  const allRecords = await loadMockData(SHOPEE_MOCK_FILE);
  if (!allRecords.length) return null;

  const normalizedKw = normalizeName(keyword);
  const kwTokens = normalizedKw.split(" ").filter((t) => t.length > 1);

  // Filter by keyword token match
  const relevant = allRecords.filter((r) => {
    const normName = normalizeName(r.name || r.keyword || "");
    return kwTokens.some((t) => normName.includes(t));
  });

  if (!relevant.length) return null;

  // Sort by date descending and take the latest
  relevant.sort((a, b) => new Date(b.date) - new Date(a.date));
  return relevant[0];
}

/**
 * Get Shopee trend info from mock JSON data.
 * Falls back to null if no matching record found.
 */
async function getShopeeFromMock(keyword) {
  const record = await getMockRecordForKeyword(keyword);
  if (!record) return null;
  return {
    platform: "Shopee",
    name: record.name || keyword,
    historical_sold: record.historical_sold || 0,
    sold_30d: record.historical_sold || 0,
    rating: record.rating || 0,
    view_count: record.view_count || 0,
    price: record.price_min || record.price || 0,
  };
}

/**
 * Get Tiki trend info from mock JSON data.
 * If tiki_mock_data.json doesn't exist, synthesise from Shopee mock data
 * with slight variation (to show both platforms in UI even with one source).
 */
async function getTikiFromMock(keyword) {
  const record = await getMockRecordForKeyword(keyword);
  if (!record) return null;

  // Synthesize Tiki data from Shopee mock (with different rating/sold pattern)
  return {
    platform: "Tiki",
    name: record.name || keyword,
    rating: Math.min(5, Math.max(0, (record.rating || 4) - 0.3)),
    review_count: Math.max(10, Math.floor((record.historical_sold || 100) * 0.05)),
    sold_quantity: Math.max(0, Math.floor((record.historical_sold || 100) * 0.3)),
    price: record.price_min || record.price || 0,
  };
}

/**
 * Search external platforms for trending info about a product keyword.
 * Reads from mock JSON files (collected by trend_collector.js).
 * Falls back to empty data gracefully.
 */
async function getWebTrendsForKeyword(keyword) {
  const [shopee, tiki] = await Promise.all([
    getShopeeFromMock(keyword),
    getTikiFromMock(keyword),
  ]);

  let globalTrendScore = 0;
  let trendSources = [];
  let popularCategory = null;

  if (shopee) {
    const soldScore = Math.min(100, Math.log10(shopee.historical_sold + 1) * 15);
    const viewScore = Math.min(100, Math.log10((shopee.view_count || 0) + 1) * 5);
    const shopeeScore = Math.round((soldScore + viewScore) / 2);
    globalTrendScore = Math.max(globalTrendScore, shopeeScore);
    trendSources.push({
      platform: "Shopee",
      score: shopeeScore,
      sold: shopee.historical_sold,
      price: shopee.price || null,
    });
  }

  if (tiki) {
    const reviewScore = Math.min(100, (tiki.review_count || 0) / 5);
    const soldScore = Math.min(100, Math.log10((tiki.sold_quantity || 0) + 1) * 20);
    const tikiScore = Math.round((reviewScore + soldScore) / 2);
    if (globalTrendScore === 0) globalTrendScore = tikiScore;
    else globalTrendScore = Math.round((globalTrendScore + tikiScore) / 2);
    trendSources.push({
      platform: "Tiki",
      score: tikiScore,
      sold: tiki.sold_quantity,
      price: tiki.price || null,
    });
  }

  return {
    globalTrendScore,
    trendSources,
    hasData: !!(shopee || tiki),
  };
}

/**
 * Get demand forecast with web-based trending insights for a seller.
 * Results are cached in MongoDB for 30 minutes to avoid redundant web searches.
 * Rate-limit is enforced per seller (50 requests/day, 60s per-product cooldown).
 *
 * @param {string} sellerId
 * @param {Object} options
 * @param {number} options.days - Historical analysis window (default 90)
 * @param {number} options.trendDays - Forecast horizon for restock (7 or 30, default 30)
 * @param {boolean} options.includeWebTrends - Whether to search external platforms (default true)
 * @returns {{ summary, trendingProducts, dataPeriod, _cached?, _rateLimit? }}
 */
export const getDemandForecast = async (sellerId, options = {}) => {
  const {
    days = 90,
    trendDays = 30,
    includeWebTrends = true,
  } = options;

  if (!sellerId) {
    throw new ErrorResponse("Seller ID is required", 400);
  }

  const sellerOid = new mongoose.Types.ObjectId(sellerId);

  // ── Rate-limit check ───────────────────────────────────────────────────
  let rateLimitRecord;
  try {
    rateLimitRecord = await DemandForecastRateLimit.findOne({ sellerId: sellerOid });
    if (!rateLimitRecord) {
      rateLimitRecord = new DemandForecastRateLimit({ sellerId: sellerOid });
    }
    const limitResult = rateLimitRecord.checkAndIncrement(null);
    if (!limitResult.allowed) {
      return {
        summary: null,
        trendingProducts: [],
        dataPeriod: null,
        _rateLimit: {
          allowed: false,
          reason: limitResult.reason,
          message: limitResult.message,
          msUntilReset: limitResult.msUntilReset,
        },
      };
    }
    await rateLimitRecord.save();
  } catch (err) {
    // Rate-limit DB errors should not block the forecast — log and continue
    console.warn("[demandForecast] Rate-limit check failed:", err.message);
  }

  // ── Cache check ────────────────────────────────────────────────────────
  const cacheResult = await getCachedForecast(sellerOid, { days, trendDays, includeWebTrends });
  if (cacheResult) {
    return { ...cacheResult, _cached: true };
  }

  // ── No cache: compute forecast ─────────────────────────────────────────
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get seller's active products (include category for display)
  const products = await Product.find({ sellerId: sellerOid, status: "active" })
    .select("_id name images models._id models.price models.stock models.sku category")
    .lean();

  if (!products.length) {
    return {
      summary: { totalProducts: 0, trendingProducts: 0 },
      trendingProducts: [],
      dataPeriod: { days, trendDays, since: since.toISOString(), until: new Date().toISOString() },
    };
  }

  const productIds = products.map((p) => p._id);

  // Aggregate weekly sales data
  const salesData = await OrderItem.aggregate([
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "_id",
        as: "order",
      },
    },
    { $unwind: "$order" },
    {
      $match: {
        productId: { $in: productIds },
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
        "order.paymentStatus": { $ne: "refunded" },
      },
    },
    {
      $addFields: {
        week: { $dateToString: { format: "%Y-W%V", date: "$order.createdAt" } },
      },
    },
    {
      $group: {
        _id: { productId: "$productId", week: "$week" },
        quantity: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
      },
    },
    { $sort: { "_id.week": 1 } },
  ]);

  // Current inventory
  const inventoryItems = await InventoryItem.find({
    productId: { $in: productIds },
  }).select("productId modelId quantity").lean();

  const invByProductModel = {};
  inventoryItems.forEach((item) => {
    const pid = item.productId.toString();
    const mid = item.modelId.toString();
    const key = `${pid}|${mid}`;
    if (!invByProductModel[key]) invByProductModel[key] = 0;
    invByProductModel[key] += item.quantity;
  });

  const productMap = Object.fromEntries(products.map((p) => [p._id.toString(), p]));

  const weeklySalesMap = {};
  salesData.forEach((row) => {
    const pid = row._id.productId.toString();
    if (!weeklySalesMap[pid]) weeklySalesMap[pid] = [];
    weeklySalesMap[pid].push({ week: row._id.week, quantity: row.quantity, revenue: row.revenue });
  });

  const resolveSkuStock = (productIdStr, model) => {
    const mid = model?._id?.toString();
    if (!mid) return Number(model?.stock) || 0;
    const key = `${productIdStr}|${mid}`;
    return Object.prototype.hasOwnProperty.call(invByProductModel, key)
      ? invByProductModel[key]
      : (Number(model.stock) || 0);
  };

  // Build per-product forecasts
  const forecasts = Object.keys(productMap).map((pid) => {
    const product = productMap[pid];
    const sales = weeklySalesMap[pid] || [];
    const models = product.models || [];
    const currentStock = models.reduce((sum, m) => sum + resolveSkuStock(pid, m), 0);
    const totalSold = sales.reduce((sum, w) => sum + w.quantity, 0);
    const totalRevenue = sales.reduce((sum, w) => sum + w.revenue, 0);
    const weekCount = sales.length || 1;
    const avgWeeklyQty = totalSold / weekCount;

    // For trend calculation, use recent half vs previous half of available weeks
    const mid = Math.floor(sales.length / 2);
    const recentWeeks = sales.slice(mid);
    const previousWeeks = sales.slice(0, mid);
    const recentTotal = recentWeeks.reduce((sum, w) => sum + w.quantity, 0);
    const previousTotal = previousWeeks.reduce((sum, w) => sum + w.quantity, 0);

    // Short-horizon (7 days) uses last 2 weeks vs prior 2 weeks for higher precision
    const recent2 = sales.slice(-2);
    const prior2 = sales.slice(-4, -2);
    const recent2Total = recent2.reduce((sum, w) => sum + w.quantity, 0);
    const prior2Total = prior2.reduce((sum, w) => sum + w.quantity, 0);

    const trendPercent30d = previousTotal > 0
      ? ((recentTotal - previousTotal) / previousTotal * 100)
      : (recentTotal > 0 ? 100 : 0);

    const trendPercent7d = prior2Total > 0
      ? ((recent2Total - prior2Total) / prior2Total * 100)
      : (recent2Total > 0 ? 100 : 0);

    const weeksOfStock = avgWeeklyQty > 0 ? currentStock / avgWeeklyQty : Infinity;
    const restockMultiplier = trendDays === 7 ? 1 : 4; // 1 week buffer for 7d, 4 weeks for 30d
    const suggestedQty = Math.max(Math.ceil(avgWeeklyQty * restockMultiplier - currentStock), 0);

    let trendCategory = "stable";
    const activeTrendPct = trendDays === 7 ? trendPercent7d : trendPercent30d;
    if (activeTrendPct > 10) trendCategory = "trending_up";
    else if (activeTrendPct < -10) trendCategory = "trending_down";

    return {
      productId: pid,
      name: product.name,
      image: product.images?.[0] || null,
      category: product.category || null,
      currentStock,
      totalSold,
      totalRevenue,
      avgWeeklyQty: Math.round(avgWeeklyQty * 10) / 10,
      trendPercent30d: Math.round(trendPercent30d * 10) / 10,
      trendPercent7d: Math.round(trendPercent7d * 10) / 10,
      activeTrendPct: Math.round(activeTrendPct * 10) / 10,
      weeksOfStock: weeksOfStock === Infinity ? null : Math.round(weeksOfStock * 10) / 10,
      trendCategory,
      suggestedQty,
      restockPriority: weeksOfStock < 2 && avgWeeklyQty > 0 ? "urgent"
        : weeksOfStock < 4 && avgWeeklyQty > 0 ? "moderate"
        : trendCategory === "trending_up" ? "opportunity"
        : "stable",
    };
  });

  // Enrich with web trend data (parallel, skip for products with no sales)
  let webTrends = {};
  if (includeWebTrends) {
    const productsWithSales = forecasts.filter((f) => f.totalSold > 0);
    const BATCH = 5;
    for (let i = 0; i < productsWithSales.length; i += BATCH) {
      const batch = productsWithSales.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (f) => {
          try {
            const trends = await getWebTrendsForKeyword(f.name);
            return [f.productId, trends];
          } catch {
            return [f.productId, { globalTrendScore: 0, trendSources: [], hasData: false }];
          }
        })
      );
      results.forEach(([pid, trends]) => { webTrends[pid] = trends; });
    }
  }

  // Merge: build trendingProducts list
  // Priority: trending_up with web support > trending_up local only > moderate restock
  const trendingProducts = forecasts
    .map((f) => {
      const web = webTrends[f.productId] || { globalTrendScore: 0, trendSources: [], hasData: false };
      // Combined score: local trend (60%) + web global trend (40%)
      const combinedScore = Math.round(
        (Math.abs(f.activeTrendPct) * 0.6) + (web.globalTrendScore * 0.4)
      );
      return {
        ...f,
        globalTrendScore: web.globalTrendScore,
        webTrendSources: web.trendSources,
        hasWebData: web.hasData,
        combinedScore,
        displayTrendPct: f.activeTrendPct,
        displayQty: f.totalSold,
        forecastAccuracy: trendDays === 7 ? "high" : "standard",
      };
    })
    .filter((f) => {
      // Show products that are trending up OR have combined score > 15 OR need restock
      return (
        f.trendCategory === "trending_up" ||
        f.combinedScore > 15 ||
        f.restockPriority === "urgent" ||
        f.restockPriority === "moderate" ||
        f.restockPriority === "opportunity"
      );
    })
    .sort((a, b) => {
      // Sort: trending_up first, then by combinedScore desc, then by activeTrendPct desc
      const catOrder = { trending_up: 0, opportunity: 1, moderate: 2, urgent: 3, stable: 4 };
      const dc = catOrder[a.restockPriority] - catOrder[b.restockPriority];
      if (dc !== 0) return dc;
      return b.combinedScore - a.combinedScore;
    })
    .slice(0, 20);

  const summary = {
    totalProducts: forecasts.length,
    trendingProducts: trendingProducts.length,
    trendingUp: forecasts.filter((f) => f.trendCategory === "trending_up").length,
    trendingDown: forecasts.filter((f) => f.trendCategory === "trending_down").length,
    urgentRestock: forecasts.filter((f) => f.restockPriority === "urgent").length,
    moderateRestock: forecasts.filter((f) => f.restockPriority === "moderate" || f.restockPriority === "opportunity").length,
  };

  const result = {
    summary,
    trendingProducts,
    dataPeriod: {
      days,
      trendDays,
      forecastAccuracy: trendDays === 7 ? "high" : "standard",
      since: since.toISOString(),
      until: new Date().toISOString(),
    },
  };

  // Persist to MongoDB cache (non-blocking)
  saveForecastToCache(sellerOid, { days, trendDays, includeWebTrends }, result);

  return result;
};

/**
 * Get detailed product performance with weekly breakdown.
 */
export const getProductPerformance = async (sellerId, productId, weeks = 12) => {
  if (!sellerId) {
    throw new ErrorResponse("Seller ID is required", 400);
  }

  const since = new Date();
  since.setDate(since.getDate() - (weeks * 7));

  const salesData = await OrderItem.aggregate([
    { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "order" } },
    { $unwind: "$order" },
    {
      $match: {
        productId: new mongoose.Types.ObjectId(productId),
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
        "order.paymentStatus": { $ne: "refunded" },
      },
    },
    {
      $addFields: {
        week: { $dateToString: { format: "%Y-W%V", date: "$order.createdAt" } },
      },
    },
    {
      $group: {
        _id: "$week",
        quantity: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    productId,
    weeks,
    data: salesData,
    totalSold: salesData.reduce((sum, w) => sum + w.quantity, 0),
    totalRevenue: salesData.reduce((sum, w) => sum + w.revenue, 0),
    totalOrders: salesData.reduce((sum, w) => sum + w.orders, 0),
  };
};

/**
 * Get rich demand details for a single product (chart-ready daily data + web insights).
 * Used by the Analysis Details modal.
 */
export const getProductDemandDetails = async (sellerId, productId, options = {}) => {
  const { days = 30 } = options;

  if (!sellerId) throw new ErrorResponse("Seller ID is required", 400);
  if (!productId) throw new ErrorResponse("Product ID is required", 400);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const productOid = new mongoose.Types.ObjectId(productId);
  const sellerOid = new mongoose.Types.ObjectId(sellerId);

  // ── Verify seller owns the product ─────────────────────────────────
  const product = await Product.findOne({ _id: productOid, sellerId: sellerOid })
    .select("_id name images models category")
    .lean();
  if (!product) throw new ErrorResponse("Product not found", 404);

  // ── Daily sales velocity (for line chart) ─────────────────────────
  const dailySales = await OrderItem.aggregate([
    { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "order" } },
    { $unwind: "$order" },
    {
      $match: {
        productId: productOid,
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
        "order.paymentStatus": { $ne: "refunded" },
      },
    },
    {
      $addFields: {
        date: { $dateToString: { format: "%Y-%m-%d", date: "$order.createdAt" } },
      },
    },
    {
      $group: {
        _id: "$date",
        quantity: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Fill gaps so chart shows a continuous line
  const filledDaily = [];
  const salesMap = Object.fromEntries(dailySales.map((d) => [d._id, d]));
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    filledDaily.push({
      date: key,
      quantity: salesMap[key]?.quantity || 0,
      revenue: salesMap[key]?.revenue || 0,
    });
  }

  const totalSold = dailySales.reduce((s, d) => s + d.quantity, 0);
  const avgDailyQty = totalSold / days;
  const lastSale = dailySales.length > 0 ? dailySales[dailySales.length - 1] : null;

  // ── Weekly data (for trend calculation) ───────────────────────────
  const weeklySales = await OrderItem.aggregate([
    { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "order" } },
    { $unwind: "$order" },
    {
      $match: {
        productId: productOid,
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
        "order.paymentStatus": { $ne: "refunded" },
      },
    },
    {
      $addFields: { week: { $dateToString: { format: "%Y-W%V", date: "$order.createdAt" } } },
    },
    {
      $group: {
        _id: "$week",
        quantity: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const mid = Math.floor(weeklySales.length / 2);
  const recentTotal = weeklySales.slice(mid).reduce((s, w) => s + w.quantity, 0);
  const previousTotal = weeklySales.slice(0, mid).reduce((s, w) => s + w.quantity, 0);
  const trendPct = previousTotal > 0
    ? ((recentTotal - previousTotal) / previousTotal) * 100
    : recentTotal > 0 ? 100 : 0;

  // ── Current inventory ─────────────────────────────────────────────
  const models = product.models || [];
  const totalStock = models.reduce((sum, m) => {
    const stock = m.stock ?? 0;
    return sum + Number(stock);
  }, 0);

  // Lead time estimate: use avg time between last 3 incoming POs for this product
  let leadTimeDays = null;
  try {
    const PurchaseOrder = (await import("../models/PurchaseOrder.js")).default;
    const pos = await PurchaseOrder.find({
      sellerId: sellerOid,
      status: { $in: ["completed", "delivered"] },
    })
      .select("items expectedDeliveryDate receivedDate createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const leadTimes = [];
    for (const po of pos) {
      const hasProduct = po.items?.some((it) => it.productId?.toString() === productId);
      if (!hasProduct) continue;
      if (po.receivedDate && po.createdAt) {
        const ms = new Date(po.receivedDate) - new Date(po.createdAt);
        leadTimes.push(Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24))));
      }
    }
    if (leadTimes.length > 0) leadTimeDays = Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length);
  } catch {}

  // Days until stockout
  let daysUntilStockout = null;
  if (avgDailyQty > 0) {
    daysUntilStockout = Math.round(totalStock / avgDailyQty);
  }

  // ── Suggested restock qty ─────────────────────────────────────────
  const restockMultiplier = days === 7 ? 1 : 4;
  const suggestedQty = Math.max(Math.ceil(avgDailyQty * 7 * restockMultiplier - totalStock), 0);

  // ── Web trend data ────────────────────────────────────────────────
  let webTrends = { globalTrendScore: 0, trendSources: [], hasData: false };
  try {
    webTrends = await getWebTrendsForKeyword(product.name);
  } catch {}

  // ── Market price range from competitors ──────────────────────────
  let marketPrices = null;
  if (webTrends.hasData && webTrends.trendSources.length > 0) {
    const prices = [];
    for (const src of webTrends.trendSources) {
      if (src.price) prices.push(src.price);
    }
    if (prices.length > 0) {
      prices.sort((a, b) => a - b);
      const lo = prices[Math.floor(prices.length * 0.1)];
      const hi = prices[Math.floor(prices.length * 0.9)];
      marketPrices = { low: lo, high: hi, currency: "VND" };
    }
  }

  // ── AI insight summary (via Gemini when available) ──────────────────────────
  let aiInsight = "";
  try {
    aiInsight = await generateDemandInsight({
      productId,
      productName: product.name,
      totalStock,
      avgDailyQty,
      totalSold,
      leadTimeDays,
      daysUntilStockout,
      suggestedQty,
      estimatedRevenue: suggestedQty > 0 && product.models?.[0]?.price
        ? suggestedQty * product.models[0].price
        : null,
      trendPct: Math.round(trendPct * 10) / 10,
      webTrends,
      days,
      marketPrices,
      currentPrice: product.models?.[0]?.price || null,
    });
  } catch (err) {
    console.error("[demandForecast] generateDemandInsight failed:", err.message);
    // Fallback: minimal structured text so the UI still shows something
    aiInsight = `Analysis of **${product.name}**: ${totalSold} units sold over ${days} days. ` +
      `Current stock ${totalStock} units${daysUntilStockout !== null ? ` (~${daysUntilStockout} days remaining)` : ""}. ` +
      `Suggested order: **${suggestedQty} units**.`;
  }

  return {
    productId,
    name: product.name,
    image: product.images?.[0] || null,
    category: product.category || null,
    // Section A
    salesVelocity: filledDaily,
    totalSold,
    avgDailyQty: Math.round(avgDailyQty * 10) / 10,
    totalStock,
    leadTimeDays,
    daysUntilStockout,
    // Section B
    webTrends,
    marketPrices,
    // Section C
    suggestedQty,
    estimatedRevenue: suggestedQty > 0 && product.models?.[0]?.price
      ? suggestedQty * (product.models[0].price)
      : null,
    aiInsight,
    trendPct: Math.round(trendPct * 10) / 10,
  };
};
