import { Router } from "express";
import * as ctrl from "../controllers/livestream.controller.js";
import { protect, optionalAuth } from "../middlewares/auth.middleware.js";
import pkg from "rate-limiter-flexible";
const { RateLimiterMemory } = pkg;
const RateLimiterRes = pkg.RateLimiterRes;

// Rate limiters (in-memory, per-process)
const chatRateLimiter = new RateLimiterMemory({
  points: 10,       // 10 messages
  duration: 60,     // per 60 seconds
  blockDuration: 10,
});

const viewerTokenRateLimiter = new RateLimiterMemory({
  points: 1,        // 1 token request
  duration: 10,     // per 10 seconds (prevents token-grabbing spam)
  blockDuration: 5,
});

// Middleware: rate limit viewer token requests
export async function viewerTokenRateLimitMiddleware(req, res, next) {
  const key = req.params.sessionId || req.ip;
  try {
    await viewerTokenRateLimiter.consume(key);
    next();
  } catch (e) {
    if (e instanceof RateLimiterRes) {
      res.status(429).json({ message: "Too many requests. Please wait." });
    } else {
      console.error('[RateLimit] Unexpected error:', e);
      next(e);
    }
  }
}

const router = Router();

router.post("/session", protect, ctrl.createSession);
router.post("/session/:sessionId/start", protect, ctrl.startSession);
router.post("/session/:sessionId/token", optionalAuth, viewerTokenRateLimitMiddleware, ctrl.getViewerToken);
router.post("/session/:sessionId/end", protect, ctrl.endSession);
router.get("/active", ctrl.getActiveByShop);
router.get('/session/:sessionId/config', ctrl.getSessionConfig);
router.get("/session/:sessionId", ctrl.getSession);
router.put("/session/:sessionId", protect, ctrl.updateSession);
router.get('/session/:sessionId/products', ctrl.getSessionProducts);
router.post('/session/:sessionId/products', protect, ctrl.addSessionProducts);
router.delete('/session/:sessionId/products/:productId', protect, ctrl.removeSessionProduct);
router.get('/session/:sessionId/vouchers', ctrl.getSessionVouchers);
router.post('/session/:sessionId/vouchers', protect, ctrl.addSessionVouchers);
router.delete('/session/:sessionId/vouchers/:voucherId', protect, ctrl.removeSessionVoucher);
router.post('/session/:sessionId/pin', protect, ctrl.pinProduct);
router.post('/session/:sessionId/unpin', protect, ctrl.unpinProduct);
router.get('/session/:sessionId/messages', ctrl.getSessionMessages);
router.post('/session/:sessionId/like', ctrl.likeSession);

// POST /api/livestream/webhook — LiveKit webhook (no auth — LiveKit signs with API key)
router.post("/webhook", ctrl.handleLiveKitWebhook);

// GET /api/livestream/health — monitoring endpoint (no auth for internal use)
router.get("/health", ctrl.getStreamHealth);

export default router;
