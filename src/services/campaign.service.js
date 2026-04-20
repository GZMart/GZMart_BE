import Deal from "../models/Deal.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import NotificationService from "./notification.service.js";
import { sendTemplatedEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../templates/email.templates.js";

function escapeHtml(s) {
  if (s == null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToEmailHtml(text) {
  return escapeHtml(text).replace(/\r\n/g, "\n").split("\n").filter(Boolean).map((line) => `<p style="margin:0 0 8px 0;">${line}</p>`).join("");
}

// Allowed deal types - maps to Deal model's enum
const DEAL_TYPES = [
  "flash_sale",
  "daily_deal",
  "weekly_deal",
  "limited_time",
  "clearance",
  "special",
];

// Human-readable labels for deal types
const TYPE_LABELS = {
  flash_sale: "Flash Sale",
  daily_deal: "Daily Deal",
  weekly_deal: "Weekly Deal",
  limited_time: "Limited Time Deal",
  clearance: "Clearance",
  special: "Special Deal",
};

/**
 * Format deal type key to human-readable name
 */
function formatTypeName(type) {
  return TYPE_LABELS[type] || type;
}

// Helper to map DB Deal fields back to legacy Flash Sale API response
function mapToCampaignShape(deal) {
  if (!deal) return deal;

  const originalPrice = deal.productId?.originalPrice || 0;

  return {
    _id: deal._id,
    type: deal.type || null, // Include deal type
    sellerId: deal.sellerId,
    productId: deal.productId?.toJSON
      ? deal.productId.toJSON()
      : deal.productId,
    campaignTitle: deal.title || null,
    variantSku: deal.variantSku || null,
    salePrice: deal.dealPrice || 0,
    originalPrice,
    discountAmount: originalPrice
      ? Math.max(0, originalPrice - (deal.dealPrice || 0))
      : 0,
    discountPercent: originalPrice
      ? Math.round(
          ((originalPrice - (deal.dealPrice || 0)) / originalPrice) * 10000,
        ) / 100
      : 0,
    totalQuantity: deal.quantityLimit || 0,
    soldQuantity: deal.soldCount || 0,
    remainingQuantity: Math.max(
      0,
      (deal.quantityLimit || 0) - (deal.soldCount || 0),
    ),
    soldPercentage:
      deal.quantityLimit && deal.quantityLimit > 0
        ? Math.round(((deal.soldCount || 0) / deal.quantityLimit) * 10000) / 100
        : 0,
    startAt: deal.startDate,
    endAt: deal.endDate,
    timeRemaining: Math.max(0, new Date(deal.endDate).getTime() - Date.now()),
    status: deal.status,
    createdAt: deal.createdAt,
    adminStopReason: deal.adminStopReason ?? null,
    adminStoppedAt: deal.adminStoppedAt ?? null,
    adminStoppedBy: deal.adminStoppedBy ?? null,
  };
}

/**
 * Create a new flash sale for a product
 */
export const createCampaign = async (flashSaleData) => {
  const {
    productId,
    salePrice,
    totalQuantity,
    startAt,
    endAt,
    sellerId,
    variantSku,
    campaignTitle,
    purchaseLimitPerOrder,
    purchaseLimitPerUser,
  } = flashSaleData;

  // Required field validation
  if (
    !productId ||
    salePrice === undefined ||
    !totalQuantity ||
    !startAt ||
    !endAt
  ) {
    throw new ErrorResponse(
      "Please provide productId, salePrice, totalQuantity, startAt, and endAt",
      400,
    );
  }

  // salePrice must be > 0
  if (Number(salePrice) <= 0) {
    throw new ErrorResponse("salePrice must be greater than 0", 400);
  }

  // totalQuantity must be >= 1
  if (Number(totalQuantity) < 1) {
    throw new ErrorResponse("totalQuantity must be at least 1", 400);
  }

  const start = new Date(startAt);
  const end = new Date(endAt);

  // startAt must be before endAt
  if (start >= end) {
    throw new ErrorResponse("startAt must be before endAt", 400);
  }

  // startAt must be in the future
  if (start <= new Date()) {
    throw new ErrorResponse("startAt must be in the future", 400);
  }

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  // Check for duplicate active/upcoming flash sale for this product
  const existingFlashSale = await Deal.findOne({
    productId,
    type: "flash_sale",
    status: { $in: ["pending", "active"] },
  });
  if (existingFlashSale) {
    throw new ErrorResponse(
      "An active or upcoming flash sale already exists for this product",
      400,
    );
  }

  // Calculate discount dynamically based on provided salePrice vs product originalPrice
  const originalPrice = product.originalPrice || 0;
  let discountPercent = 0;
  if (originalPrice > 0) {
    discountPercent = Math.max(
      0,
      Math.round(((originalPrice - salePrice) / originalPrice) * 10000) / 100,
    );
  }

  const flashSale = await Deal.create({
    type: "flash_sale",
    productId,
    variantSku: variantSku || null,
    title: campaignTitle || null,
    dealPrice: Number(salePrice),
    discountPercent,
    quantityLimit: Number(totalQuantity),
    startDate: start,
    endDate: end,
    sellerId: sellerId || product.sellerId,
    purchaseLimitPerOrder: purchaseLimitPerOrder || 1,
    purchaseLimitPerUser: purchaseLimitPerUser || 1,
  });

  return mapToCampaignShape(flashSale);
};

/**
 * Create multiple flash-sale deals in one batch for a single product.
 * Each entry in `variants[]` becomes its own Deal document.
 *
 * Payload:
 *   { productId, campaignTitle, startAt, endAt, sellerId, type,
 *     variants: [{ variantSku, salePrice, totalQuantity,
 *                  purchaseLimitPerOrder, purchaseLimitPerUser }] }
 */
export const createBatchCampaign = async (batchData) => {
  const {
    productId,
    campaignTitle,
    startAt,
    endAt,
    sellerId,
    type = "flash_sale",
    variants,
  } = batchData;

  // Validate type
  if (!DEAL_TYPES.includes(type)) {
    throw new ErrorResponse(
      `Invalid deal type. Allowed types: ${DEAL_TYPES.join(", ")}`,
      400,
    );
  }

  if (
    !productId ||
    !startAt ||
    !endAt ||
    !Array.isArray(variants) ||
    variants.length === 0
  ) {
    throw new ErrorResponse(
      "Please provide productId, startAt, endAt, and at least one variant",
      400,
    );
  }

  const start = new Date(startAt);
  const end = new Date(endAt);

  if (start >= end) {
    throw new ErrorResponse("startAt must be before endAt", 400);
  }
  if (start <= new Date()) {
    throw new ErrorResponse("startAt must be in the future", 400);
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const originalPrice = product.originalPrice || 0;
  const resolvedSellerId = sellerId || product.sellerId;

  // Validate each variant and check for duplicates
  for (const v of variants) {
    if (v.salePrice === undefined || v.salePrice <= 0) {
      throw new ErrorResponse(
        `salePrice must be > 0 for variant ${v.variantSku || "(no sku)"}`,
        400,
      );
    }
    if (!v.totalQuantity || Number(v.totalQuantity) < 1) {
      throw new ErrorResponse(
        `totalQuantity must be >= 1 for variant ${v.variantSku || "(no sku)"}`,
        400,
      );
    }

    const dupQuery = {
      productId,
      type, // Use dynamic type instead of hardcoded "flash_sale"
      status: { $in: ["pending", "active"] },
    };
    if (v.variantSku) dupQuery.variantSku = v.variantSku;

    const existing = await Deal.findOne(dupQuery);
    if (existing) {
      throw new ErrorResponse(
        `An active or upcoming ${formatTypeName(type)} already exists for ${
          v.variantSku ? `variant ${v.variantSku}` : "this product"
        }`,
        400,
      );
    }
  }

  // Create one Deal per variant
  const created = await Promise.all(
    variants.map((v) => {
      const salePrice = Number(v.salePrice);
      const discountPercent =
        originalPrice > 0
          ? Math.max(
              0,
              Math.round(
                ((originalPrice - salePrice) / originalPrice) * 10000,
              ) / 100,
            )
          : 0;

      return Deal.create({
        type, // Use dynamic type
        productId,
        variantSku: v.variantSku || null,
        title: campaignTitle || null,
        dealPrice: salePrice,
        discountPercent,
        quantityLimit: Number(v.totalQuantity),
        startDate: start,
        endDate: end,
        sellerId: resolvedSellerId,
        purchaseLimitPerOrder: v.purchaseLimitPerOrder || 1,
        purchaseLimitPerUser: v.purchaseLimitPerUser || 1,
      });
    }),
  );

  return created.map(mapToCampaignShape);
};

/**
 * Get all campaigns (grouped by product + title + startAt + endAt) with pagination
 * Returns campaigns with aggregated SKU data
 */
export const getCampaigns = async (filters = {}, user = null) => {
  const {
    page = 1,
    limit = 10,
    status,
    sortBy = "createdAt",
    type,
    sellerId: filterSellerId,
  } = filters;
  const skip = (page - 1) * limit;

  // Base filter for Deal documents
  const filterQuery = type ? { type } : {};
  if (user && user.role === "seller") {
    filterQuery.sellerId = user._id;
  } else if (user && user.role === "admin" && filterSellerId) {
    filterQuery.sellerId = filterSellerId;
  }
  if (status) {
    if (status === "upcoming") filterQuery.status = "pending";
    else filterQuery.status = status;
  }

  const sortOptions = {
    createdAt: { createdAt: -1 },
    "newest-first": { createdAt: -1 },
    "oldest-first": { createdAt: 1 },
    startDate: { startDate: 1 },
    endDate: { endDate: 1 },
    upcoming: { startDate: 1 },
    "active-first": { status: -1 },
  };
  const sortStage = sortOptions[sortBy] || { createdAt: -1 };

  let dealsQuery = Deal.find(filterQuery).populate(
    "productId",
    "name sku originalPrice images models",
  );
  if (user && user.role === "admin") {
    dealsQuery = dealsQuery.populate("sellerId", "shopName fullName email");
  }
  const allDeals = await dealsQuery.sort(sortStage).lean();

  // Group deals by productId + title + startDate + endDate to form campaigns
  const campaignMap = {};
  allDeals.forEach((deal) => {
    const key = `${deal.productId?._id}_${deal.title}_${deal.startDate}_${deal.endDate}`;
    if (!campaignMap[key]) {
      campaignMap[key] = {
        _id: deal._id,
        productId: deal.productId,
        sellerId: deal.sellerId,
        campaignTitle: deal.title,
        type: deal.type,
        startAt: deal.startDate,
        endAt: deal.endDate,
        status: deal.status,
        variants: [],
      };
    }
    campaignMap[key].variants.push(mapToCampaignShape(deal));
  });

  const allCampaigns = Object.values(campaignMap);
  const totalCampaigns = allCampaigns.length;
  const paginatedCampaigns = allCampaigns.slice(skip, skip + Number(limit));

  // Aggregate variant data for each campaign
  const campaigns = paginatedCampaigns.map((campaign) => {
    const records = campaign.variants;
    const totalQty = records.reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const totalSold = records.reduce((s, r) => s + (r.soldQuantity || 0), 0);
    const priceMin = Math.min(...records.map((r) => r.salePrice || 0));
    const priceMax = Math.max(...records.map((r) => r.salePrice || 0));
    const statusOrder = {
      active: 3,
      pending: 2,
      upcoming: 2,
      expired: 1,
      ended: 1,
      cancelled: 0,
    };
    const topStatus = records.reduce(
      (best, r) =>
        (statusOrder[r.status] || 0) > (statusOrder[best] || 0)
          ? r.status
          : best,
      campaign.status,
    );

    // If endAt has passed, force status to expired (time-based override, not quantity-based)
    const now = new Date();
    const effectiveStatus =
      campaign.endAt && new Date(campaign.endAt) <= now && topStatus !== "cancelled"
        ? "expired"
        : topStatus;

    return {
      ...campaign,
      salePrice: priceMin,
      salePriceMax: priceMax,
      totalQuantity: totalQty,
      soldQuantity: totalSold,
      status: effectiveStatus,
      skuCount: records.length,
    };
  });

  return {
    data: campaigns,
    page: Number(page),
    limit: Number(limit),
    total: totalCampaigns,
  };
};

/**
 * Get flash sale detail by ID
 */
export const getCampaignDetail = async (campaignId) => {
  const campaign = await Deal.findOne({
    _id: campaignId,
  }).populate(
    "productId",
    "name sku slug images description originalPrice models",
  );

  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  // Force expired based on endAt (time-based, not DB-dependent)
  const result = mapToCampaignShape(campaign);
  if (campaign.endDate && new Date(campaign.endDate) <= new Date() && result.status !== "cancelled") {
    result.status = "expired";
  }
  return result;
};

/**
 * Get active flash sales with countdown info
 */
export const getActiveCampaigns = async () => {
  const now = new Date();
  // Lọc bỏ các deal có productId bị xóa hoặc inactive
  const campaigns = await Deal.find({
    status: "active",
    productId: { $ne: null },
  })
    .populate({
      path: "productId",
      match: { status: { $ne: "inactive" } },
      select: "name sku slug images originalPrice rating reviewCount sold models",
    })
    .lean();

  // Lọc bỏ: (1) deal có productId populate trả về null, (2) deal đã hết hạn theo endDate
  const validCampaigns = campaigns
    .filter((c) => c.productId != null)
    .filter((c) => c.endDate && new Date(c.endDate) > now);

  return validCampaigns.map(mapToCampaignShape);
};

/**
 * Get flash sale stats
 */
export const getCampaignStats = async (campaignId, user = null) => {
  const campaign = await Deal.findOne({
    _id: campaignId,
  }).populate("productId", "name sku originalPrice images models");

  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  // Sellers can only view stats for their own campaigns
  if (
    user &&
    user.role === "seller" &&
    campaign.sellerId?.toString() !== user._id.toString()
  ) {
    throw new ErrorResponse("Not authorized to access this campaign", 403);
  }

  return mapToCampaignShape(campaign);
};

/**
 * Search campaign products by keyword
 */
export const searchCampaignProducts = async (
  campaignId,
  searchTerm,
  pagination = {},
) => {
  const campaign = await Deal.findOne({
    _id: campaignId,
  }).populate("productId", "name sku slug images models");

  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  const product = campaign.productId;
  const term = (searchTerm || "").toLowerCase();
  const matches =
    product &&
    (product.name?.toLowerCase().includes(term) ||
      product.sku?.toLowerCase().includes(term) ||
      product.slug?.toLowerCase().includes(term));

  if (matches) {
    return {
      total: 1,
      page: 1,
      limit: 10,
      data: [mapToCampaignShape(campaign)],
    };
  }

  return { total: 0, page: 1, limit: 10, data: [] };
};

/**
 * Update campaign
 */
export const updateCampaign = async (campaignId, updateData, user = null) => {
  const {
    salePrice,
    totalQuantity,
    startAt,
    endAt,
    variantSku,
    campaignTitle,
    purchaseLimitPerOrder,
    purchaseLimitPerUser,
  } = updateData;

  const campaign = await Deal.findOne({
    _id: campaignId,
  });
  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  // Sellers can only update their own campaigns
  if (
    user &&
    user.role === "seller" &&
    campaign.sellerId?.toString() !== user._id.toString()
  ) {
    throw new ErrorResponse("Not authorized to update this campaign", 403);
  }

  // Admin stop / hủy — không cho seller (hay bất kỳ ai qua API này) "sửa" để kích hoạt lại
  if (campaign.status === "cancelled") {
    throw new ErrorResponse(
      "Campaign đã bị dừng hoặc hủy — không thể chỉnh sửa. Vui lòng tạo campaign mới nếu cần.",
      400,
    );
  }

  const now = new Date();
  const isActive = campaign.startDate <= now && campaign.endDate >= now;
  const isPending = campaign.startDate > now;

  // If campaign already started, disallow changing startAt
  if (startAt && isActive) {
    const requestedStart = new Date(startAt);
    // Only block if trying to change to a genuinely different value
    if (
      Math.abs(requestedStart.getTime() - campaign.startDate.getTime()) > 1000
    ) {
      throw new ErrorResponse(
        "Cannot change start time of an already active flash sale",
        400,
      );
    }
    // Same value sent back – just ignore it
  }

  // For pending flash sales, validate that new startAt is in the future
  if (startAt && isPending) {
    const newStart = new Date(startAt);
    if (newStart <= now) {
      throw new ErrorResponse("startAt must be in the future", 400);
    }
  }

  if (endAt) {
    const newStartAt =
      startAt && isPending ? new Date(startAt) : campaign.startDate;
    const newEndAt = new Date(endAt);
    if (newStartAt >= newEndAt) {
      throw new ErrorResponse("startAt must be before endAt", 400);
    }
    if (newEndAt <= now) {
      throw new ErrorResponse("endAt must be in the future", 400);
    }
  }

  if (salePrice !== undefined) campaign.dealPrice = Number(salePrice);
  if (totalQuantity !== undefined)
    campaign.quantityLimit = Number(totalQuantity);
  // Only update startAt when campaign hasn't started yet
  if (startAt && isPending) campaign.startDate = new Date(startAt);
  if (endAt) campaign.endDate = new Date(endAt);
  if (variantSku !== undefined) campaign.variantSku = variantSku;
  if (campaignTitle !== undefined) campaign.title = campaignTitle;
  if (purchaseLimitPerOrder !== undefined)
    campaign.purchaseLimitPerOrder = Number(purchaseLimitPerOrder);
  if (purchaseLimitPerUser !== undefined)
    campaign.purchaseLimitPerUser = Number(purchaseLimitPerUser);

  // Recalculate status based on dates (pre-save hook also does this).
  // Campaign cancelled đã bị từ chối ở trên — không thể tới đây với status cancelled.
  const updatedNow = new Date();
  if (campaign.startDate > updatedNow) {
    campaign.status = "pending";
  } else if (campaign.endDate < updatedNow) {
    campaign.status = "expired";
  } else {
    campaign.status = "active";
  }

  await campaign.save();
  return mapToCampaignShape(campaign);
};

/**
 * Delete campaign
 */
export const deleteCampaign = async (campaignId, user = null) => {
  const campaign = await Deal.findOne({
    _id: campaignId,
  });

  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  // Sellers can only delete their own campaigns
  if (
    user &&
    user.role === "seller" &&
    campaign.sellerId?.toString() !== user._id.toString()
  ) {
    throw new ErrorResponse("Not authorized to delete this campaign", 403);
  }

  await campaign.deleteOne();
  return mapToCampaignShape(campaign);
};

/**
 * Pause an active campaign - sets all variants in the group to "paused"
 */
export const pauseCampaign = async (campaignId, user = null) => {
  const campaign = await Deal.findOne({ _id: campaignId });
  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  if (user && user.role === "seller" && campaign.sellerId?.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to pause this campaign", 403);
  }

  if (campaign.status !== "active" && campaign.status !== "pending") {
    throw new ErrorResponse("Only active or pending campaigns can be paused", 400);
  }

  // Pause ALL variants in the same campaign group (same productId + title + startDate + endDate)
  const groupQuery = {
    productId: campaign.productId,
    title: campaign.title,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    status: { $in: ["active", "pending"] },
  };

  const result = await Deal.updateMany(groupQuery, { $set: { status: "paused" } });

  // Return the first updated deal as representative
  const updated = await Deal.findOne({ _id: campaignId });
  return { ...mapToCampaignShape(updated), pausedCount: result.modifiedCount };
};

/**
 * Stop (cancelled) a campaign - sets all variants in the group to "cancelled"
 * Admin bắt buộc `reason` (tối thiểu 10 ký tự); lưu audit + gửi thông báo & email cho seller.
 */
export const stopCampaign = async (campaignId, user = null, options = {}) => {
  const { reason } = options;

  const campaign = await Deal.findOne({ _id: campaignId }).populate(
    "productId",
    "name sku",
  );
  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  if (user && user.role === "seller" && campaign.sellerId?.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to stop this campaign", 403);
  }

  const isAdmin = user && user.role === "admin";
  if (isAdmin) {
    const r = (reason || "").trim();
    if (!r || r.length < 10) {
      throw new ErrorResponse(
        "Lý do dừng campaign là bắt buộc (tối thiểu 10 ký tự) khi thao tác bằng tài khoản quản trị",
        400,
      );
    }
    if (r.length > 4000) {
      throw new ErrorResponse("Lý do không được vượt quá 4000 ký tự", 400);
    }
  }

  if (campaign.status === "expired" || campaign.status === "cancelled") {
    throw new ErrorResponse("Campaign is already ended or cancelled", 400);
  }

  const groupQuery = {
    productId: campaign.productId?._id || campaign.productId,
    title: campaign.title,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    status: { $nin: ["expired", "cancelled"] },
  };

  let result;
  if (isAdmin) {
    const r = (reason || "").trim();
    result = await Deal.updateMany(groupQuery, {
      $set: {
        status: "cancelled",
        adminStopReason: r,
        adminStoppedAt: new Date(),
        adminStoppedBy: user._id,
      },
    });

    const sellerId = campaign.sellerId;
    if (sellerId) {
      const productName =
        campaign.productId?.name || "Sản phẩm";
      const notifTitle = "Campaign Flash Sale đã bị dừng — GZMart";
      const notifBody = `Quản trị đã dừng campaign liên quan sản phẩm "${productName}".\n\nLý do: ${r}`;
      try {
        await NotificationService.createNotification(
          sellerId,
          notifTitle,
          notifBody,
          "CAMPAIGN_ADMIN",
          {
            dealId: campaign._id.toString(),
            productId: (campaign.productId?._id || campaign.productId)?.toString?.(),
            action: "admin_stop",
          },
        );
      } catch (e) {
        /* log ở caller nếu cần */
      }

      const sellerUser = await User.findById(sellerId).select("email fullName").lean();
      if (sellerUser?.email && emailTemplates.CAMPAIGN_SELLER_NOTICE) {
        const bodyHtml = textToEmailHtml(
          `Sản phẩm: ${productName}\n\nCampaign Flash Sale đã bị dừng bởi quản trị viên.\n\nLý do:\n${r}`,
        );
        try {
          await sendTemplatedEmail({
            email: sellerUser.email,
            templateType: "CAMPAIGN_SELLER_NOTICE",
            templateData: {
              name: sellerUser.fullName,
              heading: "Campaign đã bị dừng",
              bodyHtml,
            },
          });
        } catch (e) {
          /* email optional */
        }
      }
    }
  } else {
    result = await Deal.updateMany(groupQuery, { $set: { status: "cancelled" } });
  }

  const updated = await Deal.findOne({ _id: campaignId });
  return { ...mapToCampaignShape(updated), cancelledCount: result.modifiedCount };
};

/**
 * Admin cảnh cáo seller về vi phạm campaign — thông báo in-app + email.
 */
export const warnSellerAboutCampaign = async (campaignId, user, options = {}) => {
  if (!user || user.role !== "admin") {
    throw new ErrorResponse("Chỉ quản trị viên mới gửi được cảnh cáo", 403);
  }

  const { message, title } = options;
  const msg = (message || "").trim();
  if (!msg || msg.length < 10) {
    throw new ErrorResponse("Nội dung cảnh cáo phải có ít nhất 10 ký tự", 400);
  }
  if (msg.length > 4000) {
    throw new ErrorResponse("Nội dung không được vượt quá 4000 ký tự", 400);
  }

  const campaign = await Deal.findOne({ _id: campaignId }).populate(
    "productId",
    "name sku",
  );
  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  const sellerId = campaign.sellerId;
  if (!sellerId) {
    throw new ErrorResponse("Campaign không gắn seller", 400);
  }

  const productName = campaign.productId?.name || "Sản phẩm";
  const notifTitle =
    (title || "").trim() || "Cảnh cáo vi phạm — Campaign Flash Sale";
  const notifBody = `Sản phẩm: ${productName}\n\n${msg}`;

  await NotificationService.createNotification(
    sellerId,
    notifTitle,
    notifBody,
    "CAMPAIGN_ADMIN",
    {
      dealId: campaign._id.toString(),
      productId: (campaign.productId?._id || campaign.productId)?.toString?.(),
      action: "warning",
    },
  );

  const sellerUser = await User.findById(sellerId).select("email fullName").lean();
  if (sellerUser?.email) {
    const bodyHtml = textToEmailHtml(
      `Sản phẩm: ${productName}\n\n${msg}`,
    );
    try {
      await sendTemplatedEmail({
        email: sellerUser.email,
        templateType: "CAMPAIGN_SELLER_NOTICE",
        templateData: {
          name: sellerUser.fullName,
          heading: notifTitle,
          bodyHtml,
        },
      });
    } catch (e) {
      /* email optional */
    }
  }

  return { success: true, message: "Đã gửi cảnh cáo tới seller" };
};

/**
 * Resume a paused campaign - reactivates ALL variants in the group
 */
export const resumeCampaign = async (campaignId, user = null) => {
  const campaign = await Deal.findOne({ _id: campaignId });
  if (!campaign) {
    throw new ErrorResponse("Campaign not found", 404);
  }

  if (user && user.role === "seller" && campaign.sellerId?.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to resume this campaign", 403);
  }

  if (campaign.status !== "paused") {
    throw new ErrorResponse("Only paused campaigns can be resumed", 400);
  }

  // Resume ALL variants in the same campaign group
  const groupQuery = {
    productId: campaign.productId,
    title: campaign.title,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    status: "paused",
  };

  // Reactivate based on dates
  const now = new Date();
  let newStatus;
  if (campaign.startDate > now) {
    newStatus = "pending";
  } else if (campaign.endDate < now) {
    throw new ErrorResponse("Campaign end date has passed, cannot resume", 400);
  } else {
    newStatus = "active";
  }

  const result = await Deal.updateMany(groupQuery, { $set: { status: newStatus } });

  // Return the first updated deal as representative
  const updated = await Deal.findOne({ _id: campaignId });
  return { ...mapToCampaignShape(updated), resumedCount: result.modifiedCount };
};

/**
 * Get deal price for order (price override logic - supports all deal types)
 */
export const getCampaignPrice = async (productId, regularPrice) => {
  const now = new Date();

  // Find active deal for this product (any deal type)
  const deal = await Deal.findOne({
    productId,
    status: "active",
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).lean();

  if (deal) {
    const dealPrice =
      deal.dealPrice || regularPrice * (1 - (deal.discountPercent || 0) / 100);

    return {
      price: dealPrice,
      originalPrice: regularPrice,
      discountPercent: Math.round(
        ((regularPrice - dealPrice) / regularPrice) * 100,
      ),
      isFlashSale: deal.type === "flash_sale",
      flashSaleId: deal._id,
    };
  }

  return {
    price: regularPrice,
    originalPrice: regularPrice,
    discountPercent: 0,
    isFlashSale: false,
    flashSaleId: null,
  };
};

/**
 * Sync deal statuses based on current time.
 * Activates pending deals whose startDate has passed, and expires
 * active deals whose endDate has passed.
 * Called by the background scheduler and on-demand.
 */
export const syncDealStatuses = async () => {
  const now = new Date();

  // pending → active
  await Deal.updateMany(
    {
      status: "pending",
      startDate: { $lte: now },
      endDate: { $gt: now },
    },
    { $set: { status: "active" } },
  );

  // pending → expired (end date passed before ever going active, e.g. server was down)
  await Deal.updateMany(
    { status: "pending", endDate: { $lte: now } },
    { $set: { status: "expired" } },
  );

  // active → expired (time exceeded)
  await Deal.updateMany(
    { status: "active", endDate: { $lte: now } },
    { $set: { status: "expired" } },
  );

  // active → expired (quantity exhausted)
  await Deal.updateMany(
    {
      status: "active",
      $expr: {
        $and: [
          { $gt: ["$quantityLimit", 0] },
          { $gte: ["$soldCount", "$quantityLimit"] },
        ],
      },
    },
    { $set: { status: "expired" } },
  );
};

// ─── Unused / legacy stubs kept for backward-compat ──────────────────────────

export const addProductsToCampaign = async () => {
  throw new ErrorResponse(
    "Cannot add products to flash sale. Each flash sale is for one product only.",
    400,
  );
};

export const getCampaignProducts = async (campaignId) => {
  const data = await getCampaignDetail(campaignId);
  return { total: 1, page: 1, limit: 10, data: [data] };
};

export const getCampaignProduct = async (campaignProductId) => {
  return getCampaignDetail(campaignProductId);
};

export const updateCampaignProduct = async (campaignProductId, updateData, user = null) => {
  return updateCampaign(campaignProductId, updateData, user);
};

export const removeProductFromCampaign = async (campaignProductId) => {
  return deleteCampaign(campaignProductId);
};
