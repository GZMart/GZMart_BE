import Deal from "../models/Deal.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

// Helper to map DB Deal fields back to legacy Flash Sale API response
function mapToFlashSaleShape(deal) {
  if (!deal) return deal;

  const originalPrice = deal.productId?.originalPrice || 0;

  return {
    _id: deal._id,
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
  };
}

/**
 * Create a new flash sale for a product
 */
export const createFlashSale = async (flashSaleData) => {
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

  return mapToFlashSaleShape(flashSale);
};

/**
 * Get all flash sales (with pagination, status filter, and sortBy)
 */
export const getFlashSales = async (filters = {}) => {
  const { page = 1, limit = 10, status, sortBy = "createdAt" } = filters;
  const skip = (page - 1) * limit;

  const filterQuery = { type: "flash_sale" };

  // FlashSale status: upcoming mapped to Deal pending
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

  const flashSales = await Deal.find(filterQuery)
    .populate("productId", "name sku originalPrice images models")
    .sort(sortOptions[sortBy] || { createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Deal.countDocuments(filterQuery);

  return {
    data: flashSales.map(mapToFlashSaleShape),
    page: Number(page),
    limit: Number(limit),
    total,
  };
};

/**
 * Get flash sale detail by ID
 */
export const getFlashSaleDetail = async (flashSaleId) => {
  const flashSale = await Deal.findOne({
    _id: flashSaleId,
    type: "flash_sale",
  }).populate(
    "productId",
    "name sku slug images description originalPrice models",
  );

  if (!flashSale) {
    throw new ErrorResponse("Flash sale not found", 404);
  }

  return mapToFlashSaleShape(flashSale);
};

/**
 * Get active flash sales with countdown info
 */
export const getActiveFlashSales = async () => {
  const flashSales = await Deal.find({
    type: "flash_sale",
    status: "active",
  }).populate(
    "productId",
    "name sku slug images originalPrice rating reviewCount sold models",
  );

  return flashSales.map(mapToFlashSaleShape);
};

/**
 * Get flash sale stats
 */
export const getFlashSaleStats = async (flashSaleId) => {
  const flashSale = await Deal.findOne({
    _id: flashSaleId,
    type: "flash_sale",
  }).populate("productId", "name sku originalPrice images models");

  if (!flashSale) {
    throw new ErrorResponse("Flash sale not found", 404);
  }

  return mapToFlashSaleShape(flashSale);
};

/**
 * Search flash sale products by keyword
 */
export const searchFlashSaleProducts = async (
  flashSaleId,
  searchTerm,
  pagination = {},
) => {
  const flashSale = await Deal.findOne({
    _id: flashSaleId,
    type: "flash_sale",
  }).populate("productId", "name sku slug images models");

  if (!flashSale) {
    throw new ErrorResponse("Flash sale not found", 404);
  }

  const product = flashSale.productId;
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
      data: [mapToFlashSaleShape(flashSale)],
    };
  }

  return { total: 0, page: 1, limit: 10, data: [] };
};

/**
 * Update flash sale
 */
export const updateFlashSale = async (flashSaleId, updateData) => {
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

  const flashSale = await Deal.findOne({
    _id: flashSaleId,
    type: "flash_sale",
  });
  if (!flashSale) {
    throw new ErrorResponse("Flash sale not found", 404);
  }

  if (startAt || endAt) {
    const newStartAt = startAt ? new Date(startAt) : flashSale.startDate;
    const newEndAt = endAt ? new Date(endAt) : flashSale.endDate;
    if (newStartAt >= newEndAt) {
      throw new ErrorResponse("startAt must be before endAt", 400);
    }
  }

  if (salePrice !== undefined) {
    flashSale.dealPrice = Number(salePrice);
  }
  if (totalQuantity !== undefined)
    flashSale.quantityLimit = Number(totalQuantity);
  if (startAt) flashSale.startDate = new Date(startAt);
  if (endAt) flashSale.endDate = new Date(endAt);
  if (variantSku !== undefined) flashSale.variantSku = variantSku;
  if (campaignTitle !== undefined) flashSale.title = campaignTitle;
  if (purchaseLimitPerOrder !== undefined)
    flashSale.purchaseLimitPerOrder = Number(purchaseLimitPerOrder);
  if (purchaseLimitPerUser !== undefined)
    flashSale.purchaseLimitPerUser = Number(purchaseLimitPerUser);

  // Recalculate status based on dates
  const now = new Date();
  if (flashSale.startDate > now) {
    flashSale.status = "pending";
  } else if (flashSale.endDate < now) {
    flashSale.status = "expired";
  } else {
    flashSale.status = "active";
  }

  await flashSale.save();
  return mapToFlashSaleShape(flashSale);
};

/**
 * Delete flash sale
 */
export const deleteFlashSale = async (flashSaleId) => {
  const flashSale = await Deal.findOneAndDelete({
    _id: flashSaleId,
    type: "flash_sale",
  });
  if (!flashSale) {
    throw new ErrorResponse("Flash sale not found", 404);
  }
  return mapToFlashSaleShape(flashSale);
};

/**
 * Get flash sale price for order (price override logic)
 */
export const getFlashSalePrice = async (productId, regularPrice) => {
  const now = new Date();

  const flashSaleDeal = await Deal.findOne({
    productId,
    type: "flash_sale",
    status: "active",
  }).lean();

  if (
    flashSaleDeal &&
    now >= flashSaleDeal.startDate &&
    now <= flashSaleDeal.endDate
  ) {
    const salePrice =
      flashSaleDeal.dealPrice ||
      regularPrice * (1 - (flashSaleDeal.discountPercent || 0) / 100);

    return {
      price: salePrice,
      originalPrice: regularPrice,
      discountPercent: Math.round(
        ((regularPrice - salePrice) / regularPrice) * 100,
      ),
      isFlashSale: true,
      flashSaleId: flashSaleDeal._id,
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

// ─── Unused / legacy stubs kept for backward-compat ──────────────────────────

export const addProductsToFlashSale = async () => {
  throw new ErrorResponse(
    "Cannot add products to flash sale. Each flash sale is for one product only.",
    400,
  );
};

export const getFlashSaleProducts = async (flashSaleId) => {
  const data = await getFlashSaleDetail(flashSaleId);
  return { total: 1, page: 1, limit: 10, data: [data] };
};

export const getFlashSaleProduct = async (flashSaleProductId) => {
  return getFlashSaleDetail(flashSaleProductId);
};

export const updateFlashSaleProduct = async (
  flashSaleProductId,
  updateData,
) => {
  return updateFlashSale(flashSaleProductId, updateData);
};

export const removeProductFromFlashSale = async (flashSaleProductId) => {
  return deleteFlashSale(flashSaleProductId);
};
