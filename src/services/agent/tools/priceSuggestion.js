import mongoose, { isValidObjectId } from "mongoose";
import crypto from "crypto";
import Product from "../../../models/Product.js";
import PriceSuggestionCache from "../../../models/PriceSuggestionCache.js";
import InventoryItem from "../../../models/InventoryItem.js";
import PurchaseOrder from "../../../models/PurchaseOrder.js";
import embeddingService from "../../embedding.service.js";
import multiStrategyCache from "../../multiStrategyCache.service.js";
import { registerTool } from "../tools.js";
import { sanitizeProductName } from "../../../utils/promptSanitizer.js";

/**
 * Chuẩn hóa SKU để so khớp PO / kho (GIÀY041 vs GIAY041, khoảng trắng, v.v.).
 */
function normalizeSkuKey(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/Đ/g, "D");
}

/** Hai SKU có cùng khóa chuẩn hóa không */
function skusMatch(a, b) {
  if (!a || !b) return false;
  return normalizeSkuKey(a) === normalizeSkuKey(b);
}

/** Các biến thể để query Mongo ($in) — PO có thể lưu GIÀY… hoặc GIAY… */
function buildSkuQueryVariants(sku) {
  if (!sku || typeof sku !== "string") return [];
  const t = sku.trim();
  if (!t) return [];
  const upper = t.toUpperCase();
  const folded = normalizeSkuKey(t);
  return [...new Set([upper, folded].filter(Boolean))];
}

const AI_API_URL = process.env.AI_API_URL || "https://textgeneration.trongducdoan25.workers.dev/";
const AI_API_TOKEN = process.env.AI_API_TOKEN;

/**
 * Compute min, avg (rounded), max from a price array.
 */
function priceStats(prices) {
  if (!prices.length) return { min: 0, avg: 0, max: 0 };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  return { min, avg, max };
}

/**
 * [Phase 3 - P2] Beyond Simple Average:
 * Computes market statistics from a competitor list enriched with sold/score/rating.
 *
 * 1. Clustering  — keep only "quality" competitors (score > 0.9 AND rating > 4.0).
 *    Falls back to full set if cluster < 2.
 *
 * 2. Weighted Average by sold count — competitors with more sales get higher weight,
 *    so SKUs with 0 orders don't skew the benchmark downward.
 *
 * 3. Median — removes outlier influence from both low and high extremes.
 *
 * 4. Full cluster vs. global stats — for the prompt so the LLM can reason about
 *    whether the seller's market is thin ("low confidence") or deep.
 *
 * Returns a flat object compatible with the existing `stats` field names (min/avg/max)
 * PLUS the new fields (weightedAvg, median, cluster*).
 *
 * @param {Array} competitors - product docs with { score?, rating?, sold?, originalPrice, models? }
 * @returns {{ min, avg, max, weightedAvg, median, clusterMin, clusterAvg, clusterMax,
 *             clusterCount, totalCount, clusterWeightedAvg, confidence }}
 */
function computeMarketStats(competitors) {
  if (!competitors || competitors.length === 0) {
    return {
      min: 0, avg: 0, max: 0,
      weightedAvg: 0, median: 0,
      clusterMin: 0, clusterAvg: 0, clusterMax: 0,
      clusterCount: 0, totalCount: 0,
      clusterWeightedAvg: 0, confidence: "none",
    };
  }

  const THRESH_SCORE = 0.9;
  const THRESH_RATING = 4.0;

  // Each entry: { price, sold, score, rating }
  const enriched = competitors.map((p) => {
    const price = p.models?.length
      ? (p.models.find((m) => m.price != null)?.price ?? p.originalPrice)
      : p.originalPrice;
    return {
      price: Number(price) || 0,
      sold: Number(p.sold) || 0,
      score: typeof p.score === "number" ? p.score : (p._score || 0),
      rating: Number(p.rating) || 0,
    };
  }).filter((e) => e.price > 0);

  if (enriched.length === 0) {
    return { min: 0, avg: 0, max: 0, weightedAvg: 0, median: 0,
      clusterMin: 0, clusterAvg: 0, clusterMax: 0,
      clusterCount: 0, totalCount: 0, clusterWeightedAvg: 0, confidence: "none" };
  }

  const allPrices = enriched.map((e) => e.price);

  // --- Global stats (original behaviour, for backward-compat prompt) ---
  const globalStats = priceStats(allPrices);

  // --- Weighted Average by sold (log-scaled to avoid extreme outliers) ---
  const logSoldWeight = (sold) => Math.log1p(Math.max(0, sold));
  const totalWeight = enriched.reduce((s, e) => s + logSoldWeight(e.sold), 0);
  const weightedAvg = totalWeight > 0
    ? Math.round(enriched.reduce((s, e) => s + e.price * logSoldWeight(e.sold), 0) / totalWeight)
    : globalStats.avg;

  // --- Median ---
  const sorted = [...allPrices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];

  // --- Cluster: score > THRESH_SCORE AND rating > THRESH_RATING ---
  const cluster = enriched.filter((e) => e.score > THRESH_SCORE && e.rating > THRESH_RATING);
  const clusterPrices = cluster.map((e) => e.price);

  let clusterStats = { min: 0, avg: 0, max: 0, weightedAvg: 0, median: 0 };
  if (cluster.length >= 2) {
    clusterStats = priceStats(clusterPrices);
    const clusterTotalWeight = cluster.reduce((s, e) => s + logSoldWeight(e.sold), 0);
    clusterStats.weightedAvg = clusterTotalWeight > 0
      ? Math.round(cluster.reduce((s, e) => s + e.price * logSoldWeight(e.sold), 0) / clusterTotalWeight)
      : clusterStats.avg;
    const cs = [...clusterPrices].sort((a, b) => a - b);
    const cm = Math.floor(cs.length / 2);
    clusterStats.median = cs.length % 2 === 0
      ? Math.round((cs[cm - 1] + cs[cm]) / 2)
      : cs[cm];
  } else {
    // Not enough cluster items — use global as fallback with low confidence
    clusterStats.min = globalStats.min;
    clusterStats.avg = globalStats.avg;
    clusterStats.max = globalStats.max;
    clusterStats.weightedAvg = weightedAvg;
    clusterStats.median = median;
  }

  // --- Confidence label ---
  let confidence = "low";
  if (cluster.length >= 5) confidence = "high";
  else if (cluster.length >= 2) confidence = "medium";

  return {
    ...globalStats,
    weightedAvg,
    median,
    clusterMin: clusterStats.min,
    clusterAvg: clusterStats.avg,
    clusterMax: clusterStats.max,
    clusterWeightedAvg: clusterStats.weightedAvg,
    clusterMedian: clusterStats.median,
    clusterCount: cluster.length,
    totalCount: enriched.length,
    confidence,
  };
}

/**
 * [Hướng 2] Lấy chi phí nhập hàng chi tiết từ PurchaseOrder (PO) cho một sản phẩm/model.
 *
 * Tính toán LANDED COST (giá vốn đã phân bổ) bao gồm:
 *   - Giá hàng gốc (đã quy đổi từ CNY → VND theo tỷ giá)
 *   - Phí dịch vụ mua hàng (%)
 *   - Cước vận chuyển quốc tế (VNĐ/kg hoặc VNĐ/m³)
 *   - Thuế nhập khẩu
 *   - Chi phí cố định (ship nội TQ, đóng gói, ship nội VN)
 *
 * Mỗi chi phí được phân bổ theo tỷ lệ số lượng (quantity) của item trong PO.
 *
 * @param {ObjectId|string} productId - ID sản phẩm
 * @param {string} sku - SKU của model cần lấy chi phí
 * @returns {Object} Chi tiết chi phí nhập hàng
 */
/**
 * Chọn dòng PO phù hợp: ưu tiên modelId, sau đó khớp SKU (có chuẩn hóa dấu).
 */
function findPoLine(po, sku, modelId) {
  if (!po?.items?.length) return null;
  if (modelId && isValidObjectId(modelId)) {
    const mid = String(modelId);
    const byModel = po.items.find((i) => i.modelId?.toString() === mid);
    if (byModel) return byModel;
  }
  if (sku && String(sku).trim()) {
    const bySku = po.items.find((i) => skusMatch(i.sku, sku));
    if (bySku) return bySku;
  }
  return null;
}

/**
 * Tìm PO theo productId trên dòng hàng (khi SKU listing ≠ SKU trên PO).
 */
async function findPoByLinkedProduct(productId, sku, modelId) {
  if (!productId || !isValidObjectId(productId)) return null;
  const pid = new mongoose.Types.ObjectId(productId);

  const tryStatuses = [
    { list: ["COMPLETED", "Completed"], estimate: false },
    { list: ["ORDERED", "ARRIVED_VN"], estimate: true },
  ];

  for (const { list, estimate } of tryStatuses) {
    const pos = await PurchaseOrder.find({
      status: { $in: list },
      "items.productId": pid,
    })
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean();

    for (const po of pos) {
      const lines = (po.items || []).filter((i) => i.productId?.toString() === pid.toString());
      if (!lines.length) continue;

      let item = null;
      if (modelId && isValidObjectId(modelId)) {
        const mid = String(modelId);
        item = lines.find((l) => l.modelId?.toString() === mid);
      }
      if (!item && sku?.trim()) {
        item = lines.find((l) => skusMatch(l.sku, sku));
      }
      if (!item && lines.length === 1) {
        item = lines[0];
      }
      if (item) {
        return { po, item, isEstimate: estimate };
      }
    }
  }
  return null;
}

/**
 * Lấy PO từ InventoryItem.costSourcePoId (đồng bộ với màn hình tồn kho / "via PO").
 */
async function fetchCostDataFromInventoryPoLink(productId, modelId) {
  if (!productId || !isValidObjectId(productId) || !modelId || !isValidObjectId(modelId)) {
    return null;
  }
  const inv = await InventoryItem.findOne({
    productId: new mongoose.Types.ObjectId(productId),
    modelId: new mongoose.Types.ObjectId(modelId),
    costSourcePoId: { $ne: null },
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!inv?.costSourcePoId) return null;

  const po = await PurchaseOrder.findById(inv.costSourcePoId).lean();
  if (!po) return null;

  const item = findPoLine(po, inv.sku, modelId);
  if (!item) return null;

  const estimate = !["COMPLETED", "Completed"].includes(po.status || "");
  return buildCostBreakdown(po, item.sku, estimate, modelId, item);
}

async function fetchCostData(productId, sku, modelId = null) {
  const skuTrim = typeof sku === "string" ? sku.trim() : "";
  const variants = buildSkuQueryVariants(skuTrim);

  const findPoBySkuVariants = async (statusList) => {
    if (!variants.length) return null;
    return PurchaseOrder.findOne({
      status: { $in: statusList },
      "items.sku": { $in: variants },
    })
      .sort({ updatedAt: -1 })
      .lean();
  };

  // 1) PO hoàn thành — khớp SKU (nhiều biến thể chữ)
  let latestPO = await findPoBySkuVariants(["COMPLETED", "Completed"]);
  let isEstimate = false;

  if (!latestPO) {
    latestPO = await findPoBySkuVariants(["ORDERED", "ARRIVED_VN"]);
    if (latestPO) isEstimate = true;
  }

  if (latestPO) {
    return buildCostBreakdown(latestPO, skuTrim || latestPO.items?.[0]?.sku, isEstimate, modelId);
  }

  // 2) Fallback: dòng PO đã gắn productId + modelId (SKU có thể lệch dấu / nhập tay)
  const linked = await findPoByLinkedProduct(productId, skuTrim, modelId);
  if (linked) {
    return buildCostBreakdown(linked.po, linked.item.sku, linked.isEstimate, modelId, linked.item);
  }

  // 3) Fallback: bản ghi tồn kho trỏ thẳng tới PO
  const fromInv = await fetchCostDataFromInventoryPoLink(productId, modelId);
  if (fromInv) return fromInv;

  return {
    hasCostData: false,
    message: skuTrim
      ? "Chưa có dữ liệu nhập hàng nào cho SKU/phiên bản này (hoặc PO chưa ở trạng thái hoàn thành)."
      : "Chưa có SKU trên listing hoặc chưa liên kết phiên bản với phiếu nhập.",
  };
}

/**
 * Xây dựng chi tiết chi phí từ một PurchaseOrder cụ thể.
 * Tất cả các chi phí được phân bổ theo số lượng (quantity) của item.
 *
 * @param {Object} po - PurchaseOrder document (lean)
 * @param {string} sku - SKU cần tính chi phí
 * @param {boolean} isEstimate - true nếu PO chưa COMPLETED (chi phí có thể thay đổi)
 * @param {string|null} modelId - ObjectId model (ưu tiên khớp dòng PO)
 * @param {Object|null} explicitItem - dòng PO đã xác định (bỏ qua tìm lại)
 */
function buildCostBreakdown(po, sku, isEstimate = false, modelId = null, explicitItem = null) {
  const DEFAULT_EXCHANGE_RATE = 3500;
  const rate = po.importConfig?.exchangeRate || DEFAULT_EXCHANGE_RATE;

  const item = explicitItem || findPoLine(po, sku, modelId);

  if (!item) {
    return { hasCostData: false, message: "Không tìm thấy item trong PO." };
  }

  const qty = item.quantity || 1;
  const unitPriceCny = item.unitPriceCny || 0;
  const unitPriceVnd = item.unitPrice || 0; // đã computed bằng unitPriceCny × rate

  // ─── Chi phí theo đơn hàng (không phân bổ) ───────────────────────────────────
  const buyingFeeVnd = (unitPriceVnd || 0) * (po.importConfig?.buyingServiceFeeRate || 0);

  // ─── Chi phí theo trọng lượng (chargeable weight) ────────────────────────────
  const chargeableWeight = item.chargeableWeightKg || 0;
  const shippingRatePerKg = po.importConfig?.shippingRatePerKg || 0;
  const shippingCostPerUnit = chargeableWeight > 0 && shippingRatePerKg > 0
    ? (chargeableWeight * shippingRatePerKg) / qty
    : 0;

  // ─── Chi phí cố định phân bổ ─────────────────────────────────────────────────
  const poRate = po.importConfig?.exchangeRate || DEFAULT_EXCHANGE_RATE;
  const cnDomesticVnd = (po.fixedCosts?.cnDomesticShippingCny || 0) * poRate;
  const packagingVnd = po.fixedCosts?.packagingCostVnd || 0;
  const vnDomesticVnd = po.fixedCosts?.vnDomesticShippingVnd || 0;
  const fixedCostsTotal = cnDomesticVnd + packagingVnd + vnDomesticVnd;
  const fixedCostsPerUnit = qty > 0 ? fixedCostsTotal / qty : 0;

  // ─── Thuế và chi phí khác (phân bổ theo số lượng) ───────────────────────────
  const taxPerUnit = qty > 0 ? (po.taxAmount || 0) / qty : 0;
  const otherCostPerUnit = qty > 0 ? (po.otherCost || 0) / qty : 0;

  // ─── Tổng hợp ───────────────────────────────────────────────────────────────
  const productCostVnd = unitPriceVnd || (unitPriceCny * rate);
  const landedCostPerUnit = productCostVnd
    + buyingFeeVnd
    + shippingCostPerUnit
    + taxPerUnit
    + otherCostPerUnit
    + fixedCostsPerUnit;

  // ─── Biên lợi nhuận reference (so với current selling price → cần truyền vào) ───
  // Biên được tính ở execute() khi có giá bán hiện tại

  return {
    hasCostData: true,
    isEstimate,
    poCode: po.code,
    poStatus: po.status,
    sku: item.sku,
    quantityInPo: qty,
    // ─── Chi tiết từng dòng chi phí ───
    breakdown: {
      // Giá hàng gốc (CNY → VND)
      productCostCny: unitPriceCny,
      productCostVnd: productCostVnd,
      exchangeRate: rate,
      exchangeRateNote: `Tỷ giá ${rate.toLocaleString("vi-VN")} VNĐ/CNY`,
      // Phí dịch vụ mua hàng (%)
      buyingServiceFeeRate: po.importConfig?.buyingServiceFeeRate || 0,
      buyingServiceFeeVnd: Math.round(buyingFeeVnd),
      buyingServiceFeeNote: `${((po.importConfig?.buyingServiceFeeRate || 0) * 100).toFixed(1)}% phí dịch vụ mua hàng Quảng Châu`,
      // Cước vận chuyển quốc tế
      chargeableWeightKg: Math.round(chargeableWeight * 1000) / 1000,
      shippingRatePerKg,
      shippingCostPerUnit: Math.round(shippingCostPerUnit),
      shippingNote: chargeableWeight > 0 && shippingRatePerKg > 0
        ? `Cước vận chuyển QT: ${shippingRatePerKg.toLocaleString("vi-VN")}₫/kg × ${chargeableWeight.toFixed(2)}kg = ${Math.round(chargeableWeight * shippingRatePerKg).toLocaleString("vi-VN")}₫ ÷ ${qty} sp`
        : "Chưa có dữ liệu cước vận chuyển",
      // Thuế nhập khẩu
      taxAmount: po.taxAmount || 0,
      taxPerUnit: Math.round(taxPerUnit),
      taxNote: po.taxAmount > 0
        ? `Thuế NK: ${(po.taxAmount || 0).toLocaleString("vi-VN")}₫ ÷ ${qty} sp`
        : "Không có thuế nhập khẩu",
      // Chi phí cố định
      fixedCosts: {
        cnDomesticShippingCny: po.fixedCosts?.cnDomesticShippingCny || 0,
        cnDomesticShippingVnd: Math.round(cnDomesticVnd),
        packagingCostVnd: packagingVnd,
        vnDomesticShippingVnd: vnDomesticVnd,
        total: Math.round(fixedCostsTotal),
        perUnit: Math.round(fixedCostsPerUnit),
        note: fixedCostsTotal > 0
          ? `Ship nội TQ ${cnDomesticVnd.toLocaleString("vi-VN")}₫ + Đóng gói ${packagingVnd.toLocaleString("vi-VN")}₫ + Ship nội VN ${vnDomesticVnd.toLocaleString("vi-VN")}₫ = ${fixedCostsTotal.toLocaleString("vi-VN")}₫ ÷ ${qty} sp`
          : "Không có chi phí cố định",
      },
      // Chi phí khác
      otherCost: po.otherCost || 0,
      otherCostPerUnit: Math.round(otherCostPerUnit),
    },
    // ─── Tổng chi phí (landed cost) ───
    landedCostPerUnit: Math.round(landedCostPerUnit),
    landedCostDisplay: landedCostPerUnit >= 1000
      ? `${(landedCostPerUnit / 1000).toFixed(0)}K`
      : landedCostPerUnit.toLocaleString("vi-VN"),
    // ─── Chi phí đã trả của PO này ───
    poTotals: {
      totalAmount: po.totalAmount || 0,
      shippingCost: po.shippingCost || 0,
      taxAmount: po.taxAmount || 0,
      finalAmount: po.finalAmount || 0,
      finalAmountDisplay: (po.finalAmount || 0) >= 1000
        ? `${((po.finalAmount || 0) / 1000).toFixed(0)}K`
        : (po.finalAmount || 0).toLocaleString("vi-VN"),
    },
    // ─── Thông tin bổ sung ───
    supplierId: po.supplierId,
    receivedDate: po.receivedDate || null,
    poDate: po.createdAt,
    estimateNote: isEstimate
      ? "⚠️ Chi phí ước tính (PO chưa hoàn thành - hàng đang vận chuyển)"
      : null,
  };
}

/**
 * [Hướng 2] Tính biên lợi nhuận dựa trên landed cost thay vì originalPrice.
 *
 * @param {number} sellingPrice - Giá bán hiện tại
 * @param {number} landedCost - Giá vốn landed (từ PO)
 * @returns {Object} { marginPercent, marginVnd, isHealthy }
 */
function calculateMargin(sellingPrice, landedCost) {
  if (!landedCost || landedCost <= 0) {
    return { marginPercent: null, marginVnd: null, isHealthy: false, reason: "Chưa có dữ liệu giá vốn" };
  }

  const marginVnd = sellingPrice - landedCost;
  const marginPercent = (marginVnd / landedCost) * 100;
  const isHealthy = marginPercent >= 10;

  let reason;
  if (marginPercent >= 30) reason = "Biên lợi nhuận tốt";
  else if (marginPercent >= 20) reason = "Biên khá tốt";
  else if (marginPercent >= 15) reason = "Biên chấp nhận được";
  else if (marginPercent >= 10) reason = "Biên tối thiểu (đạt ngưỡng)";
  else if (marginPercent >= 5) reason = "⚠️ Biên thấp - cân nhắc tăng giá";
  else reason = "⚠️ Nguy cơ lỗ vốn - cần điều chỉnh giá";

  return { marginPercent: Math.round(marginPercent * 10) / 10, marginVnd, isHealthy, reason };
}

/**
 * Normalize product title tokens (letters/digits only, min length).
 * Used to require name overlap so category-broadening doesn't pull unrelated SKUs
 * (e.g. handbag vs jogger pants in the same broad "Fashion" category).
 */
function significantNameTokens(name, { minLen = 3, maxTokens = 10 } = {}) {
  if (!name || typeof name !== "string") return [];
  const raw = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase())
    .filter((w) => w.length >= minLen);
  // De-dupe while keeping order
  const seen = new Set();
  const out = [];
  for (const w of raw) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
      if (out.length >= maxTokens) break;
    }
  }
  return out;
}

/** How many significant tokens from `sourceName` appear in `candidateName` (case-insensitive). */
function countTokenOverlap(sourceName, candidateName) {
  const tokens = significantNameTokens(sourceName);
  if (!tokens.length || !candidateName) return 0;
  const hay = candidateName.toLowerCase();
  let n = 0;
  for (const t of tokens) {
    if (hay.includes(t)) n += 1;
  }
  return n;
}

/**
 * Category-expanded competitor must look like the same product type:
 * - ≥2 keyword hits, OR
 * - ≥1 hit including the first keyword (usually the noun: túi, áo, quần, giày…).
 */
function categoryCandidateMatchesProduct(sourceName, candidateName) {
  const tokens = significantNameTokens(sourceName);
  if (!tokens.length || !candidateName) return false;
  const hay = candidateName.toLowerCase();
  const overlap = countTokenOverlap(sourceName, candidateName);
  if (overlap >= 2) return true;
  if (overlap >= 1 && tokens[0] && hay.includes(tokens[0])) return true;
  return false;
}

/**
 * Obfuscate competitor product ID with SHA-256 hash (first 8 chars only).
 * Prevents data scraping while still allowing frontend to distinguish competitors.
 */
function obfuscateCompetitorId(id) {
  return crypto.createHash("sha256").update(id.toString()).digest("hex").slice(0, 8);
}

/**
 * [Phase 2 - 4.2] Build a cache key from productId, currentPrice, top-5 competitor prices.
 * Key changes when: the seller's own price changes, or a competitor changes their price.
 * [Phase 3 - 5.1] Strategy is included in the key — different strategies yield different suggestions.
 */
function makeCacheKey(productId, currentPrice, competitors, strategy) {
  const marketHash = competitors
    .slice(0, 5)
    .map((c) => c.models?.[0]?.price || c.originalPrice)
    .join("|");
  return `${productId}|${currentPrice}|${strategy}|${marketHash}`;
}

/**
 * [Phase 2 - 4.2] Check for a valid cached suggestion before calling LLM.
 * [Phase 3 - 5.1] Strategy is part of the cache key.
 */
async function getCachedSuggestion(productId, sellerId, currentPrice, competitors, strategy) {
  const cacheKey = makeCacheKey(productId, currentPrice, competitors, strategy);
  const cached = await PriceSuggestionCache.findOne({
    productId: new mongoose.Types.ObjectId(productId),
    sellerId: new mongoose.Types.ObjectId(sellerId),
    cacheKey,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (cached) {
    console.log(`[priceSuggestion] Cache HIT for product ${productId}`);
    return cached;
  }
  console.log(`[priceSuggestion] Cache MISS for product ${productId}`);
  return null;
}

/**
 * [Phase 2 - 4.2] Save LLM result to MongoDB cache (fire-and-forget, non-blocking).
 * [Phase 3 - 5.1] Strategy included in cache key and stored payload.
 */
async function saveToCache(productId, sellerId, currentPrice, competitors, result, strategy) {
  const cacheKey = makeCacheKey(productId, currentPrice, competitors, strategy);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute TTL — reflects market price volatility

  try {
    await PriceSuggestionCache.findOneAndUpdate(
      {
        productId: new mongoose.Types.ObjectId(productId),
        sellerId: new mongoose.Types.ObjectId(sellerId),
        cacheKey,
      },
      {
        suggestedPrice: result.suggestedPrice,
        reasoning: result.reasoning,
        warning: result.warning || null,
        riskLevel: result.riskLevel || "safe",
        warningMessage: result.warningMessage || null,
        discountPct: result.discountPct || null,
        // [Phase 3 - 5.1] Store strategy for cache metadata
        strategy: result.strategy || strategy,
        marketData: result.marketData || null,
        competitors: result.competitors || [],
        product: result.product || null,
        productId: new mongoose.Types.ObjectId(productId),
        sellerId: new mongoose.Types.ObjectId(sellerId),
        cacheKey,
        expiresAt,
        updatedAt: new Date(),
      },
      { upsert: true, lean: true }
    );
  } catch (err) {
    // Cache failures must NEVER block the main flow
    console.warn("[priceSuggestion] Cache save failed:", err.message);
  }
}

/**
 * Batch cache key: strategy + variant set + top-5 competitor prices.
 * [Phase 3 - 5.1] Strategy changes the suggestion output — must be part of the key.
 */
function makeBatchCacheKey(validModelIds, competitors, strategy) {
  const sortedIds = [...validModelIds].sort().join(",");
  const marketHash = competitors
    .slice(0, 5)
    .map((c) => c.models?.[0]?.price || c.originalPrice)
    .join("|");
  return `batch|${strategy}|${sortedIds}|${marketHash}`;
}

async function getBatchCachedSuggestion(productId, sellerId, batchCacheKey) {
  const cached = await PriceSuggestionCache.findOne({
    productId: new mongoose.Types.ObjectId(productId),
    sellerId: new mongoose.Types.ObjectId(sellerId),
    cacheKey: batchCacheKey,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (cached?.batchPayload && cached.fromBatch) {
    console.log(`[priceSuggestion] Batch cache HIT for product ${productId}`);
    return cached;
  }
  console.log(`[priceSuggestion] Batch cache MISS for product ${productId}`);
  return null;
}

async function saveBatchToCache(productId, sellerId, batchCacheKey, payload) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute TTL — reflects market price volatility
  try {
    await PriceSuggestionCache.findOneAndUpdate(
      {
        productId: new mongoose.Types.ObjectId(productId),
        sellerId: new mongoose.Types.ObjectId(sellerId),
        cacheKey: batchCacheKey,
      },
      {
        productId: new mongoose.Types.ObjectId(productId),
        sellerId: new mongoose.Types.ObjectId(sellerId),
        cacheKey: batchCacheKey,
        fromBatch: true,
        batchPayload: payload,
        marketData: payload.marketData,
        competitors: payload.competitors,
        product: payload.product,
        // [Phase 3 - 5.1]
        strategy: payload.strategy,
        expiresAt,
        updatedAt: new Date(),
      },
      { upsert: true, lean: true }
    );
  } catch (err) {
    console.warn("[priceSuggestion] Batch cache save failed:", err.message);
  }
}

// [Phase 3 - 5.1] Strategy-specific prompts for Pricing Personas
// [Phase 3 - P2] Uses advanced marketStats (weightedAvg, median, clusterAvg)
// [Hướng 2] Nhận costData để dùng landed cost thay vì originalPrice
function buildStrategyPrompt(strategy, marketStats, totalStock, costData = null) {
  // Prefer cluster-weighted-avg when confidence is high, fall back to global stats
  const refAvg = marketStats.confidence === "high" ? marketStats.clusterWeightedAvg : marketStats.weightedAvg;
  const refMin = marketStats.confidence === "high" ? marketStats.clusterMin : marketStats.min;

  const strategies = {
    balanced: {
      instruction: costData?.hasCostData
        ? `Đề xuất giá cân bằng: cạnh tranh nhưng đảm bảo biên lợi nhuận ≥ 10% trên giá vốn landed (${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫).`
        : "Đề xuất giá cân bằng: cạnh tranh nhưng vẫn đảm bảo biên lợi nhuận.",
      priceHint: `Giá nên nằm trong khoảng min-max của thị trường.\n  Trung bình có trọng số (theo lượt bán): ${refAvg.toLocaleString("vi-VN")}₫\n  Trung vị (loại bỏ outlier): ${(marketStats.median || refAvg).toLocaleString("vi-VN")}₫${costData?.hasCostData ? `\n  Giá vốn landed: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫ → floor price` : ""}`,
    },
    penetration: {
      instruction: costData?.hasCostData
        ? `Chiến lược xâm nhập: đề xuất giá thấp để lấy traffic. Tuy nhiên KHÔNG được thấp hơn giá vốn landed (${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫).`
        : "Chiến lược xâm nhập: đề xuất giá thấp hơn giá của đối thủ bán chạy nhất để lấy traffic.",
      priceHint: `Giá nên thấp hơn ${refMin.toLocaleString("vi-VN")}₫ (giá thấp nhất thị trường) hoặc bằng. Ưu tiên tối đa volume.${costData?.hasCostData ? `\n  ⚠️ Floor price = landed cost: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫` : ""}`,
    },
    clearance: {
      instruction: costData?.hasCostData
        ? `Chiến lược xả kho: ${totalStock} unit tồn kho. Đề xuất giá thấp để bán nhanh nhưng PHẢI ≥ landed cost (${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫). Cảnh báo nếu biên < 15%.`
        : `Chiến lược xả kho: sản phẩm có tồn kho ${totalStock} unit. Đề xuất giá hợp lý để bán nhanh.`,
      priceHint: `Giá có thể thấp hơn avg ${refAvg.toLocaleString("vi-VN")}₫ một chút, nhưng KHÔNG được thấp hơn min ${refMin.toLocaleString("vi-VN")}₫.${costData?.hasCostData ? `\n  ⚠️ Floor price = landed cost: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫` : ""}`,
    },
    profit: {
      instruction: costData?.hasCostData
        ? `Chiến lược tối đa lợi nhuận: dựa trên giá vốn landed (${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫), đề xuất giá tối ưu hóa biên lợi nhuận.`
        : "Chiến lược tối đa lợi nhuận: nếu seller có rating cao, đề xuất giá cao hơn avg một chút.",
      priceHint: `Giá có thể cao hơn avg ${refAvg.toLocaleString("vi-VN")}₫ nếu có lý do chính đáng (brand, rating, tính năng vượt trội).${costData?.hasCostData ? `\n  Biên lợi nhuận target: > 20% trên landed cost ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫` : ""}`,
    },
  };

  return strategies[strategy] || strategies.balanced;
}

/**
 * [Phase 2 - 4.1] Resolve the correct currentPrice based on selected variant (modelId).
 */
function resolveCurrentPrice(targetProduct, modelId) {
  if (modelId) {
    const selectedModel = targetProduct.models?.find(
      (m) => m._id?.toString() === modelId || m.sku === modelId
    );
    return {
      price: selectedModel?.price ?? targetProduct.models?.[0]?.price ?? targetProduct.originalPrice,
      model: selectedModel ?? targetProduct.models?.[0] ?? null,
    };
  }
  return {
    price: targetProduct.models?.[0]?.price ?? targetProduct.originalPrice,
    model: targetProduct.models?.[0] ?? null,
  };
}

/**
 * Ask LLM for a concise pricing recommendation.
 *
 * [Phase 1] Added:
 * - Floor price floor rules in system prompt
 * - Brand + rating context
 * - Floor price validation + discount tier warnings after parsing
 *
 * [Phase 3 - 5.1] Added strategy parameter for Pricing Personas.
 */
async function askLLM(productName, currentPrice, marketStats, topSeller, sellerRating, avgCompetitorRating, strategy = "balanced", totalStock = 0, costData = null) {
  // [Safety] Strip prompt-injection patterns from seller-controlled productName
  const safeProductName = sanitizeProductName(productName);
  if (safeProductName.blocked) {
    console.warn(`[priceSuggestion] productName injection blocked: "${productName}" → "${safeProductName.sanitized}"`);
  }

  // [Hướng 2] Tính margin dựa trên landed cost thực tế (từ PO)
  const marginInfo = costData?.hasCostData
    ? calculateMargin(currentPrice, costData.landedCostPerUnit)
    : { marginPercent: null, marginVnd: null, isHealthy: false, reason: "Chưa có dữ liệu giá vốn" };

  const strategyPrompt = buildStrategyPrompt(strategy, marketStats, totalStock, costData);

  // Use cluster-weighted-avg when high-confidence; otherwise weighted global avg
  const refAvg = marketStats.confidence === "high" ? marketStats.clusterWeightedAvg : marketStats.weightedAvg;
  const refMin  = marketStats.confidence === "high" ? marketStats.clusterMin : marketStats.min;

  const systemPrompt = `Bạn là chuyên gia định giá sản phẩm cho sàn E-commerce GZMart.
Nhiệm vụ: Đề xuất MỘT mức giá bán tối ưu (số nguyên VND, không có dấu phân cách), giải thích chi tiết kèm phân tích chi phí và biên lợi nhuận.

QUAN TRỌNG - Định dạng số:
- TẤT CẢ giá đều là số nguyên (đơn vị: VND/đồng). Ví dụ: 1000000 = một triệu đồng, 1040000 = 1 triệu 40 nghìn.
- suggestedPrice PHẢI trả về SỐ NGUYÊN đầy đủ (vd: 1100000, 1040000), KHÔNG dùng dấu chấm/phẩy.

Quy tắc bắt buộc:
- Giá đề xuất PHẢI cao hơn giá hiện tại của seller ít nhất 5% nếu giá hiện tại thấp hơn giá trung bình thị trường.
- Nếu giá hiện tại hợp lý, giữ hoặc tinh chỉnh nhẹ.
- Mức giá phải cạnh tranh: thấp hơn giá max, cao hơn giá min của đối thủ.
- Luôn đảm bảo biên lợi nhuận > 10% so với giá hiện tại của seller (coi giá hiện tại là giá vốn reference).

QUY TẮC SÀN (BẮT BUỘC):
- KHÔNG BAO GIỜ đề xuất giá thấp hơn giá hiện tại của seller (giá hiện tại = giá sàn).
- Nếu giá đề xuất thấp hơn ${refAvg * 0.7} VND (30% dưới avg thị trường), PHẢI thêm cảnh báo: "⚠️ Cảnh báo: Giá này thấp hơn 30% so với trung bình thị trường. Có nguy cơ lỗ vốn."

[Phase 3 - P2] CHỈ SỐ THỊ TRƯỜNG NÂNG CAO:
- Trung bình có trọng số (theo lượt bán): ${refAvg.toLocaleString("vi-VN")}₫
- Trung vị (loại bỏ outlier): ${(marketStats.median || refAvg).toLocaleString("vi-VN")}₫
- Cluster chất lượng cao (score>0.9 & rating>4.0, confidence: ${marketStats.confidence}):
  · Giá thấp nhất cluster: ${(marketStats.clusterMin || refMin).toLocaleString("vi-VN")}₫
  · Giá trung bình cluster: ${(marketStats.clusterAvg || refAvg).toLocaleString("vi-VN")}₫
  · Trung bình có trọng số cluster: ${(marketStats.clusterWeightedAvg || refAvg).toLocaleString("vi-VN")}₫
  · Trung vị cluster: ${(marketStats.clusterMedian || marketStats.median || refAvg).toLocaleString("vi-VN")}₫
  · Số đối thủ trong cluster: ${marketStats.clusterCount} / ${marketStats.totalCount}
- Tổng số đối thủ: ${marketStats.totalCount} | Độ tin cậy thị trường: ${marketStats.confidence}
- Nếu confidence = "low" (ít đối thủ chất lượng), hãy cẩn trọng hơn và giữ giá gần với top-seller.

[Phase 3 - 5.1] Chiến lược định giá: ${strategy.toUpperCase()}
→ ${strategyPrompt.instruction}
→ ${strategyPrompt.priceHint}

Phân tích rating:
- Rating cao → có thể đề xuất giá cao hơn avg 5-10%.
- Rating thấp → không nên định giá cao hơn avg.
- Luôn đảm bảo biên lợi nhuận > 10%.

Trả về ĐÚNG JSON (không markdown):
{"suggestedPrice": <số nguyên VND>, "reasoning": "<câu giải thích ngắn gọn tổng hợp 1-2 dòng tiếng Việt về quyết định định giá>"}`;

  const fmt = (n) => (n != null && typeof n === "number" ? Math.round(n) : "N/A");
  const prompt = `Sản phẩm: ${safeProductName.sanitized}
Rating của seller: ${sellerRating}⭐
Thị trường (${topSeller ? "top-sold: " + topSeller.name : ""}):
  Giá thấp nhất: ${fmt(refMin)} VND
  Giá trung bình: ${fmt(refAvg)} VND
  Giá cao nhất: ${fmt(marketStats.max)} VND
  Trung vị (loại outlier): ${fmt(marketStats.median || refAvg)} VND
  Rating trung bình đối thủ: ${avgCompetitorRating}⭐

[Phase 3 - P2] Thị trường chất lượng cao (score>0.9, rating>4.0):
  Count: ${marketStats.clusterCount}/${marketStats.totalCount} | Confidence: ${marketStats.confidence}
  Cluster avg: ${fmt((marketStats.clusterAvg || refAvg))} | Cluster weighted-avg: ${fmt((marketStats.clusterWeightedAvg || refAvg))}

Chiến lược: ${strategy.toUpperCase()}
  → ${strategyPrompt.instruction}
  → ${strategyPrompt.priceHint}

Ngữ cảnh bổ sung:
${costData?.hasCostData ? `
[Hướng 2 - CHI TIẾT CHI PHÍ NHẬP HÀNG]
PO: ${costData.poCode} | SKU: ${costData.sku} | SL nhập: ${costData.quantityInPo} unit
Giá vốn LANDED: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫/unit

Chi tiết chi phí (cho 1 sản phẩm):
- Giá hàng gốc (CNY→VND): ${costData.breakdown.productCostCny} ¥ × ${costData.breakdown.exchangeRate.toLocaleString("vi-VN")}₫ = ${costData.breakdown.productCostVnd.toLocaleString("vi-VN")}₫
- Phí dịch vụ mua hàng (${(costData.breakdown.buyingServiceFeeRate * 100).toFixed(1)}%): +${costData.breakdown.buyingServiceFeeVnd.toLocaleString("vi-VN")}₫
${costData.breakdown.shippingCostPerUnit > 0 ? `- Cước vận chuyển QT (${costData.breakdown.chargeableWeightKg}kg × ${costData.breakdown.shippingRatePerKg.toLocaleString("vi-VN")}₫/kg): +${costData.breakdown.shippingCostPerUnit.toLocaleString("vi-VN")}₫` : `- Cước vận chuyển QT: Chưa có dữ liệu`}
${costData.breakdown.taxPerUnit > 0 ? `- Thuế nhập khẩu: +${costData.breakdown.taxPerUnit.toLocaleString("vi-VN")}₫` : `- Thuế nhập khẩu: Không có`}
${costData.breakdown.fixedCosts.perUnit > 0 ? `- Chi phí cố định (ship nội TQ + đóng gói + ship nội VN): +${costData.breakdown.fixedCosts.perUnit.toLocaleString("vi-VN")}₫` : `- Chi phí cố định: Không có`}

Phân tích biên lợi nhuận:
- Giá bán hiện tại: ${Number(currentPrice).toLocaleString("vi-VN")}₫
- Giá vốn landed: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫
- Biên lợi nhuận hiện tại: ${marginInfo?.marginPercent}% (${marginInfo?.reason})
- Biên đề xuất (target): ≥ 10% trên landed cost

Khi đề xuất giá, hãy GIẢI THÍCH RÕ:
1. Giá đề xuất có đảm bảo biên ≥ 10% trên landed cost không?
2. So với thị trường (avg ${refAvg.toLocaleString("vi-VN")}₫), giá này có cạnh tranh không?
3. Các chi phí nào ảnh hưởng nhiều nhất đến giá vốn?
` : `- Chưa có thông tin phiếu nhập (Purchase Order) cho sản phẩm này → KHÔNG thể tính giá vốn landed.
- Giá vốn tạm thời = giá hiện tại của seller.
- TRONG PHẦN reasoning, CẦN ghi rõ: "⚠️ Chưa có thông tin phiếu nhập. Không thể tính chính xác giá vốn và biên lợi nhuận."`}
- Nếu seller có rating cao hơn đáng kể so với đối thủ (≥0.3⭐), có thể đề xuất giá cao hơn avg 5-10%.
- Nếu seller có rating thấp hơn avg, khuyến khích cải thiện chất lượng thay vì giảm giá.
- Nếu confidence = "low", tránh đề xuất giá quá thấp vì dữ liệu thị trường mỏng.`;

  try {
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, systemPrompt, history: [] }),
    });

    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();

    // If the API already parsed it into an object
    if (data.response && typeof data.response === "object") {
      return data.response;
    }

    const raw = String(data.response || "");

    // Extract JSON from string (LLM sometimes wraps in backticks)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      let suggested = Number(parsed.suggestedPrice);
      // Sanity check: if suggested is absurdly low (e.g. <10% of current price), LLM likely misparsed thousands
      const currentNum = Number(currentPrice) || 0;
      const refAvg = marketStats.confidence === "high" ? marketStats.clusterWeightedAvg : marketStats.weightedAvg;
      if (currentNum > 100000 && suggested > 0 && suggested < currentNum * 0.1) {
        console.warn(
          "[priceSuggestion] LLM returned suspiciously low price:",
          suggested,
          "vs current:",
          currentNum,
          "→ using weightedAvg fallback"
        );
        suggested = refAvg;
      }
      // [Hướng 2] Enhance reasoning: tạo lý giải chi tiết từng dòng chi phí
      let reasoning = parsed.reasoning || "Đề xuất theo phân tích thị trường nâng cao.";
      if (costData?.hasCostData) {
        const lines = [];
        lines.push(`Giá đề xuất: ${suggested.toLocaleString("vi-VN")}₫`);

        // Chi phí nhập hàng chi tiết
        lines.push("Chi tiết giá vốn landed:");
        lines.push(`  1. Giá hàng (CNY→VND): ${costData.breakdown.productCostCny}¥ × ${costData.breakdown.exchangeRate.toLocaleString("vi-VN")}₫ = ${costData.breakdown.productCostVnd.toLocaleString("vi-VN")}₫`);
        lines.push(`  2. Phí dịch vụ mua hàng (${(costData.breakdown.buyingServiceFeeRate * 100).toFixed(1)}%): +${costData.breakdown.buyingServiceFeeVnd.toLocaleString("vi-VN")}₫`);
        if (costData.breakdown.shippingCostPerUnit > 0) {
          lines.push(`  3. Cước vận chuyển QT (${costData.breakdown.chargeableWeightKg}kg × ${costData.breakdown.shippingRatePerKg.toLocaleString("vi-VN")}₫/kg): +${costData.breakdown.shippingCostPerUnit.toLocaleString("vi-VN")}₫`);
        } else {
          lines.push(`  3. Cước vận chuyển QT: Chưa có dữ liệu`);
        }
        if (costData.breakdown.taxPerUnit > 0) {
          lines.push(`  4. Thuế nhập khẩu: +${costData.breakdown.taxPerUnit.toLocaleString("vi-VN")}₫`);
        } else {
          lines.push(`  4. Thuế nhập khẩu: Không có`);
        }
        if (costData.breakdown.fixedCosts.perUnit > 0) {
          lines.push(`  5. Chi phí cố định (ship nội TQ + đóng gói + ship nội VN): +${costData.breakdown.fixedCosts.perUnit.toLocaleString("vi-VN")}₫`);
        } else {
          lines.push(`  5. Chi phí cố định: Không có`);
        }
        lines.push(`  ➤ TỔNG GIÁ VỐN LANDED: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫`);

        const suggestedMarginPct = costData.landedCostPerUnit > 0
          ? ((suggested - costData.landedCostPerUnit) / costData.landedCostPerUnit * 100).toFixed(1)
          : "N/A";
        lines.push(`Biên lợi nhuận trên giá vốn landed: ${suggestedMarginPct}%`);

        if (parsed.reasoning) {
          lines.push(`Phân tích: ${parsed.reasoning}`);
        }

        reasoning = lines.join("\n");
      }
      return {
        suggestedPrice: Math.round(suggested),
        reasoning,
      };
    }
  } catch (err) {
    console.error("[priceSuggestion] LLM error:", err.message);
  }

  // Fallback: suggest weighted-average market price
  const fallbackAvg = marketStats.confidence === "high"
    ? marketStats.clusterWeightedAvg
    : (marketStats.avg || marketStats.avg);
  let fallbackReasoning = "Đề xuất theo giá trung bình có trọng số thị trường.";
  if (costData?.hasCostData) {
    fallbackReasoning = `Giá đề xuất ${(fallbackAvg || 0).toLocaleString("vi-VN")}₫ đảm bảo biên lợi nhuận ${((fallbackAvg > 0 && costData.landedCostPerUnit > 0) ? ((fallbackAvg - costData.landedCostPerUnit) / costData.landedCostPerUnit * 100).toFixed(1) : "N/A")}% trên giá vốn landed ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫.`;
  } else {
    fallbackReasoning = "Chưa có thông tin phiếu nhập (Purchase Order) cho sản phẩm này. Không thể tính chính xác giá vốn landed. Giá đề xuất dựa hoàn toàn vào phân tích thị trường.";
  }
  return {
    suggestedPrice: fallbackAvg || marketStats.avg,
    reasoning: fallbackReasoning,
  };
}

// [Phase 2 - 4.1] Added modelId parameter for variant-aware price suggestion
// [Phase 3 - 5.1] Added strategy parameter for Pricing Personas
async function execute({ sellerId, query, productId, modelId, strategy = "balanced" }) {
  if (!sellerId) return { context: "Cần sellerId để đề xuất giá." };

  const sellerOid = new mongoose.Types.ObjectId(sellerId);

  // [Phase 1 - 3.4 Optional] Seller verification: uncomment if needed
  // const ShopStatistic = (await import("../../../models/ShopStatistic.js")).default;
  // const shopStats = await ShopStatistic.findOne({ sellerId: sellerOid }).lean();
  // if (!shopStats || (shopStats.totalOrders ?? 0) < 1) {
  //   return {
  //     context: "Tính năng AI đề xuất giá chỉ dành cho shop đã có ít nhất 1 đơn hàng thành công.",
  //   };
  // }

  // 1. Resolve the listing being priced: saved product by id, or draft name from the form.
  // [Fix] Previously, a non-ObjectId productId (e.g. temp-*) skipped _id in the query,
  // so Product.find returned arbitrary active listings and sellerProducts[0] was wrong —
  // the UI and LLM then showed another product's name while searchTerm still used `query`.
  let targetProduct;
  const q = typeof query === "string" ? query.trim() : "";

  if (productId && isValidObjectId(productId)) {
    const found = await Product.findOne({
      sellerId: sellerOid,
      status: "active",
      _id: new mongoose.Types.ObjectId(productId),
    })
      .select("name originalPrice rating sold models categoryId brand")
      .lean();

    if (!found) {
      return { context: "Không tìm thấy sản phẩm này trong shop của bạn." };
    }
    targetProduct = found;
  } else if (q) {
    targetProduct = {
      _id: null,
      name: q,
      originalPrice: 0,
      models: [],
      rating: 0,
      categoryId: null,
      brand: null,
    };
  } else {
    return {
      context:
        "Cần nhập tên sản phẩm khi tạo mới, hoặc mở đề xuất giá từ sản phẩm đã lưu (productId hợp lệ).",
    };
  }

  const searchTerm = q || targetProduct.name;
  let competitors = [];
  try {
    const queryVector = await embeddingService.getEmbedding(searchTerm);
    competitors = await Product.aggregate([
      {
        $vectorSearch: {
          index: "product_vector_index",
          path: "embedding",
          queryVector,
          numCandidates: 60,
          limit: 15,
          filter: { status: "active" },
        },
      },
      {
        $match: {
          sellerId: { $ne: sellerOid }, // exclude own products — privacy rule
        },
      },
      {
        $project: {
          name: 1,
          originalPrice: 1,
          "models.price": 1,
          rating: 1,
          sold: 1,
          categoryId: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
      {
        $match: {
          score: { $gte: 0.82 }, // Only keep highly relevant matches
        },
      },
    ]);

    // If threshold filter drops all results, throw to trigger fallback
    if (!competitors.length) {
      throw new Error("No competitors met the similarity threshold");
    }
  } catch (err) {
    console.error("[priceSuggestion] vectorSearch failed, fallback to name search:", err.message);

    // Fallback: text search using product name keywords (product-specific, not category-wide)
    // Extract meaningful words: remove short words, take first 4 significant tokens
    const nameTokens = targetProduct.name
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);

    const nameRegex = new RegExp(nameTokens.join("|"), "i");

    competitors = await Product.find({
      sellerId: { $ne: sellerOid },
      status: "active",
      name: nameRegex,
    })
      .select("name originalPrice models.price rating sold categoryId")
      .limit(20)
      .lean();

    // If name search found too few (<3), optionally add from same category — but ONLY if
    // competitor title overlaps enough keywords with our product (avoid "túi xách" vs "quần jogger"
    // when both sit under a very broad category).
    if (competitors.length < 3 && targetProduct.categoryId) {
      const tokens = significantNameTokens(targetProduct.name);

      const categoryPool = await Product.find({
        sellerId: { $ne: sellerOid },
        status: "active",
        categoryId: targetProduct.categoryId,
        name: { $ne: targetProduct.name },
      })
        .select("name originalPrice models.price rating sold categoryId")
        .sort({ sold: -1 })
        .limit(80)
        .lean();

      const existingIds = new Set(competitors.map((p) => p._id.toString()));
      for (const p of categoryPool) {
        if (existingIds.has(p._id.toString())) continue;
        if (!categoryCandidateMatchesProduct(targetProduct.name, p.name)) continue;
        competitors.push(p);
        existingIds.add(p._id.toString());
        if (competitors.length >= 15) break;
      }

      if (competitors.length < 3) {
        console.warn(
          "[priceSuggestion] category fallback: still <3 after name overlap filter for",
          JSON.stringify(targetProduct.name),
          "tokens:",
          tokens
        );
      }
    }
  }

  if (!competitors.length) {
    return {
      context: `Không tìm thấy sản phẩm đối thủ để so sánh cho "${targetProduct.name}".`,
    };
  }

  // 3. Aggregate competitor prices + [Phase 3 - P2] advanced market stats
  const prices = competitors
    .flatMap((p) => p.models?.map((m) => m.price).filter(Boolean) || [p.originalPrice])
    .filter(Boolean);

  // [Phase 3 - P2] Replace simple avg with advanced market stats
  const marketStats = computeMarketStats(competitors);
  const topSeller = [...competitors].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0))[0];

  // [Phase 1 - 3.2] Rating context
  const sellerRating = targetProduct.rating ?? 0;
  const avgCompetitorRating = competitors.length
    ? (competitors.reduce((sum, c) => sum + (c.rating ?? 0), 0) / competitors.length).toFixed(1)
    : 0;

  // [Phase 2 - 4.1] Variant-aware current price resolution
  const { price: currentPrice, model: selectedModel } = resolveCurrentPrice(targetProduct, modelId);
  const sellerBrand = targetProduct.brand || "No-brand";

  // [Phase 3 - 5.1] Calculate total stock for clearance strategy
  const totalStock = targetProduct.models
    ? targetProduct.models.reduce((sum, m) => sum + (m.stock ?? 0), 0)
    : 0;

  // [Hướng 2] Lấy chi phí nhập hàng từ PurchaseOrder
  // Dùng SKU của model được chọn hoặc SKU đầu tiên; luôn truyền modelId để fallback theo productId / tồn kho
  const targetSku = selectedModel?.sku || targetProduct.models?.[0]?.sku || "";
  const modelIdStr = selectedModel?._id?.toString() || null;
  let costData = null;
  if (targetSku || (targetProduct._id && modelIdStr)) {
    try {
      costData = await fetchCostData(targetProduct._id, targetSku, modelIdStr);
      if (costData?.hasCostData) {
        console.log(`[priceSuggestion] [Hướng 2] Cost data loaded from PO ${costData.poCode}: landed cost = ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫`);
      } else {
        console.log(`[priceSuggestion] [Hướng 2] No cost data for SKU ${targetSku || "(empty)"} model ${modelIdStr || "(none)"}: ${costData?.message || "unknown"}`);
      }
    } catch (err) {
      console.warn(`[priceSuggestion] [Hướng 2] fetchCostData error:`, err.message);
      costData = { hasCostData: false, message: "Lỗi khi lấy chi phí nhập hàng." };
    }
  }

  // [Phase 2 - 4.2] Check cache before calling LLM
  // [Multi-strategy Redis cache] Check all 4 strategies at once — switching strategy is instant
  const productIdStr = targetProduct._id
    ? targetProduct._id.toString()
    : `draft-${sellerOid}-${crypto.createHash("sha256").update(searchTerm).digest("hex").slice(0, 24)}`;

  // Use raw competitor list for cache key (same format as makeMarketHash in multiStrategyCache)
  const competitorsForCache = competitors.map((c) => ({
    models: c.models ? [{ price: c.models[0]?.price }] : undefined,
    originalPrice: c.originalPrice,
  }));

  // Step 1: Try Redis multi-strategy cache
  const redisCached = await multiStrategyCache.getStrategy(
    productIdStr, currentPrice, competitorsForCache, sellerId, strategy
  );
  if (redisCached && redisCached.suggestedPrice != null) {
    console.log(`[priceSuggestion] Redis cache HIT for "${strategy}" on product ${productIdStr}`);
    // Luôn ưu tiên costData vừa tính từ PO/tồn kho — cache Redis cũ thường không có trường này
    const mergedCostData = costData ?? redisCached.costData ?? null;
    const mergedMargin = mergedCostData?.hasCostData
      ? calculateMargin(Number(currentPrice), mergedCostData.landedCostPerUnit)
      : null;
    const sug = Number(redisCached.suggestedPrice);
    const mergedSuggestedMarginPct = mergedCostData?.hasCostData && mergedCostData.landedCostPerUnit > 0 && sug > 0
      ? Math.round(((sug - mergedCostData.landedCostPerUnit) / mergedCostData.landedCostPerUnit) * 1000) / 10
      : redisCached.suggestedMarginPct ?? null;

    return {
      context: redisCached.context || "",
      suggestedPrice: redisCached.suggestedPrice,
      reasoning: redisCached.reasoning,
      warning: redisCached.warning || null,
      riskLevel: redisCached.riskLevel || "safe",
      warningMessage: redisCached.warningMessage || null,
      discountPct: redisCached.discountPct || null,
      strategy: redisCached.strategy || strategy,
      marketData: redisCached.marketData,
      competitors: redisCached.competitors,
      product: redisCached.product,
      fromCache: true,
      fromRedis: true,
      cachedAt: redisCached.savedAt || null,
      costData: mergedCostData,
      marginInfo: mergedMargin,
      suggestedMarginPct: mergedSuggestedMarginPct,
    };
  }
  console.log(`[priceSuggestion] Redis cache MISS for "${strategy}" on product ${productIdStr}`);

  // Step 2: Diff — which strategies are already cached vs missing in Redis?
  const { cached: cachedStrats, missing: missingStrats } = await multiStrategyCache.diffStrategies(
    productIdStr, currentPrice, competitorsForCache, sellerId
  );
  console.log(`[priceSuggestion] Redis: ${cachedStrats.length} cached (${cachedStrats.join(", ")}), ${missingStrats.length} missing (${missingStrats.join(", ")})`);

  // Step 3: Call LLM only for MISSING strategies (not all 4 — just what's needed)
  const STRATEGIES_TO_COMPUTE = ["balanced", "penetration", "profit", "clearance"];
  const strategiesToCall = missingStrats.length > 0
    ? missingStrats
    : STRATEGIES_TO_COMPUTE; // First call: compute all 4

  const llmResults = {};
  for (const strat of strategiesToCall) {
    try {
      llmResults[strat] = await askLLM(
        targetProduct.name,
        currentPrice,
        marketStats,
        topSeller,
        sellerRating,
        avgCompetitorRating,
        strat,
        totalStock,
        costData, // [Hướng 2] Truyền chi phí nhập hàng
      );
    } catch (err) {
      console.warn(`[priceSuggestion] LLM failed for strategy "${strat}":`, err.message);
      const fallbackAvg = marketStats.confidence === "high"
        ? marketStats.clusterWeightedAvg
        : (marketStats.weightedAvg || marketStats.avg);
      llmResults[strat] = { suggestedPrice: fallbackAvg || marketStats.avg, reasoning: "Lỗi LLM — dùng giá trung bình thị trường." };
    }
  }

  // Step 4: Build full result object for each strategy + validate floor price
  // [Phase 3 - P2] Reference avg = cluster-weighted-avg when high confidence
  const refAvg = marketStats.confidence === "high" ? marketStats.clusterWeightedAvg : marketStats.weightedAvg;
  const refMin = marketStats.confidence === "high" ? marketStats.clusterMin : marketStats.min;

  const marketDataObj = {
    min: marketStats.min,
    avg: marketStats.avg,
    max: marketStats.max,
    // [Phase 3 - P2] Advanced stats
    weightedAvg: marketStats.weightedAvg,
    median: marketStats.median || marketStats.weightedAvg,
    clusterMin: marketStats.clusterMin || refMin,
    clusterAvg: marketStats.clusterAvg || refAvg,
    clusterMax: marketStats.clusterMax || marketStats.max,
    clusterWeightedAvg: marketStats.clusterWeightedAvg || refAvg,
    clusterMedian: marketStats.clusterMedian || marketStats.median || refAvg,
    clusterCount: marketStats.clusterCount,
    totalCount: marketStats.totalCount,
    confidence: marketStats.confidence,
    //
    count: competitors.length,
    topSeller: topSeller
      ? {
          name: topSeller.name,
          sold: topSeller.sold,
          price: topSeller.models?.[0]?.price || topSeller.originalPrice,
        }
      : null,
  };

  const competitorsObj = competitors.map((c) => ({
    id: obfuscateCompetitorId(c._id),
    name: c.name,
    price: c.models?.[0]?.price || c.originalPrice,
    rating: c.rating ?? 0,
    sold: c.sold ?? 0,
    score: c.score ?? null,
    brand: c.brand ?? null,
  }));

  const productObj = {
    id: targetProduct._id ?? null,
    name: targetProduct.name,
    currentPrice,
    brand: sellerBrand,
    rating: sellerRating,
    modelId: selectedModel?._id?.toString() || null,
    modelSku: selectedModel?.sku || null,
    isDraftListing: !targetProduct._id,
  };

  // [Hướng 2] Tính margin dựa trên landed cost (nếu có)
  const currentMarginInfo = costData?.hasCostData
    ? calculateMargin(currentPrice, costData.landedCostPerUnit)
    : null;

  const buildResult = (strat, llmResult) => {
    // [Hướng 2] Floor price = landed cost (không phải currentPrice)
    const floorPrice = costData?.hasCostData
      ? costData.landedCostPerUnit
      : Number(currentPrice) || 0;
    let suggested = Number(llmResult.suggestedPrice);

    // Floor price guard - không bao giờ đề xuất thấp hơn landed cost
    if (suggested > 0 && suggested < floorPrice) {
      suggested = floorPrice;
    }

    // [Hướng 2] Tính discount % vs landed cost thay vì market avg
    const refMarginPrice = costData?.hasCostData
      ? costData.landedCostPerUnit
      : refAvg;
    const suggestedMarginPct = refMarginPrice > 0
      ? ((suggested - refMarginPrice) / refMarginPrice) * 100
      : 0;

    // [Phase 3 - P2] Discount % vs market reference
    const discountPct = refAvg > 0 ? ((refAvg - suggested) / refAvg) * 100 : 0;

    let riskLevel = "safe", warning = null, warningMessage = null;

    if (suggested === floorPrice && suggested > 0 && costData?.hasCostData) {
      riskLevel = "safe"; warning = "floor_price_landed";
      warningMessage = `Giá đề xuất không thể thấp hơn giá vốn landed (${floorPrice.toLocaleString("vi-VN")}₫).`;
    } else if (suggested === floorPrice && suggested > 0) {
      riskLevel = "safe"; warning = "floor_price";
      warningMessage = `Giá đề xuất không thể thấp hơn giá hiện tại (${floorPrice.toLocaleString("vi-VN")}₫).`;
    } else if (discountPct > 30) {
      riskLevel = "high"; warning = "high_discount_risk";
      warningMessage = "⚠️ Giá đề xuất thấp hơn 30% so với trung bình thị trường. Có nguy cơ lỗ vốn.";
    } else if (discountPct > 15) {
      riskLevel = "moderate"; warning = "moderate_discount";
      warningMessage = `⚠️ Giá đề xuất thấp hơn ${Math.round(discountPct)}% so với trung bình.`;
    }

    const competitorLines = competitors.slice(0, 5).map((p) => {
      const price = p.models?.[0]?.price || p.originalPrice;
      return `  - ${p.name}: ${price?.toLocaleString("vi-VN")}₫ | ⭐${p.rating ?? "N/A"} | ${p.sold ?? 0} đã bán`;
    });

    // [Phase 3 - P2] Rich market context
    const confidenceLabel = { high: "Cao", medium: "Trung bình", low: "Thấp", none: "Không rõ" };

    // [Hướng 2] Build chi phí nhập hàng chi tiết cho seller đọc
    const costContext = costData?.hasCostData ? `
[Hướng 2 - CHI PHÍ NHẬP HÀNG TỪ PURCHASE ORDER ${costData.poCode}]
${costData.estimateNote ? costData.estimateNote + "\n" : ""}
📦 CHI TIẾT GIÁ VỐN LANDED (cho 1 sản phẩm):
  1. Giá hàng gốc (CNY→VND):
     Giá CNY: ${costData.breakdown.productCostCny} ¥ × ${costData.breakdown.exchangeRate.toLocaleString("vi-VN")}₫ = ${costData.breakdown.productCostVnd.toLocaleString("vi-VN")}₫
  2. Phí dịch vụ mua hàng (${(costData.breakdown.buyingServiceFeeRate * 100).toFixed(1)}%):  + ${costData.breakdown.buyingServiceFeeVnd.toLocaleString("vi-VN")}₫
  3. Cước vận chuyển QT:  + ${costData.breakdown.shippingCostPerUnit.toLocaleString("vi-VN")}₫
     ${costData.breakdown.shippingNote}
  4. Thuế nhập khẩu:  + ${costData.breakdown.taxPerUnit.toLocaleString("vi-VN")}₫
     ${costData.breakdown.taxNote}
  5. Chi phí cố định (phân bổ):  + ${costData.breakdown.fixedCosts.perUnit.toLocaleString("vi-VN")}₫
     ${costData.breakdown.fixedCosts.note}
  ─────────────────────────────────────
  💰 TỔNG GIÁ VỐN LANDED: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫/unit

📈 BIÊN LỢI NHUẬN HIỆN TẠI:
  Giá bán:  ${currentPrice?.toLocaleString("vi-VN")}₫
  Giá vốn:  ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫
  Biên:     ${currentMarginInfo?.marginPercent}% (${currentMarginInfo?.reason})

📊 BIÊN LỢI NHUẬN ĐỀ XUẤT:
  Giá đề xuất:  ${suggested?.toLocaleString("vi-VN")}₫
  Giá vốn:      ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫
  Biên:         ${suggestedMarginPct.toFixed(1)}%
` : "";

    const context = `=== ĐỀ XUẤT GIÁ SẢN PHẨM ===
📦 Sản phẩm: ${targetProduct.name}
💰 Giá hiện tại: ${currentPrice?.toLocaleString("vi-VN")}₫${costData?.hasCostData ? ` | Giá vốn: ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫ | Biên: ${currentMarginInfo?.marginPercent}%` : ""}
${costContext}
📊 Thị trường (${competitors.length} SP tương tự):
  Giá thấp nhất (global):     ${marketStats.min.toLocaleString("vi-VN")}₫
  Giá trung bình (global):    ${marketStats.avg.toLocaleString("vi-VN")}₫
  Giá cao nhất (global):      ${marketStats.max.toLocaleString("vi-VN")}₫
  Trung vị (loại outlier):    ${(marketStats.median || refAvg).toLocaleString("vi-VN")}₫
  Trung bình có trọng số:     ${marketStats.weightedAvg.toLocaleString("vi-VN")}₫

📌 Cluster chất lượng cao (score>0.9 & rating>4.0):
  Độ tin cậy: ${confidenceLabel[marketStats.confidence] || "Không rõ"} (${marketStats.clusterCount}/${marketStats.totalCount} đối thủ)
  Cluster min: ${(marketStats.clusterMin || refMin).toLocaleString("vi-VN")}₫
  Cluster avg: ${(marketStats.clusterAvg || refAvg).toLocaleString("vi-VN")}₫
  Cluster weighted-avg: ${(marketStats.clusterWeightedAvg || refAvg).toLocaleString("vi-VN")}₫

🏆 SP bán chạy nhất của đối thủ: ${topSeller?.name ?? "N/A"} (${topSeller?.sold ?? 0} đã bán)

📋 Top 5 đối thủ:
${competitorLines.join("\n")}

💡 Giá AI đề xuất: ${suggested?.toLocaleString("vi-VN")}₫
📝 Lý giải: ${llmResult.reasoning || "Không có lý giải."}`;

    return {
      suggestedPrice: Math.round(suggested),
      reasoning: llmResult.reasoning || "Đề xuất theo phân tích thị trường.",
      warning,
      riskLevel,
      warningMessage,
      discountPct: Math.round(discountPct * 10) / 10,
      strategy: strat,
      marketData: marketDataObj,
      competitors: competitorsObj,
      product: productObj,
      // [Hướng 2] Cost data
      costData: costData || null,
      marginInfo: currentMarginInfo || null,
      suggestedMarginPct: Math.round(suggestedMarginPct * 10) / 10,
      context,
    };
  };

  // Build all 4 strategy results
  const allStrategies = {};
  for (const strat of STRATEGIES_TO_COMPUTE) {
    // Merge: use cached result if available, else compute
    const cachedOne = cachedStrats.includes(strat)
      ? await multiStrategyCache.getStrategy(productIdStr, currentPrice, competitorsForCache, sellerId, strat)
      : null;

    allStrategies[strat] = cachedOne && cachedOne.suggestedPrice != null
      ? cachedOne
      : buildResult(strat, llmResults[strat] || {
          suggestedPrice: refAvg || marketStats.avg,
          reasoning: "Không có dữ liệu.",
        });
  }

  // Step 5: Save all 4 strategies to Redis (non-blocking)
  multiStrategyCache.saveAllStrategies(
    productIdStr, currentPrice, competitorsForCache, sellerId, allStrategies
  ).catch((err) => console.warn("[priceSuggestion] Redis save failed:", err.message));

  // Step 6: Also save to MongoDB per-strategy cache (for backward compat)
  for (const strat of STRATEGIES_TO_COMPUTE) {
    const r = allStrategies[strat];
    if (r && !r.fromMongoCache) {
      saveToCache(productIdStr, sellerId, currentPrice, competitors, {
        ...r,
        savedAt: r.savedAt || Date.now(),
      }, strat).catch(() => {});
    }
  }

  // Step 7: Return the requested strategy
  const result = allStrategies[strategy];
  return {
    context: result.context || "",
    suggestedPrice: result.suggestedPrice,
    reasoning: result.reasoning,
    warning: result.warning || null,
    riskLevel: result.riskLevel || "safe",
    warningMessage: result.warningMessage || null,
    discountPct: result.discountPct || null,
    strategy: result.strategy || strategy,
    marketData: result.marketData,
    competitors: result.competitors,
    product: result.product,
    fromCache: false,
    // [Hướng 2] Cost data & margin info
    costData: result.costData || null,
    marginInfo: result.marginInfo || null,
    suggestedMarginPct: result.suggestedMarginPct || null,
    allStrategies: Object.keys(allStrategies).length > 1 ? allStrategies : undefined,
  };
}

/**
 * [Batch] Phase 1: product + vector search + batch cache read. No LLM.
 * [Phase 3 - 5.1] Added strategy parameter for Pricing Personas.
 * [Fix] Added draft-mode support: when productId is not a valid ObjectId,
 *       use productName for vector search and handle locally-defined variants.
 * Returns { fromCache } | { pendingLLM, precompute } | { context } error.
 */
async function prepareBatchPriceSuggestion({ sellerId, productId, productName, modelIds, strategy = "balanced" }) {
  if (!sellerId) return { context: "Cần sellerId để đề xuất giá." };
  if (!modelIds || !modelIds.length) return { context: "Cần danh sách modelIds." };

  const sellerOid = new mongoose.Types.ObjectId(sellerId);
  const MAX_BATCH = 50;
  const safeModelIds = modelIds.slice(0, MAX_BATCH);
  const q = typeof productName === "string" ? productName.trim() : "";

  // ── Draft mode: product not yet saved ──────────────────────────────────────
  // productId is a temp string (e.g. "temp-1742000000000") or empty.
  // We still need to run vector search to find competitors, so we build a
  // synthetic targetProduct from the form data and treat all modelIds as
  // "local" variants (no DB _id yet — they will be resolved via tierIndex).
  const isDraft = !productId || !isValidObjectId(productId);

  if (isDraft) {
    if (!q) {
      return { context: "Cần nhập tên sản phẩm để phân tích giá." };
    }

    // Build a synthetic targetProduct so downstream code (vector search,
    // LLM prompt) uses the correct name.
    const targetProduct = {
      _id: null,
      name: q,
      originalPrice: 0,
      models: [],
      rating: 0,
      categoryId: null,
      brand: null,
    };
    const draftId = `draft-${sellerOid}-${crypto.createHash("sha256").update(q).digest("hex").slice(0, 24)}`;

    // For draft mode, ALL modelIds are treated as "local" — keyed by clientId (e.g. m-0-1).
    const parseTierIndexFromClientModelId = (id) => {
      if (typeof id !== "string") return [];
      if (id.startsWith("m-idx-")) return [];
      if (id.startsWith("m-")) {
        const rest = id.slice(2);
        if (!rest) return [];
        return rest
          .split("-")
          .map((n) => parseInt(n, 10))
          .filter((n) => !Number.isNaN(n));
      }
      if (/^\d+(?:-\d+)*$/.test(id)) {
        return id
          .split("-")
          .map((n) => parseInt(n, 10))
          .filter((n) => !Number.isNaN(n));
      }
      return [];
    };
    const localModelMap = new Map();
    safeModelIds.forEach((id) => {
      localModelMap.set(String(id), {
        _id: id,
        tierIndex: parseTierIndexFromClientModelId(String(id)),
        price: 0,
        sku: "",
      });
    });

    const allLocalModelIds = [...localModelMap.keys()];

    // Do vector search using the draft product name
    let competitors = [];
    let topSeller = null;
    let marketStats = computeMarketStats([]);
    try {
      const queryVector = await embeddingService.getEmbedding(q);
      const queryResult = await Product.aggregate([
        {
          $vectorSearch: {
            index: "product_vector_index",
            path: "embedding",
            queryVector,
            numCandidates: 60,
            limit: 15,
            filter: { status: "active" },
          },
        },
        { $match: { sellerId: { $ne: sellerOid } } },
        {
          $project: {
            name: 1, originalPrice: 1, "models.price": 1,
            rating: 1, sold: 1, categoryId: 1, score: { $meta: "vectorSearchScore" },
          },
        },
        { $match: { score: { $gte: 0.82 } } },
      ]);
      if (queryResult.length) competitors = queryResult;
      else throw new Error("No competitors met the similarity threshold");
    } catch {
      const tokens = q.split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
      const nameRegex = new RegExp(tokens.join("|"), "i");
      competitors = await Product.find({
        sellerId: { $ne: sellerOid },
        status: "active",
        name: nameRegex,
      })
        .select("name originalPrice models.price rating sold categoryId")
        .limit(20)
        .lean();
    }

    if (!competitors.length) {
      return { context: `Không tìm thấy sản phẩm đối thủ để so sánh cho "${q}".` };
    }

    marketStats = computeMarketStats(competitors);
    topSeller = [...competitors].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0))[0];
    const sellerRating = 0;
    const avgCompetitorRating = competitors.length
      ? (competitors.reduce((sum, c) => sum + (c.rating ?? 0), 0) / competitors.length).toFixed(1)
      : 0;
    const refAvg = marketStats.confidence === "high"
      ? marketStats.clusterWeightedAvg : marketStats.weightedAvg;
    const obfuscatedCompetitors = competitors.map((c) => ({
      id: obfuscateCompetitorId(c._id),
      name: c.name,
      price: c.models?.[0]?.price || c.originalPrice,
      rating: c.rating ?? 0,
      sold: c.sold ?? 0,
      score: c.score ?? null,
      brand: c.brand ?? null,
    }));
    const marketData = {
      min: marketStats.min, avg: marketStats.avg, max: marketStats.max,
      weightedAvg: marketStats.weightedAvg,
      median: marketStats.median || marketStats.weightedAvg,
      clusterMin: marketStats.clusterMin || marketStats.min,
      clusterAvg: marketStats.clusterAvg || refAvg,
      clusterMax: marketStats.clusterMax || marketStats.max,
      clusterWeightedAvg: marketStats.clusterWeightedAvg || refAvg,
      clusterMedian: marketStats.clusterMedian || marketStats.median || refAvg,
      clusterCount: marketStats.clusterCount,
      totalCount: marketStats.totalCount,
      confidence: marketStats.confidence,
      count: competitors.length,
      topSeller: topSeller
        ? { name: topSeller.name, sold: topSeller.sold, price: topSeller.models?.[0]?.price || topSeller.originalPrice }
        : null,
    };

    // Group all local models under price 0 so they all get the same suggestion
    const priceGroups = new Map();
    priceGroups.set(0, allLocalModelIds);

    return {
      pendingLLM: true,
      precompute: {
        productIdStr: draftId,
        sellerId,
        batchCacheKey: "",
        targetProduct,
        // In draft mode modelMap is empty; we use localModelMap below
        modelMap: localModelMap,
        localModelMap,
        validModelIds: allLocalModelIds,
        marketStats,
        topSeller,
        sellerRating,
        avgCompetitorRating,
        obfuscatedCompetitors,
        marketData,
        priceGroups,
        strategy,
        sellerBrand: "No-brand",
        totalStock: 0,
        costData: null,
        competitors,
        isDraftMode: true,
      },
    };
  }

  // ── Normal mode: product exists in DB ─────────────────────────────────────
  const filter = { sellerId: sellerOid, status: "active" };
  if (productId && isValidObjectId(productId)) {
    filter._id = new mongoose.Types.ObjectId(productId);
  }
  const sellerProducts = await Product.find(filter)
    .select("name originalPrice rating sold models categoryId brand tiers")
    .limit(5)
    .lean();

  if (!sellerProducts.length) {
    return { context: "Không tìm thấy sản phẩm này trong shop của bạn." };
  }

  const targetProduct = sellerProducts[0];
  const productIdStr = targetProduct._id.toString();

  const modelMap = new Map();
  (targetProduct.models || []).forEach((m) => {
    const id = m._id?.toString();
    if (id) modelMap.set(id, m);
  });

  const validModelIds = safeModelIds.filter((id) => modelMap.has(id));

  let competitors = [];
  let topSeller = null;
  // [Phase 3 - P2] Advanced market stats (replaces simple priceStats)
  let marketStats = computeMarketStats([]);
  const sellerRating = targetProduct.rating ?? 0;

  try {
    const queryVector = await embeddingService.getEmbedding(targetProduct.name);
    const queryResult = await Product.aggregate([
      {
        $vectorSearch: {
          index: "product_vector_index",
          path: "embedding",
          queryVector,
          numCandidates: 60,
          limit: 15,
          filter: { status: "active" },
        },
      },
      { $match: { sellerId: { $ne: sellerOid } } },
      {
        $project: {
          name: 1, originalPrice: 1, "models.price": 1,
          rating: 1, sold: 1, categoryId: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
      { $match: { score: { $gte: 0.82 } } },
    ]);
    if (queryResult.length) competitors = queryResult;
    else throw new Error("No competitors met the similarity threshold");
  } catch {
    const nameTokens = targetProduct.name
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);
    const nameRegex = new RegExp(nameTokens.join("|"), "i");
    competitors = await Product.find({
      sellerId: { $ne: sellerOid }, status: "active", name: nameRegex,
    })
      .select("name originalPrice models.price rating sold categoryId")
      .limit(20)
      .lean();
  }

  if (!competitors.length) {
    return { context: `Không tìm thấy sản phẩm đối thủ để so sánh cho "${targetProduct.name}".` };
  }

  const prices = competitors.flatMap(
    (p) => p.models?.map((m) => m.price).filter(Boolean) || [p.originalPrice],
  );
  // [Phase 3 - P2] Use advanced market stats
  marketStats = computeMarketStats(competitors);
  topSeller = [...competitors].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0))[0];
  const avgCompetitorRating = competitors.length
    ? (competitors.reduce((sum, c) => sum + (c.rating ?? 0), 0) / competitors.length).toFixed(1)
    : 0;

  const obfuscatedCompetitors = competitors.map((c) => ({
    id: obfuscateCompetitorId(c._id),
    name: c.name,
    price: c.models?.[0]?.price || c.originalPrice,
    rating: c.rating ?? 0,
    sold: c.sold ?? 0,
    score: c.score ?? null,
    brand: c.brand ?? null,
  }));

  const refAvg = marketStats.confidence === "high" ? marketStats.clusterWeightedAvg : marketStats.weightedAvg;

  // [Phase 3 - P2] Expanded marketData with advanced stats
  const marketData = {
    min: marketStats.min,
    avg: marketStats.avg,
    max: marketStats.max,
    weightedAvg: marketStats.weightedAvg,
    median: marketStats.median || marketStats.weightedAvg,
    clusterMin: marketStats.clusterMin || marketStats.min,
    clusterAvg: marketStats.clusterAvg || refAvg,
    clusterMax: marketStats.clusterMax || marketStats.max,
    clusterWeightedAvg: marketStats.clusterWeightedAvg || refAvg,
    clusterMedian: marketStats.clusterMedian || marketStats.median || refAvg,
    clusterCount: marketStats.clusterCount,
    totalCount: marketStats.totalCount,
    confidence: marketStats.confidence,
    count: competitors.length,
    topSeller: topSeller
      ? { name: topSeller.name, sold: topSeller.sold, price: topSeller.models?.[0]?.price || topSeller.originalPrice }
      : null,
  };

  // [Hướng 2] Lấy chi phí nhập hàng từ PurchaseOrder cho batch (move up for Redis cache check)
  const firstModel = targetProduct.models?.[0];
  const firstSku = firstModel?.sku || "";
  const firstModelId = firstModel?._id?.toString() || null;
  let costData = null;
  if (firstSku || (targetProduct._id && firstModelId)) {
    try {
      costData = await fetchCostData(targetProduct._id, firstSku, firstModelId);
      if (costData?.hasCostData) {
        console.log(`[priceSuggestion] [Batch - Hướng 2] Cost from PO ${costData.poCode}: landed cost = ${costData.landedCostPerUnit.toLocaleString("vi-VN")}₫`);
      }
    } catch (err) {
      console.warn(`[priceSuggestion] [Batch - Hướng 2] fetchCostData error:`, err.message);
      costData = { hasCostData: false, message: "Lỗi khi lấy chi phí nhập hàng." };
    }
  }

  // Step 0: Check Redis multi-strategy cache first (Tầng 1)
  // For batch, use targetProduct.originalPrice as the reference currentPrice for cache key lookup
  const batchReferencePrice = targetProduct.originalPrice || 0;
  const competitorsForCache = competitors.map((c) => ({
    models: c.models ? [{ price: c.models[0]?.price }] : undefined,
    originalPrice: c.originalPrice,
  }));
  const redisAllStrategies = await multiStrategyCache.getAllStrategies(
    productIdStr, batchReferencePrice, competitorsForCache, sellerId
  );

  if (redisAllStrategies) {
    // Reconstruct batch results for ALL 4 strategies so the modal can switch instantly.
    // The cached strategy results are keyed by "balanced" | "penetration" | "profit" | "clearance".
    const buildResultsForStrategy = (stratKey) => {
      const cached = redisAllStrategies[stratKey];
      if (!cached || cached.suggestedPrice == null) return null;

      const refAvgForCalc = marketStats.confidence === "high"
        ? marketStats.clusterWeightedAvg
        : (marketStats.weightedAvg || marketStats.avg);
      const floorPrice = costData?.hasCostData ? costData.landedCostPerUnit : 0;
      let suggested = Number(cached.suggestedPrice);
      if (suggested > 0 && suggested < floorPrice) suggested = floorPrice;

      const discountPct = refAvgForCalc > 0 ? ((refAvgForCalc - suggested) / refAvgForCalc) * 100 : 0;
      const suggestedMarginPct = costData?.hasCostData && costData.landedCostPerUnit > 0
        ? ((suggested - costData.landedCostPerUnit) / costData.landedCostPerUnit) * 100
        : 0;
      const currentMarginInfo = costData?.hasCostData
        ? calculateMargin(0, costData.landedCostPerUnit)
        : null;

      return validModelIds.map((modelId) => {
        const model = modelMap.get(modelId);
        const currentPrice = model?.price ?? targetProduct.originalPrice;
        const variantFloor = costData?.hasCostData ? costData.landedCostPerUnit : currentPrice;
        let variantSuggested = suggested;
        if (variantSuggested > 0 && variantSuggested < variantFloor) variantSuggested = variantFloor;
        const variantDiscountPct = refAvgForCalc > 0 ? ((refAvgForCalc - variantSuggested) / refAvgForCalc) * 100 : 0;
        const variantMarginPct = costData?.hasCostData && costData.landedCostPerUnit > 0
          ? ((variantSuggested - costData.landedCostPerUnit) / costData.landedCostPerUnit) * 100
          : 0;
        const variantMarginInfo = costData?.hasCostData
          ? calculateMargin(currentPrice, costData.landedCostPerUnit)
          : null;

        return {
          modelId,
          sku: model?.sku || null,
          tierIndex: model?.tierIndex || [],
          currentPrice,
          suggestedPrice: Math.round(variantSuggested),
          reasoning: cached.reasoning || "",
          discountPct: Math.round(variantDiscountPct * 10) / 10,
          riskLevel: cached.riskLevel || "safe",
          warning: cached.warning || null,
          warningMessage: cached.warningMessage || null,
          fromCache: true,
          fromRedis: true,
          strategy: stratKey,
          costData: costData || null,
          marginInfo: variantMarginInfo || null,
          suggestedMarginPct: Math.round(variantMarginPct * 10) / 10,
          analyzedAt: redisAllStrategies._cachedAt || null,
        };
      });
    };

    const resultsForRequestedStrategy = buildResultsForStrategy(strategy)
      || buildResultsForStrategy("balanced");

    // Build allStrategies from cache so frontend can switch without a refetch
    const allStrategies = {};
    for (const strat of ["balanced", "penetration", "profit", "clearance"]) {
      allStrategies[strat] = redisAllStrategies[strat] || null;
    }

    if (resultsForRequestedStrategy && resultsForRequestedStrategy.length === validModelIds.length) {
      console.log(`[priceSuggestion] [Batch] Redis cache HIT for ${resultsForRequestedStrategy.length} models on product ${productIdStr}`);
      return {
        success: true,
        fromCache: true,
        fromRedis: true,
        cachedAt: redisAllStrategies._cachedAt || null,
        results: resultsForRequestedStrategy,
        product: {
          id: targetProduct._id,
          name: targetProduct.name,
          brand: targetProduct.brand || "No-brand",
          rating: sellerRating,
          totalModels: targetProduct.models?.length ?? 0,
        },
        marketData,
        competitors: obfuscatedCompetitors,
        strategy,
        costData: costData || null,
        // [Multi-strategy Redis cache] Return all 4 strategies for instant switching
        allStrategies,
        analyzedAt: redisAllStrategies._cachedAt || null,
      };
    }
  }
  console.log(`[priceSuggestion] [Batch] Redis cache MISS for product ${productIdStr}`);

  const batchCacheKey = makeBatchCacheKey(validModelIds, competitors, strategy);
  const batchCached = await getBatchCachedSuggestion(productIdStr, sellerId, batchCacheKey);
  if (batchCached?.batchPayload) {
    const p = batchCached.batchPayload;
    return {
      success: true,
      fromCache: true,
      cachedAt: batchCached.updatedAt,
      results: p.results,
      product: p.product,
      marketData: p.marketData,
      competitors: p.competitors,
      // [Phase 3 - 5.1]
      strategy: p.strategy || strategy,
      // [Hướng 2] Ưu tiên costData vừa fetch từ PO — payload Mongo cũ có thể không có
      costData: costData ?? p.costData ?? null,
    };
  }

  const priceGroups = new Map();
  validModelIds.forEach((mid) => {
    const model = modelMap.get(mid);
    const currentPrice = model?.price ?? targetProduct.originalPrice;
    if (!priceGroups.has(currentPrice)) priceGroups.set(currentPrice, []);
    priceGroups.get(currentPrice).push(mid);
  });

  const sellerBrand = targetProduct.brand || "No-brand";
  const totalStock = targetProduct.models
    ? targetProduct.models.reduce((sum, m) => sum + (m.stock ?? 0), 0)
    : 0;

  return {
    pendingLLM: true,
    precompute: {
      productIdStr,
      sellerId,
      batchCacheKey,
      targetProduct,
      modelMap,
      validModelIds,
      // [Phase 3 - P2] renamed from stats → marketStats
      marketStats,
      topSeller,
      sellerRating,
      avgCompetitorRating,
      obfuscatedCompetitors,
      marketData,
      priceGroups,
      // [Phase 3 - 5.1]
      strategy,
      sellerBrand,
      totalStock,
      // [Hướng 2]
      costData,
      // For Redis cache
      competitors,
    },
  };
}

/**
 * [Batch] Phase 2: LLM + per-model results + save cache.
 * Computes ALL 4 strategies (balanced, penetration, profit, clearance) in one shot,
 * saves them all to Redis, and returns the requested strategy.
 * [Phase 3 - 5.1] Strategy support for Pricing Personas.
 */
async function finalizeBatchPriceSuggestion(precompute) {
  const {
    productIdStr,
    sellerId,
    batchCacheKey,
    targetProduct,
    modelMap,
    validModelIds,
    // [Phase 3 - P2] renamed from stats → marketStats
    marketStats,
    topSeller,
    sellerRating,
    avgCompetitorRating,
    obfuscatedCompetitors,
    marketData,
    priceGroups,
    strategy,
    totalStock,
    // [Hướng 2]
    costData,
    // For Redis cache
    competitors,
  } = precompute;

  // [Phase 3 - P2] Reference avg for discount calculations
  const refAvg = marketStats.confidence === "high"
    ? marketStats.clusterWeightedAvg
    : (marketStats.weightedAvg || marketStats.avg);

  // ── marketDataObj & competitorsObj (same shape as single-variant flow) ──
  const competitorsObj = competitors.map((c) => ({
    id: obfuscateCompetitorId(c._id),
    name: c.name,
    price: c.models?.[0]?.price || c.originalPrice,
    rating: c.rating ?? 0,
    sold: c.sold ?? 0,
    score: c.score ?? null,
    brand: c.brand ?? null,
  }));

  const analyzedAt = Date.now();

  // ── Step 1: Diff with Redis — reuse any strategy already cached ──
  const competitorsForCache = (competitors || []).map((c) => ({
    models: c.models ? [{ price: c.models[0]?.price }] : undefined,
    originalPrice: c.originalPrice,
  }));
  const batchRefPrice = targetProduct.originalPrice || 0;

  const { cached: cachedStrats, missing: missingStrats } = await multiStrategyCache.diffStrategies(
    productIdStr, batchRefPrice, competitorsForCache, sellerId
  );
  console.log(`[priceSuggestion] [Batch] Redis: ${cachedStrats.length} cached (${cachedStrats.join(", ")}), ${missingStrats.length} missing (${missingStrats.join(", ")})`);

  // Take the first price as the representative for the canonical LLM analysis.
  // All strategy outputs are valid for any price point — the per-variant
  // floor-price guard (landed cost) is applied later in the result mapping.
  const STRATEGIES_TO_COMPUTE = ["balanced", "penetration", "profit", "clearance"];
  const firstPrice = [...priceGroups.keys()][0] ?? targetProduct.originalPrice ?? 0;

  // ── Step 2: Compute missing strategies IN PARALLEL (not sequential) ──
  // This is the same pattern as the single-variant flow.
  // ~1 LLM call latency (≈5–15s) instead of 4× sequential (≈20–60s → timeout).
  const priceToAllStrategies = new Map([[firstPrice, {}]]);

  const llmPromises = missingStrats.map((strat) =>
    askLLM(
      targetProduct.name, firstPrice, marketStats, topSeller, sellerRating,
      avgCompetitorRating, strat, totalStock, costData,
    ).then((result) => ({ strat, result }))
      .catch(() => ({
        strat,
        result: { suggestedPrice: refAvg || marketStats.avg, reasoning: "Đề xuất theo giá trung bình thị trường." },
      }))
  );

  const llmResults = await Promise.all(llmPromises);
  for (const { strat, result } of llmResults) {
    priceToAllStrategies.get(firstPrice)[strat] = result;
  }

  // Also load already-cached strategies from Redis so allStrategies is complete
  for (const strat of cachedStrats) {
    const cached = await multiStrategyCache.getStrategy(
      productIdStr, batchRefPrice, competitorsForCache, sellerId, strat
    );
    if (cached && cached.suggestedPrice != null) {
      priceToAllStrategies.get(firstPrice)[strat] = cached;
    }
  }

  // ── Step 3: Build allStrategies — one per strategy ──
  const allStrategies = {};

  for (const strat of STRATEGIES_TO_COMPUTE) {
    const llmResult = priceToAllStrategies.get(firstPrice)?.[strat]
      || { suggestedPrice: refAvg || marketStats.avg, reasoning: "" };

    let suggested = Number(llmResult.suggestedPrice);

    // Floor price guard
    const floorPrice = costData?.hasCostData ? costData.landedCostPerUnit : firstPrice;
    if (suggested > 0 && suggested < floorPrice) suggested = floorPrice;

    const suggestedMarginPct = costData?.hasCostData && costData.landedCostPerUnit > 0
      ? ((suggested - costData.landedCostPerUnit) / costData.landedCostPerUnit) * 100
      : 0;
    const discountPct = refAvg > 0 ? ((refAvg - suggested) / refAvg) * 100 : 0;
    let riskLevel = "safe", warning = null, warningMessage = null;
    if (suggested === floorPrice && suggested > 0 && costData?.hasCostData) {
      riskLevel = "safe"; warning = "floor_price_landed";
      warningMessage = `Giá đề xuất không thể thấp hơn giá vốn landed (${floorPrice.toLocaleString("vi-VN")}₫).`;
    } else if (suggested < floorPrice) {
      riskLevel = "safe"; warning = "floor_price";
      warningMessage = `Giá đề xuất không thể thấp hơn giá hiện tại (${floorPrice.toLocaleString("vi-VN")}₫).`;
    } else if (discountPct > 30) {
      riskLevel = "high"; warning = "high_discount_risk";
      warningMessage = "Giá đề xuất thấp hơn 30% so với trung bình thị trường. Có nguy cơ lỗ vốn.";
    } else if (discountPct > 15) {
      riskLevel = "moderate"; warning = "moderate_discount";
      warningMessage = `Giá đề xuất thấp hơn ${Math.round(discountPct)}% so với trung bình.`;
    }

    allStrategies[strat] = {
      suggestedPrice: Math.round(suggested),
      reasoning: llmResult.reasoning || "",
      warning,
      riskLevel,
      warningMessage,
      discountPct: Math.round(discountPct * 10) / 10,
      suggestedMarginPct: Math.round(suggestedMarginPct * 10) / 10,
      marketData,
      competitors: competitorsObj,
      analyzedAt,
    };
  }

  // ── Step 4: Build per-variant results for the REQUESTED strategy ──
  const results = validModelIds.map((modelId) => {
    const model = modelMap.get(modelId);
    const currentPrice = model?.price ?? targetProduct.originalPrice;
    const stratResult = allStrategies[strategy] || allStrategies["balanced"];

    // Re-clamp per-variant (variant floor may differ from the first group's floor)
    let suggested = stratResult.suggestedPrice;
    const variantFloor = costData?.hasCostData ? costData.landedCostPerUnit : currentPrice;
    if (suggested > 0 && suggested < variantFloor) suggested = variantFloor;

    const variantDiscountPct = refAvg > 0 ? ((refAvg - suggested) / refAvg) * 100 : 0;
    const variantMarginPct = costData?.hasCostData && costData.landedCostPerUnit > 0
      ? ((suggested - costData.landedCostPerUnit) / costData.landedCostPerUnit) * 100
      : 0;
    const currentMarginInfo = costData?.hasCostData
      ? calculateMargin(currentPrice, costData.landedCostPerUnit)
      : null;

    return {
      modelId,
      sku: model?.sku || null,
      tierIndex: model?.tierIndex || [],
      currentPrice,
      suggestedPrice: Math.round(suggested),
      reasoning: stratResult.reasoning || "",
      discountPct: Math.round(variantDiscountPct * 10) / 10,
      riskLevel: stratResult.riskLevel || "safe",
      warning: stratResult.warning || null,
      warningMessage: stratResult.warningMessage || null,
      fromCache: false,
      strategy,
      // [Hướng 2]
      costData: costData || null,
      marginInfo: currentMarginInfo || null,
      suggestedMarginPct: Math.round(variantMarginPct * 10) / 10,
      analyzedAt,
    };
  });

  const productPayload = {
    id: targetProduct._id ?? null,
    name: targetProduct.name,
    brand: targetProduct.brand || "No-brand",
    rating: sellerRating,
    totalModels: (targetProduct.models?.length ?? 0) || (precompute.localModelMap ? precompute.localModelMap.size : 0),
    isDraftListing: !targetProduct._id,
  };

  const fullPayload = {
    results,
    product: productPayload,
    marketData,
    competitors: obfuscatedCompetitors,
    strategy,
    costData: costData || null,
    // [Multi-strategy Redis cache] All 4 strategies — enables instant switching in UI
    allStrategies,
    analyzedAt,
  };

  // batchCacheKey is empty string in draft mode (no MongoDB cache); skip save
  if (batchCacheKey) {
    saveBatchToCache(productIdStr, sellerId, batchCacheKey, fullPayload).catch(() => {});
  }

  // ── Step 5: Save ALL 4 strategies to Redis (non-blocking) ──
  // competitorsForCache & batchRefPrice already declared at Step 1
  multiStrategyCache.saveAllStrategies(
    productIdStr, batchRefPrice, competitorsForCache, sellerId, allStrategies
  ).catch((err) => console.warn("[priceSuggestion] [Batch] Redis save failed:", err.message));

  return {
    success: true,
    fromCache: false,
    ...fullPayload,
  };
}

/**
 * [Batch] Execute price suggestions (agent tool): full pipeline, no HTTP rate-limit gate between phases.
 * [Phase 3 - 5.1] Added strategy parameter for Pricing Personas.
 */
async function executeBatch({ sellerId, productId, modelIds, strategy = "balanced" }) {
  const prep = await prepareBatchPriceSuggestion({ sellerId, productId, modelIds, strategy });
  if (prep.context) return { context: prep.context };
  if (prep.success && prep.fromCache) return prep;
  if (prep.pendingLLM && prep.precompute) {
    return finalizeBatchPriceSuggestion(prep.precompute);
  }
  return { context: "Không thể đề xuất giá batch." };
}

registerTool("priceSuggestion", {
  description: "Đề xuất giá bán tối ưu dựa trên phân tích đối thủ và thị trường",
  roles: ["seller"],
  keywords: [
    "giá", "định giá", "price", "pricing",
    "đề xuất giá", "nên bán giá", "giá bao nhiêu",
    "điều chỉnh giá", "tăng giá", "giảm giá",
    "cạnh tranh", "thị trường", "đối thủ",
  ],
  execute,
  executeBatch,
});

export {
  execute as executePriceSuggestion,
  executeBatch,
  prepareBatchPriceSuggestion,
  finalizeBatchPriceSuggestion,
};
