import express from 'express';
import {
  createOrder,
  getSellerOrders,
  getOrderDetail,
  updateOrderStatus,
  getOrdersByStatus,
  generateDeliveryNote,
  cancelOrder,
} from '../controllers/orderController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import User from '../models/Users.js';

const router = express.Router();

// All routes require authentication
// router.use(protect);
// Temporarily disabled for testing
// router.use(authorize('shop', 'admin'));

/**
 * @route   GET /api/orders/test/users
 * @desc    Get list of users for testing (get valid userId)
 * @access  Public (for testing only)
 */
router.get('/test/users', async (req, res, next) => {
  try {
    const users = await User.find().select('_id fullName email phone role').limit(10);
    res.status(200).json({
      success: true,
      message: 'Use one of these _id values as userId in your order creation request',
      data: users,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/orders
 * @desc    Create new order (for testing)
 * @access  Public
 */
router.post('/', createOrder);

/**
 * @route   GET /api/orders
 * @desc    Get all orders (with filters & pagination)
 * @access  Private (Seller)
 */
router.get('/', getSellerOrders);

/**
 * @route   GET /api/orders/status/:status
 * @desc    Get orders filtered by status
 * @access  Private (Seller)
 */
router.get('/status/:status', getOrdersByStatus);

/**
 * @route   GET /api/orders/:orderId
 * @desc    Get order detail by ID
 * @access  Private (Seller)
 */
router.get('/:orderId', getOrderDetail);

/**
 * @route   PUT /api/orders/:orderId/status
 * @desc    Update order status (pending -> processing -> shipped -> delivered)
 * @access  Private (Seller)
 */
router.put('/:orderId/status', updateOrderStatus);

/**
 * @route   PUT /api/orders/:orderId/cancel
 * @desc    Cancel order with reason
 * @access  Private (Seller)
 */
router.put('/:orderId/cancel', cancelOrder);

/**
 * @route   GET /api/orders/:orderId/delivery-note
 * @desc    Generate delivery note (HTML/PDF)
 * @access  Private (Seller)
 */
router.get('/:orderId/delivery-note', generateDeliveryNote);

export default router;
