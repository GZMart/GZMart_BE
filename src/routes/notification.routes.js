import express from 'express';
import NotificationController from '../controllers/notification.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get user notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', NotificationController.getNotifications);

/**
 * @swagger
 * /api/notifications/unread/count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get unread notification count
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/unread/count', NotificationController.getUnreadCount);

/**
 * @swagger
 * /api/notifications/read-all:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark all unread notifications as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.put('/read-all', NotificationController.markAllAsRead);

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark a single notification as read
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
router.put('/:id/read', NotificationController.markAsRead);

/**
 * @swagger
 * /api/notifications/broadcast:
 *   post:
 *     tags: [Notifications]
 *     summary: Broadcast a global notification (Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - message
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               type:
 *                 type: string
 *               relatedData:
 *                 type: object
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/broadcast', NotificationController.broadcastNotification);

/**
 * @swagger
 * /api/notifications/shop/announce:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a manual announcement to all shop followers (Seller only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - message
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [PROMOTION, ANNOUNCEMENT, FLASH_SALE, VOUCHER]
 *     responses:
 *       200:
 *         description: Sent successfully
 */
router.post('/shop/announce', NotificationController.sendFollowerAnnouncement);

export default router;
