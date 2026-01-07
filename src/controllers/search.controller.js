import searchService from "../services/search.service.js";

export const searchProducts = async (req, res, next) => {
  try {
    const {
      q,
      page = 1,
      limit = 20,
      sort = "relevance",
      categoryId,
      brand,
      minPrice,
      maxPrice,
      minRating,
      inStock,
    } = req.query;

    if (!q || q.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const result = await searchService.searchProducts({
      query: q,
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      filters: {
        categoryId,
        brand: brand ? (Array.isArray(brand) ? brand : [brand]) : undefined,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        minRating: minRating ? parseFloat(minRating) : undefined,
        inStock: inStock === "true",
      },
    });

    res.status(200).json({
      success: true,
      message: "Search completed successfully",
      data: result.products,
      query: result.query,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getSearchSuggestions = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(200).json({
        success: true,
        message: "Query too short",
        data: [],
      });
    }

    const suggestions = await searchService.getSearchSuggestions(q);

    res.status(200).json({
      success: true,
      message: "Suggestions retrieved successfully",
      data: suggestions,
    });
  } catch (error) {
    next(error);
  }
};

export const autocomplete = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(200).json({
        success: true,
        message: "Query too short",
        data: [],
      });
    }

    const results = await searchService.autocomplete(q);

    res.status(200).json({
      success: true,
      message: "Autocomplete results retrieved successfully",
      data: results,
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailableFilters = async (req, res, next) => {
  try {
    const { categoryId, search } = req.query;

    const filters = await searchService.getAvailableFilters({
      categoryId,
      search,
    });

    res.status(200).json({
      success: true,
      message: "Available filters retrieved successfully",
      data: filters,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Advanced search with MongoDB Aggregation
 */
export const advancedSearch = async (req, res, next) => {
  try {
    const {
      q,
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

    const result = await searchService.advancedSearchProducts({
      query: q,
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
      message: "Advanced search completed successfully",
      data: result.products,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};
