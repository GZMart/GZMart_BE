import Order from "../models/Order.js";
import { getSocketIO } from "../utils/socketIO.js";

// Store active timers for cleanup
const activeTimers = new Map();

const DEFAULT_DELIVERY_TIMER_SECONDS = 10;
const DELIVERY_TIMER_SECONDS = Number.isFinite(
  Number(process.env.ORDER_DELIVERY_TIMER_SECONDS),
)
  ? Math.max(1, Number(process.env.ORDER_DELIVERY_TIMER_SECONDS))
  : DEFAULT_DELIVERY_TIMER_SECONDS;

const toUserIdString = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    return value._id?.toString?.() || value.id?.toString?.() || null;
  }

  return value.toString?.() || null;
};

const emitOrderStatus = (io, payload = {}) => {
  const { orderId, status, buyerId, sellerId } = payload;

  if (!orderId || !status) {
    return;
  }

  const buyerIdStr = toUserIdString(buyerId);
  if (buyerIdStr) {
    io.to(`user_${buyerIdStr}`).emit("order_status_updated", payload);
    io.to(`user_${buyerIdStr}`).emit(`order:status:${orderId}`, payload);
  }

  const sellerIdStr = toUserIdString(sellerId);
  if (sellerIdStr) {
    io.to(`user_${sellerIdStr}`).emit("order_status_updated", payload);
    io.to(`user_${sellerIdStr}`).emit(`order:status:${orderId}`, payload);
  }

  // Global event for admin/seller list pages to trigger lightweight background refresh.
  io.emit("order_updated", payload);
};

/**
 * Start the 60-second delivery countdown timer
 * @param {String} orderId - Order ID
 * @param {Object} trackingData - Contains seller and buyer coordinates
 */
export const startDeliveryTimer = async (
  orderId,
  trackingData,
  metadata = {},
) => {
  const io = getSocketIO();
  if (!io) {
    console.error("Socket.IO instance not available");
    return;
  }

  // Clear existing timer if any
  if (activeTimers.has(orderId)) {
    clearTimeout(activeTimers.get(orderId));
    activeTimers.delete(orderId);
  }

  // Set shipping started timestamp
  const shippingStartedAt = new Date();
  const shippingEstimatedArrival = new Date(
    shippingStartedAt.getTime() + DELIVERY_TIMER_SECONDS * 1000,
  );

  const statusPayloadBase = {
    orderId,
    orderNumber: metadata.orderNumber,
    buyerId: metadata.buyerId,
    sellerId: metadata.sellerId,
  };

  // Update order with shipping info (use canonical 'shipped' status)
  await Order.findByIdAndUpdate(orderId, {
    status: "shipped",
    shippingStartedAt,
    shippingEstimatedArrival,
    trackingCoordinates: trackingData,
    $push: {
      statusHistory: {
        status: "shipped",
        changedAt: new Date(),
        notes: "Đơn hàng đã được đóng gói và bắt đầu vận chuyển",
      },
    },
  });

  // Emit socket event to buyer to start map animation (event name retained)
  io.emit(`order:shipping:${orderId}`, {
    orderId,
    status: "shipped",
    coordinates: trackingData,
    startTime: shippingStartedAt,
    estimatedArrival: shippingEstimatedArrival,
    duration: DELIVERY_TIMER_SECONDS,
  });

  emitOrderStatus(io, {
    ...statusPayloadBase,
    status: "shipped",
    coordinates: trackingData,
    startTime: shippingStartedAt,
    estimatedArrival: shippingEstimatedArrival,
    duration: DELIVERY_TIMER_SECONDS,
    updatedAt: new Date(),
  });

  // Auto update to delivered after the configured server-side timer.
  const timerId = setTimeout(async () => {
    try {
      await Order.findByIdAndUpdate(orderId, {
        status: "delivered",
        $push: {
          statusHistory: {
            status: "delivered",
            changedAt: new Date(),
            notes: "Đơn hàng đã được giao đến địa chỉ người nhận",
          },
        },
      });

      // Emit socket event that delivery is complete
      io.emit(`order:arrived:${orderId}`, {
        orderId,
        status: "delivered",
        arrivedAt: new Date(),
      });

      emitOrderStatus(io, {
        ...statusPayloadBase,
        status: "delivered",
        deliveredAt: new Date(),
        updatedAt: new Date(),
      });

      // Remove timer from active list
      activeTimers.delete(orderId);

      console.log(
        `Order ${orderId} auto-marked as delivered after ${DELIVERY_TIMER_SECONDS} seconds`,
      );
    } catch (error) {
      console.error(
        `Error auto-updating order ${orderId} to delivered:`,
        error,
      );
    }
  }, DELIVERY_TIMER_SECONDS * 1000);

  // Store timer ID for potential cleanup
  activeTimers.set(orderId, timerId);

  return {
    shippingStartedAt,
    shippingEstimatedArrival,
    durationSeconds: DELIVERY_TIMER_SECONDS,
  };
};

/**
 * Cancel active delivery timer for an order
 * @param {String} orderId - Order ID
 */
export const cancelDeliveryTimer = (orderId) => {
  if (activeTimers.has(orderId)) {
    clearTimeout(activeTimers.get(orderId));
    activeTimers.delete(orderId);
    console.log(`Delivery timer cancelled for order ${orderId}`);
    return true;
  }
  return false;
};

/**
 * Get default mock coordinates (can be customized per seller/buyer)
 */
export const getMockCoordinates = () => {
  // Mock coordinates for demo (Da Nang city - intra-city delivery)
  return {
    seller: {
      lat: 16.0471, // Hai Chau District - Downtown Da Nang
      lng: 108.2062,
      address: "123 Trần Phú, Quận Hải Châu, Đà Nẵng",
    },
    buyer: {
      lat: 16.0878, // Son Tra District - Da Nang
      lng: 108.2429,
      address: "456 Võ Nguyên Giáp, Quận Sơn Trà, Đà Nẵng",
    },
  };
};

/**
 * Emit new order alert to seller
 * @param {String} orderId - Order ID
 * @param {Object} orderData - Order details
 */
export const notifySellerNewOrder = (orderId, orderData) => {
  const io = getSocketIO();
  if (!io) {
    console.error("Socket.IO instance not available");
    return;
  }

  const payload = {
    orderId,
    orderNumber: orderData.orderNumber,
    status: orderData.status || "pending",
    totalPrice: orderData.totalPrice,
    itemCount: orderData.items?.length || 0,
    createdAt: orderData.createdAt || new Date(),
    customerName: orderData.customerName,
  };

  // Existing event used by current clients.
  io.emit("seller:new-order", payload);

  // Standardized event for order list pages.
  io.emit("new_order", payload);

  console.log(`New order notification sent to seller for order ${orderId}`);
};

/**
 * Notify buyer of order status change
 * @param {String} orderId - Order ID
 * @param {String} status - New status
 * @param {Object} additionalData - Any additional data
 */
export const notifyBuyerStatusChange = (
  orderId,
  status,
  additionalData = {},
) => {
  const io = getSocketIO();
  if (!io) {
    console.error("Socket.IO instance not available");
    return;
  }

  emitOrderStatus(io, {
    orderId,
    status,
    updatedAt: new Date(),
    ...additionalData,
  });

  console.log(
    `Status change notification sent to buyer for order ${orderId}: ${status}`,
  );
};

export default {
  startDeliveryTimer,
  cancelDeliveryTimer,
  getMockCoordinates,
  notifySellerNewOrder,
  notifyBuyerStatusChange,
};
