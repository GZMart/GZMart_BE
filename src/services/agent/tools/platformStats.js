import * as dashboardService from "../../dashboard.service.js";
import { registerTool } from "../tools.js";

async function execute() {
  const [overview, quickStats, topProducts, recentOrders] = await Promise.all([
    dashboardService.getOverviewStats(),
    dashboardService.getQuickStats(),
    dashboardService.getTopProducts(5),
    dashboardService.getRecentOrders(5),
  ]);

  const overviewLines = overview.map(
    (o) => `${o.title}: ${typeof o.value === "number" ? o.value.toLocaleString("vi-VN") : o.value} (${o.isPositive ? "+" : ""}${o.trend}% so với tháng trước)`
  );

  const topLines = topProducts.map(
    (p, i) => `${i + 1}. ${p.name} — ${p.sold} bán, ${p.revenue.toLocaleString("vi-VN")}₫`
  );

  const orderLines = recentOrders.map(
    (o) => `${o.orderId} | ${o.customer} | ${typeof o.total === "number" ? o.total.toLocaleString("vi-VN") : o.total}₫ | ${o.status}`
  );

  return {
    context: `=== TỔNG QUAN HỆ THỐNG GZMART ===
📊 Overview:
${overviewLines.join("\n")}

⚡ Quick Stats:
  Đơn chờ xử lý: ${quickStats.pendingOrders}
  SP sắp hết hàng: ${quickStats.lowStockItems}
  User mới hôm nay: ${quickStats.newUsersToday}
  Customer Satisfaction: ${quickStats.customerSatisfaction}

🏆 Top sản phẩm:
${topLines.join("\n")}

📋 Đơn hàng gần nhất:
${orderLines.join("\n")}`,
  };
}

registerTool("platformStats", {
  description: "Tổng quan hệ thống (admin only)",
  roles: ["admin"],
  keywords: ["tổng quan", "overview", "hệ thống", "platform", "toàn bộ", "dashboard"],
  execute,
});
