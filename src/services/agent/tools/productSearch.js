import mongoose from "mongoose";
import Product from "../../../models/Product.js";
import Category from "../../../models/Category.js";
import Deal from "../../../models/Deal.js";
import Voucher from "../../../models/Voucher.js";
import Review from "../../../models/Review.js";
import User from "../../../models/User.js";
import embeddingService from "../../embedding.service.js";
import { registerTool } from "../tools.js";
import { escapeRegex, extractSearchTerms } from "../../../utils/productSearchQuery.js";
import { normalizeBuyerQuery } from "../../../utils/buyerQueryNormalizer.js";
import {
  extractGenderIntent,
  buildGenderMongoClause,
  filterProductsByGenderIntent,
} from "../../../utils/genderIntent.js";

const TOP_K = 10;

/** Load Category.name theo categoryId trên danh sách sản phẩm (lọc giới + context). */
async function loadCategoryIdToNameMap(products) {
  const raw = [...new Set(products.map((p) => p.categoryId).filter(Boolean))];
  if (!raw.length) return {};
  const ids = raw.map((id) =>
    typeof id === "string" ? new mongoose.Types.ObjectId(id) : id,
  );
  const rows = await Category.find({ _id: { $in: ids } }).select("name").lean();
  const map = {};
  for (const c of rows) map[c._id.toString()] = c.name || "";
  return map;
}

/**
 * Pipeline tìm sản phẩm cho agent (dùng chung outfit + productSearch).
 */
export async function runProductSearch({ query, limit = TOP_K, categoryId = null }) {
  const { normalized } = normalizeBuyerQuery(query);
  const effectiveQuery = normalized || query;

  const genderIntent = extractGenderIntent(effectiveQuery);
  const genderClause = buildGenderMongoClause(genderIntent);

  const queryEmbedding = await embeddingService.getEmbedding(effectiveQuery);

  // ─── Stage 1: Text filter — OR per keyword (natural Vietnamese)
  const terms = extractSearchTerms(effectiveQuery);
  const orConditions = [];
  for (const term of terms) {
    const rx = escapeRegex(term);
    orConditions.push(
      { name: { $regex: rx, $options: "i" } },
      { brand: { $regex: rx, $options: "i" } },
      { tags: { $regex: rx, $options: "i" } },
    );
  }

  const textCandidates = orConditions.length
    ? await Product.find({
        status: "active",
        ...(categoryId ? { categoryId: new mongoose.Types.ObjectId(categoryId) } : {}),
        ...genderClause,
        $or: orConditions,
      })
        .select("_id name slug categoryId sellerId description attributes originalPrice rating reviewCount sold brand tags models.price models.sku images")
        .sort({ sold: -1 })
        .limit(60)
        .lean()
    : [];

  const candidateIds = textCandidates.map((p) => p._id);

  // ─── Stage 2: Vector rank
  let products = [];

  if (candidateIds.length > 0) {
    try {
      const rawResults = await Product.aggregate([
        {
          $vectorSearch: {
            index: "product_vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: candidateIds.length,
            limit: Math.min(limit * 2, candidateIds.length),
            filter: { _id: { $in: candidateIds } },
          },
        },
        {
          $addFields: {
            score: { $meta: "vectorSearchScore" },
          },
        },
        {
          $match: {
            score: { $gte: 0.88 },
          },
        },
        {
          $project: {
            name: 1, slug: 1, categoryId: 1, sellerId: 1,
            description: 1, attributes: 1, originalPrice: 1,
            rating: 1, reviewCount: 1, sold: 1, brand: 1,
            tags: 1, "models.price": 1, "models.sku": 1, images: 1,
          },
        },
        { $sort: { score: -1 } },
        { $limit: limit },
      ]);
      products = rawResults;
    } catch (err) {
      console.warn("[productSearch] Vector search failed, falling back to text:", err.message);
    }
  }

  if (products.length === 0 && textCandidates.length > 0) {
    products = textCandidates.slice(0, limit);
  }

  const categoryIdToName = await loadCategoryIdToNameMap(products);

  const countBeforeGender = products.length;
  products = filterProductsByGenderIntent(products, genderIntent, categoryIdToName);
  if (countBeforeGender > 0 && products.length === 0 && genderIntent) {
    return {
      context:
        "Không tìm thấy sản phẩm phù hợp với giới tính (nam/nữ) bạn đang tìm trong kho GZMart. Bạn thử đổi từ khóa hoặc xem danh mục khác.",
      products: [],
    };
  }

  if (products.length === 0) {
    return { context: "Không tìm thấy sản phẩm phù hợp.", products: [] };
  }

  return finalizeProductAgentContext(
    products,
    `=== SẢN PHẨM TÌM ĐƯỢC (${products.length} kết quả) ===`,
  );
}

/**
 * Gắn deal/voucher/review và format context cho LLM (dùng chung outfit).
 */
export async function finalizeProductAgentContext(products, headerLine) {
  if (!products?.length) {
    return { context: "Không tìm thấy sản phẩm phù hợp.", products: [] };
  }

  const productIds = products.map((p) => p._id);
  const sellerIds = [...new Set(products.map((p) => p.sellerId?.toString()).filter(Boolean))];
  const now = new Date();

  const [categories, sellers, deals, vouchers, reviews] = await Promise.all([
    Category.find({ status: "active" }).select("name").lean(),
    User.find({ _id: { $in: sellerIds } }, "fullName shopName").lean(),
    Deal.find({
      productId: { $in: productIds }, status: "active",
      startDate: { $lte: now }, endDate: { $gte: now },
    }).select("productId type title dealPrice discountPercent endDate").lean(),
    Voucher.find({
      status: "active", displaySetting: "public",
      startTime: { $lte: now }, endTime: { $gte: now },
      type: { $in: ["shop", "product"] },
      $or: [
        { shopId: { $in: sellerIds } },
        { appliedProducts: { $in: productIds } },
      ],
      $expr: { $lt: ["$usageCount", "$usageLimit"] },
    }).select("code name type shopId discountType discountValue maxDiscountAmount minBasketPrice applyTo appliedProducts endTime").lean(),
    Review.aggregate([
      { $match: { productId: { $in: productIds }, status: "approved" } },
      { $group: {
        _id: "$productId",
        avgRating: { $avg: "$rating" }, count: { $sum: 1 },
        sample: { $push: { rating: "$rating", content: { $substrBytes: ["$content", 0, 80] } } },
      }},
      { $project: { avgRating: { $round: ["$avgRating", 1] }, count: 1, sample: { $slice: ["$sample", 2] } } },
    ]),
  ]);

  const catMap = {};
  categories.forEach((c) => { catMap[c._id.toString()] = c.name; });
  const sellerMap = {};
  sellers.forEach((s) => { sellerMap[s._id.toString()] = s.shopName || s.fullName || "Shop"; });
  const dealMap = {};
  deals.forEach((d) => { const pid = d.productId.toString(); if (!dealMap[pid]) dealMap[pid] = []; dealMap[pid].push(d); });

  const productLines = products.map((p) => {
    const pid = p._id.toString();
    const sid = p.sellerId?.toString();
    const cat = catMap[p.categoryId?.toString()] || "N/A";
    const shop = sellerMap[sid] || "Shop";
    const prices = p.models?.map((m) => m.price).filter(Boolean) || [];
    const basePrice = prices.length > 0 ? Math.min(...prices) : (p.originalPrice || 0);
    const maxPrice = prices.length > 1 ? Math.max(...prices) : null;
    const priceStr = maxPrice && maxPrice !== basePrice
      ? `${basePrice.toLocaleString("vi-VN")}–${maxPrice.toLocaleString("vi-VN")}₫`
      : `${basePrice.toLocaleString("vi-VN")}₫`;

    const desc = p.description?.replace(/<[^>]*>/g, "").slice(0, 200) || "";
    const attrs = (p.attributes || []).map((a) => `${a.label}: ${a.value}`).join(", ");

    let line = `[ID:${pid}] ${p.name} | ${cat} | Shop: ${shop} | Giá: ${priceStr} | ⭐${p.rating}/5 (${p.reviewCount} đánh giá) | Đã bán: ${p.sold}`;
    if (p.brand) line += ` | Brand: ${p.brand}`;

    const pDeals = dealMap[pid];
    if (pDeals?.length) {
      pDeals.forEach((d) => {
        const label = d.type === "flash_sale" ? "FLASH SALE" : d.title || d.type;
        const disc = d.dealPrice ? `${d.dealPrice.toLocaleString("vi-VN")}₫` : `-${d.discountPercent}%`;
        line += `\n  🔥 ${label}: ${disc} (HSD: ${d.endDate.toLocaleDateString("vi-VN")})`;
      });
    }

    const applicableVouchers = vouchers.filter((v) => {
      if (v.type === "product" && v.applyTo === "specific") return v.appliedProducts?.some((ap) => ap.toString() === pid);
      return v.shopId?.toString() === sid;
    });
    applicableVouchers.forEach((v) => {
      const disc = v.discountType === "percent"
        ? `-${v.discountValue}%${v.maxDiscountAmount ? ` (max ${v.maxDiscountAmount.toLocaleString("vi-VN")}₫)` : ""}`
        : `-${v.discountValue.toLocaleString("vi-VN")}₫`;
      line += `\n  🎟️ ${v.code}: ${disc}`;
    });

    if (desc) line += `\n  Mô tả: ${desc}`;
    if (attrs) line += `\n  Đặc điểm: ${attrs}`;
    return line;
  });

  const context = `${headerLine}\n${productLines.join("\n\n")}`;
  return { context, products };
}

registerTool("productSearch", {
  description: "Tìm kiếm sản phẩm theo từ khóa, sử dụng vector search + text search",
  roles: ["buyer", "seller", "admin"],
  keywords: [
    "tìm", "kiếm", "gợi ý", "recommend", "sản phẩm", "hàng",
    "mua", "muốn", "cần", "xem", "so sánh",
    "áo", "quần", "giày", "dép", "túi", "balo", "nón", "mũ", "váy", "đầm",
    "hoodie", "jacket", "polo", "jean", "jogger", "sneaker",
    "điện thoại", "laptop", "tai nghe", "loa", "sạc", "ốp lưng",
    "kem", "serum", "son", "nước hoa", "dầu gội",
    "rẻ", "đắt", "budget", "dưới", "trên",
    "hot", "bán chạy", "best seller", "mới",
  ],
  execute: (params) => runProductSearch(params),
});
