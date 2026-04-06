import mongoose from "mongoose";
import ReturnRequest from "../models/ReturnRequest.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import User from "../models/User.js";
import InventoryItem from "../models/InventoryItem.js";
import Product from "../models/Product.js";
import { rollbackOrderResources } from "../utils/orderInventory.js";
import coinService from "./coin.service.js";
import NotificationService from "./notification.service.js";
import { getSocketIO } from "../utils/socketIO.js";

const emitRmaUpdate = (returnRequest, extra = {}) => {
  try {
    const io = getSocketIO();
    if (!io || !returnRequest) {
      return;
    }

    const payload = {
      returnRequestId: returnRequest._id?.toString?.() || returnRequest._id,
      orderId:
        returnRequest.orderId?._id?.toString?.() || returnRequest.orderId,
      userId: returnRequest.userId?._id?.toString?.() || returnRequest.userId,
      status: returnRequest.status,
      type: returnRequest.type,
      refundAmount: returnRequest.refund?.amount || 0,
      updatedAt: new Date().toISOString(),
      ...extra,
    };

    io.emit("rma:request-updated", payload);
    if (payload.returnRequestId) {
      io.emit(`rma:request-updated:${payload.returnRequestId}`, payload);
    }

    const buyerId = payload.userId;
    if (buyerId) {
      io.to(`user_${buyerId}`).emit("rma:request-updated", payload);
      if (payload.returnRequestId) {
        io.to(`user_${buyerId}`).emit(
          `rma:request-updated:${payload.returnRequestId}`,
          payload,
        );
      }
    }
  } catch (error) {
    console.error("[RMA] Failed to emit realtime update:", error);
  }
};

const ensureLogisticsSteps = (returnRequest) => {
  if (!returnRequest.logistics) {
    returnRequest.logistics = { flowType: null, currentStep: null, steps: [] };
  }
  if (!Array.isArray(returnRequest.logistics.steps)) {
    returnRequest.logistics.steps = [];
  }
};

const upsertLogisticsStep = (returnRequest, code, patch = {}) => {
  ensureLogisticsSteps(returnRequest);
  const existing = returnRequest.logistics.steps.find(
    (step) => step.code === code,
  );
  if (existing) {
    Object.assign(existing, patch);
    return existing;
  }

  const next = {
    code,
    title: patch.title || code,
    completed: false,
    ...patch,
  };
  returnRequest.logistics.steps.push(next);
  return next;
};

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

    const {
      orderId,
      userId,
      type = "undetermined",
      reason,
      description,
      images,
      items,
    } = data;

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
          refund: {
            amount: totalRefundAmount,
            coinAmount: Math.round(totalRefundAmount), // 1 VND = 1 coin
          },
          returnShipping,
          logistics: {
            flowType: null,
            currentStep: "buyer_submitted",
            steps: [
              {
                code: "buyer_submitted",
                title: "Buyer submitted return/refund request",
                completed: true,
                completedAt: new Date(),
              },
            ],
          },
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

    emitRmaUpdate(returnRequest[0], {
      event: "created",
    });

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
  resolutionType,
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
      if (!["refund", "exchange"].includes(resolutionType)) {
        throw new Error("Resolution type must be 'refund' or 'exchange'");
      }

      returnRequest.type = resolutionType;
      returnRequest.status = "approved";
      returnRequest.logistics = {
        ...(returnRequest.logistics || {}),
        flowType: resolutionType,
        currentStep:
          resolutionType === "exchange"
            ? "seller_pack_and_handover"
            : "seller_to_buyer_in_transit",
        steps:
          resolutionType === "exchange"
            ? [
                {
                  code: "seller_pack_and_handover",
                  title: "Seller packs replacement item and hands to shipper",
                  completed: false,
                },
                {
                  code: "shipper_deliver_and_collect",
                  title:
                    "Shipper delivers replacement to buyer and collects faulty item",
                  completed: false,
                },
                {
                  code: "shipper_return_to_seller",
                  title: "Shipper returns faulty item back to seller warehouse",
                  completed: false,
                },
                {
                  code: "exchange_completed",
                  title: "Exchange flow is completed",
                  completed: false,
                },
              ]
            : [
                {
                  code: "seller_to_buyer_in_transit",
                  title:
                    "Shipper is delivering return flow package from seller to buyer",
                  completed: false,
                },
                {
                  code: "buyer_confirmed_handover",
                  title: "Buyer confirmed handover of faulty item",
                  completed: false,
                },
                {
                  code: "buyer_to_seller_in_transit",
                  title:
                    "Shipper is returning faulty item from buyer back to seller",
                  completed: false,
                },
                {
                  code: "seller_confirmed_faulty_received",
                  title: "Seller confirmed receiving faulty item",
                  completed: false,
                },
              ],
      };

      returnRequest.timeline.push({
        status: "approved",
        description: `Seller approved request with ${resolutionType.toUpperCase()} resolution`,
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

    await NotificationService.createNotification(
      returnRequest.userId,
      decision === "approve"
        ? "Return Request Approved"
        : "Return Request Rejected",
      decision === "approve"
        ? `Seller approved your request #${returnRequest.requestNumber} with ${returnRequest.type} resolution.`
        : `Seller rejected your request #${returnRequest.requestNumber}.`,
      "ORDER",
      {
        orderId: returnRequest.orderId,
        returnRequestId: returnRequest._id,
        returnStatus: returnRequest.status,
        resolution: returnRequest.type,
      },
    );

    console.log(
      `[RMA] Seller ${decision} return request ${returnRequest.requestNumber}`,
    );

    emitRmaUpdate(returnRequest, {
      event: decision === "approve" ? "seller_approved" : "seller_rejected",
    });

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

    await NotificationService.createNotification(
      returnRequest.userId,
      "Refund Completed",
      `${coinAmount} GZCoin has been credited for order ${order.orderNumber}.`,
      "ORDER",
      {
        orderId: order._id,
        returnRequestId: returnRequest._id,
        returnStatus: returnRequest.status,
        coinAmount,
      },
    );

    console.log(
      `[RMA] Refund processed: ${coinAmount} coins added to user wallet (no expiration)`,
    );

    emitRmaUpdate(returnRequest, {
      event: "refund_completed",
      coinAmount,
    });

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
    // Mark exchange flow as completed. In this codebase, replacement shipment is tracked via RMA
    // timeline and logistics steps rather than creating a synthetic order record.
    const priceDifference = 0;

    returnRequest.exchange = {
      newOrderId: null,
      priceDifference,
      additionalPaymentRequired: false,
      exchangedAt: new Date(),
    };
    returnRequest.status = "completed";
    returnRequest.logistics = {
      ...(returnRequest.logistics || {}),
      currentStep: "exchange_completed",
    };
    returnRequest.timeline.push({
      status: "completed",
      description: "Exchange processed successfully",
      updatedAt: new Date(),
      role: "system",
    });

    await returnRequest.save({ session });

    // Update original order
    order.status = "refunded"; // Mark original as refunded/exchanged
    order.statusHistory.push({
      status: "refunded",
      changedByRole: "system",
      changedAt: new Date(),
      reason: `Exchanged via ${returnRequest.requestNumber}`,
      notes: "Replacement flow completed",
    });

    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    await NotificationService.createNotification(
      returnRequest.userId,
      "Exchange Processed",
      `Your exchange for order ${order.orderNumber} has been processed successfully.`,
      "ORDER",
      {
        orderId: order._id,
        newOrderId: null,
        returnRequestId: returnRequest._id,
        returnStatus: returnRequest.status,
      },
    );

    console.log(
      `[RMA] Exchange processed for request ${returnRequest.requestNumber}`,
    );

    emitRmaUpdate(returnRequest, {
      event: "exchange_completed",
    });

    return {
      returnRequest,
      newOrder: null,
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

  if (filters.orderId) {
    query.orderId = filters.orderId;
  }

  const returnRequests = await ReturnRequest.find(query)
    .populate("orderId", "orderNumber totalPrice status")
    .populate("items.orderItemId")
    .sort({ createdAt: -1 })
    .limit(filters.limit || 50);

  return returnRequests;
};

export const getOrderReturnRequestForBuyer = async (userId, orderId) => {
  return ReturnRequest.findOne({
    userId,
    orderId,
    isActive: true,
  })
    .populate("orderId", "orderNumber status")
    .sort({ createdAt: -1 });
};

/**
 * Get seller's return requests (for orders they sold)
 */
export const getSellerReturnRequests = async (sellerId, filters = {}) => {
  // Get all return requests first
  const query = { isActive: true };

  if (filters.status) {
    query.status = filters.status;
  }

  let returnRequests = await ReturnRequest.find(query)
    .populate("orderId")
    .populate("userId", "fullName email")
    .populate("items.orderItemId")
    .populate("items.productId")
    .sort({ createdAt: -1 })
    .limit(filters.limit || 50);

  // Filter requests to only include items from this seller
  const filteredRequests = [];

  for (const requestDoc of returnRequests) {
    const request = requestDoc.toObject();

    // Filter items to only include products from this seller
    const sellerItems = request.items.filter((item) => {
      return (
        item.productId &&
        item.productId.sellerId &&
        item.productId.sellerId.toString() === sellerId.toString()
      );
    });

    // Only include this request if it has items from this seller
    if (sellerItems.length > 0) {
      request.items = sellerItems;

      // Add stock signals for seller's items
      const stockChecks = await Promise.all(
        (request.items || []).map(async (item) => {
          const modelId = item.orderItemId?.modelId;
          const productId = item.productId?._id;

          if (!modelId || !productId) {
            return {
              itemId: item.orderItemId?._id || item.orderItemId,
              requestedQty: item.quantity || 0,
              availableQty: 0,
              canExchange: false,
            };
          }

          const inventory = await InventoryItem.findOne({
            productId,
            modelId,
          });
          const availableQty =
            inventory?.availableQuantity ?? inventory?.quantity ?? 0;

          return {
            itemId: item.orderItemId?._id || item.orderItemId,
            requestedQty: item.quantity || 0,
            availableQty,
            canExchange: availableQty >= (item.quantity || 0),
          };
        }),
      );

      request.exchangeEligibility = {
        canExchange: stockChecks.every((s) => s.canExchange),
        checks: stockChecks,
      };

      filteredRequests.push(request);
    }
  }

  return filteredRequests;
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

    emitRmaUpdate(returnRequest, {
      event: "items_returned",
    });

    return returnRequest;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error updating return shipping:", error);
    throw error;
  }
};

/**
 * Buyer confirms faulty item handover after first-leg delivery reaches buyer.
 */
export const confirmBuyerHandover = async (returnRequestId, userId, notes) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest =
      await ReturnRequest.findById(returnRequestId).session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.userId.toString() !== userId.toString()) {
      throw new Error("You don't have permission to confirm this handover");
    }

    if (!["approved", "items_returned"].includes(returnRequest.status)) {
      throw new Error(
        `Cannot confirm handover for status: ${returnRequest.status}. Must be approved or items_returned.`,
      );
    }

    const now = new Date();

    if (returnRequest.type === "refund") {
      upsertLogisticsStep(returnRequest, "seller_to_buyer_in_transit", {
        title: "Shipper is delivering return flow package from seller to buyer",
        completed: true,
        completedAt: now,
      });

      upsertLogisticsStep(returnRequest, "buyer_confirmed_handover", {
        title: "Buyer confirmed handover of faulty item",
        completed: true,
        completedAt: now,
        note: notes,
      });

      upsertLogisticsStep(returnRequest, "buyer_to_seller_in_transit", {
        title: "Shipper is returning faulty item from buyer back to seller",
        completed: false,
      });

      returnRequest.status = "items_returned";
      returnRequest.logistics = {
        ...(returnRequest.logistics || {}),
        flowType: "refund",
        currentStep: "buyer_to_seller_in_transit",
      };

      returnRequest.timeline.push({
        status: "items_returned",
        description:
          "Buyer confirmed handover. Shipment is now returning to seller",
        updatedAt: now,
        updatedBy: userId,
        role: "buyer",
        notes,
      });
    } else if (returnRequest.type === "exchange") {
      upsertLogisticsStep(returnRequest, "seller_pack_and_handover", {
        title: "Seller packs replacement item and hands to shipper",
        completed: true,
        completedAt: now,
      });

      upsertLogisticsStep(returnRequest, "shipper_deliver_and_collect", {
        title: "Shipper delivers replacement to buyer and collects faulty item",
        completed: true,
        completedAt: now,
        note: notes,
      });

      upsertLogisticsStep(returnRequest, "shipper_return_to_seller", {
        title: "Shipper returns faulty item back to seller warehouse",
        completed: false,
      });

      upsertLogisticsStep(returnRequest, "exchange_completed", {
        title: "Exchange flow is completed",
        completed: false,
      });

      returnRequest.status = "items_returned";
      returnRequest.logistics = {
        ...(returnRequest.logistics || {}),
        flowType: "exchange",
        currentStep: "shipper_return_to_seller",
      };

      returnRequest.timeline.push({
        status: "items_returned",
        description:
          "Buyer confirmed delivery/collection handover. Faulty item is returning to seller",
        updatedAt: now,
        updatedBy: userId,
        role: "buyer",
        notes,
      });
    } else {
      throw new Error(
        "Buyer handover confirmation is only available for refund or exchange flow",
      );
    }

    await returnRequest.save({ session });
    await session.commitTransaction();
    session.endSession();

    emitRmaUpdate(returnRequest, {
      event: "buyer_confirmed_handover",
    });

    return returnRequest;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[RMA] Error confirming buyer handover:", error);
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

    if (returnRequest.type === "refund") {
      upsertLogisticsStep(returnRequest, "buyer_to_seller_in_transit", {
        title: "Shipper is returning faulty item from buyer back to seller",
        completed: true,
        completedAt: new Date(),
      });

      upsertLogisticsStep(returnRequest, "seller_confirmed_faulty_received", {
        title: "Seller confirmed receiving faulty item",
        completed: true,
        completedAt: new Date(),
        note: notes,
      });
    } else if (returnRequest.type === "exchange") {
      upsertLogisticsStep(returnRequest, "shipper_return_to_seller", {
        title: "Shipper returns faulty item back to seller warehouse",
        completed: true,
        completedAt: new Date(),
      });

      upsertLogisticsStep(returnRequest, "exchange_completed", {
        title: "Exchange flow is completed",
        completed: false,
      });
    }

    // Update shipping info
    returnRequest.returnShipping.actualReturnDate = new Date();

    // Update status to processing (ready for refund/exchange)
    returnRequest.status = "processing";
    returnRequest.logistics = {
      ...(returnRequest.logistics || {}),
      currentStep:
        returnRequest.type === "exchange"
          ? "shipper_return_to_seller"
          : "seller_confirmed_faulty_received",
    };
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

    // Refund flow: auto credit GZCoin immediately after seller confirms receipt.
    if (returnRequest.type === "refund") {
      const refundResult = await processRefund(returnRequestId);
      return {
        ...refundResult,
        autoRefund: true,
      };
    }

    if (returnRequest.type === "exchange") {
      const exchangeResult = await processExchange(returnRequestId);
      return {
        ...exchangeResult,
        autoExchange: true,
      };
    }

    console.log(
      `[RMA] Seller confirmed items received for request ${returnRequest.requestNumber}`,
    );

    emitRmaUpdate(returnRequest, {
      event: "seller_confirmed_receipt",
    });

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
      emitRmaUpdate(request, {
        event: "auto_approved",
      });
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
  confirmBuyerHandover,
  confirmItemsReceived,
  autoApproveExpiredRequests,
};
