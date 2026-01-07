import express from "express";
import {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getProductsBySeller,
  getProductsByCategory,
  searchProducts,
} from "../controllers/product.controller.js";

// Import middlewares
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

// Public routes
router.get("/", getProducts);
router.get("/search", searchProducts);
router.get("/seller/:sellerId", getProductsBySeller);
router.get("/category/:categoryId", getProductsByCategory);
router.get("/:id", getProduct);

// Protected routes (require authentication)
router.post("/", protect, requireRoles("seller", "admin"), createProduct);
router.put("/:id", protect, requireRoles("seller", "admin"), updateProduct);
router.delete("/:id", protect, requireRoles("seller", "admin"), deleteProduct);

export default router;
