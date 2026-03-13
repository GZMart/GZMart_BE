import express from "express";
import {
  createSellerApplication,
  getMySellerApplications,
  listSellerApplications,
  getSellerApplicationDetail,
  approveSellerApplication,
  rejectSellerApplication,
} from "../controllers/sellerApplication.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import {
  requireExactRole,
  requireAdmin,
  ROLES,
} from "../middlewares/role.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// ── Buyer routes ──

/**
 * @swagger
 * /api/seller-applications:
 *   post:
 *     tags: [Seller Applications]
 *     summary: Submit a seller application (buyer only)
 *     description: Allows a buyer to submit a request to become a seller. Profile fields (phone, address, taxId, citizenId) are saved to the user profile. Only one pending application per user is allowed.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               provinceCode:
 *                 type: string
 *               provinceName:
 *                 type: string
 *               wardCode:
 *                 type: string
 *               wardName:
 *                 type: string
 *               taxId:
 *                 type: string
 *               citizenId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *       400:
 *         description: User is already a seller/admin or already has a pending application
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Only buyers can submit
 */
router.post(
  "/",
  requireExactRole(ROLES.BUYER),
  asyncHandler(createSellerApplication),
);

/**
 * @swagger
 * /api/seller-applications/me:
 *   get:
 *     tags: [Seller Applications]
 *     summary: Get my seller applications
 *     description: Returns all seller applications submitted by the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of applications
 *       401:
 *         description: Not authenticated
 */
router.get("/me", asyncHandler(getMySellerApplications));

// ── Admin routes ──

/**
 * @swagger
 * /api/seller-applications/admin:
 *   get:
 *     tags: [Seller Applications]
 *     summary: List all seller applications (admin only)
 *     description: Returns paginated list of seller applications. Supports filtering by status.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *         description: Filter by application status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated list of applications
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin access required
 */
router.get(
  "/admin",
  requireAdmin,
  asyncHandler(listSellerApplications),
);

/**
 * @swagger
 * /api/seller-applications/admin/{id}:
 *   get:
 *     tags: [Seller Applications]
 *     summary: Get seller application detail (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Application ID
 *     responses:
 *       200:
 *         description: Application detail
 *       404:
 *         description: Application not found
 */
router.get(
  "/admin/:id",
  requireAdmin,
  asyncHandler(getSellerApplicationDetail),
);

/**
 * @swagger
 * /api/seller-applications/admin/{id}/approve:
 *   post:
 *     tags: [Seller Applications]
 *     summary: Approve a seller application (admin only)
 *     description: Approves a pending application and upgrades the user's role from buyer to seller.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Application ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reviewNote:
 *                 type: string
 *                 description: Optional note from the admin
 *     responses:
 *       200:
 *         description: Application approved, user upgraded to seller
 *       400:
 *         description: Application is not in pending status
 *       404:
 *         description: Application not found
 */
router.post(
  "/admin/:id/approve",
  requireAdmin,
  asyncHandler(approveSellerApplication),
);

/**
 * @swagger
 * /api/seller-applications/admin/{id}/reject:
 *   post:
 *     tags: [Seller Applications]
 *     summary: Reject a seller application (admin only)
 *     description: Rejects a pending application. The user's role remains unchanged.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Application ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reviewNote:
 *                 type: string
 *                 description: Reason for rejection
 *     responses:
 *       200:
 *         description: Application rejected
 *       400:
 *         description: Application is not in pending status
 *       404:
 *         description: Application not found
 */
router.post(
  "/admin/:id/reject",
  requireAdmin,
  asyncHandler(rejectSellerApplication),
);

export default router;
