import express from "express";
import * as purchaseOrderController from "../controllers/purchaseOrder.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";

const router = express.Router();

/**
 * ===================================================================
 * PURCHASE ORDER ROUTES
 * ===================================================================
 */

// All routes require authentication
router.use(protect);

// Purchase Order Routes - Only Admin and Manager can access
router
  .route("/")
  .post(
    authorize("admin", "manager"),
    purchaseOrderController.createPurchaseOrder,
  )
  .get(
    authorize("admin", "manager"),
    purchaseOrderController.getPurchaseOrders,
  );

router
  .route("/:id")
  .get(
    authorize("admin", "manager"),
    purchaseOrderController.getPurchaseOrderById,
  )
  .put(
    authorize("admin", "manager"),
    purchaseOrderController.updatePurchaseOrder,
  );

// Complete purchase order (special action)
router
  .route("/:id/complete")
  .post(
    authorize("admin", "manager"),
    purchaseOrderController.completePurchaseOrder,
  );

// Cancel purchase order
router
  .route("/:id/cancel")
  .post(
    authorize("admin", "manager"),
    purchaseOrderController.cancelPurchaseOrder,
  );

/**
 * ===================================================================
 * SUPPLIER ROUTES
 * ===================================================================
 */

router
  .route("/suppliers")
  .post(authorize("admin", "manager"), purchaseOrderController.createSupplier)
  .get(authorize("admin", "manager"), purchaseOrderController.getSuppliers);

router
  .route("/suppliers/:id")
  .get(authorize("admin", "manager"), purchaseOrderController.getSupplierById)
  .put(authorize("admin", "manager"), purchaseOrderController.updateSupplier)
  .delete(
    authorize("admin", "manager"),
    purchaseOrderController.deleteSupplier,
  );

// Get supplier purchase history with analytics
router
  .route("/suppliers/:id/purchase-history")
  .get(
    authorize("admin", "manager"),
    purchaseOrderController.getSupplierPurchaseHistory,
  );

/**
 * ===================================================================
 * INVENTORY MANAGEMENT ROUTES
 * ===================================================================
 */

// Get low stock items alert
router
  .route("/inventory/low-stock")
  .get(
    authorize("admin", "manager", "seller"),
    purchaseOrderController.getLowStockItems,
  );

// Get inventory valuation report
router
  .route("/inventory/valuation")
  .get(
    authorize("admin", "manager"),
    purchaseOrderController.getInventoryValuation,
  );

/**
 * ===================================================================
 * REPORTING ROUTES
 * ===================================================================
 */

// Get Profit & Loss report
router
  .route("/reports/profit-loss")
  .get(authorize("admin"), purchaseOrderController.getProfitLossReport);

export default router;
