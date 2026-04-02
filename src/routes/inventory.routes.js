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
  getLotBreakdown,
  getDemandForecast,
  getProductPerformance,
} from "../controllers/inventory.controller.js";

// Import middlewares
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

// All inventory routes require authentication (Admin or Seller)
router.post('/stock-in', protect, requireRoles('admin', 'seller'), stockIn);
router.post('/stock-out', protect, requireRoles('admin', 'seller'), stockOut);
router.post('/adjust', protect, requireRoles('admin', 'seller'), adjustStock);
router.post('/bulk-update', protect, requireRoles('admin', 'seller'), bulkStockUpdate);
router.get('/transactions', protect, requireRoles('admin', 'seller'), getTransactions);
router.get('/transactions/:id', protect, requireRoles('admin', 'seller'), getTransaction);
router.get('/summary/:productId', protect, requireRoles('admin', 'seller'), getProductInventorySummary);
router.get('/stats', protect, requireRoles('admin', 'seller'), getInventoryStats);
router.get('/lots/:sku', protect, requireRoles('admin', 'seller'), getLotBreakdown);
router.get('/demand-forecast', protect, requireRoles('seller'), getDemandForecast);
router.get('/product-performance/:productId', protect, requireRoles('seller'), getProductPerformance);

export default router;
