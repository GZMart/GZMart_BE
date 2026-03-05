import mongoose from "mongoose";
import ReturnRequest from "../models/ReturnRequest.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import User from "../models/User.js";
import InventoryItem from "../models/InventoryItem.js";
import { rollbackOrderResources } from "../utils/orderInventory.js";

/**
 * RMA Service - Return Merchandise Authorization
 * Handles refund and exchange requests
 */

/**
 * Create a return/exchange request
 */
export const createReturnRequest = async (data) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { orderId, userId, type, reason, description, images, items } = data;

    // 1. Check eligibility
    const eligibility = await ReturnRequest.checkEligibility(orderId);
    if (!eligibility.isEligible) {
      throw new Error(eligibility.reason);
    }

    // 2. Get order details
    const order = await Order.findById(orderId)
      .populate("items")
      .session(session);

    if (order.userId.toString() !== userId.toString()) {
      throw new Error("You don't have permission to return this order");
    }

    // 3. Validate items
    const validatedItems = [];
    let totalRefundAmount = 0;

    for (const item of items) {
      const orderItem = await OrderItem.findById(item.orderItemId).session(
        session,
      );
      if (!orderItem) {
        throw new Error(`Order item not found: ${item.orderItemId}`);
      }

      // Validate quantity
      if (item.quantity > orderItem.quantity) {
        throw new Error(
          `Invalid quantity for ${orderItem.productName}. Max: ${orderItem.quantity}`,
        );
      }

      // Calculate refund amount (proportional if partial return)
      const itemRefundAmount =
        (orderItem.finalPrice || orderItem.price) *
        (item.quantity / orderItem.quantity);
      totalRefundAmount += itemRefundAmount;

      validatedItems.push({
        orderItemId: item.orderItemId,
        productId: orderItem.productId,
        productName: orderItem.productName,
        variantName: orderItem.variantName,
        quantity: item.quantity,
        price: orderItem.finalPrice || orderItem.price,
        exchangeToVariantId: item.exchangeToVariantId,
        exchangeToVariantName: item.exchangeToVariantName,
      });
    }

    // 4. Calculate shipping cost responsibility
    const returnShipping = calculateReturnShippingCost(
      reason,
      order.shippingCost,
    );

    // 5. Create return request
    const returnRequest = await ReturnRequest.create(
      [
        {
          orderId,
          userId,
          type,
          reason,
          description,
          images: images || [],
          items: validatedItems,
          status: "pending",
          refund:
            type === "refund"
              ? {
                  amount: totalRefundAmount,
                  coinAmount: Math.round(totalRefundAmount), // 1 VND = 1 coin
                }
              : undefined,
          returnShipping,
          eligibility: {
            isEligible: true,
            orderDeliveredDate: eligibility.deliveredDate,
            daysAfterDelivery: eligibility.daysSinceDelivery,
          },
          autoRejectAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
          timeline: [
            {
              status: "pending",
              description: "Return request created",
              updatedAt: new Date(),
              updatedBy: userId,
              role: "buyer",
            },
          ],
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[RMA] Created return request ${returnRequest[0].requestNumber} for order ${order.orderNumber}`,
    );

    return returnRequest[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error creating return request:", error);
    throw error;
  }
};

/**
 * Seller approve/reject return request
 */
export const respondToReturnRequest = async (
  requestId,
  decision,
  respondedBy,
  notes,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest =
      await ReturnRequest.findById(requestId).session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.status !== "pending") {
      throw new Error(
        `Cannot respond to request with status: ${returnRequest.status}`,
      );
    }

    // Update seller response
    returnRequest.sellerResponse = {
      respondedBy,
      respondedAt: new Date(),
      decision,
      notes,
      rejectionReason: decision === "reject" ? notes : undefined,
    };

    if (decision === "approve") {
      returnRequest.status = "approved";
      returnRequest.timeline.push({
        status: "approved",
        description: "Seller approved return request",
        updatedAt: new Date(),
        updatedBy: respondedBy,
        role: "seller",
        notes,
      });
    } else if (decision === "reject") {
      returnRequest.status = "rejected";
      returnRequest.timeline.push({
        status: "rejected",
        description: "Seller rejected return request",
        updatedAt: new Date(),
        updatedBy: respondedBy,
        role: "seller",
        notes,
      });
    }

    await returnRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[RMA] Seller ${decision} return request ${returnRequest.requestNumber}`,
    );

    return returnRequest;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error responding to return request:", error);
    throw error;
  }
};

/**
 * Process refund - Add coins to user wallet
 */
export const processRefund = async (returnRequestId) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest = await ReturnRequest.findById(returnRequestId)
      .populate("orderId")
      .session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.type !== "refund") {
      throw new Error("This is not a refund request");
    }

    if (
      returnRequest.status !== "approved" &&
      returnRequest.status !== "items_returned"
    ) {
      throw new Error(
        `Cannot process refund for status: ${returnRequest.status}`,
      );
    }

    const order = returnRequest.orderId;
    const coinAmount = returnRequest.refund.coinAmount;

    // 1. Record wallet transaction (add coins)
    const transaction = await WalletTransaction.recordTransaction({
      userId: returnRequest.userId,
      type: "refund",
      amount: coinAmount, // Positive = credit
      description: `Hoàn tiền từ đơn hàng ${order.orderNumber} (${returnRequest.requestNumber})`,
      reference: {
        orderId: order._id,
        returnRequestId: returnRequest._id,
      },
      metadata: {
        requestNumber: returnRequest.requestNumber,
        orderNumber: order.orderNumber,
        reason: returnRequest.reason,
      },
      originalPayment: {
        method: order.paymentMethod,
        amount: returnRequest.refund.amount,
        transactionId: order.payosTransactionDateTime || order.transactionId,
      },
    });

    // 2. Update return request
    returnRequest.refund.refundedAt = new Date();
    returnRequest.refund.transactionId = transaction._id;
    returnRequest.status = "completed";
    returnRequest.timeline.push({
      status: "completed",
      description: `Refunded ${coinAmount} coins to wallet`,
      updatedAt: new Date(),
      role: "system",
    });

    await returnRequest.save({ session });

    // 3. Update order status
    order.status = "refunded";
    order.paymentStatus = "refunded";
    order.refundedAt = new Date();
    order.refundReason = returnRequest.reason;
    order.refundAmount = returnRequest.refund.amount;

    order.statusHistory.push({
      status: "refunded",
      changedByRole: "system",
      changedAt: new Date(),
      reason: `Return request ${returnRequest.requestNumber} processed`,
    });

    await order.save({ session });

    // 4. Rollback inventory if it was deducted
    if (order.resourcesDeducted) {
      console.log("[RMA] Rolling back order resources...");
      await rollbackOrderResources(order);
    }

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[RMA] Refund processed: ${coinAmount} coins added to user wallet`,
    );

    return {
      returnRequest,
      transaction,
      coinsAdded: coinAmount,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error processing refund:", error);
    throw error;
  }
};

/**
 * Process exchange - Create new order for exchange items
 */
export const processExchange = async (returnRequestId) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest = await ReturnRequest.findById(returnRequestId)
      .populate("orderId")
      .populate("items.orderItemId")
      .session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.type !== "exchange") {
      throw new Error("This is not an exchange request");
    }

    if (
      returnRequest.status !== "approved" &&
      returnRequest.status !== "items_returned"
    ) {
      throw new Error(
        `Cannot process exchange for status: ${returnRequest.status}`,
      );
    }

    const order = returnRequest.orderId;

    // 1. Validate exchange items have stock
    for (const item of returnRequest.items) {
      if (item.exchangeToVariantId) {
        const variant = await InventoryItem.findById(
          item.exchangeToVariantId,
        ).session(session);

        if (!variant) {
          throw new Error(
            `Exchange variant not found: ${item.exchangeToVariantName}`,
          );
        }

        if (variant.stock < item.quantity) {
          throw new Error(
            `Insufficient stock for ${item.exchangeToVariantName}. Available: ${variant.stock}`,
          );
        }
      }
    }

    // 2. Calculate price difference
    let priceDifference = 0;
    for (const item of returnRequest.items) {
      if (item.exchangeToVariantId) {
        const newVariant = await InventoryItem.findById(
          item.exchangeToVariantId,
        ).session(session);
        const originalPrice = item.price;
        const newPrice = newVariant.price;
        priceDifference += (newPrice - originalPrice) * item.quantity;
      }
    }

    // 3. Create new order items for exchange
    const newOrderItems = [];
    for (const item of returnRequest.items) {
      if (item.exchangeToVariantId) {
        const newVariant = await InventoryItem.findById(
          item.exchangeToVariantId,
        ).session(session);

        const orderItem = await OrderItem.create(
          [
            {
              productId: item.productId,
              productName: item.productName,
              variantId: item.exchangeToVariantId,
              variantName: item.exchangeToVariantName,
              quantity: item.quantity,
              price: newVariant.price,
              finalPrice: newVariant.price,
              image: newVariant.image || item.orderItemId.image,
              sku: newVariant.sku,
            },
          ],
          { session },
        );

        newOrderItems.push(orderItem[0]._id);

        // Deduct stock
        newVariant.stock -= item.quantity;
        await newVariant.save({ session });
      }
    }

    // 4. Create new exchange order
    const newOrder = await Order.create(
      [
        {
          userId: order.userId,
          orderNumber: `EXG-${order.orderNumber}`,
          status: "processing",
          totalPrice: Math.max(0, priceDifference),
          subtotal: Math.max(0, priceDifference),
          shippingAddress: order.shippingAddress,
          shippingMethod: order.shippingMethod,
          shippingCost: 0, // Free shipping for exchange
          paymentMethod: "cod", // Exchange paid by buyer if price difference
          paymentStatus: priceDifference > 0 ? "pending" : "paid",
          items: newOrderItems,
          notes: `Exchange from order ${order.orderNumber} (${returnRequest.requestNumber})`,
          resourcesDeducted: true,
        },
      ],
      { session },
    );

    // 5. Update return request
    returnRequest.exchange = {
      newOrderId: newOrder[0]._id,
      priceDifference,
      additionalPaymentRequired: priceDifference > 0,
      exchangedAt: new Date(),
    };
    returnRequest.status = "completed";
    returnRequest.timeline.push({
      status: "completed",
      description: `Exchange processed. New order: ${newOrder[0].orderNumber}`,
      updatedAt: new Date(),
      role: "system",
    });

    await returnRequest.save({ session });

    // 6. Update original order
    order.status = "refunded"; // Mark original as refunded/exchanged
    order.statusHistory.push({
      status: "refunded",
      changedByRole: "system",
      changedAt: new Date(),
      reason: `Exchanged via ${returnRequest.requestNumber}`,
      notes: `New order: ${newOrder[0].orderNumber}`,
    });

    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[RMA] Exchange processed: Created new order ${newOrder[0].orderNumber}`,
    );

    return {
      returnRequest,
      newOrder: newOrder[0],
      priceDifference,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error processing exchange:", error);
    throw error;
  }
};

/**
 * Get user's return requests
 */
export const getUserReturnRequests = async (userId, filters = {}) => {
  const query = { userId, isActive: true };

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.type) {
    query.type = filters.type;
  }

  const returnRequests = await ReturnRequest.find(query)
    .populate("orderId", "orderNumber totalPrice status")
    .populate("items.orderItemId")
    .sort({ createdAt: -1 })
    .limit(filters.limit || 50);

  return returnRequests;
};

/**
 * Get seller's return requests (for orders they sold)
 */
export const getSellerReturnRequests = async (sellerId, filters = {}) => {
  // Find orders where seller is the seller (need to implement seller field in Order model)
  // For now, return all pending requests
  const query = { isActive: true };

  if (filters.status) {
    query.status = filters.status;
  }

  const returnRequests = await ReturnRequest.find(query)
    .populate("orderId")
    .populate("userId", "fullName email")
    .populate("items.orderItemId")
    .sort({ createdAt: -1 })
    .limit(filters.limit || 50);

  return returnRequests;
};

/**
 * Calculate return shipping cost responsibility
 */
function calculateReturnShippingCost(reason, originalShippingCost) {
  const buyerPaysReasons = ["change_of_mind"];
  const sellerPaysReasons = [
    "defective",
    "wrong_item",
    "damaged_in_shipping",
    "not_as_described",
  ];

  const shippingCost = originalShippingCost || 30000; // Default 30k VND

  if (buyerPaysReasons.includes(reason)) {
    return {
      shippingCost,
      paidBy: "buyer",
    };
  } else if (sellerPaysReasons.includes(reason)) {
    return {
      shippingCost: 0, // Seller covers
      paidBy: "seller",
    };
  } else {
    return {
      shippingCost: shippingCost / 2,
      paidBy: "split",
    };
  }
}

/**
 * Auto-approve requests if seller doesn't respond within 3 days
 */
export const autoApproveExpiredRequests = async () => {
  try {
    const expiredRequests = await ReturnRequest.find({
      status: "pending",
      autoRejectAt: { $lte: new Date() },
    });

    console.log(
      `[RMA] Found ${expiredRequests.length} expired pending requests to auto-approve`,
    );

    for (const request of expiredRequests) {
      request.status = "approved";
      request.sellerResponse = {
        respondedAt: new Date(),
        decision: "approve",
        notes: "Auto-approved due to seller timeout (3 days)",
      };
      request.timeline.push({
        status: "approved",
        description: "Auto-approved - seller did not respond within 3 days",
        updatedAt: new Date(),
        role: "system",
      });

      await request.save();
      console.log(`[RMA] Auto-approved request: ${request.requestNumber}`);
    }

    return expiredRequests.length;
  } catch (error) {
    console.error("[RMA] Error in auto-approve:", error);
    throw error;
  }
};

export default {
  createReturnRequest,
  respondToReturnRequest,
  processRefund,
  processExchange,
  getUserReturnRequests,
  getSellerReturnRequests,
  autoApproveExpiredRequests,
};
