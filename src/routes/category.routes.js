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
  getTopCategories,
  getFeaturedCategories,
  getCategoriesWithCounts,
  getCategoryProducts,
} from "../controllers/category.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

router.get("/", getCategories);
router.get("/tree", getCategoryTree);
router.get("/top", getTopCategories);
router.get("/featured", getFeaturedCategories);
router.get("/with-counts", getCategoriesWithCounts);

router.get("/:id", getCategory);
router.get("/:id/children", getChildCategories);
router.get("/:id/stats", getCategoryStats);
router.get("/:id/products", getCategoryProducts);

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