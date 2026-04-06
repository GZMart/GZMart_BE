import Review from "../../../models/Review.js";
import Product from "../../../models/Product.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, days = 30 }) {
  if (!sellerId) return { context: "Cần sellerId để xem review shop." };

  const products = await Product.find({ sellerId }).select("_id name").lean();
  const productIds = products.map((p) => p._id);
  const productMap = {};
  products.forEach((p) => { productMap[p._id.toString()] = p.name; });

  if (productIds.length === 0) return { context: "Shop chưa có sản phẩm." };

  const since = new Date();
  since.setDate(since.getDate() - days);

  const reviews = await Review.find({
    productId: { $in: productIds },
    status: "approved",
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("productId rating content createdAt")
    .lean();

  const stats = await Review.aggregate([
    { $match: { productId: { $in: productIds }, status: "approved" } },
    { $group: {
      _id: null,
      avgRating: { $avg: "$rating" },
      total: { $sum: 1 },
      star5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
      star4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
      star3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
      star2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
      star1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
    }},
  ]);

  const s = stats[0] || { avgRating: 0, total: 0, star5: 0, star4: 0, star3: 0, star2: 0, star1: 0 };

  const recentLines = reviews.slice(0, 10).map(
    (r) => `⭐${r.rating} | ${productMap[r.productId.toString()] || "SP"} | "${r.content?.slice(0, 100)}..." | ${r.createdAt.toLocaleDateString("vi-VN")}`
  );

  return {
    context: `=== ĐÁNH GIÁ SHOP (${days} ngày gần nhất) ===
⭐ Rating trung bình: ${s.avgRating.toFixed(1)}/5 (${s.total} đánh giá)
  5⭐: ${s.star5} | 4⭐: ${s.star4} | 3⭐: ${s.star3} | 2⭐: ${s.star2} | 1⭐: ${s.star1}

📝 Review gần nhất:
${recentLines.join("\n") || "Chưa có review."}`,
  };
}

registerTool("shopReviews", {
  description: "Xem tổng hợp đánh giá shop",
  roles: ["seller"],
  keywords: ["review", "đánh giá", "nhận xét", "feedback", "rating", "sao"],
  execute,
});
