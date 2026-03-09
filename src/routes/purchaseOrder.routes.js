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
 *   - seller  : tạo PO, xem PO, cancel PO
 *   - manager : xem PO, update PO, complete PO, cancel PO
 *   - admin   : full access
 * NOTE: Named routes MUST come before /:id to avoid wildcard collision
 * ===================================================================
 */

// ─── Landed Cost Preview ───────────────────────────────────────────
router
  .route("/calculate")
  .post(
    requireRoles("admin", "manager", "seller"),
    purchaseOrderController.calculateLandedCost,
  );

// ─── List / Create Purchase Orders ────────────────────────────────
router
  .route("/")
  .post(
    requireRoles("admin", "manager", "seller"),   // seller tạo PO
    purchaseOrderController.createPurchaseOrder,
  )
  .get(
    requireRoles("admin", "manager", "seller"),
    purchaseOrderController.getPurchaseOrders,
  );

/**
 * ===================================================================
 * SUPPLIER ROUTES  (must be before /:id)
 * ===================================================================
 */

router
  .route("/suppliers")
  .post(requireRoles("admin", "manager", "seller"), purchaseOrderController.createSupplier)
  .get(requireRoles("admin", "manager", "seller"), purchaseOrderController.getSuppliers);

// Get supplier purchase history with analytics (before /suppliers/:id to avoid conflict)
router
  .route("/suppliers/:id/purchase-history")
  .get(
    requireRoles("admin", "manager", "seller"),
    purchaseOrderController.getSupplierPurchaseHistory,
  );

router
  .route("/suppliers/:id")
  .get(requireRoles("admin", "manager", "seller"), purchaseOrderController.getSupplierById)
  .put(requireRoles("admin", "manager"), purchaseOrderController.updateSupplier)
  .delete(requireRoles("admin", "manager"), purchaseOrderController.deleteSupplier);

/**
 * ===================================================================
 * INVENTORY MANAGEMENT ROUTES  (must be before /:id)
 * ===================================================================
 */

router
  .route("/inventory/low-stock")
  .get(
    requireRoles("admin", "manager", "seller"),
    purchaseOrderController.getLowStockItems,
  );

router
  .route("/inventory/valuation")
  .get(
    requireRoles("admin", "manager"),
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
    requireRoles("admin", "manager", "seller"),
    purchaseOrderController.getPurchaseOrderById,
  )
  .put(
    requireRoles("admin", "manager", "seller"),   // seller sửa PO của mình (service kiểm tra status)
    purchaseOrderController.updatePurchaseOrder,
  );

// Complete purchase order – chỉ admin/manager mới nhập kho
router
  .route("/:id/complete")
  .post(
    requireRoles("admin", "manager"),
    purchaseOrderController.completePurchaseOrder,
  );

// Cancel purchase order – seller cũng có thể cancel PO của mình
router
  .route("/:id/cancel")
  .post(
    requireRoles("admin", "manager", "seller"),
    purchaseOrderController.cancelPurchaseOrder,
  );

export default router;
