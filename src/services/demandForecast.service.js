import mongoose from "mongoose";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import InventoryItem from "../models/InventoryItem.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * Get demand forecast and restock alerts for seller
 * Revenue = subtotal - discountAmount, exclude refunded orders
 */
export const getDemandForecast = async (sellerId, days = 90) => {
  if (!sellerId) {
    throw new ErrorResponse("Seller ID is required", 400);
  }

  const sellerOid = new mongoose.Types.ObjectId(sellerId);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get seller's active products
  const products = await Product.find({ sellerId: sellerOid, status: "active" })
    .select("_id name images models._id models.price models.stock models.sku")
    .lean();

  if (!products.length) {
    return {
      summary: {
        totalProducts: 0,
        urgentRestock: 0,
        moderateRestock: 0,
        stable: 0,
        trendingUp: 0,
        trendingDown: 0,
        outOfStock: 0,
        restockSkuAlerts: 0,
      },
      restockAlerts: [],
      trendAnalysis: [],
      insights: [],
    };
  }

  const productIds = products.map((p) => p._id);

  // Get sales data grouped by week for all products
  const salesData = await OrderItem.aggregate([
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
        productId: { $in: productIds },
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
        "order.paymentStatus": { $ne: "refunded" },
      },
    },
    {
      $addFields: {
        week: {
          $dateToString: { format: "%Y-W%V", date: "$order.createdAt" },
        },
      },
    },
    {
      $group: {
        _id: {
          productId: "$productId",
          week: "$week",
        },
        quantity: { $sum: "$quantity" },
        revenue: { $sum: "$subtotal" },
      },
    },
    {
      $sort: { "_id.week": 1 },
    },
  ]);

  // Get current inventory for all products
  const inventoryItems = await InventoryItem.find({
    productId: { $in: productIds },
  }).select("productId modelId quantity").lean();

  /**
   * Per-(productId, modelId) quantities from ERP.
   * If a SKU has no InventoryItem row, fall back to Product.models[].stock (catalog),
   * so forecast matches what sellers see on the product list.
   */
  const invByProductModel = {};
  inventoryItems.forEach((item) => {
    const pid = item.productId.toString();
    const mid = item.modelId.toString();
    const key = `${pid}|${mid}`;
    if (!invByProductModel[key]) invByProductModel[key] = 0;
    invByProductModel[key] += item.quantity;
  });

  // Build product map
  const productMap = {};
  products.forEach((p) => {
    productMap[p._id.toString()] = p;
  });

  // Calculate metrics for each product
  const weeklySalesMap = {};
  salesData.forEach((row) => {
    const pid = row._id.productId.toString();
    if (!weeklySalesMap[pid]) weeklySalesMap[pid] = [];
    weeklySalesMap[pid].push({
      week: row._id.week,
      quantity: row.quantity,
      revenue: row.revenue,
    });
  });

  const resolveSkuStock = (productIdStr, model) => {
    const mid = model?._id?.toString();
    if (!mid) return Number(model?.stock) || 0;
    const key = `${productIdStr}|${mid}`;
    return Object.prototype.hasOwnProperty.call(invByProductModel, key)
      ? invByProductModel[key]
      : (Number(model.stock) || 0);
  };

  const forecasts = Object.keys(productMap).map((pid) => {
    const product = productMap[pid];
    const sales = weeklySalesMap[pid] || [];
    const models = product.models || [];
    const currentStock = models.reduce(
      (sum, m) => sum + resolveSkuStock(pid, m),
      0,
    );
    const totalSold = sales.reduce((sum, w) => sum + w.quantity, 0);
    const totalRevenue = sales.reduce((sum, w) => sum + w.revenue, 0);

    // Calculate weekly averages
    const weekCount = sales.length || 1;
    const avgWeeklyQty = totalSold / weekCount;
    const avgWeeklyRevenue = totalRevenue / weekCount;

    // Calculate trend: compare recent 4 weeks vs previous 4 weeks
    const recentWeeks = sales.slice(-4);
    const previousWeeks = sales.slice(-8, -4);

    const recentTotal = recentWeeks.reduce((sum, w) => sum + w.quantity, 0);
    const previousTotal = previousWeeks.reduce((sum, w) => sum + w.quantity, 0);

    const trendPercent = previousTotal > 0
      ? ((recentTotal - previousTotal) / previousTotal * 100)
      : (recentTotal > 0 ? 100 : 0);

    // Calculate weeks of stock remaining (product-level)
    const weeksOfStock = avgWeeklyQty > 0
      ? currentStock / avgWeeklyQty
      : Infinity;

    // Product-level restock flag (for summaries / legacy); SKU list is built below.
    let restockPriority = "stable"; // stable, moderate, urgent
    if (currentStock === 0 && avgWeeklyQty > 0) {
      restockPriority = "urgent";
    } else if (weeksOfStock < 2 && avgWeeklyQty > 0) {
      restockPriority = "urgent";
    } else if (weeksOfStock < 4 && avgWeeklyQty > 0) {
      restockPriority = "moderate";
    }

    // Trend category
    let trendCategory = "stable"; // trending_up, stable, trending_down
    if (trendPercent > 10) trendCategory = "trending_up";
    else if (trendPercent < -10) trendCategory = "trending_down";

    // Best selling price
    const modelPrices = product.models
      ?.filter((m) => m.price > 0)
      .map((m) => m.price) || [];
    const minPrice = modelPrices.length > 0 ? Math.min(...modelPrices) : 0;
    const maxPrice = modelPrices.length > 1 ? Math.max(...modelPrices) : minPrice;

    return {
      productId: pid,
      name: product.name,
      image: product.images?.[0] || null,
      currentStock,
      totalSold,
      totalRevenue,
      avgWeeklyQty: Math.round(avgWeeklyQty * 10) / 10,
      avgWeeklyRevenue,
      weeksOfStock: weeksOfStock === Infinity ? null : Math.round(weeksOfStock * 10) / 10,
      trendPercent: Math.round(trendPercent * 10) / 10,
      trendCategory,
      restockPriority,
      minPrice,
      maxPrice,
    };
  });

  const forecastByProductId = Object.fromEntries(
    forecasts.map((f) => [f.productId, f]),
  );

  /** SKU-level restock rows (matches catalog / ERP per variant) */
  const skuRestockRows = [];
  products.forEach((p) => {
    const pid = p._id.toString();
    const f = forecastByProductId[pid];
    if (!f) return;
    const models = p.models || [];
    const denom = Math.max(models.length, 1);
    const salesWeeks = weeklySalesMap[pid] || [];
    const weekCount = salesWeeks.length || 1;
    const avgWeeklyQty = f.totalSold / weekCount;
    models.forEach((m) => {
      const skuStock = resolveSkuStock(pid, m);
      const skuAvgWeekly = avgWeeklyQty / denom;
      const skuWeeks =
        skuAvgWeekly > 0 ? skuStock / skuAvgWeekly : Infinity;

      let skuPriority = "stable";
      if (skuStock === 0) {
        skuPriority = avgWeeklyQty > 0 ? "urgent" : "moderate";
      } else if (avgWeeklyQty > 0) {
        if (skuWeeks < 2) skuPriority = "urgent";
        else if (skuWeeks < 4) skuPriority = "moderate";
      }

      if (skuPriority === "stable") return;

      skuRestockRows.push({
        productId: pid,
        modelId: m._id?.toString() || null,
        sku: m.sku || "",
        name: p.name,
        image: p.images?.[0] || null,
        currentStock: skuStock,
        totalSold: f.totalSold,
        avgWeeklyQty: f.avgWeeklyQty,
        weeksOfStock:
          skuWeeks === Infinity ? null : Math.round(skuWeeks * 10) / 10,
        restockPriority: skuPriority,
        trendPercent: f.trendPercent,
        trendCategory: f.trendCategory,
        suggestedQuantity:
          skuStock === 0
            ? Math.max(Math.ceil(skuAvgWeekly * 4) || 10, 10)
            : Math.max(Math.ceil(skuAvgWeekly * 4 - skuStock), 10),
      });
    });
  });

  skuRestockRows.sort((a, b) => {
    const pr = { urgent: 0, moderate: 1, stable: 2 };
    const d = pr[a.restockPriority] - pr[b.restockPriority];
    if (d !== 0) return d;
    const wa = a.weeksOfStock ?? 999;
    const wb = b.weeksOfStock ?? 999;
    return wa - wb;
  });

  const urgentProducts = skuRestockRows.filter((r) => r.restockPriority === "urgent");
  const moderateProducts = skuRestockRows.filter((r) => r.restockPriority === "moderate");

  const trendingUpProducts = forecasts
    .filter((f) => f.trendCategory === "trending_up")
    .sort((a, b) => b.trendPercent - a.trendPercent);

  const trendingDownProducts = forecasts
    .filter((f) => f.trendCategory === "trending_down")
    .sort((a, b) => a.trendPercent - b.trendPercent);

  // Generate insights
  const insights = [];

  if (urgentProducts.length > 0) {
    insights.push({
      type: "danger",
      icon: "🚨",
      title: "Cần nhập hàng gấp",
      message: `${urgentProducts.length} mã SKU đang sắp hết hoặc đã hết hàng. Cần nhập hàng ngay để tránh mất doanh thu.`,
    });
  }

  if (trendingUpProducts.length > 0) {
    insights.push({
      type: "success",
      icon: "📈",
      title: "Sản phẩm đang trend tốt",
      message: `${trendingUpProducts.length} sản phẩm có xu hướng tăng trưởng. Nên đẩy mạnh marketing và chuẩn bị đủ hàng.`,
    });
  }

  if (trendingDownProducts.length > 0) {
    insights.push({
      type: "warning",
      icon: "📉",
      title: "Sản phẩm có xu hướng giảm",
      message: `${trendingDownProducts.length} sản phẩm đang giảm nhu cầu. Cần xem lại giá, nội dung hoặc chạy quảng cáo.`,
    });
  }

  const outOfStockSkuCount = products.reduce((acc, p) => {
    const pid = p._id.toString();
    const f = forecastByProductId[pid];
    if (!f || f.totalSold <= 0) return acc;
    const n = (p.models || []).filter((m) => resolveSkuStock(pid, m) === 0).length;
    return acc + n;
  }, 0);
  if (outOfStockSkuCount > 0) {
    insights.push({
      type: "danger",
      icon: "❌",
      title: "Biến thể đã hết hàng",
      message: `${outOfStockSkuCount} mã SKU đang hết hàng nhưng sản phẩm vẫn có đơn trong kỳ. Đây là doanh thu bị mất!`,
    });
  }

  const slowMoving = forecasts.filter((f) => f.currentStock > 50 && f.avgWeeklyQty < 2);
  if (slowMoving.length > 0) {
    insights.push({
      type: "info",
      icon: "📦",
      title: "Hàng tồn lâu",
      message: `${slowMoving.length} sản phẩm tồn kho nhiều nhưng bán chậm. Cân nhắc giảm giá hoặc ngừng nhập thêm.`,
    });
  }

  // Build summary
  const summary = {
    totalProducts: forecasts.length,
    urgentRestock: urgentProducts.length,
    moderateRestock: moderateProducts.length,
    stable: forecasts.filter((f) => f.restockPriority === "stable").length,
    trendingUp: trendingUpProducts.length,
    trendingDown: trendingDownProducts.length,
    outOfStock: outOfStockSkuCount,
    restockSkuAlerts: skuRestockRows.length,
  };

  // Return all data
  return {
    summary,
    restockAlerts: skuRestockRows.slice(0, 20),
    trendAnalysis: {
      trendingUp: trendingUpProducts.slice(0, 10),
      trendingDown: trendingDownProducts.slice(0, 10),
      topPerformer: forecasts.sort((a, b) => b.totalSold - a.totalSold)[0] || null,
      worstPerformer: forecasts
        .filter((f) => f.totalSold > 0)
        .sort((a, b) => a.totalSold - b.totalSold)[0] || null,
    },
    insights,
    dataPeriod: {
      days,
      since: since.toISOString(),
      until: new Date().toISOString(),
    },
  };
};

/**
 * Get detailed product performance with weekly breakdown
 */
export const getProductPerformance = async (sellerId, productId, weeks = 12) => {
  if (!sellerId) {
    throw new ErrorResponse("Seller ID is required", 400);
  }

  const since = new Date();
  since.setDate(since.getDate() - (weeks * 7));

  const salesData = await OrderItem.aggregate([
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
        productId: new mongoose.Types.ObjectId(productId),
        "order.createdAt": { $gte: since },
        "order.status": { $in: ["completed", "delivered", "delivered_pending_confirmation"] },
        "order.paymentStatus": { $ne: "refunded" },
      },
    },
    {
      $addFields: {
        week: {
          $dateToString: { format: "%Y-W%V", date: "$order.createdAt" },
        },
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
    {
      $sort: { _id: 1 },
    },
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
