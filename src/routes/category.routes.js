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

/**
 * @swagger
 * /api/categories:
 *   get:
 *     tags: [Categories]
 *     summary: Get all categories
 *     responses:
 *       200:
 *         description: Success
 *   post:
 *     tags: [Categories]
 *     summary: Create category
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Success
 */
router.get("/", getCategories);

/**
 * @swagger
 * /api/categories/tree:
 *   get:
 *     tags: [Categories]
 *     summary: Get category tree
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/tree", getCategoryTree);

/**
 * @swagger
 * /api/categories/top:
 *   get:
 *     tags: [Categories]
 *     summary: Get top categories
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/top", getTopCategories);

/**
 * @swagger
 * /api/categories/featured:
 *   get:
 *     tags: [Categories]
 *     summary: Get featured categories
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/featured", getFeaturedCategories);

/**
 * @swagger
 * /api/categories/with-counts:
 *   get:
 *     tags: [Categories]
 *     summary: Get categories with product counts
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/with-counts", getCategoriesWithCounts);

/**
 * @swagger
 * /api/categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get category by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *   put:
 *     tags: [Categories]
 *     summary: Update category
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
 *   delete:
 *     tags: [Categories]
 *     summary: Delete category
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
  permanentDeleteCategory,
);

export default router;
