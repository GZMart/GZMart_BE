import Product from "../models/Product.js";
import Category from "../models/Category.js";
import Review from "../models/Review.js";
import Deal from "../models/Deal.js";
import Voucher from "../models/Voucher.js";
import User from "../models/User.js";
import { executeAgent } from "./agent/agentExecutor.js";

const AI_API_URL =
  process.env.AI_API_URL ||
  "https://textgeneration.trongducdoan25.workers.dev/";
const AI_API_TOKEN = process.env.AI_API_TOKEN || "ducdeptraivl";

const CACHE_TTL_MS = 30 * 60 * 1000;
let knowledgeCache = { data: null, builtAt: 0 };
let productNameCache = [];

async function buildKnowledgeBase() {
  const now = Date.now();
  if (knowledgeCache.data && now - knowledgeCache.builtAt < CACHE_TTL_MS) {
    return knowledgeCache.data;
  }

  const categories = await Category.find({ status: "active" })
    .select("name slug parentId level productCount")
    .lean();

  const categoryMap = {};
  categories.forEach((c) => {
    categoryMap[c._id.toString()] = c.name;
  });

  const categoryLines = categories.map((c) => {
    const parent = c.parentId ? categoryMap[c.parentId.toString()] : null;
    return `- ${c.name}${parent ? ` (thuộc ${parent})` : ""} — ${c.productCount} sản phẩm`;
  });

  const products = await Product.find({ status: "active" })
    .select(
      "name slug categoryId sellerId description attributes originalPrice rating reviewCount sold brand tags models.price models.sku images",
    )
    .lean();

  const now_date = new Date();
  const activeDeals = await Deal.find({
    status: "active",
    startDate: { $lte: now_date },
    endDate: { $gte: now_date },
  })
    .select("productId variantSku type title dealPrice discountPercent quantityLimit soldCount endDate")
    .lean();

  const dealsByProduct = {};
  activeDeals.forEach((d) => {
    const pid = d.productId.toString();
    if (!dealsByProduct[pid]) dealsByProduct[pid] = [];
    dealsByProduct[pid].push(d);
  });

  const activeVouchers = await Voucher.find({
    status: "active",
    displaySetting: "public",
    startTime: { $lte: now_date },
    endTime: { $gte: now_date },
    type: { $in: ["shop", "product"] },
    $expr: { $lt: ["$usageCount", "$usageLimit"] },
  })
    .select("code name type shopId discountType discountValue maxDiscountAmount minBasketPrice applyTo appliedProducts endTime usageLimit usageCount")
    .lean();

  const sellerIds = [...new Set(products.map((p) => p.sellerId?.toString()).filter(Boolean))];
  const sellers = await User.find(
    { _id: { $in: sellerIds } },
    "fullName shopName",
  ).lean();
  const sellerNameMap = {};
  sellers.forEach((s) => {
    sellerNameMap[s._id.toString()] = s.shopName || s.fullName || "Shop";
  });

  const productSellerMap = {};
  products.forEach((p) => {
    if (p.sellerId) productSellerMap[p._id.toString()] = p.sellerId.toString();
  });

  const vouchersByProduct = {};
  const vouchersByShop = {};
  activeVouchers.forEach((v) => {
    const shopId = v.shopId?.toString();
    if (!shopId) return;

    if (v.type === "product" && v.applyTo === "specific" && v.appliedProducts?.length) {
      v.appliedProducts.forEach((pid) => {
        const key = pid.toString();
        if (!vouchersByProduct[key]) vouchersByProduct[key] = [];
        vouchersByProduct[key].push(v);
      });
    } else {
      if (!vouchersByShop[shopId]) vouchersByShop[shopId] = [];
      vouchersByShop[shopId].push(v);
    }
  });

  const formatVoucherDiscount = (v) => {
    if (v.discountType === "percent") {
      return `-${v.discountValue}%${v.maxDiscountAmount ? ` (tối đa ${v.maxDiscountAmount.toLocaleString("vi-VN")}₫)` : ""}`;
    }
    if (v.discountType === "amount") {
      return `-${v.discountValue.toLocaleString("vi-VN")}₫`;
    }
    return `-${v.discountValue} coin`;
  };

  const productLines = products.map((p) => {
    const pid = p._id.toString();
    const sid = p.sellerId?.toString();
    const cat = categoryMap[p.categoryId?.toString()] || "N/A";
    const shopName = sellerNameMap[sid] || "Shop";
    const prices = p.models?.map((m) => m.price).filter(Boolean) || [];
    const basePrice = prices.length > 0 ? Math.min(...prices) : (p.originalPrice || 0);
    const maxPrice = prices.length > 1 ? Math.max(...prices) : null;
    const priceRange = maxPrice && maxPrice !== basePrice
      ? `${basePrice.toLocaleString("vi-VN")}–${maxPrice.toLocaleString("vi-VN")}₫`
      : `${basePrice.toLocaleString("vi-VN")}₫`;

    const desc = p.description
      ? p.description.replace(/<[^>]*>/g, "").slice(0, 150)
      : "";
    const attrs = (p.attributes || [])
      .map((a) => `${a.label}: ${a.value}`)
      .join(", ");
    let line = `[ID:${pid}] ${p.name} | ${cat} | Shop: ${shopName} | Giá: ${priceRange} | ⭐${p.rating}/5 (${p.reviewCount} đánh giá) | Đã bán: ${p.sold}`;
    if (p.brand) line += ` | Brand: ${p.brand}`;

    const deals = dealsByProduct[pid];
    if (deals?.length) {
      const dealInfos = deals.map((d) => {
        if (d.dealPrice) {
          return `🔥 ${d.type === "flash_sale" ? "FLASH SALE" : d.title || d.type}: ${d.dealPrice.toLocaleString("vi-VN")}₫ (HSD: ${d.endDate.toLocaleDateString("vi-VN")})`;
        }
        return `🔥 ${d.type === "flash_sale" ? "FLASH SALE" : d.title || d.type}: -${d.discountPercent}% (HSD: ${d.endDate.toLocaleDateString("vi-VN")})`;
      });
      line += `\n  ${dealInfos.join("\n  ")}`;
    }

    const productVouchers = vouchersByProduct[pid] || [];
    const shopVouchers = vouchersByShop[sid] || [];
    const allVouchers = [...productVouchers, ...shopVouchers];
    if (allVouchers.length) {
      const seen = new Set();
      const vInfo = allVouchers
        .filter((v) => { if (seen.has(v.code)) return false; seen.add(v.code); return true; })
        .map((v) => {
          const disc = formatVoucherDiscount(v);
          const scope = v.type === "product" && v.applyTo === "specific" ? " (riêng SP này)" : " (toàn shop)";
          const min = v.minBasketPrice ? ` | Đơn tối thiểu ${v.minBasketPrice.toLocaleString("vi-VN")}₫` : "";
          return `🎟️ Mã ${v.code}: ${disc}${scope}${min}`;
        });
      line += `\n  ${vInfo.join("\n  ")}`;
    }

    if (desc) line += `\n  Mô tả: ${desc}`;
    if (attrs) line += `\n  Đặc điểm: ${attrs}`;
    if (p.tags?.length > 0) line += `\n  Tags: ${p.tags.join(", ")}`;
    return line;
  });

  const reviewAgg = await Review.aggregate([
    { $match: { status: "approved" } },
    {
      $group: {
        _id: "$productId",
        avgRating: { $avg: "$rating" },
        count: { $sum: 1 },
        sample: {
          $push: {
            rating: "$rating",
            content: { $substrBytes: ["$content", 0, 100] },
          },
        },
      },
    },
    {
      $project: {
        avgRating: { $round: ["$avgRating", 1] },
        count: 1,
        sample: { $slice: ["$sample", 3] },
      },
    },
  ]);

  const productIdNameMap = {};
  products.forEach((p) => {
    productIdNameMap[p._id.toString()] = p.name;
  });

  const reviewLines = reviewAgg.map((r) => {
    const pName = productIdNameMap[r._id.toString()] || "Sản phẩm";
    const samples = r.sample
      .map((s) => `  "${s.content}..." (${s.rating}⭐)`)
      .join("\n");
    return `- ${pName}: ${r.avgRating}⭐ trung bình, ${r.count} đánh giá\n${samples}`;
  });

  const voucherLines = activeVouchers.map((v) => {
    const shopName = sellerNameMap[v.shopId?.toString()] || "Shop";
    const disc = formatVoucherDiscount(v);
    const scope = v.type === "product" && v.applyTo === "specific"
      ? "Áp dụng: sản phẩm chỉ định"
      : `Áp dụng: toàn bộ shop ${shopName}`;
    const min = v.minBasketPrice ? ` | Đơn tối thiểu ${v.minBasketPrice.toLocaleString("vi-VN")}₫` : "";
    const remaining = v.usageLimit - v.usageCount;
    return `- 🎟️ Mã ${v.code} (${v.name}) | Shop: ${shopName} | Giảm: ${disc} | ${scope}${min} | Còn ${remaining} lượt | HSD: ${v.endTime.toLocaleDateString("vi-VN")}`;
  });

  const flashSaleCount = activeDeals.filter((d) => d.type === "flash_sale").length;

  const kb = `=== DỮ LIỆU CỬA HÀNG GZMART (cập nhật ${new Date().toLocaleString("vi-VN")}) ===

## DANH MỤC (${categories.length})
${categoryLines.join("\n")}

## SẢN PHẨM (${products.length} sản phẩm đang bán)
${productLines.join("\n")}
${flashSaleCount > 0 ? `\n## FLASH SALE ĐANG DIỄN RA (${flashSaleCount} sản phẩm)\nThông tin deal đã gắn trực tiếp vào từng sản phẩm ở trên.` : ""}
${voucherLines.length > 0 ? `\n## VOUCHER ĐANG CÓ (${voucherLines.length})\nLưu ý: Người mua cần LƯU voucher trước khi dùng. Tối đa 1 voucher shop + 1 voucher sản phẩm mỗi đơn.\n${voucherLines.join("\n")}` : ""}

## ĐÁNH GIÁ NỔI BẬT
${reviewLines.join("\n")}
`;

  productNameCache = products
    .map((p) => ({ id: p._id.toString(), name: p.name }))
    .sort((a, b) => b.name.length - a.name.length);

  knowledgeCache = { data: kb, builtAt: now };
  console.log(
    `[AI] Knowledge base rebuilt: ${categories.length} categories, ${products.length} products, ${activeDeals.length} deals, ${activeVouchers.length} vouchers, ${reviewAgg.length} review groups (${(kb.length / 1024).toFixed(1)} KB)`,
  );
  return kb;
}

function invalidateCache() {
  knowledgeCache = { data: null, builtAt: 0 };
}

function buildSystemPrompt(knowledgeBase) {
  return `Bạn là trợ lý mua sắm GZMart. Trả lời bằng tiếng Việt, thân thiện.

DỮ LIỆU BÊN DƯỚI là NGUỒN THÔNG TIN DUY NHẤT của bạn. TUYỆT ĐỐI KHÔNG được bịa hoặc đoán thông tin không có trong dữ liệu này.

${knowledgeBase}

=== CÁCH TRẢ LỜI ===

1. CHỈ gợi ý sản phẩm CÓ TRONG dữ liệu ở trên. Nếu không tìm thấy sản phẩm phù hợp, nói thẳng "Hiện tại GZMart chưa có sản phẩm phù hợp với yêu cầu của bạn".

2. Mỗi sản phẩm nhắc tới PHẢI kèm tag [[product:ID]] trên dòng riêng. ID lấy từ [ID:...] trong dữ liệu.

3. KHÔNG viết lại tên, giá, rating, lượt bán — hệ thống tự hiển thị card. Chỉ viết 1 câu ngắn về điểm nổi bật rồi đặt tag.

4. Nếu sản phẩm đang có deal/flash sale, nhắc ngắn gọn. Nếu có voucher áp dụng được, nhắc mã và điều kiện.

=== VÍ DỤ ===

Mình gợi ý cho bạn nè ✨

Chất nỉ bông dày, kiểu oversize hợp đi học đi chơi 👉
[[product:64a1b2c3d4e5f6a7b8c9d0e1]]

Đang flash sale, nhanh tay kẻo hết nha! 🔥
[[product:64a1b2c3d4e5f6a7b8c9d0e2]]

Bạn thích mẫu nào hơn? 😊`;
}

async function fetchProductDetails(conversationHistory) {
  const mentionedIds = new Set();
  for (const m of conversationHistory) {
    if (m.role === "ai" || m.role === "assistant") {
      const ids = extractProductIds(m.content || "");
      ids.forEach((id) => mentionedIds.add(id));
    }
  }
  if (mentionedIds.size === 0) return "";

  const products = await Product.find({
    _id: { $in: [...mentionedIds] },
    status: "active",
  })
    .select("name description attributes models.sku models.price tiers")
    .lean();

  if (products.length === 0) return "";

  const lines = products.map((p) => {
    const desc = p.description
      ? p.description.replace(/<[^>]*>/g, "").slice(0, 800)
      : "Không có mô tả";
    const attrs = (p.attributes || [])
      .map((a) => `  - ${a.label}: ${a.value}`)
      .join("\n");
    const variants = (p.models || [])
      .map((m) => `  - ${m.sku}: ${m.price.toLocaleString("vi-VN")}₫`)
      .join("\n");
    const tiers = (p.tiers || [])
      .map((t) => `  - Phân loại "${t.name}": ${(t.options || []).join(", ")}`)
      .join("\n");

    let detail = `[ID:${p._id}] ${p.name}\n  Mô tả đầy đủ: ${desc}`;
    if (attrs) detail += `\n  Thông số:\n${attrs}`;
    if (tiers) detail += `\n  Phân loại:\n${tiers}`;
    if (variants) detail += `\n  Biến thể & giá:\n${variants}`;
    return detail;
  });

  return `\n\n=== THÔNG TIN CHI TIẾT SẢN PHẨM ĐANG ĐƯỢC HỎI ===\n${lines.join("\n\n")}`;
}

const REJECTION_MSG =
  "Mình là trợ lý mua sắm GZMart, chỉ hỗ trợ được các vấn đề liên quan đến sản phẩm và mua sắm trên GZMart thôi nha 😊 Bạn cần tìm sản phẩm gì không?";

const SHOPPING_KEYWORDS = [
  "mua", "bán", "giá", "sản phẩm", "hàng", "đồ", "shop", "gzmart",
  "voucher", "mã giảm", "khuyến mãi", "flash sale", "deal", "giảm giá",
  "đơn hàng", "giao hàng", "ship", "vận chuyển", "thanh toán", "cod",
  "đổi trả", "hoàn tiền", "bảo hành",
  "size", "màu", "kiểu", "mẫu", "loại", "phân loại",
  "áo", "quần", "giày", "dép", "túi", "balo", "nón", "mũ", "váy", "đầm",
  "hoodie", "jacket", "polo", "sơ mi", "jean", "jogger", "short", "kaki",
  "sneaker", "sandal", "boot",
  "đồng hồ", "phụ kiện", "trang sức", "kính",
  "điện thoại", "laptop", "tai nghe", "loa", "sạc", "cáp", "ốp lưng",
  "kem", "serum", "toner", "sữa rửa mặt", "son", "phấn", "mascara",
  "nước hoa", "dầu gội", "sữa tắm",
  "gợi ý", "tư vấn", "recommend", "suggest", "tìm", "kiếm", "xem",
  "so sánh", "nào tốt", "nào đẹp", "nào rẻ", "nào bền",
  "review", "đánh giá", "nhận xét", "feedback",
  "giỏ hàng", "cart", "checkout", "đặt hàng", "order",
  "yêu thích", "wishlist", "lưu", "theo dõi",
  "brand", "thương hiệu", "hãng",
  "nam", "nữ", "unisex", "trẻ em",
  "rẻ", "đắt", "tiết kiệm", "budget", "triệu", "nghìn", "k", "₫", "vnđ", "vnd",
  "chất liệu", "cotton", "polyester", "nỉ", "kaki", "da", "vải",
  "oversize", "slim fit", "regular", "form",
  "hot", "bán chạy", "best seller", "mới", "new arrival",
  "outfit", "set đồ", "phối đồ", "mix", "match",
  "đi chơi", "đi học", "đi làm", "đi biển", "du lịch", "thể thao", "gym",
  "tài khoản", "account", "đăng ký", "đăng nhập",
  "chi phí", "ngân sách",
  "chào", "hello", "hi", "hey", "xin chào", "alo",
  "cảm ơn", "thanks", "thank", "cám ơn",
  "hỏi", "giúp", "hỗ trợ", "support",
];

const CHAT_MANAGEMENT_KEYWORDS = [
  "clear", "reset", "xóa", "làm mới", "bắt đầu lại", "refresh",
  "new chat", "chat mới", "xóa chat", "xóa hội thoại",
];

function isShoppingRelated(message) {
  const lower = message.toLowerCase();
  if (CHAT_MANAGEMENT_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return SHOPPING_KEYWORDS.some((kw) => lower.includes(kw));
}

async function chat({ message, conversationHistory = [], role = "buyer", userId, sellerId }) {
  if (role === "buyer" && !isShoppingRelated(message)) {
    return REJECTION_MSG;
  }

  const { text, products, toolsUsed } = await executeAgent({
    message,
    role,
    userId,
    sellerId,
    conversationHistory,
  });

  if (products?.length) {
    updateProductNameCacheFromResults(products);
  }

  console.log(`[AI Agent] Role: ${role}, Tools used: ${toolsUsed?.join(", ") || "none"}`);
  return text;
}

function updateProductNameCacheFromResults(products) {
  if (!products?.length) return;
  productNameCache = products
    .map((p) => ({ id: p._id?.toString() || p._id, name: p.name }))
    .sort((a, b) => b.name.length - a.name.length);
}

function injectMissingProductTags(text) {
  if (!productNameCache.length) return text;

  const alreadyTagged = new Set(extractProductIds(text));
  let result = text;

  for (const { id, name } of productNameCache) {
    if (alreadyTagged.has(id)) continue;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\*{0,2}${escaped}\\*{0,2}`, "gi");
    const match = regex.exec(result);
    if (!match) continue;

    const insertPos = result.indexOf("\n", match.index + match[0].length);
    const tag = `\n[[product:${id}]]`;
    if (insertPos !== -1) {
      result =
        result.slice(0, insertPos) + tag + result.slice(insertPos);
    } else {
      result += tag;
    }
    alreadyTagged.add(id);
  }

  return result;
}

async function getProductCards(productIds) {
  if (!productIds || productIds.length === 0) return [];

  const products = await Product.find({
    _id: { $in: productIds },
    status: "active",
  })
    .select("name slug originalPrice rating reviewCount sold images models.price brand")
    .lean();

  const now_d = new Date();
  const deals = await Deal.find({
    productId: { $in: productIds },
    status: "active",
    startDate: { $lte: now_d },
    endDate: { $gte: now_d },
  })
    .select("productId dealPrice discountPercent type endDate")
    .lean();

  const dealMap = {};
  deals.forEach((d) => {
    const pid = d.productId.toString();
    if (!dealMap[pid] || (d.dealPrice && d.dealPrice < (dealMap[pid].dealPrice || Infinity))) {
      dealMap[pid] = d;
    }
  });

  return products.map((p) => {
    const prices = p.models?.map((m) => m.price).filter(Boolean) || [];
    const minPrice = prices.length > 0 ? Math.min(...prices) : p.originalPrice;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : p.originalPrice;

    const deal = dealMap[p._id.toString()];
    let salePrice = null;
    let dealLabel = null;
    if (deal) {
      if (deal.dealPrice) {
        salePrice = deal.dealPrice;
      } else if (deal.discountPercent) {
        salePrice = Math.round(minPrice * (1 - deal.discountPercent / 100));
      }
      dealLabel = deal.type === "flash_sale" ? "Flash Sale" : "Deal";
    }

    return {
      _id: p._id.toString(),
      name: p.name,
      slug: p.slug,
      image: p.images?.[0] || null,
      price: salePrice || minPrice,
      originalPrice: salePrice ? minPrice : p.originalPrice,
      maxPrice: minPrice !== maxPrice && !salePrice ? maxPrice : undefined,
      rating: p.rating,
      reviewCount: p.reviewCount,
      sold: p.sold,
      brand: p.brand,
      dealLabel,
    };
  });
}

function extractProductIds(text) {
  const regex = /\[\[product:([a-f0-9]{24})\]\]/gi;
  const ids = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (!ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  return ids;
}

export default {
  chat,
  buildKnowledgeBase,
  invalidateCache,
  getProductCards,
  extractProductIds,
  injectMissingProductTags,
  updateProductNameCacheFromResults,
};
