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

// GET /api/users - Get all users with filtering
router.get("/", asyncHandler(getAllUsers));

// GET /api/users/:id - Get user by ID
router.get("/:id", asyncHandler(getUserById));

// PATCH /api/users/:id/ban - Toggle user ban status (isActive)
router.patch("/:id/ban", asyncHandler(toggleUserStatus));

export default router;
