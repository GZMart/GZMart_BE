import FlashSaleProduct from '../models/FlashSaleProduct.js';
import Product from '../models/Product.js';
import { ErrorResponse } from '../utils/errorResponse.js';

/**
 * Create a new flash sale for a product
 */
export const createFlashSale = async (flashSaleData) => {
  const { productId, salePrice, totalQuantity, startAt, endAt } = flashSaleData;

  // Validation
  if (!productId || salePrice === undefined || !totalQuantity || !startAt || !endAt) {
    throw new ErrorResponse('Please provide productId, salePrice, totalQuantity, startAt, and endAt', 400);
  }

  if (new Date(startAt) >= new Date(endAt)) {
    throw new ErrorResponse('Start date must be before end date', 400);
  }

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse('Product not found', 404);
  }

  // Check if flash sale already exists for this product
  const existingFlashSale = await FlashSaleProduct.findOne({ productId });
  if (existingFlashSale) {
    throw new ErrorResponse('Flash sale already exists for this product', 400);
  }

  // Create flash sale
  const flashSale = await FlashSaleProduct.create({
    productId,
    salePrice,
    totalQuantity,
    startAt,
    endAt,
  });

  return flashSale;
};

/**
 * Get all flash sales
 */
export const getFlashSales = async (filters = {}) => {
  const { page = 1, limit = 10, status, sortBy = 'createdAt' } = filters;
  const skip = (page - 1) * limit;

  const filterQuery = {};
  if (status) {
    filterQuery.status = status;
  }

  const sortOptions = {
    createdAt: { createdAt: -1 },
    'newest-first': { createdAt: -1 },
    'oldest-first': { createdAt: 1 },
    'upcoming': { startAt: 1 },
    'active-first': { status: -1 },
  };

  const flashSales = await FlashSaleProduct.find(filterQuery)
    .populate('productId', 'name slug images')
    .sort(sortOptions[sortBy] || { createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  const total = await FlashSaleProduct.countDocuments(filterQuery);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    pages: Math.ceil(total / limit),
    data: flashSales,
  };
};

/**
 * Get flash sale detail by ID
 */
export const getFlashSaleDetail = async (flashSaleId) => {
  const flashSale = await FlashSaleProduct.findById(flashSaleId)
    .populate('productId', 'name slug images description')
    .lean();

  if (!flashSale) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  return flashSale;
};

/**
 * Get active flash sales with countdown info
 */
export const getActiveFlashSales = async () => {
  const now = new Date();

  const flashSales = await FlashSaleProduct.find({
    status: 'active',
  })
    .populate('productId', 'name slug images')
    .select('_id productId salePrice totalQuantity soldQuantity startAt endAt status createdAt')
    .lean();

  // Add countdown info
  const flashSalesWithCountdown = flashSales.map((sale) => ({
    ...sale,
    remainingQuantity: sale.totalQuantity - sale.soldQuantity,
    timeRemaining: Math.max(0, new Date(sale.endAt).getTime() - now.getTime()),
  }));

  return flashSalesWithCountdown;
};

/**
 * Add products to flash sale - NOT USED (one product per flash sale)
 */
export const addProductsToFlashSale = async (flashSaleId, productsData) => {
  throw new ErrorResponse('Cannot add products to flash sale. Each flash sale is for one product only.', 400);
};

/**
 * Get products in flash sale - NOT USED (one product per flash sale)
 */
export const getFlashSaleProducts = async (flashSaleId, pagination = {}) => {
  const product = await FlashSaleProduct.findById(flashSaleId)
    .populate('productId', 'name slug images description rating sold')
    .lean();

  if (!product) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  return {
    total: 1,
    page: 1,
    limit: 10,
    pages: 1,
    data: [product],
  };
};

/**
 * Get flash sale product by ID
 */
export const getFlashSaleProduct = async (flashSaleProductId) => {
  const product = await FlashSaleProduct.findById(flashSaleProductId)
    .populate('productId', 'name slug images description attributes tiers models')
    .lean();

  if (!product) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  return product;
};

/**
 * Update flash sale
 */
export const updateFlashSale = async (flashSaleId, updateData) => {
  const { salePrice, totalQuantity, startAt, endAt } = updateData;

  const flashSale = await FlashSaleProduct.findById(flashSaleId);

  if (!flashSale) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  // Validate date change
  if (startAt || endAt) {
    const newStartAt = startAt ? new Date(startAt) : new Date(flashSale.startAt);
    const newEndAt = endAt ? new Date(endAt) : new Date(flashSale.endAt);

    if (newStartAt >= newEndAt) {
      throw new ErrorResponse('Start date must be before end date', 400);
    }
  }

  // Update fields
  if (salePrice !== undefined) flashSale.salePrice = salePrice;
  if (totalQuantity !== undefined) flashSale.totalQuantity = totalQuantity;
  if (startAt) flashSale.startAt = startAt;
  if (endAt) flashSale.endAt = endAt;

  await flashSale.save();

  return flashSale;
};

/**
 * Update flash sale product (price, stock, discount)
 */
export const updateFlashSaleProduct = async (flashSaleProductId, updateData) => {
  const { salePrice, totalQuantity } = updateData;

  const product = await FlashSaleProduct.findById(flashSaleProductId);

  if (!product) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  if (salePrice !== undefined) product.salePrice = salePrice;
  if (totalQuantity !== undefined) product.totalQuantity = totalQuantity;

  await product.save();
  return product;
};

/**
 * Remove product from flash sale
 */
export const removeProductFromFlashSale = async (flashSaleProductId) => {
  const product = await FlashSaleProduct.findByIdAndDelete(flashSaleProductId);

  if (!product) {
    throw new ErrorResponse('Flash sale product not found', 404);
  }

  return product;
};

/**
 * Delete flash sale and all its products
 */
export const deleteFlashSale = async (flashSaleId) => {
  const flashSale = await FlashSaleProduct.findByIdAndDelete(flashSaleId);

  if (!flashSale) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  return flashSale;
};

/**
 * Get flash sale price for order (price override logic)
 * Returns flash price if product is in active flash sale, otherwise returns regular model price
 */
export const getFlashSalePrice = async (productId, regularPrice) => {
  const now = new Date();

  // Find active flash sale for this product
  const flashSaleProduct = await FlashSaleProduct.findOne({
    productId,
    status: 'active',
  }).lean();

  if (
    flashSaleProduct &&
    now >= new Date(flashSaleProduct.startAt) &&
    now <= new Date(flashSaleProduct.endAt)
  ) {
    return {
      price: flashSaleProduct.salePrice,
      originalPrice: regularPrice,
      discountPercent: Math.round(((regularPrice - flashSaleProduct.salePrice) / regularPrice) * 100),
      isFlashSale: true,
      flashSaleId: flashSaleProduct._id,
    };
  }

  // Return regular price if no active flash sale
  return {
    price: regularPrice,
    originalPrice: regularPrice,
    discountPercent: 0,
    isFlashSale: false,
    flashSaleId: null,
  };
};

/**
 * Get flash sale stats
 */
export const getFlashSaleStats = async (flashSaleId) => {
  const flashSale = await FlashSaleProduct.findById(flashSaleId);

  if (!flashSale) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  const remainingQuantity = flashSale.totalQuantity - flashSale.soldQuantity;
  const discountAmount = flashSale.productId?.originalPrice ? flashSale.productId.originalPrice - flashSale.salePrice : 0;

  return {
    _id: flashSale._id,
    productId: flashSale.productId,
    salePrice: flashSale.salePrice,
    totalQuantity: flashSale.totalQuantity,
    soldQuantity: flashSale.soldQuantity,
    remainingQuantity,
    discountAmount,
    status: flashSale.status,
    startAt: flashSale.startAt,
    endAt: flashSale.endAt,
    timeRemaining: Math.max(0, new Date(flashSale.endAt).getTime() - new Date().getTime()),
  };
};

/**
 * Search flash sale products
 */
export const searchFlashSaleProducts = async (flashSaleId, searchTerm, pagination = {}) => {
  const flashSale = await FlashSaleProduct.findById(flashSaleId)
    .populate('productId', 'name slug images')
    .lean();

  if (!flashSale) {
    throw new ErrorResponse('Flash sale not found', 404);
  }

  // Since one flash sale has one product, just check if search term matches
  if (
    flashSale.productId.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    flashSale.productId.slug.toLowerCase().includes(searchTerm.toLowerCase())
  ) {
    return {
      total: 1,
      page: 1,
      limit: 10,
      pages: 1,
      data: [flashSale],
    };
  }

  return {
    total: 0,
    page: 1,
    limit: 10,
    pages: 0,
    data: [],
  };
};
