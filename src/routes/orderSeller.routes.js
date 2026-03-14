import express from "express";
import {
  createOrder,
  getSellerOrders,
  getOrderDetail,
  updateOrderStatus,
  getOrdersByStatus,
  generateDeliveryNote,
  cancelOrder,
  getOrderStatusHistory,
  confirmOrder,
  packOrder,
  startShipping,
  completeOrder,
} from "../controllers/orderSeller.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import User from "../models/User.js";

const router = express.Router();

// Protect all routes except test endpoint
router.use((req, res, next) => {
  // Skip protection for test endpoint
  if (req.path === "/test/users" && req.method === "GET") {
    return next();
  }
  protect(req, res, next);
});

/**
 * @route   GET /api/seller/orders/test/users
 * @desc    Get list of users for testing (get valid userId)
 * @access  Public (for testing only)
 */
router.get("/test/users", async (req, res, next) => {
  try {
    const users = await User.find()
      .select("_id fullName email phone role")
      .limit(10);
    res.status(200).json({
      success: true,
      message:
        "Use one of these _id values as userId in your order creation request",
      data: users,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/seller/orders
 * @desc    Create new order (seller creates for buyer)
 * @access  Private (Seller/Admin)
 */
router.post("/", authorize("seller", "admin"), createOrder);

/**
 * @route   GET /api/seller/orders
 * @desc    Get all orders (with filters & pagination)
 * @access  Private (Seller/Admin)
 */
router.get("/", authorize("seller", "admin"), getSellerOrders);

/**
 * @route   GET /api/seller/orders/status/:status
 * @desc    Get orders filtered by status
 * @access  Private (Seller/Admin)
 */
router.get("/status/:status", authorize("seller", "admin"), getOrdersByStatus);

/**
 * @route   GET /api/seller/orders/:orderId/status-history
 * @desc    Get order status change history (audit log)
 * @access  Private (Seller/Admin)
 */
router.get(
  "/:orderId/status-history",
  authorize("seller", "admin"),
  getOrderStatusHistory,
);

/**
 * @route   GET /api/seller/orders/:orderId/delivery-note
 * @desc    Generate delivery note (HTML/PDF)
 * @access  Private (Seller/Admin)
 */
router.get(
  "/:orderId/delivery-note",
  authorize("seller", "admin"),
  generateDeliveryNote,
);

/**
 * @route   GET /api/seller/orders/:orderId
 * @desc    Get order detail by ID
 * @access  Private (Seller/Admin)
 */
router.get("/:orderId", authorize("seller", "admin"), getOrderDetail);

/**
 * @route   PUT /api/seller/orders/:orderId/status
 * @desc    Update order status (pending -> processing -> shipped -> delivered)
 * @access  Private (Seller/Admin)
 */
router.put("/:orderId/status", authorize("seller", "admin"), updateOrderStatus);

/**
 * @route   PUT /api/seller/orders/:orderId/cancel
 * @desc    Cancel order with reason
 * @access  Private (Seller/Admin)
 */
router.put("/:orderId/cancel", authorize("seller", "admin"), cancelOrder);

/**
 * @route   PUT /api/seller/orders/:orderId/confirm
 * @desc    Confirm order (Pending -> Confirmed) - Phase 1 of tracking workflow
 * @access  Private (Seller/Admin)
 */
router.put("/:orderId/confirm", authorize("seller", "admin"), confirmOrder);

/**
 * @route   PUT /api/seller/orders/:orderId/pack
 * @desc    Pack order (Confirmed -> Packing) - Phase 2 of tracking workflow
 * @access  Private (Seller/Admin)
 */
router.put("/:orderId/pack", authorize("seller", "admin"), packOrder);

/**
 * @route   PUT /api/seller/orders/:orderId/start-shipping
 * @desc    Start shipping with 60s timer (Packing -> Shipping) - Phase 3 of tracking workflow
 * @access  Private (Seller/Admin)
 */
router.put(
  "/:orderId/start-shipping",
  authorize("seller", "admin"),
  startShipping,
);

export default router;
