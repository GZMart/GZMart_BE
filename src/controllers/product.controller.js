import * as productService from "../services/product.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Create a new product
 * @route   POST /api/products
 * @access  Private (Seller only)
 */
export const createProduct = asyncHandler(async (req, res, next) => {
  const sellerId = req.user?._id; 

  const { name, categoryId, models } = req.body;

  if (!name || !categoryId || !models || models.length === 0) {
    return next(new ErrorResponse("Please provide name, categoryId, and at least one model", 400));
  }

  const product = await productService.createProduct(req.body, sellerId);

  res.status(201).json({
    success: true,
    message: "Product created successfully",
    data: product,
  });
});

/**
 * @desc    Get all products (Dashboard/Admin view)
 * @route   GET /api/products
 * @access  Public
 */
export const getProducts = asyncHandler(async (req, res, next) => {
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

  const result = await productService.getProducts({}, options);

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: result.pagination,
    data: result.products,
  });
});

/**
 * @desc    Get products with advanced filters (Storefront Search)
 * @route   GET /api/products/advanced
 * @access  Public
 */
export const getProductsAdvanced = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    categoryId,
    brand,
    color,
    size,
    minPrice,
    maxPrice,
    minRating,
    inStock,
  } = req.query;

  const result = await productService.getProductsAdvanced({
    page: parseInt(page),
    limit: parseInt(limit),
    categoryId,
    brands: brand ? (Array.isArray(brand) ? brand : [brand]) : [],
    colors: color ? (Array.isArray(color) ? color : [color]) : [],
    sizes: size ? (Array.isArray(size) ? size : [size]) : [],
    minPrice: minPrice ? parseFloat(minPrice) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
    minRating: minRating ? parseFloat(minRating) : undefined,
    inStock: inStock === "true",
  });

  res.status(200).json({
    success: true,
    message: "Products retrieved successfully",
    data: result.products,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get single product by ID
 * @route   GET /api/products/:id
 * @access  Public
 */
export const getProduct = asyncHandler(async (req, res, next) => {
  // Service handles 404 and View Increment
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

  const restrictedFields = ["_id", "sellerId", "sold", "reviewCount", "rating", "createdAt"];
  restrictedFields.forEach((field) => delete req.body[field]);

  const product = await productService.updateProduct(productId, req.body, sellerId);

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
 * @desc    Get featured products
 * @route   GET /api/products/featured
 * @access  Public
 */
export const getFeaturedProducts = asyncHandler(async (req, res, next) => {
  const { limit = 10 } = req.query;
  const products = await productService.getFeaturedProducts(parseInt(limit));

  res.status(200).json({
    success: true,
    data: products,
  });
});

/**
 * @desc    Get trending products
 * @route   GET /api/products/trending
 * @access  Public
 */
export const getTrendingProducts = asyncHandler(async (req, res, next) => {
  const { limit = 10 } = req.query;
  const products = await productService.getTrendingProducts(parseInt(limit));

  res.status(200).json({
    success: true,
    data: products,
  });
});

/**
 * @desc    Get new arrivals
 * @route   GET /api/products/new-arrivals
 * @access  Public
 */
export const getNewArrivals = asyncHandler(async (req, res, next) => {
  const { limit = 10 } = req.query;
  const products = await productService.getNewArrivals(parseInt(limit));

  res.status(200).json({
    success: true,
    data: products,
  });
});

/**
 * @desc    Get related products
 * @route   GET /api/products/:id/related
 * @access  Public
 */
export const getRelatedProducts = asyncHandler(async (req, res, next) => {
  const { limit = 10 } = req.query;
  const products = await productService.getRelatedProducts(req.params.id, parseInt(limit));

  res.status(200).json({
    success: true,
    data: products,
  });
});

/**
 * @desc    Get available filters metadata
 * @route   GET /api/products/filters
 * @access  Public
 */
export const getAvailableFilters = asyncHandler(async (req, res, next) => {
  const { categoryId } = req.query;
  const filters = await productService.getAvailableFilters(categoryId);

  res.status(200).json({
    success: true,
    data: filters,
  });
});

/**
 * @desc    Check stock availability for a specific model
 * @route   GET /api/products/model/:modelId/stock
 * @access  Public
 */
export const checkStockAvailability = asyncHandler(async (req, res, next) => {
  const { modelId } = req.params;
  const { productId, quantity = 1 } = req.query; // Expect productId in query for faster lookup

  if (!productId) {
      return next(new ErrorResponse("Product ID is required", 400));
  }

  const result = await productService.checkStockAvailability(
    productId,
    modelId,
    parseInt(quantity)
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get best offers (placeholder for deals integration)
 * @route   GET /api/products/best-offers
 * @access  Public
 */
export const getBestOffers = asyncHandler(async (req, res, next) => {
    // Logic to be implemented or mapped to trending for now
    const products = await productService.getTrendingProducts(10);
    res.status(200).json({ success: true, data: products });
});

/**
 * @desc    Get products by seller
 * @route   GET /api/products/seller/:sellerId
 * @access  Public
 */
export const getProductsBySeller = asyncHandler(async (req, res, next) => {
  const { sellerId } = req.params;
  const { page, limit } = req.query;

  const result = await productService.getProductsBySeller(sellerId, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
  });

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages
    },
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
  const { page, limit } = req.query;

  const result = await productService.getProductsByCategory(categoryId, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
  });

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages
    },
    data: result.products,
  });
});

/**
 * @desc    Simple Search
 * @route   GET /api/products/search
 * @access  Public
 */
export const searchProducts = asyncHandler(async (req, res, next) => {
  const { q, page, limit } = req.query;

  if (!q) {
    return next(new ErrorResponse("Please provide a search query", 400));
  }

  const result = await productService.searchProducts(q, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
  });

  res.status(200).json({
    success: true,
    count: result.products.length,
    pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages
    },
    data: result.products,
  });
});