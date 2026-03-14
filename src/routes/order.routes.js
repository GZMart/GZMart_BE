import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getCheckoutInfo,
  previewOrder,
  generateInvoice,
  confirmReceipt,
  markAsDelivered,
} from "../controllers/order.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * /api/orders/checkout-info:
 *   get:
 *     tags: [Orders]
 *     summary: Get checkout info
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/checkout-info", getCheckoutInfo);

/**
 * @swagger
 * /api/orders/preview:
 *   post:
 *     tags: [Orders]
 *     summary: Preview order
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/preview", previewOrder);

/**
 * @swagger
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Create order
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Success
 *   get:
 *     tags: [Orders]
 *     summary: Get my orders
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.route("/").post(createOrder).get(getMyOrders);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get order by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.route("/:id").get(getOrderById);

/**
 * @swagger
 * /api/orders/{id}/invoice:
 *   get:
 *     tags: [Orders]
 *     summary: Generate invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/:id/invoice", generateInvoice);

/**
 * @swagger
 * /api/orders/{id}/cancel:
 *   put:
 *     tags: [Orders]
 *     summary: Cancel order
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.route("/:id/cancel").put(cancelOrder);

/**
 * @swagger
 * /api/orders/{id}/confirm-receipt:
 *   put:
 *     tags: [Orders]
 *     summary: Confirm receipt of delivered order (Phase 4 - Delivered -> Completed)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.route("/:id/confirm-receipt").put(confirmReceipt);

/**
 * @swagger
 * /api/orders/{id}/mark-delivered:
 *   put:
 *     tags: [Orders]
 *     summary: Mark order as delivered (triggered by map animation completion)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.route("/:id/mark-delivered").put(markAsDelivered);

export default router;
