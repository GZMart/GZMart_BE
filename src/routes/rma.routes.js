import express from "express";
import * as rmaController from "../controllers/rma.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";

const router = express.Router();

// ==================== BUYER ROUTES ====================

/**
 * @swagger
 * /api/rma/eligibility/{orderId}:
 *   get:
 *     summary: Check if order is eligible for return/exchange
 *     tags: [RMA - Return & Exchange]
 *     security:
 *       - bearerAuth: []
 */
router.get("/eligibility/:orderId", protect, rmaController.checkEligibility);

/**
 * @swagger
 * /api/rma/requests:
 *   post:
 *     summary: Create a return/exchange request
 *     tags: [RMA - Return & Exchange]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/requests",
  protect,
  authorize("buyer"),
  rmaController.createReturnRequest,
);

/**
 * @swagger
 * /api/rma/requests:
 *   get:
 *     summary: Get my return requests
 *     tags: [RMA - Return & Exchange]
 *     security:
 *       - bearerAuth: []
 */
router.get("/requests", protect, rmaController.getMyReturnRequests);

/**
 * @swagger
 * /api/rma/requests/{id}:
 *   get:
 *     summary: Get return request details
 *     tags: [RMA - Return & Exchange]
 *     security:
 *       - bearerAuth: []
 */
router.get("/requests/:id", protect, rmaController.getReturnRequestById);

/**
 * @swagger
 * /api/rma/requests/{id}/cancel:
 *   put:
 *     summary: Cancel return request (buyer only, before seller responds)
 *     tags: [RMA - Return & Exchange]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  "/requests/:id/cancel",
  protect,
  authorize("buyer"),
  rmaController.cancelReturnRequest,
);

/**
 * @swagger
 * /api/rma/requests/{id}/shipping:
 *   put:
 *     summary: Update return shipping info (buyer ships items back)
 *     tags: [RMA - Return & Exchange]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  "/requests/:id/shipping",
  protect,
  authorize("buyer"),
  rmaController.updateReturnShipping,
);

// ==================== WALLET ROUTES ====================

/**
 * @swagger
 * /api/rma/wallet:
 *   get:
 *     summary: Get wallet balance and transaction history
 *     tags: [RMA - Wallet]
 *     security:
 *       - bearerAuth: []
 */
router.get("/wallet", protect, rmaController.getWalletInfo);

/**
 * @swagger
 * /api/rma/wallet/transactions/{id}:
 *   get:
 *     summary: Get transaction details
 *     tags: [RMA - Wallet]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/wallet/transactions/:id",
  protect,
  rmaController.getTransactionById,
);

// ==================== SELLER ROUTES ====================

/**
 * @swagger
 * /api/rma/seller/requests:
 *   get:
 *     summary: Get all return requests for seller's products
 *     tags: [RMA - Seller]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/seller/requests",
  protect,
  authorize("seller", "admin"),
  rmaController.getSellerReturnRequests,
);

/**
 * @swagger
 * /api/rma/seller/requests/{id}/respond:
 *   put:
 *     summary: Approve or reject return request
 *     tags: [RMA - Seller]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  "/seller/requests/:id/respond",
  protect,
  authorize("seller", "admin"),
  rmaController.respondToReturnRequest,
);

/**
 * @swagger
 * /api/rma/seller/requests/{id}/confirm-received:
 *   put:
 *     summary: Confirm receiving returned items
 *     tags: [RMA - Seller]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  "/seller/requests/:id/confirm-received",
  protect,
  authorize("seller", "admin"),
  rmaController.confirmItemsReceived,
);

/**
 * @swagger
 * /api/rma/seller/requests/{id}/process-refund:
 *   post:
 *     summary: Process refund (add coins to buyer wallet)
 *     tags: [RMA - Seller]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/seller/requests/:id/process-refund",
  protect,
  authorize("seller", "admin"),
  rmaController.processRefund,
);

/**
 * @swagger
 * /api/rma/seller/requests/{id}/process-exchange:
 *   post:
 *     summary: Process exchange (create new order)
 *     tags: [RMA - Seller]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/seller/requests/:id/process-exchange",
  protect,
  authorize("seller", "admin"),
  rmaController.processExchange,
);

// ==================== ADMIN ROUTES ====================

/**
 * @swagger
 * /api/rma/admin/requests:
 *   get:
 *     summary: Get all return requests (Admin)
 *     tags: [RMA - Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/admin/requests",
  protect,
  authorize("admin"),
  rmaController.getAllReturnRequests,
);

/**
 * @swagger
 * /api/rma/admin/requests/{id}/process:
 *   post:
 *     summary: Manually process refund or exchange (Admin override)
 *     tags: [RMA - Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/admin/requests/:id/process",
  protect,
  authorize("admin"),
  rmaController.adminProcessRequest,
);

export default router;
