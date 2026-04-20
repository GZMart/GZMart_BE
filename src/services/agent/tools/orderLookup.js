import Order from "../../../models/Order.js";
import OrderItem from "../../../models/OrderItem.js";
import { registerTool } from "../tools.js";
import { orderHasPreOrderSlaBreach } from "../../../utils/preOrderSla.js";

async function execute({ userId, orderNumber }) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (orderNumber) filter.orderNumber = orderNumber;

  if (!userId && !orderNumber) return { context: "Cần userId hoặc orderNumber để tra cứu đơn hàng." };

  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .limit(5)
    .select("orderNumber status totalPrice shippingCost discount createdAt paymentMethod paymentStatus")
    .lean();

  if (orders.length === 0) return { context: "Không tìm thấy đơn hàng nào." };

  const statusMap = {
    pending: "⏳ Chờ xác nhận", confirmed: "✅ Đã xác nhận",
    packing: "📦 Đang đóng gói", shipping: "🚚 Đang giao",
    delivered: "📬 Đã giao", completed: "✅ Hoàn thành",
    cancelled: "❌ Đã hủy", refunded: "💸 Đã hoàn tiền",
  };

  const orderLines = await Promise.all(orders.map(async (o) => {
    const items = await OrderItem.find({ orderId: o._id })
      .populate("productId", "name")
      .select(
        "productId quantity price isPreOrder preOrderDaysSnapshot estimatedShipBy",
      )
      .lean();

    const itemLines = items.map((i) => {
      const base = `  - ${i.productId?.name || "SP"} x${i.quantity} — ${i.price.toLocaleString("vi-VN")}₫`;
      if (!i.isPreOrder) return base;
      const ship =
        i.estimatedShipBy != null
          ? new Date(i.estimatedShipBy).toLocaleDateString("vi-VN")
          : `${i.preOrderDaysSnapshot ?? 0} ngày (snapshot)`;
      return `${base} [Đặt trước — giao trước ${ship}]`;
    });

    const breach = orderHasPreOrderSlaBreach(o.status, items);
    const breachNote = breach ? "\n  ⚠️ Có mặt hàng đặt trước đã quá hạn giao dự kiến." : "";

    return `📋 ${o.orderNumber} | ${statusMap[o.status] || o.status} | ${o.totalPrice.toLocaleString("vi-VN")}₫ | ${o.createdAt.toLocaleDateString("vi-VN")}\n${itemLines.join("\n")}${breachNote}`;
  }));

  return { context: `=== ĐƠN HÀNG GẦN NHẤT (${orders.length}) ===\n${orderLines.join("\n\n")}` };
}

registerTool("orderLookup", {
  description: "Tra cứu đơn hàng của người dùng",
  roles: ["buyer"],
  keywords: ["đơn hàng", "order", "tra cứu đơn", "đơn của tôi", "giao hàng", "shipping", "theo dõi đơn"],
  execute,
});
