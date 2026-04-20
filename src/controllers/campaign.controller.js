import * as campaignService from "../services/campaign.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import NotificationService from "../services/notification.service.js";
import User from "../models/User.js";
import Product from "../models/Product.js";

// Human-readable labels for deal types (shared with service)
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
  return TYPE_LABELS[type] || type || "Deal";
}

/**
 * @desc    Create multiple flash-sale deals for one product in a single request
 * @route   POST /api/flash-sales/batch
 * @access  Private (Seller)
 */
export const createBatchCampaign = asyncHandler(async (req, res) => {
  const { productId, startAt, endAt, variants, type = "flash_sale" } = req.body;

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

  const batchPayload = { ...req.body };
  if (req.user?.role === "seller") {
    batchPayload.sellerId = req.user._id;
  }
  // Admin: omit sellerId so service assigns product.sellerId (shop owner)

  const flashSales = await campaignService.createBatchCampaign(batchPayload);

  const dealTypeName = formatTypeName(type);

  const product = await Product.findById(productId).select("sellerId").lean();
  const notifySellerId = product?.sellerId || req.user?._id;

  // Notify shop followers (fire-and-forget) — always the product owner's shop
  if (notifySellerId) {
    const seller = await User.findById(notifySellerId, "shopName fullName").lean();
    const shopName = seller?.shopName || seller?.fullName || "Shop";
    const startFormatted = new Date(startAt).toLocaleString("vi-VN");
    NotificationService.notifyShopFollowers(
      notifySellerId,
      `${dealTypeName} mới tại ${shopName}!`,
      `${dealTypeName} bắt đầu lúc ${startFormatted} — Đừng bỏ lỡ ưu đãi hấp dẫn!`,
      "FLASH_SALE",
      { shopId: notifySellerId.toString(), startAt },
    );
  }

  res.status(201).json({
    success: true,
    message: `${flashSales.length} ${dealTypeName.toLowerCase()}(s) created successfully`,
    data: flashSales,
  });
});

/**
 * @desc    Create a new flash sale for a product
 * @route   POST /api/flash-sales
 * @access  Private (Seller)
 */
export const createCampaign = asyncHandler(async (req, res) => {
  const { productId, salePrice, totalQuantity, startAt, endAt } = req.body;

  // Validation
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

  const flashSale = await campaignService.createCampaign(req.body);

  const product = await Product.findById(productId).select("sellerId").lean();
  const notifySellerId = product?.sellerId || req.user?._id;

  if (notifySellerId) {
    const seller = await User.findById(notifySellerId, "shopName fullName").lean();
    const shopName = seller?.shopName || seller?.fullName || "Shop";
    const startFormatted = new Date(startAt).toLocaleString("vi-VN");
    NotificationService.notifyShopFollowers(
      notifySellerId,
      `⚡ Flash Sale mới tại ${shopName}!`,
      `Flash Sale bắt đầu lúc ${startFormatted} — Đừng bỏ lỡ ưu đãi hấp dẫn!`,
      "FLASH_SALE",
      { shopId: notifySellerId.toString(), startAt },
    );
  }

  res.status(201).json({
    success: true,
    message: "Flash sale created successfully",
    data: flashSale,
  });
});

/**
 * @desc    Get all flash sales
 * @route   GET /api/flash-sales
 * @access  Public
 */
export const getCampaigns = asyncHandler(async (req, res, next) => {
  const { page, limit, status, sortBy, type, sellerId } = req.query;

  const result = await campaignService.getCampaigns(
    {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      status,
      sortBy: sortBy || "createdAt",
      type,
      sellerId: sellerId || undefined,
    },
    req.user,
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Get flash sale detail with products
 * @route   GET /api/flash-sales/:flashSaleId
 * @access  Public
 */
export const getCampaignDetail = asyncHandler(async (req, res, next) => {
  const data = await campaignService.getCampaignDetail(req.params.campaignId);

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * @desc    Get active flash sales with countdown
 * @route   GET /api/flash-sales/active
 * @access  Public
 */
export const getActiveCampaigns = asyncHandler(async (req, res, next) => {
  const data = await campaignService.getActiveCampaigns();

  res.status(200).json({
    success: true,
    count: data.length,
    data,
  });
});

/**
 * @desc    Add products to flash sale
 * @route   POST /api/flash-sales/:flashSaleId/products
 * @access  Private (Admin only)
 */
export const addProductsToCampaign = asyncHandler(async (req, res, next) => {
  const { products } = req.body;

  if (!products || !Array.isArray(products)) {
    return next(new ErrorResponse("Please provide products array", 400));
  }

  const createdProducts = await campaignService.addProductsToCampaign(
    req.params.campaignId,
    products,
  );

  res.status(201).json({
    success: true,
    message: `${createdProducts.length} products added to flash sale`,
    data: createdProducts,
  });
});

/**
 * @desc    Get products in flash sale
 * @route   GET /api/flash-sales/:flashSaleId/products
 * @access  Public
 */
export const getCampaignProducts = asyncHandler(async (req, res, next) => {
  const { page, limit } = req.query;

  const result = await campaignService.getCampaignProducts(
    req.params.campaignId,
    {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    },
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Get flash sale product detail
 * @route   GET /api/flash-sales/:flashSaleId
 * @access  Public
 */
export const getCampaignProduct = asyncHandler(async (req, res, next) => {
  const product = await campaignService.getCampaignProduct(
    req.params.campaignId,
  );

  res.status(200).json({
    success: true,
    data: product,
  });
});

/**
 * @desc    Update flash sale
 * @route   PUT /api/flash-sales/:flashSaleId
 * @access  Private (Seller)
 */
export const updateCampaign = asyncHandler(async (req, res, next) => {
  const allowedFields = ["salePrice", "totalQuantity", "startAt", "endAt"];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const flashSale = await campaignService.updateCampaign(
    req.params.campaignId,
    updateData,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: "Flash sale updated successfully",
    data: flashSale,
  });
});

/**
 * @desc    Update flash sale product (price, quantity)
 * @route   PUT /api/flash-sales/:flashSaleId/product
 * @access  Private (Seller, Admin)
 */
export const updateCampaignProduct = asyncHandler(async (req, res, next) => {
  const allowedFields = ["salePrice", "totalQuantity"];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const product = await campaignService.updateCampaignProduct(
    req.params.campaignId,
    updateData,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: "Flash sale updated successfully",
    data: product,
  });
});

/**
 * @desc    Remove product from flash sale (alias for delete)
 * @route   DELETE /api/flash-sales/:flashSaleId
 * @access  Private (Seller, Admin)
 */
export const removeProductFromCampaign = asyncHandler(
  async (req, res, next) => {
    const flashSale = await campaignService.removeProductFromCampaign(
      req.params.campaignId,
    );

    res.status(200).json({
      success: true,
      message: "Flash sale removed successfully",
      data: flashSale,
    });
  },
);

/**
 * @desc    Delete flash sale
 * @route   DELETE /api/flash-sales/:flashSaleId
 * @access  Private (Seller, Admin)
 */
export const deleteCampaign = asyncHandler(async (req, res, next) => {
  await campaignService.deleteCampaign(req.params.campaignId, req.user);

  res.status(200).json({
    success: true,
    message: "Flash sale deleted successfully",
    data: {},
  });
});

/**
 * @desc    Pause flash sale - sets status to "paused"
 * @route   PATCH /api/campaigns/:campaignId/pause
 * @access  Private (Seller, Admin)
 */
export const pauseCampaign = asyncHandler(async (req, res, next) => {
  const campaign = await campaignService.pauseCampaign(
    req.params.campaignId,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: `Campaign paused successfully (${campaign.pausedCount} variant(s))`,
    data: campaign,
  });
});

/**
 * @desc    Stop flash sale - sets status to "cancelled"
 * @route   PATCH /api/campaigns/:campaignId/stop
 * @access  Private (Seller, Admin)
 */
export const stopCampaign = asyncHandler(async (req, res, next) => {
  const { reason } = req.body || {};
  const campaign = await campaignService.stopCampaign(req.params.campaignId, req.user, {
    reason,
  });

  res.status(200).json({
    success: true,
    message: `Campaign stopped successfully (${campaign.cancelledCount} variant(s))`,
    data: campaign,
  });
});

/**
 * @desc    Admin cảnh cáo seller (notification + email)
 * @route   POST /api/campaigns/:campaignId/warn
 * @access  Private (Admin)
 */
export const warnSellerAboutCampaign = asyncHandler(async (req, res) => {
  const { message, title } = req.body || {};
  const result = await campaignService.warnSellerAboutCampaign(
    req.params.campaignId,
    req.user,
    { message, title },
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Resume a paused campaign
 * @route   PATCH /api/campaigns/:campaignId/resume
 * @access  Private (Seller, Admin)
 */
export const resumeCampaign = asyncHandler(async (req, res, next) => {
  const campaign = await campaignService.resumeCampaign(
    req.params.campaignId,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: `Campaign resumed successfully (${campaign.resumedCount} variant(s))`,
    data: campaign,
  });
});

/**
 * @desc    Get flash sale stats (views, sold, revenue, discount)
 * @route   GET /api/flash-sales/:flashSaleId/stats
 * @access  Private (Seller, Admin)
 */
export const getCampaignStats = asyncHandler(async (req, res, next) => {
  const stats = await campaignService.getCampaignStats(
    req.params.campaignId,
    req.user,
  );

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Search flash sale products
 * @route   GET /api/flash-sales/:flashSaleId/search
 * @access  Public
 */
export const searchCampaignProducts = asyncHandler(async (req, res, next) => {
  const { q, page, limit } = req.query;

  if (!q) {
    return next(new ErrorResponse("Please provide search query", 400));
  }

  const result = await campaignService.searchCampaignProducts(
    req.params.campaignId,
    q,
    {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    },
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});
