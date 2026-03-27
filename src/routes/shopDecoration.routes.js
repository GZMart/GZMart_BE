import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";
import {
  getDecoration,
  saveDraft,
  publish,
  setActiveVersion,
  getWidgetCounts,
} from "../controllers/shopDecoration.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

router.use(protect);
router.use(requireRoles("seller", "admin"));

router.get("/", asyncHandler(getDecoration));
router.put("/draft", asyncHandler(saveDraft));
router.post("/publish", asyncHandler(publish));
router.put("/active-version", asyncHandler(setActiveVersion));
router.get("/counts", asyncHandler(getWidgetCounts));

export default router;
