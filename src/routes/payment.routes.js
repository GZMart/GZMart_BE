import express from "express";
import {
  createPaymentLink,
  handlePayOsWebhook,
  getPaymentStatus,
  cancelPayment,
  checkPaymentFromPayOS,
  createTopupLink,
  checkTopupStatus
} from "../controllers/payment.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/wallet/create-link", protect, createTopupLink);
router.get("/wallet/check/:orderCode", protect, checkTopupStatus);

/**
 * @swagger
 * /api/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: PayOS webhook
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/webhook", handlePayOsWebhook);

router.use(protect);

/**
 * @swagger
 * /api/payments/create-link:
 *   post:
 *     tags: [Payments]
 *     summary: Create payment link
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/create-link", createPaymentLink);

/**
 * @swagger
 * /api/payments/status/{orderCode}:
 *   get:
 *     tags: [Payments]
 *     summary: Get payment status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/status/:orderCode", getPaymentStatus);

/**
 * @swagger
 * /api/payments/check/{orderCode}:
 *   get:
 *     tags: [Payments]
 *     summary: Check payment from PayOS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/check/:orderCode", checkPaymentFromPayOS);

/**
 * @swagger
 * /api/payments/cancel/{orderCode}:
 *   put:
 *     tags: [Payments]
 *     summary: Cancel payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.put("/cancel/:orderCode", cancelPayment);

export default router;
