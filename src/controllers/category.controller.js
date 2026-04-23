import * as categoryService from "../services/category.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Create a new category
 * @route   POST /api/categories
 * @access  Private (Admin only)
 */
export const createCategory = asyncHandler(async (req, res, next) => {
  const category = await categoryService.createCategory(req.body);

  res.status(201).json({
    success: true,
    message: "Category created successfully",
    data: category,
  });
});

/**
 * @desc    Get all categories (Supports Admin filters & Storefront flags)
 * @route   GET /api/categories
 * @access  Public
 */
export const getCategories = asyncHandler(async (req, res, next) => {
  const { parentId, level, status, search, isFeatured } = req.query;

  const filters = {
    parentId,
    level: level ? parseInt(level) : undefined,
    status,
    search,
    isFeatured: isFeatured === "true", // GZM-13 feature
  };

  const categories = await categoryService.getCategories(filters);

  res.status(200).json({
    success: true,
    count: categories.length,
    data: categories,
  });
});

/**
 * @desc    Get category tree
 * @route   GET /api/categories/tree
 * @access  Public
 */
export const getCategoryTree = asyncHandler(async (req, res, next) => {
  const includeAll = req.query.includeAll === 'true';
  const tree = await categoryService.getCategoryTree(includeAll);

  res.status(200).json({
    success: true,
    data: tree,
  });
});

/**
 * @desc    Get top categories (Homepage)
 * @route   GET /api/categories/top
 * @access  Public
 */
export const getTopCategories = asyncHandler(async (req, res, next) => {
  const { limit = 8 } = req.query;
  const categories = await categoryService.getTopCategories(parseInt(limit));

  res.status(200).json({
    success: true,
    count: categories.length,
    data: categories,
  });
});

/**
 * @desc    Get featured categories
 * @route   GET /api/categories/featured
 * @access  Public
 */
export const getFeaturedCategories = asyncHandler(async (req, res, next) => {
  const categories = await categoryService.getFeaturedCategories();

  res.status(200).json({
    success: true,
    data: categories,
  });
});

/**
 * @desc    Get categories with product counts (Sidebar)
 * @route   GET /api/categories/with-counts
 * @access  Public
 */
export const getCategoriesWithCounts = asyncHandler(async (req, res, next) => {
  const categories = await categoryService.getCategoriesWithCounts();

  res.status(200).json({
    success: true,
    data: categories,
  });
});

/**
 * @desc    Get single category by ID or Slug
 * @route   GET /api/categories/:id
 * @access  Public
 */
export const getCategory = asyncHandler(async (req, res, next) => {
  // Service handles both ObjectId and Slug
  const category = await categoryService.getCategory(req.params.id);

  res.status(200).json({
    success: true,
    data: category,
  });
});

/**
 * @desc    Get products within a category
 * @route   GET /api/categories/:id/products
 * @access  Public
 */
export const getCategoryProducts = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    brand,
    minPrice,
    maxPrice,
    minRating,
    inStock,
  } = req.query;

  const result = await categoryService.getCategoryProducts(req.params.id, {
    page: parseInt(page),
    limit: parseInt(limit),
    sort,
    filters: {
      brand: brand ? (Array.isArray(brand) ? brand : [brand]) : undefined,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      minRating: minRating ? parseFloat(minRating) : undefined,
      inStock: inStock === "true",
    },
  });

  res.status(200).json({
    success: true,
    message: "Category products retrieved successfully",
    data: result.products,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get child categories
 * @route   GET /api/categories/:id/children
 * @access  Public
 */
export const getChildCategories = asyncHandler(async (req, res, next) => {
  const children = await categoryService.getChildCategories(req.params.id);

  res.status(200).json({
    success: true,
    count: children.length,
    data: children,
  });
});

/**
 * @desc    Update category
 * @route   PUT /api/categories/:id
 * @access  Private (Admin only)
 */
export const updateCategory = asyncHandler(async (req, res, next) => {
  delete req.body.productCount;
  delete req.body.createdAt;

  const category = await categoryService.updateCategory(
    req.params.id,
    req.body
  );

  res.status(200).json({
    success: true,
    message: "Category updated successfully",
    data: category,
  });
});

/**
 * @desc    Delete category (soft delete)
 * @route   DELETE /api/categories/:id
 * @access  Private (Admin only)
 */
export const deleteCategory = asyncHandler(async (req, res, next) => {
  const category = await categoryService.deleteCategory(req.params.id);

  res.status(200).json({
    success: true,
    message: "Category deleted successfully",
    data: category,
  });
});

/**
 * @desc    Permanently delete category
 * @route   DELETE /api/categories/:id/permanent
 * @access  Private (Admin only)
 */
export const permanentDeleteCategory = asyncHandler(async (req, res, next) => {
  await categoryService.permanentDeleteCategory(req.params.id);

  res.status(200).json({
    success: true,
    message: "Category permanently deleted",
    data: {},
  });
});

/**
 * @desc    Get category statistics
 * @route   GET /api/categories/:id/stats
 * @access  Public
 */
export const getCategoryStats = asyncHandler(async (req, res, next) => {
  const stats = await categoryService.getCategoryStats(req.params.id);

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Bulk-update order for categories (drag-and-drop reorder)
 * @route   PATCH /api/categories/reorder
 * @access  Private (Admin)
 */
export const reorderCategories = asyncHandler(async (req, res) => {
  const { items } = req.body;
  const result = await categoryService.reorderCategories(items);
  res.status(200).json({
    success: true,
    message: ` categories reordered`,
    data: result,
  });
});

/**
 * @desc    Get mega menu categories with products
 * @route   GET /api/categories/mega-menu
 * @access  Public
 */
export const getMegaMenuCategories = asyncHandler(async (req, res, next) => {
  const categories = await categoryService.getMegaMenuCategories();

  res.status(200).json({
    success: true,
    count: categories.length,
    data: categories,
  });
});
