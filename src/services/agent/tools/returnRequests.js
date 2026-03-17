import ReturnRequest from "../../../models/ReturnRequest.js";
import OrderItem from "../../../models/OrderItem.js";
import Product from "../../../models/Product.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, status }) {
  if (!sellerId) return { context: "Cần sellerId để xem yêu cầu đổi/trả." };

  const products = await Product.find({ sellerId }).select("_id").lean();
  const productIds = products.map((p) => p._id);

  if (productIds.length === 0) return { context: "Shop chưa có sản phẩm." };

  const orderItems = await OrderItem.find({ productId: { $in: productIds } }).select("orderId").lean();
  const orderIds = [...new Set(orderItems.map((oi) => oi.orderId.toString()))];

  const filter = { orderId: { $in: orderIds }, isActive: true };
  if (status) filter.status = status;

  const requests = await ReturnRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(10)
    .select("requestNumber type reason status items refund exchange createdAt")
    .lean();

  const statusCounts = {};
  const allRequests = await ReturnRequest.find({ orderId: { $in: orderIds }, isActive: true }).select("status").lean();
  allRequests.forEach((r) => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });

  const lines = requests.map((r) => {
    const items = r.items.map((i) => `${i.productName || "SP"} x${i.quantity}`).join(", ");
    return `📋 ${r.requestNumber} | ${r.type} | ${r.reason} | ${r.status} | ${items} | ${r.createdAt.toLocaleDateString("vi-VN")}`;
  });

  const summary = Object.entries(statusCounts).map(([s, c]) => `  ${s}: ${c}`).join("\n");

  return {
    context: `=== YÊU CẦU ĐỔI/TRẢ ===
📊 Tổng quan:
${summary || "  Không có yêu cầu nào"}

📋 ${requests.length} yêu cầu gần nhất:
${lines.join("\n") || "Không có yêu cầu nào."}`,
  };
}

registerTool("returnRequests", {
  description: "Xem yêu cầu đổi/trả hàng của shop",
  roles: ["seller"],
  keywords: ["đổi trả", "return", "hoàn tiền", "refund", "RMA", "exchange", "trả hàng", "khiếu nại"],
  execute,
});
