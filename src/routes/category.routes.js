import express from "express";
import {
  createCategory,
  getCategories,
  getCategoryTree,
  getCategory,
  getChildCategories,
  updateCategory,
  deleteCategory,
  permanentDeleteCategory,
  getCategoryStats,
} from "../controllers/category.controller.js";

// Import middlewares
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

// Public routes
router.get("/", getCategories);
router.get("/tree", getCategoryTree);
router.get("/:id", getCategory);
router.get("/:id/children", getChildCategories);
router.get("/:id/stats", getCategoryStats);

// Protected routes (Admin only)
router.post("/", protect, requireRoles("admin"), createCategory);
router.put("/:id", protect, requireRoles("admin"), updateCategory);
router.delete("/:id", protect, requireRoles("admin"), deleteCategory);
router.delete(
  "/:id/permanent",
  protect,
  requireRoles("admin"),
  permanentDeleteCategory
);

export default router;
