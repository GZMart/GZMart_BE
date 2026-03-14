import express from "express";
import { toggleFollow, checkFollowStatus } from "../controllers/follow.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect); // All follow routes require authentication

router.post("/:shopId", toggleFollow);
router.get("/:shopId/status", checkFollowStatus);

export default router;
