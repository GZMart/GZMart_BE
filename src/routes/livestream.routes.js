import { Router } from "express";
import * as ctrl from "../controllers/livestream.controller.js";
import { protect, optionalAuth } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/session", protect, ctrl.createSession);
router.post("/session/:sessionId/start", protect, ctrl.startSession);
router.post("/session/:sessionId/token", optionalAuth, ctrl.getViewerToken);
router.post("/session/:sessionId/end", protect, ctrl.endSession);
router.get("/active", ctrl.getActiveByShop);

export default router;
