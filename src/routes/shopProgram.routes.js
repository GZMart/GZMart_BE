import express from "express";
import {
  createProgram,
  getPrograms,
  getProgram,
  updateProgram,
  deleteProgram,
  cancelProgram,
  addProducts,
  updateProductVariants,
  removeProduct,
  batchUpdateVariants,
  batchRemoveProducts,
} from "../controllers/shopProgram.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";

const router = express.Router();

// All routes require authentication and seller role
router.use(protect);
router.use(authorize("seller", "admin"));

// ==================== PROGRAM CRUD ====================

// Create a new program
router.post("/", createProgram);

// Get all seller's programs
router.get("/", getPrograms);

// Get a single program with products
router.get("/:id", getProgram);

// Update a program
router.put("/:id", updateProgram);

// Delete a program
router.delete("/:id", deleteProgram);

// Cancel a program
router.post("/:id/cancel", cancelProgram);

// ==================== PROGRAM PRODUCTS ====================

// Add products to program
router.post("/:id/products", addProducts);

// Update product variants
router.put("/:id/products/:productId", updateProductVariants);

// Remove product from program
router.delete("/:id/products/:productId", removeProduct);

// ==================== BATCH OPERATIONS ====================

// Batch update variants
router.put("/:id/products/batch", batchUpdateVariants);

// Batch remove products
router.delete("/:id/products/batch", batchRemoveProducts);

export default router;
