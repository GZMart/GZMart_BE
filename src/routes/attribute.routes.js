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
