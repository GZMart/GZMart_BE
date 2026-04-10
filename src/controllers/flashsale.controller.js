import * as flashSaleService from "../services/flashsale.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import NotificationService from "../services/notification.service.js";
import User from "../models/User.js";

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
 * @access  Private (Seller, Admin)
 */
export const createBatchFlashSale = asyncHandler(async (req, res) => {
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

  const flashSales = await flashSaleService.createBatchFlashSale({
    ...req.body,
    sellerId: req.user?._id,
  });

  const dealTypeName = formatTypeName(type);

  // Notify followers (fire-and-forget)
  if (req.user?._id) {
    const seller = await User.findById(req.user._id, 'shopName fullName').lean();
    const shopName = seller?.shopName || seller?.fullName || 'Shop';
    const startFormatted = new Date(startAt).toLocaleString('vi-VN');
    NotificationService.notifyShopFollowers(
      req.user._id,
      `${dealTypeName} mới tại ${shopName}!`,
      `${dealTypeName} bắt đầu lúc ${startFormatted} — Đừng bỏ lỡ ưu đãi hấp dẫn!`,
      'FLASH_SALE',
      { shopId: req.user._id.toString(), startAt }
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
 * @access  Private (Seller, Admin)
 */
export const createFlashSale = asyncHandler(async (req, res) => {
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

  const flashSale = await flashSaleService.createFlashSale(req.body);

  // Notify followers (fire-and-forget)
  if (req.user?._id) {
    const seller = await User.findById(req.user._id, 'shopName fullName').lean();
    const shopName = seller?.shopName || seller?.fullName || 'Shop';
    const startFormatted = new Date(startAt).toLocaleString('vi-VN');
    NotificationService.notifyShopFollowers(
      req.user._id,
      `⚡ Flash Sale mới tại ${shopName}!`,
      `Flash Sale bắt đầu lúc ${startFormatted} — Đừng bỏ lỡ ưu đãi hấp dẫn!`,
      'FLASH_SALE',
      { shopId: req.user._id.toString(), startAt }
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
export const getFlashSales = asyncHandler(async (req, res, next) => {
  const { page, limit, status, sortBy, type } = req.query;

  const result = await flashSaleService.getFlashSales({
    page: Number(page) || 1,
    limit: Number(limit) || 10,
    status,
    sortBy: sortBy || "createdAt",
    type,
  }, req.user);

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
export const getFlashSaleDetail = asyncHandler(async (req, res, next) => {
  const data = await flashSaleService.getFlashSaleDetail(
    req.params.flashSaleId,
  );

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
export const getActiveFlashSales = asyncHandler(async (req, res, next) => {
  const data = await flashSaleService.getActiveFlashSales();

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
export const addProductsToFlashSale = asyncHandler(async (req, res, next) => {
  const { products } = req.body;

  if (!products || !Array.isArray(products)) {
    return next(new ErrorResponse("Please provide products array", 400));
  }

  const createdProducts = await flashSaleService.addProductsToFlashSale(
    req.params.flashSaleId,
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
export const getFlashSaleProducts = asyncHandler(async (req, res, next) => {
  const { page, limit } = req.query;

  const result = await flashSaleService.getFlashSaleProducts(
    req.params.flashSaleId,
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
export const getFlashSaleProduct = asyncHandler(async (req, res, next) => {
  const product = await flashSaleService.getFlashSaleProduct(
    req.params.flashSaleId,
  );

  res.status(200).json({
    success: true,
    data: product,
  });
});

/**
 * @desc    Update flash sale
 * @route   PUT /api/flash-sales/:flashSaleId
 * @access  Private (Seller, Admin)
 */
export const updateFlashSale = asyncHandler(async (req, res, next) => {
  const allowedFields = ["salePrice", "totalQuantity", "startAt", "endAt"];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const flashSale = await flashSaleService.updateFlashSale(
    req.params.flashSaleId,
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
export const updateFlashSaleProduct = asyncHandler(async (req, res, next) => {
  const allowedFields = ["salePrice", "totalQuantity"];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const product = await flashSaleService.updateFlashSaleProduct(
    req.params.flashSaleId,
    updateData,
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
export const removeProductFromFlashSale = asyncHandler(
  async (req, res, next) => {
    const flashSale = await flashSaleService.removeProductFromFlashSale(
      req.params.flashSaleId,
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
export const deleteFlashSale = asyncHandler(async (req, res, next) => {
  await flashSaleService.deleteFlashSale(req.params.flashSaleId, req.user);

  res.status(200).json({
    success: true,
    message: "Flash sale deleted successfully",
    data: {},
  });
});

/**
 * @desc    Get flash sale stats (views, sold, revenue, discount)
 * @route   GET /api/flash-sales/:flashSaleId/stats
 * @access  Private (Seller, Admin)
 */
export const getFlashSaleStats = asyncHandler(async (req, res, next) => {
  const stats = await flashSaleService.getFlashSaleStats(
    req.params.flashSaleId,
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
export const searchFlashSaleProducts = asyncHandler(async (req, res, next) => {
  const { q, page, limit } = req.query;

  if (!q) {
    return next(new ErrorResponse("Please provide search query", 400));
  }

  const result = await flashSaleService.searchFlashSaleProducts(
    req.params.flashSaleId,
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
