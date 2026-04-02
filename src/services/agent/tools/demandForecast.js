import mongoose from "mongoose";
import * as demandForecastService from "../../demandForecast.service.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, days = 90 }) {
  if (!sellerId) {
    return { context: "Cần sellerId để xem dự báo nhu cầu." };
  }

  try {
    const data = await demandForecastService.getDemandForecast(sellerId, days);

    if (data.summary.totalProducts === 0) {
      return { context: "Shop chưa có sản phẩm hoặc chưa có dữ liệu bán hàng." };
    }

    // Format summary
    const summaryLines = [
      `📊 Tổng quan:`,
      `  - Tổng SP đang theo dõi: ${data.summary.totalProducts}`,
      `  - Cần nhập gấp: ${data.summary.urgentRestock} SKU`,
      `  - Nên nhập sớm: ${data.summary.moderateRestock} SKU`,
      `  - Ổn định: ${data.summary.stable} SP`,
      `  - Trend tăng: ${data.summary.trendingUp} SP`,
      `  - Trend giảm: ${data.summary.trendingDown} SP`,
      `  - Hết hàng (có đơn trong kỳ): ${data.summary.outOfStock} SKU`,
    ];

    // Format restock alerts
    let restockLines = [];
    if (data.restockAlerts.length > 0) {
      restockLines = data.restockAlerts.slice(0, 10).map((p) => {
        const priority = p.restockPriority === "urgent" ? "🔴 CẦN NHẬP GẤP" : "🟡 NÊN NHẬP SỚM";
        const stockInfo = p.currentStock === 0
          ? "❌ ĐÃ HẾT HÀNG"
          : `Còn ${p.currentStock} (${p.weeksOfStock ?? "?"} tuần)`;
        const skuPart = p.sku ? ` [${p.sku}]` : "";
        return `  ${priority}: ${p.name}${skuPart} — ${stockInfo}`;
      });
    } else {
      restockLines = ["  ✅ Không có sản phẩm nào cần nhập hàng"];
    }

    // Format trend analysis
    let trendLines = [];
    if (data.trendAnalysis.trendingUp.length > 0) {
      const upProducts = data.trendAnalysis.trendingUp.slice(0, 5).map(
        (p) => `  🔥 ${p.name}: +${p.trendPercent}% (TB ${p.avgWeeklyQty}/tuần)`
      );
      trendLines.push(`📈 SP TĂNG TRƯỞNG (${data.trendAnalysis.trendingUp.length}):`);
      trendLines.push(...upProducts);
    }
    if (data.trendAnalysis.trendingDown.length > 0) {
      const downProducts = data.trendAnalysis.trendingDown.slice(0, 5).map(
        (p) => `  📉 ${p.name}: ${p.trendPercent}% (TB ${p.avgWeeklyQty}/tuần)`
      );
      trendLines.push(`📉 SP GIẢM NHU CẦU (${data.trendAnalysis.trendingDown.length}):`);
      trendLines.push(...downProducts);
    }
    if (trendLines.length === 0) {
      trendLines = ["  📊 Chưa có đủ dữ liệu xu hướng"];
    }

    // Format insights
    let insightLines = [];
    if (data.insights.length > 0) {
      insightLines = data.insights.map((ins) => {
        const icon = ins.type === "danger" ? "🚨" : ins.type === "success" ? "✅" : ins.type === "warning" ? "⚠️" : "ℹ️";
        return `  ${icon} ${ins.title}: ${ins.message}`;
      });
    }

    const context = `=== DỰ BÁO NHU CẦU & CẢNH BÁO NHẬP HÀNG ===
(Dữ liệu ${data.dataPeriod.days} ngày gần nhất)

${summaryLines.join("\n")}

🚨 CẢNH BÁO NHẬP HÀNG (${data.summary.restockSkuAlerts ?? data.restockAlerts.length} SKU, hiển thị ${data.restockAlerts.length}):
${restockLines.join("\n")}

📈 XU HƯỚNG BÁN HÀNG:
${trendLines.join("\n")}

💡 INSIGHTS & GỢI Ý:
${insightLines.length > 0 ? insightLines.join("\n") : "  Chưa có insights đáng chú ý"}`;

    return { context };
  } catch (error) {
    console.error("[demandForecast] Tool error:", error);
    return { context: "Không thể lấy dữ liệu dự báo. Vui lòng thử lại sau." };
  }
}

registerTool("demandForecast", {
  description: "Dự báo nhu cầu và cảnh báo nhập hàng cho seller",
  roles: ["seller"],
  keywords: [
    "dự báo", "forecast", "predict", "nhu cầu", "demand",
    "nhập hàng", "restock", "bổ sung", "sắp hết",
    "xu hướng", "trend", "tăng trưởng", "giảm",
    "tồn kho", "inventory", "hết hàng", "out of stock",
    "bán chạy", "bán chậm", "hiệu suất", "performance",
    "tối ưu", "optimize", "đọng vốn",
    "tồn bao lâu", "còn được bao lâu", "ước tính",
    "tuần tới", "tháng tới", "cần bao nhiêu",
  ],
  execute,
});
