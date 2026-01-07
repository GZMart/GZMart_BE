import categoryService from "../services/category.service.js";

export const getCategories = async (req, res, next) => {
  try {
    const { isFeatured } = req.query;

    const categories = await categoryService.getCategories({
      isFeatured: isFeatured === "true",
    });

    res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

export const getCategoryDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await categoryService.getCategoryById(id);

    res.status(200).json({
      success: true,
      message: "Category retrieved successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const getCategoryProducts = async (req, res, next) => {
  try {
    const { id } = req.params;
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

    const result = await categoryService.getCategoryProducts(id, {
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
  } catch (error) {
    next(error);
  }
};

export const getFeaturedCategories = async (req, res, next) => {
  try {
    const categories = await categoryService.getFeaturedCategories();

    res.status(200).json({
      success: true,
      message: "Featured categories retrieved successfully",
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

export const getCategoriesWithCounts = async (req, res, next) => {
  try {
    const categories = await categoryService.getCategoriesWithCounts();

    res.status(200).json({
      success: true,
      message: "Categories with counts retrieved successfully",
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

export const getTopCategories = async (req, res, next) => {
  try {
    const { limit = 8 } = req.query;
    const categories = await categoryService.getTopCategories(parseInt(limit));

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};
