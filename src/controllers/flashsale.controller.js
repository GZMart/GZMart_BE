import * as flashSaleService from '../services/flashsale.service.js';
import { ErrorResponse } from '../utils/errorResponse.js';
import { asyncHandler } from '../middlewares/async.middleware.js';

/**
 * @desc    Create a new flash sale for a product
 * @route   POST /api/flash-sales
 * @access  Private (Admin only)
 */
export const createFlashSale = asyncHandler(async (req, res) => {
  const { productId, salePrice, totalQuantity, startAt, endAt } = req.body;

  // Validation
  if (!productId || salePrice === undefined || !totalQuantity || !startAt || !endAt) {
    throw new ErrorResponse('Please provide productId, salePrice, totalQuantity, startAt, and endAt', 400);
  }

  const flashSale = await flashSaleService.createFlashSale(req.body);

  res.status(201).json({
    success: true,
    message: 'Flash sale created successfully',
    data: flashSale,
  });
});

/**
 * @desc    Get all flash sales
 * @route   GET /api/flash-sales
 * @access  Public
 */
export const getFlashSales = asyncHandler(async (req, res, next) => {
  const { page, limit, status, sortBy } = req.query;

  const result = await flashSaleService.getFlashSales({
    page: Number(page) || 1,
    limit: Number(limit) || 10,
    status,
    sortBy: sortBy || 'createdAt',
  });

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
  const data = await flashSaleService.getFlashSaleDetail(req.params.flashSaleId);

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
    return next(new ErrorResponse('Please provide products array', 400));
  }

  const createdProducts = await flashSaleService.addProductsToFlashSale(
    req.params.flashSaleId,
    products
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

  const result = await flashSaleService.getFlashSaleProducts(req.params.flashSaleId, {
    page: Number(page) || 1,
    limit: Number(limit) || 10,
  });

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
  const product = await flashSaleService.getFlashSaleProduct(req.params.flashSaleId);

  res.status(200).json({
    success: true,
    data: product,
  });
});

/**
 * @desc    Update flash sale
 * @route   PUT /api/flash-sales/:flashSaleId
 * @access  Private (Admin only)
 */
export const updateFlashSale = asyncHandler(async (req, res, next) => {
  const allowedFields = ['salePrice', 'totalQuantity', 'startAt', 'endAt'];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const flashSale = await flashSaleService.updateFlashSale(req.params.flashSaleId, updateData);

  res.status(200).json({
    success: true,
    message: 'Flash sale updated successfully',
    data: flashSale,
  });
});

/**
 * @desc    Update flash sale product
 * @route   PUT /api/flash-sales/:flashSaleId
 * @access  Private (Admin only)
 */
export const updateFlashSaleProduct = asyncHandler(async (req, res, next) => {
  const allowedFields = ['salePrice', 'totalQuantity'];
  const updateData = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const product = await flashSaleService.updateFlashSaleProduct(
    req.params.flashSaleId,
    updateData
  );

  res.status(200).json({
    success: true,
    message: 'Flash sale updated successfully',
    data: product,
  });
});

/**
 * @desc    Remove product from flash sale
 * @route   DELETE /api/flash-sales/:flashSaleId
 * @access  Private (Admin only)
 */
export const removeProductFromFlashSale = asyncHandler(async (req, res, next) => {
  await flashSaleService.deleteFlashSale(req.params.flashSaleId);

  res.status(200).json({
    success: true,
    message: 'Flash sale deleted',
    data: {},
  });
});

/**
 * @desc    Delete flash sale
 * @route   DELETE /api/flash-sales/:flashSaleId
 * @access  Private (Admin only)
 */
export const deleteFlashSale = asyncHandler(async (req, res, next) => {
  await flashSaleService.deleteFlashSale(req.params.flashSaleId);

  res.status(200).json({
    success: true,
    message: 'Flash sale deleted successfully',
    data: {},
  });
});

/**
 * @desc    Get flash sale stats
 * @route   GET /api/flash-sales/:flashSaleId/stats
 * @access  Private (Admin only)
 */
export const getFlashSaleStats = asyncHandler(async (req, res, next) => {
  const stats = await flashSaleService.getFlashSaleStats(req.params.flashSaleId);

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
    return next(new ErrorResponse('Please provide search query', 400));
  }

  const result = await flashSaleService.searchFlashSaleProducts(
    req.params.flashSaleId,
    q,
    {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
    }
  );

  res.status(200).json({
    success: true,
    ...result,
  });
});
