import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as dealController from "../controllers/deal.controller.js";

const router = express.Router();

// Public routes
router.get("/", asyncHandler(dealController.getAllActiveDeals));
router.get("/flash-sales", asyncHandler(dealController.getFlashSales));
router.get("/daily-deals", asyncHandler(dealController.getDailyDeals));
router.get("/weekend-deals", asyncHandler(dealController.getWeekendDeals));
router.get(
  "/product/:productId",
  asyncHandler(dealController.getActiveDealByProduct)
);

export default router;
