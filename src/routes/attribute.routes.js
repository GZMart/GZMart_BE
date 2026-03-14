import express from "express";
import {
  createAttribute,
  getAttributes,
  getAttributesByCategory,
  getAttribute,
  updateAttribute,
  deleteAttribute,
  bulkCreateAttributes,
  updateAttributeOrder,
  getAttributeTemplate,
} from "../controllers/attribute.controller.js";

// Import middlewares
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/attributes/category/{categoryId}:
 *   get:
 *     tags: [Attributes]
 *     summary: Get attributes by category
 *     description: Fetch all active attributes for a specific category
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Category ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       slug:
 *                         type: string
 *                         example: "material"
 *                       name:
 *                         type: string
 *                         example: "Chất liệu"
 *                       type:
 *                         type: string
 *                         enum: [text, number, date, select]
 *                         example: "select"
 *                       options:
 *                         type: array
 *                         items:
 *                           type: string
 *                         example: ["Cotton", "Polyester", "Linen"]
 *                       isRequired:
 *                         type: boolean
 *                         example: false
 *                       displayOrder:
 *                         type: integer
 *                         example: 1
 *       404:
 *         description: Category not found
 */

// Public routes
router.get("/", getAttributes);
router.get("/category/:categoryId", getAttributesByCategory);
router.get("/template/:categoryName", getAttributeTemplate);
router.get("/:id", getAttribute);

// Protected routes (Admin only)
router.post("/", protect, requireRoles("admin"), createAttribute);
router.post("/bulk", protect, requireRoles("admin"), bulkCreateAttributes);
router.put("/order", protect, requireRoles("admin"), updateAttributeOrder);
router.put("/:id", protect, requireRoles("admin"), updateAttribute);
router.delete("/:id", protect, requireRoles("admin"), deleteAttribute);

export default router;
