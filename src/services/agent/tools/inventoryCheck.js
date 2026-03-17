import mongoose from "mongoose";
import * as dashboardService from "../../dashboard.service.js";
import Product from "../../../models/Product.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, threshold = 20 }) {
  if (!sellerId) return { context: "Cần sellerId để kiểm tra tồn kho." };

  const sellerOid = new mongoose.Types.ObjectId(sellerId);

  const [lowStock, allInventory] = await Promise.all([
    dashboardService.getLowStockProducts(sellerId, threshold, 10),
    Product.aggregate([
      { $match: { sellerId: sellerOid } },
      { $unwind: "$models" },
      { $match: { "models.isActive": true } },
      { $group: {
        _id: null,
        totalProducts: { $addToSet: "$_id" },
        totalStock: { $sum: "$models.stock" },
        totalVariants: { $sum: 1 },
      }},
      { $project: {
        totalProducts: { $size: "$totalProducts" },
        totalStock: 1,
        totalVariants: 1,
      }},
    ]),
  ]);

  const summary = allInventory[0] || { totalProducts: 0, totalStock: 0, totalVariants: 0 };

  const lowStockLines = lowStock.map(
    (p) => `⚠️ ${p.name} — còn ${p.stock} SP (${p.activeModels} biến thể active)`
  );

  const context = `=== TÌNH TRẠNG TỒN KHO ===
📦 Tổng sản phẩm: ${summary.totalProducts}
📦 Tổng biến thể: ${summary.totalVariants}
📦 Tổng tồn kho: ${summary.totalStock}

${lowStockLines.length > 0
    ? `🚨 SẢN PHẨM SẮP HẾT HÀNG (dưới ${threshold} SP):\n${lowStockLines.join("\n")}`
    : "✅ Không có sản phẩm nào sắp hết hàng"}`;

  return { context };
}

registerTool("inventoryCheck", {
  description: "Kiểm tra tồn kho, cảnh báo sản phẩm sắp hết hàng",
  roles: ["seller"],
  keywords: [
    "tồn kho", "inventory", "stock", "kho",
    "hết hàng", "sắp hết", "low stock", "out of stock",
    "còn bao nhiêu", "số lượng còn", "nhập hàng",
  ],
  execute,
});
