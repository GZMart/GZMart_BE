import mongoose from "mongoose";
import Review from "../../../models/Review.js";
import { registerTool } from "../tools.js";

async function execute({ productId }) {
  if (!productId) return { context: "Cần cung cấp ID sản phẩm để xem review." };

  const oid = new mongoose.Types.ObjectId(productId);

  const [stats, recent] = await Promise.all([
    Review.aggregate([
      { $match: { productId: oid, status: "approved" } },
      { $group: {
        _id: null,
        avgRating: { $avg: "$rating" }, total: { $sum: 1 },
        star5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
        star4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
        star3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
        star2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
        star1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
      }},
    ]),
    Review.find({ productId, status: "approved" })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("rating content createdAt")
      .lean(),
  ]);

  const s = stats[0] || { avgRating: 0, total: 0, star5: 0, star4: 0, star3: 0, star2: 0, star1: 0 };
  const recentLines = recent.map(
    (r) => `⭐${r.rating}: "${r.content?.slice(0, 100)}..." (${r.createdAt.toLocaleDateString("vi-VN")})`
  );

  return {
    context: `=== REVIEW SẢN PHẨM ===
⭐ ${s.avgRating.toFixed(1)}/5 (${s.total} đánh giá)
  5⭐: ${s.star5} | 4⭐: ${s.star4} | 3⭐: ${s.star3} | 2⭐: ${s.star2} | 1⭐: ${s.star1}

📝 Review gần nhất:
${recentLines.join("\n") || "Chưa có review."}`,
  };
}

registerTool("reviewAnalysis", {
  description: "Phân tích review cho 1 sản phẩm cụ thể",
  roles: ["buyer", "seller", "admin"],
  keywords: ["review", "đánh giá", "nhận xét", "feedback", "rating"],
  execute,
});
