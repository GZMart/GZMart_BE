import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as productController from "../controllers/product.controller.js";

const router = express.Router();

// Public routes
router.get("/", asyncHandler(productController.getProducts));
router.get("/search", asyncHandler(productController.getProducts)); // Alias for /api/products with filters
router.get("/advanced", asyncHandler(productController.getProductsAdvanced)); // MongoDB Aggregation
router.get("/best-offers", asyncHandler(productController.getBestOffers));
router.get("/featured", asyncHandler(productController.getFeaturedProducts));
router.get("/trending", asyncHandler(productController.getTrendingProducts));
router.get("/new-arrivals", asyncHandler(productController.getNewArrivals));
router.get("/filters", asyncHandler(productController.getAvailableFilters));
router.get("/:id", asyncHandler(productController.getProductDetail));
router.get("/:id/related", asyncHandler(productController.getRelatedProducts));

// Variant operations
router.post(
  "/:id/variant",
  asyncHandler(productController.getVariantByTierIndex)
);
router.post(
  "/:id/available-options",
  asyncHandler(productController.getAvailableOptions)
);
router.get(
  "/model/:modelId/stock",
  asyncHandler(productController.checkStockAvailability)
);

export default router;
