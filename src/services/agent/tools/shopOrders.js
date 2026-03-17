import Order from "../../../models/Order.js";
import OrderItem from "../../../models/OrderItem.js";
import Product from "../../../models/Product.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, status }) {
  if (!sellerId) return { context: "Cần sellerId để xem đơn hàng." };

  const sellerProducts = await Product.find({ sellerId }).select("_id").lean();
  const productIds = sellerProducts.map((p) => p._id);

  if (productIds.length === 0) return { context: "Shop chưa có sản phẩm nào." };

  const orderItems = await OrderItem.find({ productId: { $in: productIds } })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("orderId")
    .lean();

  const orderIds = [...new Set(orderItems.map((oi) => oi.orderId.toString()))];

  const orderFilter = { _id: { $in: orderIds } };
  if (status) orderFilter.status = status;

  const orders = await Order.find(orderFilter)
    .sort({ createdAt: -1 })
    .limit(10)
    .select("orderNumber status totalPrice createdAt paymentStatus")
    .lean();

  const statusCounts = {};
  const allOrders = await Order.find({ _id: { $in: orderIds } }).select("status").lean();
  allOrders.forEach((o) => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  });

  const statusSummary = Object.entries(statusCounts)
    .map(([s, c]) => `  ${s}: ${c} đơn`)
    .join("\n");

  const orderLines = orders.map(
    (o) => `${o.orderNumber} | ${o.status} | ${o.totalPrice.toLocaleString("vi-VN")}₫ | ${o.paymentStatus} | ${o.createdAt.toLocaleDateString("vi-VN")}`
  );

  return {
    context: `=== ĐƠN HÀNG CỦA SHOP ===\n📊 Tổng quan:\n${statusSummary}\n\n📋 ${orders.length} đơn gần nhất:\n${orderLines.join("\n")}`,
  };
}

registerTool("shopOrders", {
  description: "Xem đơn hàng của shop (seller)",
  roles: ["seller"],
  keywords: ["đơn hàng", "order", "đơn mới", "đơn chờ", "đơn cần xử lý", "pending order"],
  execute,
});
