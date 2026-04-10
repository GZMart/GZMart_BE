import Banner, { MAX_SELLER_SLOTS, PRICE_PER_DAY } from "../models/Banner.js";
import WalletTransaction from "../models/WalletTransaction.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import logger from "../utils/logger.js";

class BannerService {
  // ─── SELLER: Check slot availability for a date range ──────────────────────
  async checkSlotAvailability(startDate, endDate, excludeBannerId = null) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const query = {
      ownerType: "SELLER",
      status: { $in: ["PENDING_REVIEW", "APPROVED", "RUNNING"] },
      startDate: { $lte: end },
      endDate: { $gte: start },
    };

    if (excludeBannerId) {
      query._id = { $ne: excludeBannerId };
    }

    const overlappingCount = await Banner.countDocuments(query);
    const availableSlots = MAX_SELLER_SLOTS - overlappingCount;

    return {
      maxSlots: MAX_SELLER_SLOTS,
      bookedSlots: overlappingCount,
      availableSlots: Math.max(0, availableSlots),
      isAvailable: availableSlots > 0,
    };
  }

  // ─── SELLER: Get calendar availability (next 60 days) ──────────────────────
  async getCalendarAvailability() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 60);

    // Get all active bookings in next 60 days
    const bookings = await Banner.find({
      ownerType: "SELLER",
      status: { $in: ["PENDING_REVIEW", "APPROVED", "RUNNING"] },
      startDate: { $lte: futureDate },
      endDate: { $gte: today },
    }).select("startDate endDate status");

    // Build a day-by-day map
    const calendar = {};
    for (let d = new Date(today); d <= futureDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      // Count overlapping bookings for this day
      const count = bookings.filter((b) => {
        return new Date(b.startDate) <= d && new Date(b.endDate) >= d;
      }).length;

      calendar[dateStr] = {
        bookedSlots: count,
        availableSlots: Math.max(0, MAX_SELLER_SLOTS - count),
        isFull: count >= MAX_SELLER_SLOTS,
        status:
          count >= MAX_SELLER_SLOTS
            ? "full"
            : count >= MAX_SELLER_SLOTS - 1
            ? "almost_full"
            : "available",
      };
    }

    return { calendar, pricePerDay: PRICE_PER_DAY, maxSlots: MAX_SELLER_SLOTS };
  }

  // ─── SELLER: Submit a banner ad request ────────────────────────────────────
  async createBannerRequest(sellerId, data) {
    const { title, subtitle, image, productId, startDate, endDate, link, linkType, hotspots = [] } = data;

    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    const normalizedSubtitle =
      subtitle != null && String(subtitle).trim() !== "" ? String(subtitle).trim() : null;

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Validate dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start >= end) {
      throw new ErrorResponse("End date must be after start date", 400);
    }
    if (start < today) {
      throw new ErrorResponse("Start date cannot be in the past", 400);
    }

    // Check slot availability
    const availability = await this.checkSlotAvailability(start, end);
    if (!availability.isAvailable) {
      throw new ErrorResponse(
        `No banner slots available for the selected dates. All ${MAX_SELLER_SLOTS} slots are booked.`,
        409
      );
    }

    // Calculate fee
    const diffMs = end - start;
    const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const totalFee = totalDays * PRICE_PER_DAY;

    // Check seller's coin balance
    const seller = await User.findById(sellerId);
    if (!seller) throw new ErrorResponse("Seller not found", 404);
    if ((seller.reward_point || 0) < totalFee) {
      throw new ErrorResponse(
        `Insufficient balance. Required: ${totalFee.toLocaleString()} coins. Current: ${(seller.reward_point || 0).toLocaleString()} coins.`,
        402
      );
    }

    // Validate banner document BEFORE holding coins (avoids charging when Mongoose validation fails)
    const bannerDraft = new Banner({
      title: normalizedTitle,
      subtitle: normalizedSubtitle,
      image,
      productId: productId || null,
      link: link || null,
      linkType: linkType || "product",
      hotspots: Array.isArray(hotspots) ? hotspots : [],
      startDate: start,
      endDate: end,
      ownerType: "SELLER",
      sellerId,
      status: "PENDING_REVIEW",
      paymentStatus: "HELD",
      walletTransactionId: null,
      pricing: {
        pricePerDay: PRICE_PER_DAY,
        totalDays,
        totalFee,
      },
    });

    await bannerDraft.validate();

    const holdDescription = normalizedTitle
      ? `Banner ad fee held: "${normalizedTitle}" (${totalDays} days × ${PRICE_PER_DAY.toLocaleString()} coins)`
      : `Banner ad fee held (${totalDays} days × ${PRICE_PER_DAY.toLocaleString()} coins)`;

    // Deduct coins from seller wallet (HELD status)
    const transaction = await WalletTransaction.recordTransaction({
      userId: sellerId,
      type: "promotion",
      amount: -totalFee,
      description: holdDescription,
      reference: {},
      metadata: {
        ...(normalizedTitle ? { bannerTitle: normalizedTitle } : {}),
        totalDays,
        pricePerDay: PRICE_PER_DAY,
      },
    });

    bannerDraft.walletTransactionId = transaction._id;

    try {
      await bannerDraft.save();
    } catch (err) {
      logger.error("[BannerAds] Banner save failed after coin hold; refunding seller:", err);
      await WalletTransaction.recordTransaction({
        userId: sellerId,
        type: "refund",
        amount: totalFee,
        description: `Banner ad refund: hold reversed (failed to save banner request)`,
        reference: {},
        metadata: { originalDebitId: transaction._id, error: String(err?.message || err) },
      });
      throw err;
    }

    logger.info(
      `[BannerAds] Seller ${sellerId} submitted banner "${normalizedTitle || "(no title)"}" (${totalDays} days, ${totalFee} coins deducted)`
    );

    return bannerDraft;
  }

  // ─── SELLER: Get my banner requests ────────────────────────────────────────
  async getSellerBannerRequests(sellerId, { page = 1, limit = 10, status } = {}) {
    const query = { sellerId, ownerType: "SELLER" };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [banners, total] = await Promise.all([
      Banner.find(query)
        .populate("productId", "name images models")
        .populate("hotspots.productId", "name images")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Banner.countDocuments(query),
    ]);

    return {
      banners,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // ─── SELLER: Cancel a pending or running banner ────────────────────────────
  async cancelBannerRequest(bannerId, sellerId) {
    const banner = await Banner.findOne({ _id: bannerId, sellerId });
    if (!banner) throw new ErrorResponse("Banner not found", 404);

    if (!["PENDING_REVIEW", "APPROVED", "RUNNING"].includes(banner.status)) {
      throw new ErrorResponse(
        "Only banners in PENDING_REVIEW, APPROVED, or RUNNING status can be cancelled",
        400
      );
    }

    // Calculate refund amount
    let refundAmount = 0;
    let refundDescription = "";

    if (banner.status === "RUNNING") {
      // Pro-rated refund: refund only unused days from tomorrow onwards
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = new Date(banner.endDate);
      endDate.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const remainingMs = endDate - tomorrow;
      const remainingDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)) + 1);
      const pricePerDay = banner.pricing?.pricePerDay || PRICE_PER_DAY;
      refundAmount = remainingDays * pricePerDay;
      refundDescription = `Banner partial refund: "${banner.title}" (stopped early — ${remainingDays} unused days refunded)`;
    } else if (banner.paymentStatus === "HELD" && banner.pricing?.totalFee > 0) {
      // Full refund for not-yet-running banners
      refundAmount = banner.pricing.totalFee;
      refundDescription = `Banner ad refund: "${banner.title}" (cancelled by seller)`;
    }

    if (refundAmount > 0) {
      await WalletTransaction.recordTransaction({
        userId: sellerId,
        type: "refund",
        amount: refundAmount,
        description: refundDescription,
        reference: {},
        metadata: { bannerId: banner._id },
      });
    }

    banner.status = "CANCELLED";
    banner.isActive = false;
    banner.paymentStatus = "REFUNDED";
    await banner.save();

    return banner;
  }

  // ─── ADMIN: Get all banner requests ────────────────────────────────────────
  async adminGetAllBanners({ page = 1, limit = 20, status, ownerType } = {}) {
    const query = {};
    if (status) query.status = status;
    if (ownerType) query.ownerType = ownerType;

    const skip = (page - 1) * limit;
    const [banners, total] = await Promise.all([
      Banner.find(query)
        .populate("sellerId", "fullName email avatar")
        .populate("productId", "name images models")
        .populate("reviewedBy", "fullName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Banner.countDocuments(query),
    ]);

    return {
      banners,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // ─── ADMIN: Approve a banner request ───────────────────────────────────────
  async adminApproveBanner(bannerId, adminId) {
    const banner = await Banner.findById(bannerId);
    if (!banner) throw new ErrorResponse("Banner not found", 404);

    if (banner.status !== "PENDING_REVIEW") {
      throw new ErrorResponse("Only PENDING_REVIEW banners can be approved", 400);
    }

    // If start date is today or already passed, go directly to RUNNING
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDay = new Date(banner.startDate);
    startDay.setHours(0, 0, 0, 0);

    banner.status = startDay <= today ? "RUNNING" : "APPROVED";
    banner.isActive = startDay <= today;
    banner.paymentStatus = "SETTLED";
    banner.reviewedBy = adminId;
    banner.reviewedAt = new Date();
    await banner.save();

    logger.info(`[BannerAds] Admin ${adminId} approved banner ${bannerId} → status: ${banner.status}`);
    return banner;
  }

  // ─── ADMIN: Reject a banner request ────────────────────────────────────────
  async adminRejectBanner(bannerId, adminId, rejectionReason) {
    if (!rejectionReason || rejectionReason.trim().length < 5) {
      throw new ErrorResponse("Rejection reason must be at least 5 characters", 400);
    }

    const banner = await Banner.findById(bannerId);
    if (!banner) throw new ErrorResponse("Banner not found", 404);

    if (banner.status !== "PENDING_REVIEW") {
      throw new ErrorResponse("Only PENDING_REVIEW banners can be rejected", 400);
    }

    // Refund coins to seller
    if (banner.paymentStatus === "HELD" && banner.sellerId && banner.pricing.totalFee > 0) {
      await WalletTransaction.recordTransaction({
        userId: banner.sellerId,
        type: "refund",
        amount: banner.pricing.totalFee,
        description: `Banner ad refund: "${banner.title}" (rejected by admin)`,
        reference: {},
        metadata: { bannerId: banner._id, rejectionReason },
      });
    }

    banner.status = "REJECTED";
    banner.paymentStatus = "REFUNDED";
    banner.rejectionReason = rejectionReason;
    banner.reviewedBy = adminId;
    banner.reviewedAt = new Date();
    await banner.save();

    logger.info(`[BannerAds] Admin ${adminId} rejected banner ${bannerId}: ${rejectionReason}`);
    return banner;
  }

  // ─── ADMIN: Create system (ADMIN) banner ─────────────────────────────────
  async adminCreateBanner(adminId, data) {
    const bannerData = {
      ...data,
      ownerType: "ADMIN",
      status: "RUNNING",
      paymentStatus: "SETTLED",
      isActive: true,
    };
    return await Banner.create(bannerData);
  }

  // ─── ADMIN: Update system banner ─────────────────────────────────────────
  async adminUpdateBanner(bannerId, data) {
    const banner = await Banner.findByIdAndUpdate(bannerId, data, { new: true });
    if (!banner) throw new ErrorResponse("Banner not found", 404);
    return banner;
  }

  // ─── ADMIN: Delete banner ────────────────────────────────────────────────
  async adminDeleteBanner(bannerId) {
    const banner = await Banner.findById(bannerId);
    if (!banner) throw new ErrorResponse("Banner not found", 404);

    // Refund if paid seller banner
    if (banner.ownerType === "SELLER" && banner.paymentStatus === "HELD" && banner.pricing.totalFee > 0) {
      await WalletTransaction.recordTransaction({
        userId: banner.sellerId,
        type: "refund",
        amount: banner.pricing.totalFee,
        description: `Banner ad refund: "${banner.title}" (deleted by admin)`,
        reference: {},
        metadata: { bannerId: banner._id },
      });
    }

    await Banner.findByIdAndDelete(bannerId);
    return { message: "Banner deleted successfully" };
  }

  // ─── PUBLIC: Get active banners for homepage ──────────────────────────────
  async getActiveBanners() {
    const now = new Date();

    // Admin banners: active, within date range (or no dates set)
    const adminBanners = await Banner.find({
      ownerType: "ADMIN",
      isActive: true,
      $or: [
        { startDate: null, endDate: null },
        { startDate: { $lte: now }, endDate: { $gte: now } },
        { startDate: { $lte: now }, endDate: null },
        { startDate: null, endDate: { $gte: now } },
      ],
    })
      .sort("order")
      .lean();

    // Seller banners: currently RUNNING and within active date range
    const sellerBanners = await Banner.find({
      ownerType: "SELLER",
      status: "RUNNING",
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .populate("productId", "name images")
      .populate("sellerId", "fullName avatar")
      .sort({ order: 1, createdAt: 1 })
      .limit(MAX_SELLER_SLOTS)
      .lean();

    // Merge all banners and sort by admin-assigned order so reordering is reflected
    const activeBanners = [...adminBanners, ...sellerBanners].sort((a, b) => {
      const orderA = a.order != null ? a.order : 999;
      const orderB = b.order != null ? b.order : 999;
      return orderA - orderB;
    });

    // Increment view count for all returned banners
    if (activeBanners.length > 0) {
      const bannerIds = activeBanners.map((b) => b._id);
      Banner.updateMany(
        { _id: { $in: bannerIds } },
        { $inc: { "metrics.views": 1 } }
      ).catch((err) => logger.error("[BannerAds] Failed to increment views:", err));
    }

    return activeBanners;
  }

  // ─── PUBLIC: Increment click count ───────────────────────────────────────
  async incrementClick(bannerId) {
    await Banner.findByIdAndUpdate(bannerId, {
      $inc: { "metrics.clicks": 1, clickCount: 1 },
    });
  }

  // ─── CRON: Sync banner statuses (APPROVED→RUNNING, RUNNING→COMPLETED) ────
  async syncBannerStatuses() {
    const now = new Date();

    // APPROVED → RUNNING (startDate has arrived)
    const activated = await Banner.updateMany(
      {
        ownerType: "SELLER",
        status: "APPROVED",
        startDate: { $lte: now },
      },
      { $set: { status: "RUNNING" } }
    );

    // RUNNING → COMPLETED (endDate has passed)
    const completed = await Banner.updateMany(
      {
        ownerType: "SELLER",
        status: "RUNNING",
        endDate: { $lt: now },
      },
      { $set: { status: "COMPLETED" } }
    );

    if (activated.modifiedCount > 0 || completed.modifiedCount > 0) {
      logger.info(
        `[BannerAds Cron] Activated: ${activated.modifiedCount}, Completed: ${completed.modifiedCount}`
      );
    }

    return { activated: activated.modifiedCount, completed: completed.modifiedCount };
  }

  // ─── ADMIN: Bulk reorder banners ─────────────────────────────────────────
  async adminReorderBanners(banners) {
    const bulkOps = banners.map(({ id, order }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order } },
      },
    }));
    const result = await Banner.bulkWrite(bulkOps);
    return result;
  }
}

export default new BannerService();
