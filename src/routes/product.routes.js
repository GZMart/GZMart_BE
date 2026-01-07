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
  getProductsAdvanced,
  getBestOffers,
  getFeaturedProducts,
  getTrendingProducts,
  getNewArrivals,
  getAvailableFilters,
  getRelatedProducts,
  getVariantByTierIndex,
  getAvailableOptions,
  checkStockAvailability,
} from "../controllers/product.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

router.get("/", getProducts);
router.get("/search", searchProducts);
router.get("/advanced", getProductsAdvanced);
router.get("/best-offers", getBestOffers);
router.get("/featured", getFeaturedProducts);
router.get("/trending", getTrendingProducts);
router.get("/new-arrivals", getNewArrivals);
router.get("/filters", getAvailableFilters);

router.get("/seller/:sellerId", getProductsBySeller);
router.get("/category/:categoryId", getProductsByCategory);
router.get("/model/:modelId/stock", checkStockAvailability);

router.get("/:id", getProduct);
router.get("/:id/related", getRelatedProducts);

router.post("/:id/variant", getVariantByTierIndex);
router.post("/:id/available-options", getAvailableOptions);

router.post("/", protect, requireRoles("seller", "admin"), createProduct);
router.put("/:id", protect, requireRoles("seller", "admin"), updateProduct);
router.delete("/:id", protect, requireRoles("seller", "admin"), deleteProduct);

export default router;