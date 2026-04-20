import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/role.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import {
  getPlatformSettings,
  updatePlatformSettings,
} from "../controllers/platformSettings.controller.js";

const router = express.Router();

router.use(protect);
router.use(requireAdmin);

router.get("/", asyncHandler(getPlatformSettings));
router.put("/", asyncHandler(updatePlatformSettings));

export default router;
