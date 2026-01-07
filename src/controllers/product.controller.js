import * as productService from "../services/product.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Create a new product
 * @route   POST /api/products
 * @access  Private (Seller only)
 */
export const createProduct = asyncHandler(async (req, res, next) => {
  // Get seller ID from authenticated user (or use dummy ID for testing)
  const sellerId = req.user?._id || "695dd45041f5e32466527d93"; // Temporary: Use dummy ID if no auth

  // Validate request body
  const { name, categoryId, models } = req.body;

  if (!name || !categoryId || !models || models.length === 0) {
    return next(
      new ErrorResponse(
        "Please provide name, categoryId, and at least one model",
        400
      )
    );
  }

  // Create product via service layer
  const product = await productService.createProduct(req.body, sellerId);

  // Return success response
  res.status(201).json({
    success: true,
    message: "Product created successfully",
    data: product,
  });
});

/**
 * @desc    Get all products
 * @route   GET /api/products
 * @access  Public
 */
export const getProducts = asyncHandler(async (req, res, next) => {
  // Extract query parameters
  const {
    page,
    limit,
    sortBy,
    sortOrder,
    categoryId,
    status,
    minPrice,
    maxPrice,
    search,
  } = req.query;

  // Build options object
  const options = {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    sortBy: sortBy || "createdAt",
    sortOrder: sortOrder || "desc",
    categoryId,
    status,
    minPrice: minPrice ? parseFloat(minPrice) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
    search,
  };

  // Get products from service
  const result = await productService.getProducts({}, options);

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: result.pagination,
    data: result.products,
  });
});

/**
 * @desc    Get single product by ID
 * @route   GET /api/products/:id
 * @access  Public
 */
export const getProduct = asyncHandler(async (req, res, next) => {
  const product = await productService.getProductById(req.params.id);

  res.status(200).json({
    success: true,
    data: product,
  });
});

/**
 * @desc    Update product
 * @route   PUT /api/products/:id
 * @access  Private (Seller only)
 */
export const updateProduct = asyncHandler(async (req, res, next) => {
  const sellerId = req.user._id;
  const productId = req.params.id;

  // Prevent updating certain fields
  const restrictedFields = [
    "_id",
    "sellerId",
    "sold",
    "reviewCount",
    "rating",
    "createdAt",
  ];
  restrictedFields.forEach((field) => delete req.body[field]);

  const product = await productService.updateProduct(
    productId,
    req.body,
    sellerId
  );

  res.status(200).json({
    success: true,
    message: "Product updated successfully",
    data: product,
  });
});

/**
 * @desc    Delete product
 * @route   DELETE /api/products/:id
 * @access  Private (Seller only)
 */
export const deleteProduct = asyncHandler(async (req, res, next) => {
  const sellerId = req.user._id;
  const productId = req.params.id;

  await productService.deleteProduct(productId, sellerId);

  res.status(200).json({
    success: true,
    message: "Product deleted successfully",
    data: {},
  });
});

/**
 * @desc    Get products by seller
 * @route   GET /api/products/seller/:sellerId
 * @access  Public
 */
export const getProductsBySeller = asyncHandler(async (req, res, next) => {
  const { sellerId } = req.params;
  const { page, limit, sortBy, sortOrder, status } = req.query;

  const options = {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    sortBy: sortBy || "createdAt",
    sortOrder: sortOrder || "desc",
    status,
  };

  const filters = { sellerId };

  const result = await productService.getProducts(filters, options);

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: result.pagination,
    data: result.products,
  });
});

/**
 * @desc    Get products by category
 * @route   GET /api/products/category/:categoryId
 * @access  Public
 */
export const getProductsByCategory = asyncHandler(async (req, res, next) => {
  const { categoryId } = req.params;
  const { page, limit, sortBy, sortOrder, minPrice, maxPrice } = req.query;

  const options = {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    sortBy: sortBy || "createdAt",
    sortOrder: sortOrder || "desc",
    categoryId,
    minPrice: minPrice ? parseFloat(minPrice) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
  };

  const result = await productService.getProducts({}, options);

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: result.pagination,
    data: result.products,
  });
});

/**
 * @desc    Search products
 * @route   GET /api/products/search
 * @access  Public
 */
export const searchProducts = asyncHandler(async (req, res, next) => {
  const { q, page, limit, sortBy, sortOrder, categoryId, minPrice, maxPrice } =
    req.query;

  if (!q) {
    return next(new ErrorResponse("Please provide a search query", 400));
  }

  const options = {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    sortBy: sortBy || "createdAt",
    sortOrder: sortOrder || "desc",
    search: q,
    categoryId,
    minPrice: minPrice ? parseFloat(minPrice) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
  };

  const result = await productService.getProducts({}, options);

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: result.pagination,
    data: result.products,
  });
});
