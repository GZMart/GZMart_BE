import express from "express";
import {
  getCoinBalance,
  getCoinTransactions,
  getCoinStats,
  getExpiringCoins,
  grantCoins,
  manualExpireCoins,
  syncBalances,
  notifyExpiringCoins,
} from "../controllers/coin.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";

const router = express.Router();

// ==================== USER ENDPOINTS ====================

// Get coin balance
router.get("/balance", protect, getCoinBalance);

// Get coin transaction history
router.get("/transactions", protect, getCoinTransactions);

// Get coin statistics
router.get("/stats", protect, getCoinStats);

// Get expiring coins alert
router.get("/expiring", protect, getExpiringCoins);

// ==================== ADMIN ENDPOINTS ====================

// Grant coins to user
router.post("/admin/grant", protect, authorize("admin"), grantCoins);

// Manually expire coins
router.post("/admin/expire", protect, authorize("admin"), manualExpireCoins);

// Sync all user balances
router.post("/admin/sync", protect, authorize("admin"), syncBalances);

// Send expiration notifications
router.post(
  "/admin/notify-expiring",
  protect,
  authorize("admin"),
  notifyExpiringCoins,
);

export default router;
