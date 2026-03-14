import express from "express";
import {
  getProductPromotions,
  getProductPromotionsBatch,
} from "../controllers/promotionPublic.controller.js";

const router = express.Router();

// Batch route MUST come before /:productId to avoid param conflict
// POST /api/products/promotions/batch
router.post("/promotions/batch", getProductPromotionsBatch);

// Public route — no auth required
// GET /api/products/:productId/promotions
router.get("/:productId/promotions", getProductPromotions);

export default router;
