import * as orderSellerService from '../services/orderSeller.service.js';
import { asyncHandler } from '../middlewares/async.middleware.js';

/**
 * @desc    Create a new order
 * @route   POST /api/orders
 * @access  Private
 */
export const createOrder = asyncHandler(async (req, res) => {
  const order = await orderSellerService.createOrder(req.body);

  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    data: order,
  });
});

/**
 * @desc    Get all orders with pagination and filters
 * @route   GET /api/orders
 * @access  Private
 */
export const getSellerOrders = asyncHandler(async (req, res) => {
  const { page, limit, status, sortBy } = req.query;

  const result = await orderSellerService.getSellerOrders({
    page: Number(page) || 1,
    limit: Number(limit) || 10,
    status,
    sortBy: sortBy || 'createdAt',
  });

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

  const result = await orderSellerService.getOrdersByStatus(status, {
    page: Number(page) || 1,
    limit: Number(limit) || 10,
  });

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
  const result = await orderSellerService.getOrderStatusHistory(req.params.orderId);

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
    }
  );

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

  const order = await orderSellerService.cancelOrder(req.params.orderId, cancellationReason);

  res.status(200).json({
    success: true,
    message: 'Order cancelled successfully',
    data: order,
  });
});

/**
 * @desc    Generate delivery note (HTML format)
 * @route   GET /api/orders/:orderId/delivery-note
 * @access  Private
 */
export const generateDeliveryNote = asyncHandler(async (req, res) => {
  const result = await orderSellerService.generateDeliveryNote(req.params.orderId);

  res.status(200).json({
    success: true,
    ...result,
  });
});
