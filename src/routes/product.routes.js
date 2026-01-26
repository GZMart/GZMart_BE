import express from "express";
import {
  getProducts,
  getProduct,
  getFeaturedProducts,
  getTrendingProducts,
  getNewArrivals,
  getBestOffers,
  getProductsAdvanced,
  getAvailableFilters,
  getRelatedProducts,
  getVariantByTierIndex,
  getAvailableOptionsForSelection,
  checkStockAvailability,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/product.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

// List routes (must be before :id routes)
router.get("/search", asyncHandler(getProducts)); // Alias for search
router.get("/advanced", asyncHandler(getProductsAdvanced));
router.get("/featured", asyncHandler(getFeaturedProducts));
router.get("/trending", asyncHandler(getTrendingProducts));
router.get("/new-arrivals", asyncHandler(getNewArrivals));
router.get("/best-offers", asyncHandler(getBestOffers));
router.get("/filters", asyncHandler(getAvailableFilters));

// Get all products (base route)
router.get("/", asyncHandler(getProducts));

// Create product (Seller/Admin only)
router.post(
  "/",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(createProduct)
);

// Product detail routes
router.get("/:id", asyncHandler(getProduct));
router.get("/:id/related", asyncHandler(getRelatedProducts));

// Update & Delete product (Seller/Admin only)
router.put(
  "/:id",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(updateProduct)
);
router.delete(
  "/:id",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(deleteProduct)
);

// Variant selection routes (POST)
router.post("/:id/variant", asyncHandler(getVariantByTierIndex));
router.post(
  "/:id/available-options",
  asyncHandler(getAvailableOptionsForSelection)
);

// Stock check
router.get("/model/:modelId/stock", asyncHandler(checkStockAvailability));

export default router;
