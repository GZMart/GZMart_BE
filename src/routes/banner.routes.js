import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireSeller, requireAdmin } from "../middlewares/role.middleware.js";
import * as bannerController from "../controllers/banner.controller.js";

const router = express.Router();

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/banners/active
 * @desc    Get active banners for homepage
 * @access  Public
 */
router.get("/active", asyncHandler(bannerController.getActiveBanners));

/**
 * @route   POST /api/banners/:id/click
 * @desc    Track banner click
 * @access  Public
 */
router.post("/:id/click", asyncHandler(bannerController.trackBannerClick));

// ─── AUTHENTICATED ────────────────────────────────────────────────────────────
router.use(protect);

/**
 * @route   GET /api/banners/calendar
 * @desc    Get 60-day availability calendar
 * @access  Seller
 */
router.get("/calendar", requireSeller, asyncHandler(bannerController.getCalendar));

/**
 * @route   POST /api/banners/check-slots
 * @desc    Check slot availability for date range and get pricing
 * @access  Seller
 */
router.post("/check-slots", requireSeller, asyncHandler(bannerController.checkSlots));

// ─── SELLER ───────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/banners/seller/request
 * @desc    Submit a banner ad request (deducts coins, goes to review)
 * @access  Seller
 */
router.post("/seller/request", requireSeller, asyncHandler(bannerController.createBannerRequest));

/**
 * @route   GET /api/banners/seller/my-requests
 * @desc    Get all my banner requests
 * @access  Seller
 */
router.get("/seller/my-requests", requireSeller, asyncHandler(bannerController.getMyBannerRequests));

/**
 * @route   DELETE /api/banners/seller/:id
 * @desc    Cancel a pending banner request (refunds coins)
 * @access  Seller
 */
router.delete("/seller/:id", requireSeller, asyncHandler(bannerController.cancelBannerRequest));

// ─── ADMIN ────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/banners/admin/config
 * @desc    Get slot limit and pricing config
 * @access  Admin
 */
router.get("/admin/config", requireAdmin, asyncHandler(bannerController.getAdsConfig));

/**
 * @route   GET /api/banners/admin
 * @desc    List all banners (with filters: status, ownerType)
 * @access  Admin
 */
router.get("/admin", requireAdmin, asyncHandler(bannerController.adminGetAllBanners));

/**
 * @route   POST /api/banners/admin
 * @desc    Create a system (ADMIN) banner
 * @access  Admin
 */
router.post("/admin", requireAdmin, asyncHandler(bannerController.adminCreateBanner));

/**
 * @route   PUT /api/banners/admin/:id
 * @desc    Update any banner
 * @access  Admin
 */
router.put("/admin/:id", requireAdmin, asyncHandler(bannerController.adminUpdateBanner));

/**
 * @route   POST /api/banners/admin/:id/approve
 * @desc    Approve a seller banner request
 * @access  Admin
 */
router.post("/admin/:id/approve", requireAdmin, asyncHandler(bannerController.adminApproveBanner));

/**
 * @route   POST /api/banners/admin/:id/reject
 * @desc    Reject a seller banner request (auto-refunds coins)
 * @access  Admin
 */
router.post("/admin/:id/reject", requireAdmin, asyncHandler(bannerController.adminRejectBanner));

/**
 * @route   DELETE /api/banners/admin/:id
 * @desc    Delete a banner
 * @access  Admin
 */
router.delete("/admin/:id", requireAdmin, asyncHandler(bannerController.adminDeleteBanner));

export default router;
