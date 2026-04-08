import bannerService from "../services/banner.service.js";
import { PRICE_PER_DAY, MAX_SELLER_SLOTS } from "../models/Banner.js";

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

/**
 * GET /api/banners/active
 * Get active banners for homepage (public)
 */
export const getActiveBanners = async (req, res, next) => {
  try {
    const banners = await bannerService.getActiveBanners();
    res.status(200).json({ success: true, data: banners });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/banners/:id/click
 * Track banner click (public)
 */
export const trackBannerClick = async (req, res, next) => {
  try {
    await bannerService.incrementClick(req.params.id);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/banners/calendar
 * Get 60-day slot availability calendar (authenticated sellers)
 */
export const getCalendar = async (req, res, next) => {
  try {
    const data = await bannerService.getCalendarAvailability();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/banners/check-slots
 * Check slot availability for a specific date range
 */
export const checkSlots = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: "startDate and endDate are required" });
    }

    const diffMs = new Date(endDate) - new Date(startDate);
    const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const totalFee = totalDays * PRICE_PER_DAY;

    const availability = await bannerService.checkSlotAvailability(startDate, endDate);

    res.status(200).json({
      success: true,
      data: {
        ...availability,
        pricing: { pricePerDay: PRICE_PER_DAY, totalDays, totalFee },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── SELLER ───────────────────────────────────────────────────────────────────

/**
 * POST /api/banners/seller/request
 * Submit a new banner ad request (seller only)
 */
export const createBannerRequest = async (req, res, next) => {
  try {
    const banner = await bannerService.createBannerRequest(req.user._id, req.body);
    res.status(201).json({
      success: true,
      message: "Banner request submitted successfully. Coins have been deducted. Awaiting admin review.",
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/banners/seller/my-requests
 * Get seller's own banner requests
 */
export const getMyBannerRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const result = await bannerService.getSellerBannerRequests(req.user._id, {
      page: parseInt(page),
      limit: parseInt(limit),
      status,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/banners/seller/:id
 * Cancel a pending banner request (seller only)
 */
export const cancelBannerRequest = async (req, res, next) => {
  try {
    const banner = await bannerService.cancelBannerRequest(req.params.id, req.user._id);
    res.status(200).json({
      success: true,
      message: "Banner cancelled. Coins have been refunded to your wallet.",
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────

/**
 * GET /api/banners/admin
 * Admin: list all banners (with filters)
 */
export const adminGetAllBanners = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, ownerType } = req.query;
    const result = await bannerService.adminGetAllBanners({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      ownerType,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/banners/admin
 * Admin: create a system banner
 */
export const adminCreateBanner = async (req, res, next) => {
  try {
    const banner = await bannerService.adminCreateBanner(req.user._id, req.body);
    res.status(201).json({ success: true, message: "System banner created", data: banner });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/banners/admin/:id
 * Admin: update any banner
 */
export const adminUpdateBanner = async (req, res, next) => {
  try {
    const banner = await bannerService.adminUpdateBanner(req.params.id, req.body);
    res.status(200).json({ success: true, data: banner });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/banners/admin/:id/approve
 * Admin: approve a seller banner request
 */
export const adminApproveBanner = async (req, res, next) => {
  try {
    const banner = await bannerService.adminApproveBanner(req.params.id, req.user._id);
    res.status(200).json({
      success: true,
      message: "Banner approved. It will go live on the scheduled start date.",
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/banners/admin/:id/reject
 * Admin: reject a seller banner and refund coins
 */
export const adminRejectBanner = async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    const banner = await bannerService.adminRejectBanner(req.params.id, req.user._id, rejectionReason);
    res.status(200).json({
      success: true,
      message: "Banner rejected. Seller's coins have been refunded.",
      data: banner,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/banners/admin/:id
 * Admin: delete a banner
 */
export const adminDeleteBanner = async (req, res, next) => {
  try {
    const result = await bannerService.adminDeleteBanner(req.params.id);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/banners/admin/config
 * Admin: get slot config and pricing
 */
export const getAdsConfig = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: { maxSlots: MAX_SELLER_SLOTS, pricePerDay: PRICE_PER_DAY },
    });
  } catch (error) {
    next(error);
  }
};
