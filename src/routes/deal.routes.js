import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";
import * as dealController from "../controllers/deal.controller.js";

const router = express.Router();

// ─── Public routes ───────────────────────────────────────────────────────────

router.get("/", asyncHandler(dealController.getAllActiveDeals));
router.get("/flash-sales", asyncHandler(dealController.getFlashSales));
router.get("/daily-deals", asyncHandler(dealController.getDailyDeals));
router.get("/weekend-deals", asyncHandler(dealController.getWeekendDeals));

// Must be before /:dealId so "my-deals" is not captured as a dealId param
router.get(
  "/my-deals",
  protect,
  asyncHandler(dealController.getMyDeals)
);

router.get(
  "/product/:productId",
  asyncHandler(dealController.getActiveDealByProduct)
);

// ─── Parameterised routes ─────────────────────────────────────────────────────

router.get("/:dealId", asyncHandler(dealController.getDealById));

export default router;
