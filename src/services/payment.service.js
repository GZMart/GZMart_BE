import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import User from "../models/User.js";
import TopupRequest from "../models/TopupRequest.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../templates/email.templates.js";
import payOs, { isPayOsConfigured } from "../config/payos.config.js";
import coinService from "./coin.service.js";
import * as orderTrackingService from "./orderTracking.service.js";
import {
  deductOrderResourcesFromOrder,
  clearUserCart,
} from "../utils/orderInventory.js";

const PAYOS_TEST_FIXED_AMOUNT = 2000;

const isAmountValidForPayOs = (paidAmount, expectedAmount) => {
  if (!Number.isFinite(paidAmount)) {
    return true;
  }
  const roundedPaid = Math.round(paidAmount);
  const roundedExpected = Math.round(expectedAmount);
  // Allow fixed amount 2000 for current test flow.
  return (
    roundedPaid === roundedExpected || roundedPaid === PAYOS_TEST_FIXED_AMOUNT
  );
};

class PaymentService {
  /**
   * Create PayOS payment link for order
   */
  async createPaymentLink(orderId, userId) {
    if (!isPayOsConfigured()) {
      throw new ErrorResponse(
        "Hệ thống thanh toán PayOS chưa được cấu hình. Vui lòng chọn COD hoặc cấu hình PAYOS_CLIENT_ID/PAYOS_API_KEY/PAYOS_CHECKSUM_KEY.",
        503,
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
      // amount: Math.round(order.totalPrice),
      amount: 2000, // TODO: temp fix for testing
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
    console.log("[Webhook] ========== START ==========");
    console.log(
      "[Webhook] Received data:",
      JSON.stringify(webhookData, null, 2),
    );

    if (!isPayOsConfigured()) {
      console.error("[Webhook] PayOS not configured!");
      throw new ErrorResponse("PayOS not configured on server", 500);
    }

    // Verify webhook signature using PayOS SDK
    let verifiedData;
    try {
      console.log("[Webhook] Verifying webhook signature...");
      verifiedData = await payOs.webhooks.verify(webhookData);
      console.log("[Webhook] Verification successful!");
      console.log(
        "[Webhook] Verified data:",
        JSON.stringify(verifiedData, null, 2),
      );
    } catch (verifyError) {
      console.error(
        "[Webhook] Signature verification failed:",
        verifyError.message,
      );
      throw new ErrorResponse("Invalid webhook signature", 403);
    }

    // Extract payment information from verified data
    const paymentCode = verifiedData.code || "";
    const paymentDesc = verifiedData.desc || "";
    console.log("[Webhook] Payment code:", paymentCode, "desc:", paymentDesc);

    if (paymentCode !== "00" || paymentDesc !== "success") {
      console.warn("[Webhook] Payment not successful, skipping");
      return { processed: false, reason: "Payment not successful" };
    }

    const orderCode = verifiedData.orderCode.toString();
    console.log("[Webhook] OrderCode from PayOS:", orderCode);

    const order = await Order.findOne({ payosOrderCode: orderCode }).populate(
      "items",
    );

    if (!order) {
      console.log(
        "[Webhook] Order not found for orderCode:",
        orderCode,
        "Checking TopupRequest...",
      );
      const topup = await TopupRequest.findOne({ orderCode });
      if (topup) {
        if (topup.status !== "pending") {
          console.log("[Webhook] Topup already processed, skipping");
          return { processed: false, reason: "Topup already processed" };
        }

        const topupPaidAmount = Number(verifiedData.amount);
        if (!isAmountValidForPayOs(topupPaidAmount, topup.amount)) {
          console.warn("[Webhook] Topup amount mismatch, skipping", {
            orderCode,
            expected: Math.round(topup.amount),
            actual: Math.round(topupPaidAmount),
          });
          return { processed: false, reason: "Topup amount mismatch" };
        }

        console.log("[Webhook] Updating TopupRequest to completed...");
        topup.status = "completed";
        await topup.save();

        console.log("[Webhook] Adding coins to wallet...");
        await coinService.addCoins({
          userId: topup.userId,
          source: "topup",
          amount: topup.coinAmount,
          description: `Nạp ${topup.coinAmount} xu qua PayOS (TGD: ${orderCode})`,
          sourceTransaction: {},
          metadata: { payosOrderCode: orderCode, topupRequestId: topup._id },
        });

        console.log("[Webhook] Wallet topup successful");
        return {
          processed: true,
          orderCode: orderCode,
          isTopup: true,
        };
      }

      console.error(
        "[Webhook] No Order or TopupRequest found for orderCode:",
        orderCode,
      );
      throw new ErrorResponse("Order or TopupRequest not found", 404);
    }

    console.log("[Webhook] Order found:", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentPaymentStatus: order.paymentStatus,
    });

    if (order.paymentStatus !== "pending") {
      console.log("[Webhook] Order already processed, skipping");
      return {
        processed: false,
        reason: "Order already processed",
        orderNumber: order.orderNumber,
      };
    }

    const paidAmount = Number(verifiedData.amount);
    if (!isAmountValidForPayOs(paidAmount, order.totalPrice)) {
      console.warn("[Webhook] Amount mismatch, skipping payment confirmation", {
        orderCode,
        expected: Math.round(order.totalPrice),
        actual: Math.round(paidAmount),
      });
      return { processed: false, reason: "Payment amount mismatch" };
    }

    console.log("[Webhook] Updating order to PAID status...");
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

    order.status = "pending";

    order.statusHistory.push({
      status: "pending",
      changedBy: order.userId,
      changedByRole: "system",
      changedAt: new Date(),
      reason: "Thanh toán thành công qua PayOS",
      notes: `PayOS OrderCode: ${orderCode}. Chờ seller xử lý đơn hàng.`,
    });

    await order.save();
    console.log("[Webhook] Order saved successfully");

    orderTrackingService.notifyBuyerStatusChange(
      order._id.toString(),
      "pending",
      {
        orderNumber: order.orderNumber,
        buyerId: order.userId,
        sellerId: order.sellerId,
        updatedAt: new Date(),
        notes:
          "Thanh toán PayOS thành công, đơn ở trạng thái pending chờ seller xử lý",
      },
    );

    // CRITICAL FIX: Deduct inventory, vouchers, and flash sales AFTER payment confirmed
    console.log(
      "[Webhook] Deducting resources (inventory/vouchers/flash sales)...",
    );
    try {
      await deductOrderResourcesFromOrder(order);
      console.log("[Webhook] Resources deducted successfully");
    } catch (deductError) {
      console.error("[Webhook] Error deducting resources:", deductError);
      // Don't fail the webhook, but log the error for manual intervention
    }

    console.log("[Webhook] Clearing cart...");
    try {
      await clearUserCart(order.userId);
      console.log("[Webhook] Cart cleared successfully");
    } catch (cartError) {
      console.error("[Webhook] Error clearing cart:", cartError);
      // Non-critical - cart can be cleared later by user or timeout job
    }

    console.log("[Webhook] Sending confirmation email...");
    await this.sendOrderConfirmationEmail(order);

    const result = {
      processed: true,
      orderNumber: order.orderNumber,
      orderCode: orderCode,
    };

    console.log("[Webhook] Result:", result);
    console.log("[Webhook] ========== END ==========");
    return result;
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
    const order = await Order.findOne({ payosOrderCode: orderCode }).populate(
      "items",
    );

    if (!order) {
      throw new ErrorResponse("Không tìm thấy đơn hàng", 404);
    }

    if (order.userId.toString() !== userId.toString()) {
      throw new ErrorResponse("Bạn không có quyền hủy đơn hàng này", 403);
    }

    if (order.paymentStatus !== "pending") {
      throw new ErrorResponse("Không thể hủy đơn hàng đã thanh toán", 400);
    }

    // CRITICAL FIX: Rollback resources if they were already deducted (shouldn't happen for PayOS, but safety check)
    if (order.resourcesDeducted) {
      console.log(
        `[Payment] Rolling back resources for cancelled order ${order.orderNumber}`,
      );
      const { rollbackOrderResources } =
        await import("../utils/orderInventory.js");
      await rollbackOrderResources(order);
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
    console.log("[PayOS Check] ========== START ==========");
    console.log("[PayOS Check] OrderCode:", orderCode);
    console.log("[PayOS Check] UserId:", userId);

    if (!isPayOsConfigured()) {
      console.error("[PayOS Check] PayOS not configured!");
      throw new ErrorResponse(
        "Hệ thống thanh toán PayOS chưa được cấu hình",
        500,
      );
    }

    const order = await Order.findOne({ payosOrderCode: orderCode }).populate(
      "items",
    );

    if (!order) {
      console.error("[PayOS Check] Order not found for orderCode:", orderCode);
      throw new ErrorResponse("Không tìm thấy đơn hàng", 404);
    }

    console.log("[PayOS Check] Order found:", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      currentPaymentStatus: order.paymentStatus,
      currentOrderStatus: order.status,
    });

    if (order.userId.toString() !== userId.toString()) {
      console.error("[PayOS Check] Unauthorized access attempt");
      throw new ErrorResponse("Bạn không có quyền truy cập đơn hàng này", 403);
    }

    try {
      console.log(
        "[PayOS Check] Calling PayOS API with orderCode:",
        parseInt(orderCode),
      );
      const paymentInfo = await payOs.paymentRequests.get(parseInt(orderCode));
      console.log("[PayOS Check] PayOS Response:", {
        status: paymentInfo.status,
        amount: paymentInfo.amount,
        orderCode: paymentInfo.orderCode,
      });

      const paidAmount = Number(paymentInfo.amount);
      const expectedAmount = Math.round(order.totalPrice);
      if (!isAmountValidForPayOs(paidAmount, expectedAmount)) {
        throw new ErrorResponse(
          `Sai lệch số tiền thanh toán PayOS. expected=${expectedAmount}, actual=${Math.round(paidAmount)}`,
          409,
        );
      }

      if (
        Number.isFinite(paymentInfo.orderCode) &&
        Number(paymentInfo.orderCode) !== Number(orderCode)
      ) {
        throw new ErrorResponse("Sai lệch orderCode từ PayOS", 409);
      }

      // If PayOS shows PAID but local DB is still pending, update it
      if (paymentInfo.status === "PAID" && order.paymentStatus === "pending") {
        console.log(
          "[PayOS Check] Payment status mismatch detected! Updating order...",
        );
        console.log("[PayOS Check] Before update:", {
          paymentStatus: order.paymentStatus,
          status: order.status,
        });

        order.paymentStatus = "paid";
        order.paymentDate = new Date();
        order.status = "pending";

        order.statusHistory.push({
          status: "pending",
          changedBy: order.userId,
          changedByRole: "system",
          changedAt: new Date(),
          reason: "Thanh toán thành công qua PayOS (manual check)",
          notes: `PayOS OrderCode: ${orderCode}. Chờ seller xử lý đơn hàng.`,
        });

        await order.save();
        console.log("[PayOS Check] Order updated successfully!");
        console.log("[PayOS Check] After update:", {
          paymentStatus: order.paymentStatus,
          status: order.status,
        });

        orderTrackingService.notifyBuyerStatusChange(
          order._id.toString(),
          "pending",
          {
            orderNumber: order.orderNumber,
            buyerId: order.userId,
            sellerId: order.sellerId,
            updatedAt: new Date(),
            notes: "Thanh toán PayOS xác nhận qua manual check, đơn ở pending",
          },
        );

        // CRITICAL FIX: Deduct resources after payment confirmed
        console.log("[PayOS Check] Deducting resources...");
        try {
          await deductOrderResourcesFromOrder(order);
          console.log("[PayOS Check] Resources deducted successfully");
        } catch (deductError) {
          console.error(
            "[PayOS Check] Error deducting resources:",
            deductError,
          );
        }

        console.log("[PayOS Check] Clearing cart for userId:", order.userId);
        try {
          await clearUserCart(order.userId);
          console.log("[PayOS Check] Cart cleared successfully");
        } catch (cartError) {
          console.error("[PayOS Check] Error clearing cart:", cartError);
          // Non-critical - cart can be cleared later by user
        }

        console.log("[PayOS Check] Sending confirmation email...");
        await this.sendOrderConfirmationEmail(order);
        console.log("[PayOS Check] Email sent successfully");
      } else {
        console.log("[PayOS Check] No update needed:", {
          payosStatus: paymentInfo.status,
          localStatus: order.paymentStatus,
        });
      }

      const result = {
        orderNumber: order.orderNumber,
        localPaymentStatus: order.paymentStatus,
        payosPaymentInfo: paymentInfo,
        updated:
          paymentInfo.status === "PAID" && order.paymentStatus === "paid",
      };

      console.log("[PayOS Check] Result:", result);
      console.log("[PayOS Check] ========== END ==========");
      return result;
    } catch (error) {
      console.error("[PayOS Check] ========== ERROR ==========");
      console.error("[PayOS Check] Error message:", error.message);
      console.error("[PayOS Check] Error stack:", error.stack);
      console.error("[PayOS Check] Full error:", error);
      if (error instanceof ErrorResponse) {
        throw error;
      }
      throw new ErrorResponse("Không thể kiểm tra trạng thái từ PayOS", 500);
    }
  }

  /**
   * Clear cart after successful payment
   */
  async clearCartAfterPayment(userId) {
    console.log("[Cart Service] ========== START ==========");
    console.log("[Cart Service] Clearing cart for userId:", userId);
    try {
      const cart = await Cart.findOne({ userId });
      if (cart) {
        console.log("[Cart Service] Cart found:", {
          cartId: cart._id,
          itemsCount: cart.totalPrice,
        });
        const deletedCount = await CartItem.deleteMany({ cartId: cart._id });
        console.log(
          "[Cart Service] Deleted cart items:",
          deletedCount.deletedCount,
        );
        cart.totalPrice = 0;
        await cart.save();
        console.log(`[Cart Service] Cart cleared successfully for ${userId}`);
      } else {
        console.log("[Cart Service] No cart found for userId:", userId);
      }
      console.log("[Cart Service] ========== END ==========");
    } catch (error) {
      console.error("[Cart Service] ========== ERROR ==========");
      console.error(`[Cart Service] Error message:`, error.message);
      console.error(`[Cart Service] Error stack:`, error.stack);
    }
  }

  /**
   * Send order confirmation email
   */
  async sendOrderConfirmationEmail(order) {
    console.log("[Email Service] ========== START ==========");
    console.log(
      "[Email Service] Sending confirmation for order:",
      order.orderNumber,
    );
    try {
      const user = await User.findById(order.userId).select("fullName email");
      console.log("[Email Service] User found:", {
        userId: order.userId,
        email: user?.email,
        fullName: user?.fullName,
      });

      if (!user || !user.email) {
        console.warn("[Email Service] No user email found, skipping email");
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

      console.log(
        "[Email Service] Email content prepared, sending to:",
        user.email,
      );
      await sendEmail({
        email: user.email,
        subject: emailTemplates.ORDER_CONFIRMATION.subject,
        message: emailContent,
      });

      console.log(`[Email Service] Email sent successfully to ${user.email}`);
      console.log("[Email Service] ========== END ==========");
    } catch (error) {
      console.error("[Email Service] ========== ERROR ==========");
      console.error(`[Email Service] Email error message:`, error.message);
      console.error(`[Email Service] Error stack:`, error.stack);
      console.error(`[Email Service] Full error:`, error);
    }
  }

  /**
   * Create PayOS payment link for wallet top-up
   */
  async createTopupLink(userId, amount, coinAmount, options = {}) {
    if (!payOs) {
      throw new ErrorResponse(
        "Hệ thống thanh toán PayOS chưa được cấu hình",
        500,
      );
    }

    // Must be positive number to avoid overlap with real orders or limits.
    const orderCode = parseInt(
      "9" +
        Date.now().toString().slice(0, 8) +
        Math.floor(Math.random() * 1000),
    );
    const user = await User.findById(userId);
    const buyerName = user.fullName || user.email.split("@")[0];
    const description = `Nap ${coinAmount} xu`;

    const returnPath = options?.returnPath || "/seller/banner-ads";

    const payosOrder = {
      // amount: Math.round(amount),
      amount: 2000, // TODO: temp fix for testing
      description: description.substring(0, 25),
      orderCode: orderCode,
      returnUrl: `${process.env.FRONTEND_URL}${returnPath}`,
      cancelUrl: `${process.env.FRONTEND_URL}${returnPath}`,
      buyerName: buyerName,
      buyerEmail: user.email,
    };

    try {
      const paymentLinkResponse =
        await payOs.paymentRequests.create(payosOrder);

      const topup = new TopupRequest({
        userId,
        amount,
        coinAmount,
        orderCode: orderCode.toString(),
        payosCheckoutUrl: paymentLinkResponse.checkoutUrl,
        payosQrCode: paymentLinkResponse.qrCode || "",
        payosPaymentLinkId: paymentLinkResponse.paymentLinkId || "",
      });
      await topup.save();

      return {
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
      console.error("Lỗi khi tạo link nạp xu PayOS:", error);
      throw new ErrorResponse(
        "Không thể tạo link nạp xu. Vui lòng thử lại sau.",
        500,
      );
    }
  }

  /**
   * Check Topup PayOS Status
   */
  async checkTopupStatus(orderCode, userId) {
    if (!payOs) {
      throw new ErrorResponse(
        "Hệ thống thanh toán PayOS chưa được cấu hình",
        500,
      );
    }

    const topup = await TopupRequest.findOne({ orderCode });
    if (!topup) {
      throw new ErrorResponse("Không tìm thấy giao dịch nạp xu", 404);
    }

    if (topup.userId.toString() !== userId.toString()) {
      throw new ErrorResponse("Bạn không có quyền truy cập", 403);
    }

    try {
      const paymentInfo = await payOs.paymentRequests.get(parseInt(orderCode));

      const paidAmount = Number(paymentInfo.amount);
      if (!isAmountValidForPayOs(paidAmount, topup.amount)) {
        throw new ErrorResponse(
          `Sai lệch số tiền topup PayOS. expected=${Math.round(topup.amount)}, actual=${Math.round(paidAmount)}`,
          409,
        );
      }

      if (
        Number.isFinite(paymentInfo.orderCode) &&
        Number(paymentInfo.orderCode) !== Number(orderCode)
      ) {
        throw new ErrorResponse("Sai lệch orderCode topup từ PayOS", 409);
      }

      if (paymentInfo.status === "PAID" && topup.status === "pending") {
        topup.status = "completed";
        await topup.save();

        await coinService.addCoins({
          userId: topup.userId,
          source: "topup",
          amount: topup.coinAmount,
          description: `Nạp ${topup.coinAmount} xu qua PayOS (TGD: ${orderCode})`,
          sourceTransaction: {},
          metadata: { payosOrderCode: orderCode, topupRequestId: topup._id },
        });
      }

      return {
        status: topup.status,
        payosPaymentInfo: paymentInfo,
        updated: paymentInfo.status === "PAID" && topup.status === "completed",
      };
    } catch (error) {
      console.error("Error checking topup status:", error);
      throw new ErrorResponse("Không thể kiểm tra trạng thái từ PayOS", 500);
    }
  }
}

const paymentService = new PaymentService();
export default paymentService;
