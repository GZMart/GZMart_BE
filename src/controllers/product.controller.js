import productService from "../services/product.service.js";

export const getProducts = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = "-createdAt",
      categoryId,
      brand,
      minPrice,
      maxPrice,
      minRating,
      inStock,
      isFeatured,
      isTrending,
      isNewArrival,
      search,
    } = req.query;

    // Validate pagination parameters
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 items per page

    const result = await productService.getProducts({
      page: parsedPage,
      limit: parsedLimit,
      sort,
      filters: {
        categoryId,
        brand: brand ? (Array.isArray(brand) ? brand : [brand]) : undefined,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        minRating: minRating ? parseFloat(minRating) : undefined,
        inStock: inStock === "true",
        isFeatured: isFeatured === "true",
        isTrending: isTrending === "true",
        isNewArrival: isNewArrival === "true",
        search,
      },
    });

    res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      data: result.products,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getProductDetail = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate ObjectId format
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    const product = await productService.getProductById(id);

    // Increment view count (don't await to not slow down response)
    productService
      .incrementViews(id)
      .catch((err) => console.error("Error incrementing views:", err));

    res.status(200).json({
      success: true,
      message: "Product retrieved successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const products = await productService.getFeaturedProducts(parseInt(limit));

    res.status(200).json({
      success: true,
      message: "Featured products retrieved successfully",
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

export const getTrendingProducts = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const products = await productService.getTrendingProducts(parseInt(limit));

    res.status(200).json({
      success: true,
      message: "Trending products retrieved successfully",
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

export const getNewArrivals = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const products = await productService.getNewArrivals(parseInt(limit));

    res.status(200).json({
      success: true,
      message: "New arrivals retrieved successfully",
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

export const getRelatedProducts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.query;
    const products = await productService.getRelatedProducts(
      id,
      parseInt(limit)
    );

    res.status(200).json({
      success: true,
      message: "Related products retrieved successfully",
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailableFilters = async (req, res, next) => {
  try {
    const { categoryId } = req.query;
    const filters = await productService.getAvailableFilters(categoryId);

    res.status(200).json({
      success: true,
      message: "Available filters retrieved successfully",
      data: filters,
    });
  } catch (error) {
    next(error);
  }
};

export const getVariantByTierIndex = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tierIndex } = req.body;

    // Validate product ID
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    // Validate tierIndex
    if (!tierIndex || !Array.isArray(tierIndex) || tierIndex.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tierIndex must be a non-empty array",
      });
    }

    const variant = await productService.getVariantByTierIndex(id, tierIndex);

    res.status(200).json({
      success: true,
      message: "Variant retrieved successfully",
      data: variant,
    });
  } catch (error) {
    next(error);
  }
};

export const checkStockAvailability = async (req, res, next) => {
  try {
    const { modelId } = req.params;
    const { quantity = 1 } = req.query;

    const result = await productService.checkStockAvailability(
      modelId,
      parseInt(quantity)
    );

    res.status(200).json({
      success: true,
      message: "Stock availability checked successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get available options for tiers based on current selection
 * Example: User chọn Color Black -> Trả về những Size nào còn hàng
 */
export const getAvailableOptions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { selection } = req.body; // { "0": 0 } means tier 0 (Color), option 0 (Black)

    const partialSelection = selection || {};
    const availableOptions = await productService.getAvailableOptions(
      id,
      partialSelection
    );

    res.status(200).json({
      success: true,
      message: "Available options retrieved successfully",
      data: availableOptions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get products with advanced filters (Color, Size, Price, Brand) using MongoDB Aggregation
 */
export const getProductsAdvanced = async (req, res, next) => {
  try {
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

    const result = await productService.getProductsWithAdvancedFilters({
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
      message: "Products retrieved successfully with advanced filters",
      data: result.products,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get products with best offers (highest discount)
 * GET /api/products/best-offers
 */
export const getBestOffers = async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const products = await productService.getBestOffers(parseInt(limit));

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};
