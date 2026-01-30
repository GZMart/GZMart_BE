import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../templates/email.templates.js";
import payOs from "../config/payos.config.js";

class PaymentService {
  /**
   * Create PayOS payment link for order
   */
  async createPaymentLink(orderId, userId) {
    if (!payOs) {
      throw new ErrorResponse(
        "Hệ thống thanh toán PayOS chưa được cấu hình",
        500,
      );
    }

    const order = await Order.findById(orderId).populate({
      path: "items",
      populate: {
        path: "productId",
        select: "name",
      },
    });

    if (!order) {
      throw new ErrorResponse("Không tìm thấy đơn hàng", 404);
    }

    if (order.userId.toString() !== userId.toString()) {
      throw new ErrorResponse(
        "Bạn không có quyền thanh toán đơn hàng này",
        403,
      );
    }

    if (order.paymentStatus === "paid") {
      throw new ErrorResponse("Đơn hàng đã được thanh toán", 400);
    }

    if (order.status === "cancelled") {
      throw new ErrorResponse("Đơn hàng đã bị hủy", 400);
    }

    const orderCode = parseInt(
      Date.now().toString() + Math.floor(Math.random() * 1000),
    );

    const user = await User.findById(userId);
    const buyerName = user.fullName || user.email.split("@")[0];
    const description = `GZMart #${order.orderNumber}`;

    const payosOrder = {
      amount: Math.round(order.totalPrice),
      description: description.substring(0, 25),
      orderCode: orderCode,
      returnUrl: `${process.env.FRONTEND_URL}/buyer/payment/success?orderCode=${orderCode}`,
      cancelUrl: `${process.env.FRONTEND_URL}/buyer/payment/cancelled?orderCode=${orderCode}`,
      buyerName: buyerName,
      buyerEmail: user.email,
    };

    try {
      const paymentLinkResponse =
        await payOs.paymentRequests.create(payosOrder);

      order.payosOrderCode = orderCode.toString();
      order.payosPaymentLinkId = paymentLinkResponse.paymentLinkId || "";
      order.payosCheckoutUrl = paymentLinkResponse.checkoutUrl;
      order.payosQrCode = paymentLinkResponse.qrCode || "";
      order.payosAccountNumber = paymentLinkResponse.accountNumber || "";
      order.payosAccountName = paymentLinkResponse.accountName || "";
      order.payosBin = paymentLinkResponse.bin || "";
      order.payosDesc = paymentLinkResponse.description || description;
      order.paymentMethod = "payos";

      await order.save();

      return {
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderCode: orderCode,
        checkoutUrl: paymentLinkResponse.checkoutUrl,
        qrData: {
          accountNumber: paymentLinkResponse.accountNumber,
          accountName: paymentLinkResponse.accountName,
          amount: paymentLinkResponse.amount,
          description: paymentLinkResponse.description,
          bin: paymentLinkResponse.bin,
          qrCode: paymentLinkResponse.qrCode,
        },
      };
    } catch (error) {
      console.error("Lỗi khi tạo link thanh toán PayOS:", error);
      throw new ErrorResponse(
        "Không thể tạo link thanh toán. Vui lòng thử lại sau.",
        500,
      );
    }
  }

  /**
   * Process PayOS webhook data
   */
  async processWebhook(webhookData) {
    if (!payOs) {
      throw new ErrorResponse("PayOS not configured on server", 500);
    }

    const isValidSignature = payOs.verifyPaymentWebhookData(webhookData);

    if (!isValidSignature) {
      throw new ErrorResponse("Invalid webhook signature", 403);
    }

    const { code, desc, data } = webhookData;
    const verifiedData = data;

    if (code !== "00" || desc !== "success") {
      return { processed: false, reason: "Payment not successful" };
    }

    const orderCode = verifiedData.orderCode.toString();

    const order = await Order.findOne({ payosOrderCode: orderCode }).populate(
      "items",
    );

    if (!order) {
      throw new ErrorResponse("Order not found", 404);
    }

    if (order.paymentStatus !== "pending") {
      return {
        processed: false,
        reason: "Order already processed",
        orderNumber: order.orderNumber,
      };
    }

    order.paymentStatus = "paid";
    order.paymentDate = new Date();
    order.payosTransactionDateTime =
      verifiedData.transactionDateTime || new Date().toISOString();
    order.payosReference = verifiedData.reference || "";
    order.payosCode = verifiedData.code || "";
    order.payosDesc = verifiedData.desc || "";

    if (verifiedData.counterAccountBankId) {
      order.payosCounterAccountBankId = verifiedData.counterAccountBankId;
    }
    if (verifiedData.counterAccountBankName) {
      order.payosCounterAccountBankName = verifiedData.counterAccountBankName;
    }
    if (verifiedData.counterAccountName) {
      order.payosCounterAccountName = verifiedData.counterAccountName;
    }
    if (verifiedData.counterAccountNumber) {
      order.payosCounterAccountNumber = verifiedData.counterAccountNumber;
    }

    order.status = "processing";

    order.statusHistory.push({
      status: "processing",
      changedBy: order.userId,
      changedByRole: "system",
      changedAt: new Date(),
      reason: "Thanh toán thành công qua PayOS",
      notes: `PayOS OrderCode: ${orderCode}`,
    });

    await order.save();

    await this.clearCartAfterPayment(order.userId);
    await this.sendOrderConfirmationEmail(order);

    return {
      processed: true,
      orderNumber: order.orderNumber,
      orderCode: orderCode,
    };
  }

  /**
   * Get payment status by orderCode
   */
  async getPaymentStatus(orderCode, userId) {
    const order = await Order.findOne({ payosOrderCode: orderCode });

    if (!order) {
      throw new ErrorResponse("Không tìm thấy đơn hàng", 404);
    }

    if (order.userId.toString() !== userId.toString()) {
      throw new ErrorResponse("Bạn không có quyền truy cập đơn hàng này", 403);
    }

    return {
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      orderStatus: order.status,
      totalPrice: order.totalPrice,
      paymentDate: order.paymentDate,
    };
  }

  /**
   * Cancel payment for pending order
   */
  async cancelPayment(orderCode, userId) {
    const order = await Order.findOne({ payosOrderCode: orderCode });

    if (!order) {
      throw new ErrorResponse("Không tìm thấy đơn hàng", 404);
    }

    if (order.userId.toString() !== userId.toString()) {
      throw new ErrorResponse("Bạn không có quyền hủy đơn hàng này", 403);
    }

    if (order.paymentStatus !== "pending") {
      throw new ErrorResponse("Không thể hủy đơn hàng đã thanh toán", 400);
    }

    order.status = "cancelled";
    order.paymentStatus = "failed";
    order.cancelledAt = new Date();
    order.cancellationReason = "Người dùng hủy thanh toán";

    order.statusHistory.push({
      status: "cancelled",
      changedBy: userId,
      changedByRole: "buyer",
      changedAt: new Date(),
      reason: "Người dùng hủy thanh toán PayOS",
    });

    await order.save();

    return {
      orderNumber: order.orderNumber,
      status: order.status,
    };
  }

  /**
   * Check payment status from PayOS API
   */
  async checkPayOsStatus(orderCode, userId) {
    if (!payOs) {
      throw new ErrorResponse(
        "Hệ thống thanh toán PayOS chưa được cấu hình",
        500,
      );
    }

    const order = await Order.findOne({ payosOrderCode: orderCode });

    if (!order) {
      throw new ErrorResponse("Không tìm thấy đơn hàng", 404);
    }

    if (order.userId.toString() !== userId.toString()) {
      throw new ErrorResponse("Bạn không có quyền truy cập đơn hàng này", 403);
    }

    try {
      const paymentInfo = await payOs.paymentRequests.get(parseInt(orderCode));

      return {
        orderNumber: order.orderNumber,
        localPaymentStatus: order.paymentStatus,
        payosPaymentInfo: paymentInfo,
      };
    } catch (error) {
      console.error("[PayOS Check] Error:", error);
      throw new ErrorResponse("Không thể kiểm tra trạng thái từ PayOS", 500);
    }
  }

  /**
   * Clear cart after successful payment
   */
  async clearCartAfterPayment(userId) {
    try {
      const cart = await Cart.findOne({ userId });
      if (cart) {
        await CartItem.deleteMany({ cartId: cart._id });
        cart.totalPrice = 0;
        await cart.save();
        console.log(`[Payment Service] Cart cleared: ${userId}`);
      }
    } catch (error) {
      console.error(`[Payment Service] Cart clear error:`, error.message);
    }
  }

  /**
   * Send order confirmation email
   */
  async sendOrderConfirmationEmail(order) {
    try {
      const user = await User.findById(order.userId).select("fullName email");
      if (!user || !user.email) {
        return;
      }

      const populatedOrder = await Order.findById(order._id).populate({
        path: "items",
        populate: {
          path: "productId",
          select: "name",
        },
      });

      const itemsHtml = populatedOrder.items
        .map((item) => {
          const productName = item.productId?.name || "Sản phẩm";
          const price = new Intl.NumberFormat("vi-VN", {
            style: "currency",
            currency: "VND",
          }).format(item.price);
          const subtotal = new Intl.NumberFormat("vi-VN", {
            style: "currency",
            currency: "VND",
          }).format(item.subtotal);

          return `
            <div style="border-bottom: 1px solid #e0e0e0; padding: 10px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span style="color: #2c3e50; font-weight: 500;">${productName}</span>
                <span style="color: #e74c3c; font-weight: bold;">${subtotal}</span>
              </div>
              <div style="color: #7f8c8d; font-size: 14px;">
                ${price} x ${item.quantity}
                ${
                  item.tierSelections
                    ? Object.entries(item.tierSelections)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(", ")
                    : ""
                }
              </div>
            </div>
          `;
        })
        .join("");

      const emailContent = emailTemplates.ORDER_CONFIRMATION.getContent({
        name: user.fullName || "Khách hàng",
        orderNumber: order.orderNumber,
        orderDate: new Date(order.createdAt).toLocaleDateString("vi-VN"),
        totalPrice: new Intl.NumberFormat("vi-VN", {
          style: "currency",
          currency: "VND",
        }).format(order.totalPrice),
        items: itemsHtml,
        shippingAddress: order.shippingAddress,
      });

      await sendEmail({
        email: user.email,
        subject: emailTemplates.ORDER_CONFIRMATION.subject,
        message: emailContent,
      });

      console.log(`[Payment Service] Email sent to ${user.email}`);
    } catch (error) {
      console.error(`[Payment Service] Email error:`, error.message);
    }
  }
}

const paymentService = new PaymentService();
export default paymentService;
