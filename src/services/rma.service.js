import mongoose from "mongoose";
import ReturnRequest from "../models/ReturnRequest.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import User from "../models/User.js";
import InventoryItem from "../models/InventoryItem.js";
import { rollbackOrderResources } from "../utils/orderInventory.js";
import coinService from "./coin.service.js";

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

    // 5. Generate unique request number
    // Format: RMA-YYYYMMDD-XXXXX
    let requestNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!isUnique && attempts < maxAttempts) {
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
      const random = Math.floor(10000 + Math.random() * 90000);
      requestNumber = `RMA-${dateStr}-${random}`;

      // Check if request number already exists
      const existing = await ReturnRequest.findOne({ requestNumber }).session(
        session,
      );
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error(
        "Failed to generate unique request number. Please try again.",
      );
    }

    console.log(`[RMA] Generated unique request number: ${requestNumber}`);

    // 6. Create return request
    const returnRequest = await ReturnRequest.create(
      [
        {
          orderId,
          userId,
          requestNumber,
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

    // Must be in processing status (after seller confirms receiving items)
    if (returnRequest.status !== "processing") {
      throw new Error(
        `Cannot process refund for status: ${returnRequest.status}. Must be 'processing' (seller must confirm receiving items first).`,
      );
    }

    const order = returnRequest.orderId;
    const coinAmount = returnRequest.refund.coinAmount;

    // 1. Add coins to user wallet using new coin service
    // Refund coins have NO EXPIRATION (expiresAt = null)
    const coinResult = await coinService.addCoins({
      userId: returnRequest.userId,
      source: "refund",
      amount: coinAmount,
      description: `Refund from order ${order.orderNumber} (${returnRequest.requestNumber})`,
      sourceTransaction: {
        orderId: order._id,
        returnRequestId: returnRequest._id,
      },
      metadata: {
        requestNumber: returnRequest.requestNumber,
        orderNumber: order.orderNumber,
        reason: returnRequest.reason,
        originalPayment: {
          method: order.paymentMethod,
          amount: returnRequest.refund.amount,
          transactionId: order.payosTransactionDateTime || order.transactionId,
        },
      },
    });

    // 2. Update return request
    returnRequest.refund.refundedAt = new Date();
    returnRequest.refund.transactionId = coinResult.transaction._id;
    returnRequest.status = "completed";
    returnRequest.timeline.push({
      status: "completed",
      description: `Refunded ${coinAmount} coins to wallet (no expiration)`,
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
      `[RMA] Refund processed: ${coinAmount} coins added to user wallet (no expiration)`,
    );

    return {
      returnRequest,
      transaction: coinResult.transaction,
      coinPacket: coinResult.coinPacket,
      coinsAdded: coinAmount,
      expiresAt: null, // Refund coins never expire
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

    // Must be in processing status (after seller confirms receiving items)
    if (returnRequest.status !== "processing") {
      throw new Error(
        `Cannot process exchange for status: ${returnRequest.status}. Must be 'processing' (seller must confirm receiving items first).`,
      );
    }

    const order = returnRequest.orderId;

    // 1. Rollback old items stock (trả hàng cũ về kho)
    console.log("[RMA Exchange] Rolling back old items to inventory...");
    for (const item of returnRequest.items) {
      const orderItem = await OrderItem.findById(item.orderItemId).session(
        session,
      );
      if (orderItem && orderItem.variantId) {
        const oldVariant = await InventoryItem.findById(
          orderItem.variantId,
        ).session(session);
        if (oldVariant) {
          oldVariant.stock += item.quantity;
          await oldVariant.save({ session });
          console.log(
            `[RMA Exchange] Restored ${item.quantity} units to ${orderItem.variantName} (Stock: ${oldVariant.stock})`,
          );
        }
      }
    }

    // 2. Validate exchange items have stock
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

    // 3. Calculate price difference
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

    console.log(`[RMA Exchange] Price difference: ${priceDifference} VND`);

    // 4. Create new order items for exchange
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

    // 5. Create new exchange order
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
          paymentMethod: priceDifference > 0 ? "wallet" : "cod", // Use wallet if buyer needs to pay difference
          paymentStatus: priceDifference > 0 ? "pending" : "paid",
          items: newOrderItems,
          notes: `Exchange from order ${order.orderNumber} (${returnRequest.requestNumber})`,
          resourcesDeducted: true,
        },
      ],
      { session },
    );

    // 6. Update return request
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

    // 7. Update original order
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
 * Buyer updates return shipping info after sending items back
 */
export const updateReturnShipping = async (
  returnRequestId,
  userId,
  shippingData,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest =
      await ReturnRequest.findById(returnRequestId).session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    // Only owner can update
    if (returnRequest.userId.toString() !== userId.toString()) {
      throw new Error("You don't have permission to update this request");
    }

    // Can only update shipping if approved
    if (returnRequest.status !== "approved") {
      throw new Error(
        `Cannot update shipping for status: ${returnRequest.status}. Must be approved first.`,
      );
    }

    // Update shipping info
    returnRequest.returnShipping = {
      ...returnRequest.returnShipping,
      trackingNumber: shippingData.trackingNumber,
      shippingProvider: shippingData.shippingProvider || "Unknown",
      estimatedReturnDate:
        shippingData.estimatedReturnDate ||
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };

    // Update status to items_returned
    returnRequest.status = "items_returned";
    returnRequest.timeline.push({
      status: "items_returned",
      description: `Buyer shipped items back. Tracking: ${shippingData.trackingNumber}`,
      updatedAt: new Date(),
      updatedBy: userId,
      role: "buyer",
      notes: shippingData.notes,
    });

    await returnRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[RMA] Buyer updated shipping for request ${returnRequest.requestNumber}`,
    );

    return returnRequest;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error updating return shipping:", error);
    throw error;
  }
};

/**
 * Seller confirms receiving returned items
 */
export const confirmItemsReceived = async (
  returnRequestId,
  sellerId,
  notes,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest =
      await ReturnRequest.findById(returnRequestId).session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    // Can only confirm if items_returned
    if (returnRequest.status !== "items_returned") {
      throw new Error(
        `Cannot confirm items for status: ${returnRequest.status}. Must be items_returned.`,
      );
    }

    // Update shipping info
    returnRequest.returnShipping.actualReturnDate = new Date();

    // Update status to processing (ready for refund/exchange)
    returnRequest.status = "processing";
    returnRequest.timeline.push({
      status: "processing",
      description: "Seller confirmed receiving returned items",
      updatedAt: new Date(),
      updatedBy: sellerId,
      role: "seller",
      notes,
    });

    await returnRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[RMA] Seller confirmed items received for request ${returnRequest.requestNumber}`,
    );

    return returnRequest;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error confirming items received:", error);
    throw error;
  }
};

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
  updateReturnShipping,
  confirmItemsReceived,
  autoApproveExpiredRequests,
};
