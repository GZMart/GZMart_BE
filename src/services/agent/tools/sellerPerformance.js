import ShopStatistic from "../../../models/ShopStatistic.js";
import User from "../../../models/User.js";
import Product from "../../../models/Product.js";
import { registerTool } from "../tools.js";

async function execute({ limit = 10 } = {}) {
  const stats = await ShopStatistic.find()
    .sort({ ratingAverage: -1 })
    .limit(limit)
    .lean();

  const sellerIds = stats.map((s) => s.sellerId);
  const sellers = await User.find({ _id: { $in: sellerIds } }).select("fullName shopName").lean();
  const sellerMap = {};
  sellers.forEach((s) => { sellerMap[s._id.toString()] = s.shopName || s.fullName; });

  const productCounts = await Product.aggregate([
    { $match: { sellerId: { $in: sellerIds }, status: "active" } },
    { $group: { _id: "$sellerId", count: { $sum: 1 } } },
  ]);
  const countMap = {};
  productCounts.forEach((p) => { countMap[p._id.toString()] = p.count; });

  const lines = stats.map((s, i) => {
    const name = sellerMap[s.sellerId.toString()] || "Shop";
    const products = countMap[s.sellerId.toString()] || 0;
    return `${i + 1}. ${name} | ⭐${s.ratingAverage}/5 (${s.ratingCount} đánh giá) | ${products} SP | Chat: ${s.chatResponseRate}% | Hủy: ${s.cancelDutyRate}%${s.isPreferred ? " | ⭐ Preferred" : ""}`;
  });

  return { context: `=== HIỆU SUẤT NGƯỜI BÁN (Top ${limit}) ===\n${lines.join("\n")}` };
}

registerTool("sellerPerformance", {
  description: "Xếp hạng hiệu suất người bán (admin only)",
  roles: ["admin"],
  keywords: ["seller", "người bán", "shop", "hiệu suất", "performance", "xếp hạng", "ranking"],
  execute,
});
