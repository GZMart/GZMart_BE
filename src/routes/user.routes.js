import express from "express";
import {
  getAllUsers,
  getUserById,
  toggleUserStatus,
} from "../controllers/user.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/role.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

// All routes require authentication and admin role
router.use(protect);
router.use(requireAdmin);

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: Get all users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", asyncHandler(getAllUsers));

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get user by ID
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
router.get("/:id", asyncHandler(getUserById));

/**
 * @swagger
 * /api/users/{id}/ban:
 *   patch:
 *     tags: [Users]
 *     summary: Toggle user ban status
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
router.patch("/:id/ban", asyncHandler(toggleUserStatus));

export default router;
