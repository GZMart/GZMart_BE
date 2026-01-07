import express from "express";
import {
  stockIn,
  stockOut,
  adjustStock,
  getTransactions,
  getTransaction,
  getProductInventorySummary,
  getInventoryStats,
  bulkStockUpdate,
} from "../controllers/inventory.controller.js";

// Import middlewares
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

// All inventory routes require authentication (Admin or Seller)
// Temporarily disabled for testing
router.post("/stock-in", stockIn);
router.post("/stock-out", stockOut);
router.post("/adjust", adjustStock);
router.post("/bulk-update", bulkStockUpdate);

router.get("/transactions", getTransactions);
router.get("/transactions/:id", getTransaction);
router.get("/summary/:productId", getProductInventorySummary);
router.get("/stats", getInventoryStats);

// Protected routes (enable after testing)
// router.post('/stock-in', protect, requireRoles('admin', 'seller'), stockIn);
// router.post('/stock-out', protect, requireRoles('admin', 'seller'), stockOut);
// router.post('/adjust', protect, requireRoles('admin', 'seller'), adjustStock);
// router.post('/bulk-update', protect, requireRoles('admin', 'seller'), bulkStockUpdate);
// router.get('/transactions', protect, requireRoles('admin', 'seller'), getTransactions);
// router.get('/transactions/:id', protect, requireRoles('admin', 'seller'), getTransaction);
// router.get('/summary/:productId', protect, requireRoles('admin', 'seller'), getProductInventorySummary);
// router.get('/stats', protect, requireRoles('admin', 'seller'), getInventoryStats);

export default router;
