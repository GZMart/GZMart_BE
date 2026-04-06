import * as dashboardService from "../../dashboard.service.js";
import { registerTool } from "../tools.js";

async function execute() {
  const data = await dashboardService.getCategorySales();

  const lines = data.map(
    (c) => `  ${c.name}: ${c.sales.toLocaleString("vi-VN")}₫ (${c.percentage}%)`
  );

  return { context: `=== DOANH THU THEO DANH MỤC ===\n${lines.join("\n")}` };
}

registerTool("categorySales", {
  description: "Phân bổ doanh thu theo danh mục (admin only)",
  roles: ["admin"],
  keywords: ["danh mục", "category", "phân bổ", "distribution"],
  execute,
});
