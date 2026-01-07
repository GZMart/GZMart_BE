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
} from "../controllers/product.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

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

// Product detail routes
router.get("/:id", asyncHandler(getProduct));
router.get("/:id/related", asyncHandler(getRelatedProducts));

// Variant selection routes (POST)
router.post("/:id/variant", asyncHandler(getVariantByTierIndex));
router.post(
  "/:id/available-options",
  asyncHandler(getAvailableOptionsForSelection)
);

// Stock check
router.get("/model/:modelId/stock", asyncHandler(checkStockAvailability));

export default router;
