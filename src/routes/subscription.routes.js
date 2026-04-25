import express from "express";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import {
  createSubscriptionCheckout,
  getMySubscription,
} from "../controllers/subscription.controller.js";

const router = express.Router();

router.post("/checkout", protect, authorize("buyer"), createSubscriptionCheckout);
router.get("/me", protect, authorize("buyer"), getMySubscription);

export default router;
