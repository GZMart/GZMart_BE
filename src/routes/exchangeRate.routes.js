import express from "express";
import {
  getExchangeRate,
  updateExchangeRate,
  triggerSync,
  getExchangeRateHistory,
} from "../controllers/exchangeRate.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";

const router = express.Router();

/**
 * GET  /api/exchange-rate          → current rate (public)
 * PUT  /api/exchange-rate          → manual override (admin/manager)
 * POST /api/exchange-rate/sync     → force immediate API sync (admin/manager)
 * GET  /api/exchange-rate/history  → rate history (admin/manager)
 */

router.get("/", getExchangeRate);

router.put("/", protect, requireRoles("admin", "seller"), updateExchangeRate);

router.post("/sync", protect, requireRoles("admin", "seller"), triggerSync);

router.get(
  "/history",
  protect,
  requireRoles("admin", "seller"),
  getExchangeRateHistory,
);

export default router;
