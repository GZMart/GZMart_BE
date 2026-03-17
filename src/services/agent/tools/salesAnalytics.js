import * as dashboardService from "../../dashboard.service.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId }) {
  if (!sellerId) return { context: "Cần sellerId để xem analytics." };

  const [revenue, bestSellers, trend, comparison] = await Promise.all([
    dashboardService.getRevenueStats(sellerId),
    dashboardService.getBestSellingProducts(sellerId, 5),
    dashboardService.getSalesTrend(sellerId, 30),
    dashboardService.getComparisonStats(sellerId, "month"),
  ]);

  const bestSellerLines = bestSellers.map(
    (p, i) => `${i + 1}. ${p.name} — ${p.totalSold} đã bán`
  );

  const growthEmoji = comparison.growth.revenue >= 0 ? "📈" : "📉";

  const context = `=== PHÂN TÍCH DOANH THU SHOP ===
💰 Doanh thu hôm nay: ${revenue.today.toLocaleString("vi-VN")}₫
💰 Tuần này: ${revenue.thisWeek.toLocaleString("vi-VN")}₫
💰 Tháng này: ${revenue.thisMonth.toLocaleString("vi-VN")}₫
💰 Năm nay: ${revenue.thisYear.toLocaleString("vi-VN")}₫

${growthEmoji} So với tháng trước:
  - Đơn hàng: ${comparison.growth.orders >= 0 ? "+" : ""}${comparison.growth.orders}%
  - Doanh thu: ${comparison.growth.revenue >= 0 ? "+" : ""}${comparison.growth.revenue}%
  - Số lượng bán: ${comparison.growth.quantity >= 0 ? "+" : ""}${comparison.growth.quantity}%

🏆 Top sản phẩm bán chạy:
${bestSellerLines.join("\n") || "Chưa có dữ liệu"}

📊 Xu hướng 30 ngày gần nhất:
${trend.slice(-7).map((t) => `  ${t._id}: ${t.sales} đơn, ${t.revenue.toLocaleString("vi-VN")}₫`).join("\n") || "Chưa có dữ liệu"}`;

  return { context };
}

registerTool("salesAnalytics", {
  description: "Phân tích doanh thu, top sản phẩm, xu hướng bán hàng cho seller",
  roles: ["seller"],
  keywords: [
    "doanh thu", "revenue", "bán được", "kiếm được",
    "top sản phẩm", "bán chạy", "best seller",
    "xu hướng", "trend", "biểu đồ", "thống kê", "analytics",
    "tháng này", "tuần này", "hôm nay", "năm nay",
    "so sánh", "tăng trưởng", "growth",
    "lợi nhuận", "profit",
  ],
  execute,
});
