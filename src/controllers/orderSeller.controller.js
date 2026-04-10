import * as orderSellerService from "../services/orderSeller.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as orderTrackingService from "../services/orderTracking.service.js";
import NotificationService from "../services/notification.service.js";
import Order from "../models/Order.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { getSocketIO } from "../utils/socketIO.js";

/**
 * @desc    Create a new order
 * @route   POST /api/orders
 * @access  Private
 */
export const createOrder = asyncHandler(async (req, res) => {
  const order = await orderSellerService.createOrder(req.body);

  const io = getSocketIO();
  if (io) {
    io.emit("new_order", {
      orderId: order._id,
      status: order.status,
      orderNumber: order.orderNumber,
    });
  }

  res.status(201).json({
    success: true,
    message: "Order created successfully",
    data: order,
  });
});

/**
 * @desc    Get all orders with pagination and filters
 * @route   GET /api/seller/orders
 * @access  Private
 */
export const getSellerOrders = asyncHandler(async (req, res) => {
  const { page, limit, status, sortBy } = req.query;

  const result = await orderSellerService.getSellerOrders(
    {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      status,
      sortBy: sortBy || "createdAt",
    },
    req.user._id,
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Get orders filtered by specific status
 * @route   GET /api/orders/status/:status
 * @access  Private
 */
export const getOrdersByStatus = asyncHandler(async (req, res) => {
  const { status } = req.params;
  const { page, limit } = req.query;

  const result = await orderSellerService.getOrdersByStatus(
    status,
    {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    },
    req.user._id,
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Get order status history (audit log)
 * @route   GET /api/orders/:orderId/history
 * @access  Private
 */
export const getOrderStatusHistory = asyncHandler(async (req, res) => {
  const result = await orderSellerService.getOrderStatusHistory(
    req.params.orderId,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get order detail by ID
 * @route   GET /api/orders/:orderId
 * @access  Private
 */
export const getOrderDetail = asyncHandler(async (req, res) => {
  const order = await orderSellerService.getOrderDetail(req.params.orderId);

  res.status(200).json({
    success: true,
    data: order,
  });
});

/**
 * @desc    Update order status with validation
 * @route   PUT /api/orders/:orderId/status
 * @access  Private
 */
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await orderSellerService.updateOrderStatus(
    req.params.orderId,
    req.body,
    {
      userId: req.user._id,
      userRole: req.user.role,
    },
  );

  // Emit realtime event so buyer pages update immediately without reload.
  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    order.status,
    {
      orderNumber: order.orderNumber,
      trackingNumber: order.trackingNumber,
      estimatedDelivery: order.estimatedDelivery,
      notes: req.body.notes,
      buyerId: order.userId,
      sellerId: req.user?._id,
    },
  );

  const io = getSocketIO();
  if (io) {
    io.emit("order_updated", {
      orderId: order._id,
      status: order.status,
      orderNumber: order.orderNumber,
      updatedAt: new Date(),
    });
  }

  res.status(200).json({
    success: true,
    message: `Order status updated to '${req.body.newStatus}'`,
    data: order,
  });
});

/**
 * @desc    Cancel order with reason
 * @route   PUT /api/orders/:orderId/cancel
 * @access  Private
 */
export const cancelOrder = asyncHandler(async (req, res) => {
  const { cancellationReason } = req.body;

  const order = await orderSellerService.cancelOrder(
    req.params.orderId,
    cancellationReason,
  );

  try {
    await NotificationService.createNotification(
      order.userId,
      "Đơn hàng đã bị hủy",
      `Đơn hàng ${order.orderNumber} của bạn đã bị hủy. Lý do: ${cancellationReason}`,
      "ORDER",
      { orderId: order._id.toString() },
    );
  } catch (e) {
    console.error(e);
  }

  res.status(200).json({
    success: true,
    message: "Order cancelled successfully",
    data: order,
  });
});

/**
 * @desc    Generate delivery note (HTML format)
 * @route   GET /api/orders/:orderId/delivery-note
 * @access  Private
 */
export const generateDeliveryNote = asyncHandler(async (req, res) => {
  const result = await orderSellerService.generateDeliveryNote(
    req.params.orderId,
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Confirm order (Pending -> Confirmed)
 * @route   PUT /api/seller/orders/:orderId/confirm
 * @access  Private (Seller/Admin)
 */
export const confirmOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  if (order.status !== "pending") {
    return next(
      new ErrorResponse(
        `Cannot confirm order with status: ${order.status}`,
        400,
      ),
    );
  }

  // Update to confirmed
  order.status = "confirmed";
  order.statusHistory.push({
    status: "confirmed",
    changedBy: req.user._id,
    changedByRole: req.user.role,
    changedAt: new Date(),
    notes: "Seller đã xác nhận đơn hàng",
  });

  await order.save();

  // Notify buyer via Socket
  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "confirmed",
    {
      orderNumber: order.orderNumber,
      buyerId: order.userId,
      sellerId: req.user?._id,
    },
  );

  try {
    await NotificationService.createNotification(
      order.userId,
      "Đơn hàng đã được xác nhận",
      `Đơn hàng ${order.orderNumber} của bạn đã được người bán xác nhận và đang chuẩn bị hàng.`,
      "ORDER",
      { orderId: order._id.toString() },
    );
  } catch (e) {
    console.error(e);
  }

  res.status(200).json({
    success: true,
    message: "Order confirmed successfully",
    data: order,
  });
});

const toAddressText = (value, fallback = "") => {
  if (!value) {
    return fallback;
  }

  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  if (typeof value === "object") {
    const candidates = [
      value.fullAddress,
      value.formattedAddress,
      value.address,
      value.street,
    ];
    const picked = candidates.find(
      (item) => typeof item === "string" && item.trim(),
    );
    if (picked) {
      return picked.trim();
    }
  }

  return String(value).trim() || fallback;
};

/**
 * @desc    Start shipping with tracking (Confirmed -> Shipping)
 * @route   PUT /api/seller/orders/:orderId/start-shipping
 * @access  Private (Seller/Admin)
 */
export const startShipping = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId).populate(
    "userId",
    "location address",
  );

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  const shippableStatuses = ["packing", "packed", "processing", "confirmed"];
  if (!shippableStatuses.includes(order.status)) {
    return next(
      new ErrorResponse(
        `Cannot start shipping for order with status: ${order.status}. Order must be confirmed, processing, or packed first.`,
        400,
      ),
    );
  }

  // Get coordinates from real user data or use provided or fallback to mock
  let coordinates;
  const sellerAddress = toAddressText(
    req.user?.location?.address || req.user?.address,
    "Địa chỉ người bán chưa cập nhật",
  );
  const buyerAddress = toAddressText(
    order.userId?.location?.address || order.userId?.address,
    "Địa chỉ người mua chưa cập nhật",
  );

  if (req.body.coordinates) {
    // Use provided coordinates from request
    coordinates = {
      seller: {
        ...req.body.coordinates?.seller,
        address: sellerAddress,
      },
      buyer: {
        ...req.body.coordinates?.buyer,
        address: buyerAddress,
      },
    };
  } else if (req.user?.location?.lat && order.userId?.location?.lat) {
    // Use real GPS from seller (req.user) and buyer profiles
    coordinates = {
      seller: {
        lat: req.user.location.lat,
        lng: req.user.location.lng,
        address: sellerAddress,
      },
      buyer: {
        lat: order.userId.location.lat,
        lng: order.userId.location.lng,
        address: buyerAddress,
      },
    };
  } else {
    // Fallback to mock coordinates when GPS is missing, but keep real address labels.
    const mockCoordinates = orderTrackingService.getMockCoordinates();
    coordinates = {
      seller: {
        ...mockCoordinates.seller,
        address: sellerAddress,
      },
      buyer: {
        ...mockCoordinates.buyer,
        address: buyerAddress,
      },
    };
  }

  // Start the 60-second timer and get shipping info
  // Update order status to 'shipped' (canonical) and record history
  order.status = "shipped";
  order.shippingStartedAt = new Date();
  order.statusHistory.push({
    status: "shipped",
    changedBy: req.user._id,
    changedByRole: req.user.role,
    changedAt: new Date(),
    notes: "Seller đã giao cho đơn vị vận chuyển",
  });

  await order.save();

  // Start the 60-second delivery timer (arrival simulation)
  const shippingInfo = await orderTrackingService.startDeliveryTimer(
    order._id.toString(),
    coordinates,
    {
      orderNumber: order.orderNumber,
      buyerId: order.userId?._id || order.userId,
      sellerId: req.user?._id,
    },
  );

  try {
    await NotificationService.createNotification(
      order.userId,
      "Đơn hàng đang giao",
      `Đơn hàng ${order.orderNumber} của bạn đã được giao cho đơn vị vận chuyển.`,
      "ORDER",
      { orderId: order._id.toString() },
    );
  } catch (e) {
    console.error(e);
  }

  res.status(200).json({
    success: true,
    message: `Shipping started successfully. Order will auto-arrive in ${shippingInfo.durationSeconds} seconds.`,
    data: {
      orderId: order._id,
      status: "shipped",
      shippingStartedAt: shippingInfo.shippingStartedAt,
      estimatedArrival: shippingInfo.shippingEstimatedArrival,
      durationSeconds: shippingInfo.durationSeconds,
      coordinates,
      usingRealGPS: !!(req.user?.location?.lat && order.userId?.location?.lat),
    },
  });
});

/**
 * @desc    Complete order (Delivered -> Completed)
 * @route   PUT /api/seller/orders/:orderId/complete
 * @access  Private (Buyer confirms receipt)
 */
export const completeOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  if (order.status !== "delivered") {
    return next(
      new ErrorResponse(
        `Cannot complete order with status: ${order.status}`,
        400,
      ),
    );
  }

  // Update to completed
  order.status = "completed";
  order.completedAt = new Date();
  order.customerConfirmedAt = new Date();
  order.statusHistory.push({
    status: "completed",
    changedBy: req.user._id,
    changedByRole: req.user.role,
    changedAt: new Date(),
    notes: "Người mua đã xác nhận nhận hàng",
  });

  await order.save();

  // Notify about completion
  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "completed",
    {
      orderNumber: order.orderNumber,
      completedAt: order.completedAt,
      buyerId: order.userId,
      sellerId: req.user?._id,
    },
  );

  try {
    await NotificationService.createNotification(
      order.userId,
      "Giao hàng thành công",
      `Tuyệt vời! Đơn hàng ${order.orderNumber} đã được giao thành công. Mong bạn hài lòng với sản phẩm.`,
      "ORDER",
      { orderId: order._id.toString() },
    );
  } catch (e) {
    console.error(e);
  }

  res.status(200).json({
    success: true,
    message: "Order completed successfully",
    data: order,
  });
});

/**
 * @desc    Pack order (Confirmed -> Packing)
 * @route   PUT /api/seller/orders/:orderId/pack
 * @access  Private (Seller/Admin)
 */
export const packOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  if (order.status !== "confirmed") {
    return next(
      new ErrorResponse(
        `Cannot pack order with status: ${order.status}. Order must be confirmed first.`,
        400,
      ),
    );
  }

  // Update to packed (canonical)
  order.status = "packed";
  order.statusHistory.push({
    status: "packed",
    changedBy: req.user._id,
    changedByRole: req.user.role,
    changedAt: new Date(),
    notes: "Seller đã đóng gói hàng",
  });

  await order.save();

  // Notify buyer via Socket
  orderTrackingService.notifyBuyerStatusChange(order._id.toString(), "packed", {
    orderNumber: order.orderNumber,
    buyerId: order.userId,
    sellerId: req.user?._id,
  });

  res.status(200).json({
    success: true,
    message: "Order marked as packed successfully",
    data: order,
  });
});
