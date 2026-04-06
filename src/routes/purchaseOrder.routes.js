import express from "express";
import * as purchaseOrderController from "../controllers/purchaseOrder.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

/**
 * ===================================================================
 * PURCHASE ORDER ROUTES
 * Role Policy:
 *   - seller : tạo PO, xem PO, sửa PO, xác nhận nhận hàng, cancel PO
 *   - admin  : full access
 * NOTE: Named routes MUST come before /:id to avoid wildcard collision
 * ===================================================================
 */

// ─── Landed Cost Preview ───────────────────────────────────────────
router
  .route("/calculate")
  .post(
    requireRoles("admin", "seller"),
    purchaseOrderController.calculateLandedCost,
  );

// ─── List / Create Purchase Orders ────────────────────────────────
router
  .route("/")
  .post(
    requireRoles("admin", "seller"),
    purchaseOrderController.createPurchaseOrder,
  )
  .get(
    requireRoles("admin", "seller"),
    purchaseOrderController.getPurchaseOrders,
  );

/**
 * ===================================================================
 * SUPPLIER ROUTES  (must be before /:id)
 * ===================================================================
 */

router
  .route("/suppliers")
  .post(requireRoles("admin", "seller"), purchaseOrderController.createSupplier)
  .get(requireRoles("admin", "seller"), purchaseOrderController.getSuppliers);

// Get supplier purchase history with analytics (before /suppliers/:id to avoid conflict)
router
  .route("/suppliers/:id/purchase-history")
  .get(
    requireRoles("admin", "seller"),
    purchaseOrderController.getSupplierPurchaseHistory,
  );

router
  .route("/suppliers/:id")
  .get(requireRoles("admin", "seller"), purchaseOrderController.getSupplierById)
  .put(requireRoles("admin", "seller"), purchaseOrderController.updateSupplier)
  .delete(requireRoles("admin", "seller"), purchaseOrderController.deleteSupplier);

/**
 * ===================================================================
 * INVENTORY MANAGEMENT ROUTES  (must be before /:id)
 * ===================================================================
 */

router
  .route("/inventory/low-stock")
  .get(
    requireRoles("admin", "seller"),
    purchaseOrderController.getLowStockItems,
  );

router
  .route("/inventory/valuation")
  .get(
    requireRoles("admin", "seller"),
    purchaseOrderController.getInventoryValuation,
  );

/**
 * ===================================================================
 * REPORTING ROUTES  (must be before /:id)
 * ===================================================================
 */

router
  .route("/reports/profit-loss")
  .get(requireRoles("admin"), purchaseOrderController.getProfitLossReport);

/**
 * ===================================================================
 * DYNAMIC /:id ROUTES  (must be LAST to avoid capturing named paths)
 * ===================================================================
 */

router
  .route("/:id")
  .get(
    requireRoles("admin", "seller"),
    purchaseOrderController.getPurchaseOrderById,
  )
  .put(
    requireRoles("admin", "seller"),
    purchaseOrderController.updatePurchaseOrder,
  );

// Complete purchase order – seller xác nhận đã nhận hàng
router
  .route("/:id/complete")
  .post(
    requireRoles("admin", "seller"),
    purchaseOrderController.completePurchaseOrder,
  );

// Receive Purchase Order & Calculate Landed Cost (Stage 2 – 2-Stage Taobao Model)
router
  .route("/:id/receive")
  .post(
    requireRoles("admin", "seller"),
    purchaseOrderController.receiveOrderAndCalculateLandedCost,
  );

// Cancel purchase order – seller có thể cancel PO của mình
router
  .route("/:id/cancel")
  .post(
    requireRoles("admin", "seller"),
    purchaseOrderController.cancelPurchaseOrder,
  );

export default router;
