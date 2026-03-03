import express from "express";
import { protect, authorize } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Placeholder routes for GHN (Giao Hàng Nhanh) integration
// TODO: Implement GHN shipping integration

/**
 * @route   POST /api/ghn/create-order
 * @desc    Create shipping order with GHN
 * @access  Private (Seller/Admin)
 */
router.post(
  "/create-order",
  protect,
  authorize("seller", "admin"),
  (req, res) => {
    res.status(501).json({
      success: false,
      message: "GHN integration not implemented yet",
    });
  },
);

/**
 * @route   GET /api/ghn/calculate-fee
 * @desc    Calculate shipping fee with GHN
 * @access  Public
 */
router.get("/calculate-fee", (req, res) => {
  res.status(501).json({
    success: false,
    message: "GHN integration not implemented yet",
  });
});

/**
 * @route   POST /api/ghn/webhook
 * @desc    GHN webhook for order status updates
 * @access  Public
 */
router.post("/webhook", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Webhook received",
  });
});

export default router;
