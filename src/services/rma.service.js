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
import { applyOrderRefund } from "./financialSettlement.service.js";

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

const DEFAULT_RMA_LEG_DURATION_SECONDS = 10;

const getLogisticsStep = (returnRequest, code) => {
  ensureLogisticsSteps(returnRequest);
  return (
    returnRequest.logistics.steps.find((step) => step.code === code) || null
  );
};

const startLogisticsLeg = (
  returnRequest,
  code,
  {
    title,
    durationSeconds = DEFAULT_RMA_LEG_DURATION_SECONDS,
    note,
    startedAt = new Date(),
  } = {},
) => {
  const startTime = new Date(startedAt);
  const safeDuration = Math.max(1, Number(durationSeconds || 1));
  const autoCompleteAt = new Date(startTime.getTime() + safeDuration * 1000);

  return upsertLogisticsStep(returnRequest, code, {
    title: title || code,
    startedAt: startTime,
    durationSeconds: safeDuration,
    autoCompleteAt,
    completed: false,
    completedAt: null,
    note,
  });
};

const markLogisticsStepCompleted = (
  returnRequest,
  code,
  { title, completedAt = new Date(), note } = {},
) => {
  const existing = getLogisticsStep(returnRequest, code);
  const finalizedAt = new Date(completedAt);
  const hasDuration = Number.isFinite(Number(existing?.durationSeconds));
  const durationSeconds =
    hasDuration && Number(existing.durationSeconds) > 0
      ? Number(existing.durationSeconds)
      : null;

  return upsertLogisticsStep(returnRequest, code, {
    title: title || existing?.title || code,
    startedAt: existing?.startedAt || finalizedAt,
    durationSeconds,
    autoCompleteAt:
      existing?.autoCompleteAt ||
      (durationSeconds
        ? new Date(existing?.startedAt || finalizedAt).getTime() +
          durationSeconds * 1000
        : finalizedAt),
    completed: true,
    completedAt: finalizedAt,
    note,
  });
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
      const now = new Date();
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
                  startedAt: now,
                  durationSeconds: DEFAULT_RMA_LEG_DURATION_SECONDS,
                  autoCompleteAt: new Date(
                    now.getTime() + DEFAULT_RMA_LEG_DURATION_SECONDS * 1000,
                  ),
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
                  startedAt: now,
                  durationSeconds: DEFAULT_RMA_LEG_DURATION_SECONDS,
                  autoCompleteAt: new Date(
                    now.getTime() + DEFAULT_RMA_LEG_DURATION_SECONDS * 1000,
                  ),
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
      session,
    });

    // 2. Reverse marketplace settlement using frozen order snapshot
    const settlementResult = await applyOrderRefund({
      orderId: order._id,
      refundAmount: returnRequest.refund.amount,
      returnRequest,
      session,
    });

    // 3. Update return request
    returnRequest.refund.refundedAt = new Date();
    returnRequest.refund.transactionId = coinResult.transaction._id;
    returnRequest.refund.settlementTransactionId =
      settlementResult.sellerTransaction?._id || null;
    returnRequest.refund.adminSettlementTransactionId =
      settlementResult.adminTransaction?._id || null;
    returnRequest.refund.debtAmount =
      settlementResult.snapshot?.debtAmount || 0;
    returnRequest.status = "completed";
    returnRequest.timeline.push({
      status: "completed",
      description: `Refunded ${coinAmount} coins to wallet (no expiration) and reversed settlement`,
      updatedAt: new Date(),
      role: "system",
    });

    await returnRequest.save({ session });

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
 * Process exchange - Create a real replacement order with the same items
 */
export const processExchange = async (returnRequestId) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest = await ReturnRequest.findById(returnRequestId)
      .populate({
        path: "orderId",
        populate: { path: "userId", select: "fullName email phone address location" },
      })
      .populate({
        path: "items.orderItemId",
        populate: { path: "productId", select: "name images tiers models sellerId" },
      })
      .populate("items.productId")
      .session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.type !== "exchange") {
      throw new Error("This is not an exchange request");
    }

    if (returnRequest.status !== "processing") {
      throw new Error(
        `Cannot process exchange for status: ${returnRequest.status}. Must be 'processing' (seller must confirm receiving items first).`,
      );
    }

    const originalOrder = returnRequest.orderId;

    // ── 1. Validate stock for each return item (exact same variant) ──
    const itemsToCreate = [];
    let newSubtotal = 0;

    for (const rmaItem of returnRequest.items) {
      const orderItem = rmaItem.orderItemId;
      if (!orderItem) {
        throw new Error(
          `Original order item not found for RMA item ${rmaItem._id}`,
        );
      }

      const productId = rmaItem.productId?._id || orderItem.productId?._id || orderItem.productId;
      const modelId = orderItem.modelId;
      const sku = orderItem.sku;
      const quantity = rmaItem.quantity || orderItem.quantity;

      if (!productId || !modelId) {
        throw new Error(
          `Missing productId or modelId for item ${orderItem._id}`,
        );
      }

      // Check stock in InventoryItem
      const inventory = await InventoryItem.findOne({
        productId,
        modelId,
      }).session(session);

      const availableQty =
        inventory?.availableQuantity ?? inventory?.quantity ?? 0;

      if (availableQty < quantity) {
        const productName =
          rmaItem.productName || orderItem.productName || "Product";
        throw new Error(
          `Insufficient stock for "${productName}" (need ${quantity}, available ${availableQty}). Cannot proceed with exchange.`,
        );
      }

      // Deduct stock from InventoryItem
      if (inventory) {
        inventory.quantity = Math.max(0, inventory.quantity - quantity);
        if (inventory.availableQuantity != null) {
          inventory.availableQuantity = Math.max(
            0,
            inventory.availableQuantity - quantity,
          );
        }
        await inventory.save({ session });
      }

      // Also deduct from Product.models[].stock
      await Product.findOneAndUpdate(
        {
          _id: productId,
          "models._id": modelId,
          "models.stock": { $gte: quantity },
        },
        { $inc: { "models.$.stock": -quantity } },
        { session },
      );

      const unitPrice = Number(orderItem.price || rmaItem.price || 0);
      const lineSubtotal = unitPrice * quantity;
      newSubtotal += lineSubtotal;

      itemsToCreate.push({
        productId,
        modelId,
        sku,
        quantity,
        price: unitPrice,
        subtotal: lineSubtotal,
        tierSelections: orderItem.tierSelections || new Map(),
        originalPrice: orderItem.originalPrice || unitPrice,
        isFlashSale: false,
        isPreOrder: orderItem.isPreOrder || false,
        preOrderDaysSnapshot: orderItem.preOrderDaysSnapshot || 0,
      });
    }

    // ── 2. Generate order number ──
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ── 3. Determine sellerId ──
    const sellerId =
      originalOrder.sellerId ||
      returnRequest.items?.[0]?.productId?.sellerId?._id ||
      returnRequest.items?.[0]?.productId?.sellerId ||
      null;

    // ── 4. Create the new Order ──
    const [newOrder] = await Order.create(
      [
        {
          userId: returnRequest.userId,
          sellerId,
          orderNumber,
          status: "confirmed",
          totalPrice: newSubtotal,
          subtotal: newSubtotal,
          shippingAddress: originalOrder.shippingAddress || "Same as original",
          shippingMethod: originalOrder.shippingMethod || "standard",
          shippingCost: 0,
          tax: 0,
          discount: 0,
          discountAmount: 0,
          coinUsedAmount: 0,
          payableBeforeCoin: 0,
          paymentMethod: "cash_on_delivery",
          paymentStatus: "paid",
          paymentDate: new Date(),
          trackingCoordinates: originalOrder.trackingCoordinates || {},
          notes: `Exchange order from RMA ${returnRequest.requestNumber} (original: ${originalOrder.orderNumber})`,
          items: [],
          statusHistory: [
            {
              status: "confirmed",
              changedByRole: "system",
              changedAt: new Date(),
              reason: `Auto-created exchange from ${returnRequest.requestNumber}`,
              notes: "Free shipping, auto-confirmed",
            },
          ],
          resourcesDeducted: true,
        },
      ],
      { session },
    );

    // ── 5. Create OrderItems linked to the new Order ──
    const createdOrderItems = [];
    for (const itemData of itemsToCreate) {
      const [orderItem] = await OrderItem.create(
        [{ ...itemData, orderId: newOrder._id }],
        { session },
      );
      createdOrderItems.push(orderItem);
    }

    newOrder.items = createdOrderItems.map((oi) => oi._id);
    await newOrder.save({ session });

    // ── 6. Update return request ──
    returnRequest.exchange = {
      newOrderId: newOrder._id,
      priceDifference: 0,
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
      description: `Exchange processed. New order created: ${orderNumber}`,
      updatedAt: new Date(),
      role: "system",
    });

    await returnRequest.save({ session });

    // ── 7. Update original order status ──
    originalOrder.status = "refunded";
    originalOrder.statusHistory.push({
      status: "refunded",
      changedByRole: "system",
      changedAt: new Date(),
      reason: `Exchanged via ${returnRequest.requestNumber}`,
      notes: `Replacement order: ${orderNumber}`,
    });

    await originalOrder.save({ session });

    // ── 8. Rollback inventory for original order if needed ──
    if (originalOrder.resourcesDeducted) {
      await rollbackOrderResources(originalOrder);
    }

    await session.commitTransaction();
    session.endSession();

    // ── 9. Notify buyer ──
    await NotificationService.createNotification(
      returnRequest.userId,
      "Exchange Processed — New Order Created",
      `Your exchange for order ${originalOrder.orderNumber} is complete. New order ${orderNumber} has been created with free shipping.`,
      "ORDER",
      {
        orderId: originalOrder._id,
        newOrderId: newOrder._id,
        returnRequestId: returnRequest._id,
        returnStatus: returnRequest.status,
      },
    );

    console.log(
      `[RMA] Exchange processed for ${returnRequest.requestNumber}. New order: ${orderNumber}`,
    );

    emitRmaUpdate(returnRequest, {
      event: "exchange_completed",
      newOrderId: newOrder._id,
      newOrderNumber: orderNumber,
    });

    return {
      returnRequest,
      newOrder,
      priceDifference: 0,
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
  const normalizeId = (value) => {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object") {
      if (value._id) {
        return value._id.toString();
      }
      if (value.id) {
        return value.id.toString();
      }
    }

    return value.toString?.() || null;
  };

  const sellerIdStr = normalizeId(sellerId);

  // Get all return requests first
  const query = { isActive: true };

  if (filters.status) {
    query.status = filters.status;
  }

  let returnRequests = await ReturnRequest.find(query)
    .populate({
      path: "orderId",
      select:
        "orderNumber status shippingAddress trackingCoordinates userId shippingStartedAt shippingEstimatedArrival",
      populate: {
        path: "userId",
        select: "fullName email phone address location",
      },
    })
    .populate("userId", "fullName email")
    .populate("items.orderItemId")
    .populate({
      path: "items.productId",
      populate: {
        path: "sellerId",
        select: "fullName email phone address location",
      },
    })
    .sort({ createdAt: -1 })
    .limit(filters.limit || 50);

  // Filter requests to only include items from this seller
  const filteredRequests = [];

  for (const requestDoc of returnRequests) {
    const request = requestDoc.toObject();

    // Filter items to only include products from this seller
    const sellerItems = request.items.filter((item) => {
      const itemSellerId = normalizeId(item?.productId?.sellerId);
      return (
        item.productId &&
        itemSellerId &&
        sellerIdStr &&
        itemSellerId === sellerIdStr
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
      markLogisticsStepCompleted(returnRequest, "seller_to_buyer_in_transit", {
        title: "Shipper is delivering return flow package from seller to buyer",
      });

      markLogisticsStepCompleted(returnRequest, "buyer_confirmed_handover", {
        title: "Buyer confirmed handover of faulty item",
        note: notes,
      });

      startLogisticsLeg(returnRequest, "buyer_to_seller_in_transit", {
        title: "Shipper is returning faulty item from buyer back to seller",
        startedAt: now,
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
      markLogisticsStepCompleted(returnRequest, "seller_pack_and_handover", {
        title: "Seller packs replacement item and hands to shipper",
      });

      markLogisticsStepCompleted(returnRequest, "shipper_deliver_and_collect", {
        title: "Shipper delivers replacement to buyer and collects faulty item",
        note: notes,
      });

      startLogisticsLeg(returnRequest, "shipper_return_to_seller", {
        title: "Shipper returns faulty item back to seller warehouse",
        startedAt: now,
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
 * Seller confirms receiving returned items.
 * Optional `resolution` parameter allows seller to choose refund or exchange at this step.
 */
export const confirmItemsReceived = async (
  returnRequestId,
  sellerId,
  notes,
  resolution,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const returnRequest =
      await ReturnRequest.findById(returnRequestId).session(session);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    // If seller explicitly chose a resolution, update the type now
    if (resolution && ["refund", "exchange"].includes(resolution)) {
      if (returnRequest.type !== resolution) {
        returnRequest.type = resolution;
        returnRequest.timeline.push({
          status: returnRequest.status,
          description: `Seller chose ${resolution.toUpperCase()} resolution at confirm-receipt step`,
          updatedAt: new Date(),
          updatedBy: sellerId,
          role: "seller",
        });
      }
    }

    const effectiveType = returnRequest.type;

    // Idempotent behavior:
    // - items_returned: normal transition to processing then auto-process
    // - processing: retry auto-process directly
    // - completed: return current state
    if (returnRequest.status === "completed") {
      await session.commitTransaction();
      session.endSession();
      return returnRequest;
    }

    if (returnRequest.status === "processing") {
      // Save any type change before committing
      await returnRequest.save({ session });
      await session.commitTransaction();
      session.endSession();

      if (effectiveType === "refund") {
        const refundResult = await processRefund(returnRequestId);
        return {
          ...refundResult,
          autoRefund: true,
          retriedFromProcessing: true,
        };
      }

      if (effectiveType === "exchange") {
        const exchangeResult = await processExchange(returnRequestId);
        return {
          ...exchangeResult,
          autoExchange: true,
          retriedFromProcessing: true,
        };
      }

      throw new Error(`Unsupported return request type: ${effectiveType}`);
    }

    if (returnRequest.status !== "items_returned") {
      throw new Error(
        `Cannot confirm items for status: ${returnRequest.status}. Must be items_returned or processing.`,
      );
    }

    // Mark logistics steps completed based on the logistics flow that was used
    // (always refund logistics since we approve with 'refund' to get items back)
    if (returnRequest.logistics?.flowType === "exchange") {
      markLogisticsStepCompleted(returnRequest, "shipper_return_to_seller", {
        title: "Shipper returns faulty item back to seller warehouse",
      });

      upsertLogisticsStep(returnRequest, "exchange_completed", {
        title: "Exchange flow is completed",
        completed: false,
      });
    } else {
      markLogisticsStepCompleted(returnRequest, "buyer_to_seller_in_transit", {
        title: "Shipper is returning faulty item from buyer back to seller",
      });

      markLogisticsStepCompleted(
        returnRequest,
        "seller_confirmed_faulty_received",
        {
          title: "Seller confirmed receiving faulty item",
          note: notes,
        },
      );
    }

    // Update shipping info
    returnRequest.returnShipping.actualReturnDate = new Date();

    // Update status to processing (ready for refund/exchange)
    returnRequest.status = "processing";
    returnRequest.logistics = {
      ...(returnRequest.logistics || {}),
      currentStep:
        returnRequest.logistics?.flowType === "exchange"
          ? "shipper_return_to_seller"
          : "seller_confirmed_faulty_received",
    };
    returnRequest.timeline.push({
      status: "processing",
      description: `Seller confirmed receiving returned items. Resolution: ${effectiveType}`,
      updatedAt: new Date(),
      updatedBy: sellerId,
      role: "seller",
      notes,
    });

    await returnRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Auto-process based on the effective type (seller's choice)
    if (effectiveType === "refund") {
      const refundResult = await processRefund(returnRequestId);
      return {
        ...refundResult,
        autoRefund: true,
      };
    }

    if (effectiveType === "exchange") {
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
 * Auto-progress active logistics legs based on startedAt + durationSeconds.
 * This allows both buyer/seller tracking maps to stay in sync even when pages are not open.
 */
export const autoProgressActiveLogisticsLegs = async () => {
  const now = new Date();

  const activeRequests = await ReturnRequest.find({
    isActive: true,
    status: { $in: ["approved", "items_returned"] },
    "logistics.steps": {
      $elemMatch: {
        completed: false,
        startedAt: { $ne: null },
        durationSeconds: { $gt: 0 },
      },
    },
  });

  let progressedCount = 0;

  for (const request of activeRequests) {
    let requestChanged = false;
    ensureLogisticsSteps(request);

    for (const step of request.logistics.steps) {
      if (step.completed || !step.startedAt || !step.durationSeconds) {
        continue;
      }

      const stepStart = new Date(step.startedAt).getTime();
      const stepEnd = stepStart + Number(step.durationSeconds) * 1000;

      if (Number.isFinite(stepEnd) && now.getTime() >= stepEnd) {
        step.completed = true;
        step.completedAt = step.completedAt || new Date(stepEnd);
        step.autoCompleteAt = step.autoCompleteAt || new Date(stepEnd);
        requestChanged = true;

        if (
          request.type === "refund" &&
          step.code === "seller_to_buyer_in_transit"
        ) {
          request.logistics.currentStep = "buyer_confirmed_handover";
        }

        if (
          request.type === "exchange" &&
          step.code === "seller_pack_and_handover"
        ) {
          startLogisticsLeg(request, "shipper_deliver_and_collect", {
            title:
              "Shipper delivers replacement to buyer and collects faulty item",
            startedAt: step.completedAt || now,
          });
          request.logistics.currentStep = "shipper_deliver_and_collect";
        }

        if (
          request.type === "exchange" &&
          step.code === "shipper_deliver_and_collect"
        ) {
          startLogisticsLeg(request, "shipper_return_to_seller", {
            title: "Shipper returns faulty item back to seller warehouse",
            startedAt: step.completedAt || now,
          });
          request.logistics.currentStep = "shipper_return_to_seller";
          if (request.status === "approved") {
            request.status = "items_returned";
            request.timeline.push({
              status: "items_returned",
              description:
                "Auto-progress: shipper completed delivery & collection leg",
              updatedAt: new Date(),
              role: "system",
            });
          }
        }

        if (
          request.type === "refund" &&
          step.code === "buyer_to_seller_in_transit"
        ) {
          request.logistics.currentStep = "seller_confirmed_faulty_received";
        }
      }
    }

    if (requestChanged) {
      await request.save();
      progressedCount += 1;
      emitRmaUpdate(request, {
        event: "logistics_auto_progressed",
      });
    }
  }

  return progressedCount;
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
  autoProgressActiveLogisticsLegs,
  autoApproveExpiredRequests,
};
