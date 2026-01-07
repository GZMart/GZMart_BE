import Category from "../models/Category.js";
import Product from "../models/Product.js";
import ErrorResponse from "../utils/errorResponse.js";
import productService from "./product.service.js";

class CategoryService {
  /**
   * Get all categories with optional filters
   */
  async getCategories(filters = {}) {
    const query = { isActive: true };

    if (filters.isFeatured) {
      query.isFeatured = true;
    }

    const categories = await Category.find(query).sort("order").lean();

    return categories;
  }

  /**
   * Get category by ID or slug
   */
  async getCategoryById(identifier) {
    let category;

    // Check if identifier is ObjectId or slug
    if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
      category = await Category.findOne({
        _id: identifier,
        isActive: true,
      }).lean();
    } else {
      category = await Category.findOne({
        slug: identifier,
        isActive: true,
      }).lean();
    }

    if (!category) {
      throw new ErrorResponse("Category not found", 404);
    }

    return category;
  }

  /**
   * Get products by category
   */
  async getCategoryProducts(categoryId, options) {
    const { page = 1, limit = 20, sort = "-createdAt", filters = {} } = options;

    // Verify category exists
    const category = await this.getCategoryById(categoryId);

    return await productService.getProducts({
      page,
      limit,
      sort,
      filters: {
        ...filters,
        categoryId: category._id,
      },
    });
  }

  /**
   * Get featured categories
   */
  async getFeaturedCategories() {
    return await Category.find({ isActive: true, isFeatured: true })
      .sort("order")
      .lean();
  }

  /**
   * Get categories with product counts
   */
  async getCategoriesWithCounts() {
    const categories = await Category.find({ isActive: true })
      .sort("order")
      .lean();

    return await Promise.all(
      categories.map(async (category) => {
        const productCount = await Product.countDocuments({
          categoryId: category._id,
          isAvailable: true,
        });

        return {
          ...category,
          productCount,
        };
      })
    );
  }

  /**
   * Get top categories (for homepage)
   * Returns 8 featured categories with icon + name
   */
  async getTopCategories(limit = 8) {
    const categories = await Category.find({
      isActive: true,
      isFeatured: true,
    })
      .sort({ order: 1, productCount: -1 })
      .limit(limit)
      .select("name slug icon image productCount")
      .lean();

    return categories;
  }
}

export default new CategoryService();
