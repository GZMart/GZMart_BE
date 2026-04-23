import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import * as productService from "./product.service.js";

/**
 * Create a new category
 */
export const createCategory = async (categoryData) => {
  const { slug, parentId } = categoryData;

  if (!parentId || parentId === "") {
    categoryData.parentId = null;
    categoryData.level = 1;
  }

  let finalSlug = slug;
  if (finalSlug) {
    let counter = 1;
    while (await Category.findOne({ slug: finalSlug })) {
      finalSlug = `${slug}-${counter}`;
      counter++;
    }
    categoryData.slug = finalSlug;
  }

  if (categoryData.parentId) {
    const parent = await Category.findById(categoryData.parentId);
    if (!parent) {
      throw new ErrorResponse("Parent category not found", 404);
    }
    categoryData.level = (parent.level || 0) + 1;

    if (categoryData.level > 3) {
      throw new ErrorResponse("Category level cannot exceed 3", 400);
    }
  }

  const category = await Category.create(categoryData);
  return category;
};

/**
 * Get all categories with filters
 */
export const getCategories = async (filters = {}) => {
  const { parentId, level, status, search, isFeatured } = filters;

  const query = {};

  if (parentId !== undefined) {
    query.parentId = parentId === "null" ? null : parentId;
  }
  if (level) query.level = level;
  if (status) query.status = status;
  if (isFeatured) query.isFeatured = true;

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  const categories = await Category.find(query)
    .populate("parentId", "name slug")
    .sort({ order: 1, level: 1, createdAt: -1 });

  return categories;
};

/**
 * Get category by ID or Slug
 */
export const getCategory = async (identifier) => {
  let query;

  if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
    query = Category.findById(identifier);
  } else {
    query = Category.findOne({ slug: identifier });
  }

  const category = await query.populate("parentId", "name slug").lean();

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  return category;
};

/**
 * Get category tree structure
 * @param {boolean} includeAll - If true, include all statuses (admin use)
 */
export const getCategoryTree = async (includeAll = false) => {
  const query = includeAll ? {} : { status: "active" };
  const categories = await Category.find(query)
    .sort({ order: 1, name: 1 })
    .lean();

  const buildTree = (parentId = null) => {
    return categories
      .filter((cat) => String(cat.parentId) === String(parentId))
      .map((cat) => ({
        ...cat,
        children: buildTree(cat._id),
      }));
  };

  return buildTree(null);
};

/**
 * Update category
 */
export const updateCategory = async (categoryId, updateData) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  // Remove empty/undefined slug to preserve existing slug
  if (!updateData.slug) {
    delete updateData.slug;
  }

  if (updateData.slug && updateData.slug !== category.slug) {
    const existing = await Category.findOne({ slug: updateData.slug });
    if (existing) {
      throw new ErrorResponse("Category slug already exists", 400);
    }
  }

  if (updateData.parentId) {
    if (String(updateData.parentId) === String(categoryId)) {
      throw new ErrorResponse("Category cannot be its own parent", 400);
    }

    const parent = await Category.findById(updateData.parentId);
    if (!parent) {
      throw new ErrorResponse("Parent category not found", 404);
    }
    updateData.level = parent.level + 1;
  } else if (updateData.parentId === null) {
    // Moving to root level
    updateData.level = 1;
  }

  Object.assign(category, updateData);
  await category.save();

  return category;
};

/**
 * Delete category (Soft delete)
 */
export const deleteCategory = async (categoryId) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  const productCount = await Product.countDocuments({ categoryId });
  if (productCount > 0) {
    throw new ErrorResponse(
      `Cannot delete: Category has ${productCount} products.`,
      400
    );
  }

  const childCount = await Category.countDocuments({ parentId: categoryId });
  if (childCount > 0) {
    throw new ErrorResponse(
      `Cannot delete: Category has ${childCount} sub-categories.`,
      400
    );
  }

  category.status = "inactive";
  await category.save();

  return category;
};

/**
 * Permanently Delete
 */
export const permanentDeleteCategory = async (categoryId) => {
  const category = await Category.findById(categoryId);
  if (!category) throw new ErrorResponse("Category not found", 404);

  const productCount = await Product.countDocuments({ categoryId });
  const childCount = await Category.countDocuments({ parentId: categoryId });

  if (productCount > 0 || childCount > 0) {
    throw new ErrorResponse("Cannot delete category with related data", 400);
  }

  await category.deleteOne();
  return category;
};

/**
 * Get top categories for Homepage
 */
export const getTopCategories = async (limit = 8) => {
  return await Category.find({
    status: "active",
    isFeatured: true,
  })
    .sort({ order: 1, productCount: -1 })
    .limit(limit)
    .select("name slug icon image productCount")
    .lean();
};

/**
 * Get featured categories list
 */
export const getFeaturedCategories = async () => {
  return await Category.find({ status: "active", isFeatured: true })
    .sort({ order: 1 })
    .lean();
};

/**
 * Get categories with computed product counts
 */
export const getCategoriesWithCounts = async () => {
  const categories = await Category.find({ status: "active" })
    .sort({ order: 1 })
    .lean();

  return await Promise.all(
    categories.map(async (category) => {
      const productCount = await Product.countDocuments({
        categoryId: category._id,
        status: "active",
      });
      return { ...category, productCount };
    })
  );
};

/**
 * Get products inside a category
 */
export const getCategoryProducts = async (categoryId, options) => {
  const category = await getCategory(categoryId);

  return await productService.getProducts({
    ...options,
    filters: {
      ...options.filters,
      categoryId: category._id,
    },
  });
};

/**
 * Get detailed stats for Admin Dashboard
 */
export const getCategoryStats = async (categoryId) => {
  const category = await Category.findById(categoryId);
  if (!category) throw new ErrorResponse("Category not found", 404);

  const [productCount, childCount, products] = await Promise.all([
    Product.countDocuments({ categoryId, status: "active" }),
    Category.countDocuments({ parentId: categoryId }),
    Product.find({ categoryId, status: "active" })
      .select("sold viewCount")
      .lean(),
  ]);

  const totalSold = products.reduce((sum, p) => sum + (p.sold || 0), 0);
  const totalViews = products.reduce((sum, p) => sum + (p.viewCount || 0), 0);

  return {
    categoryId,
    categoryName: category.name,
    productCount,
    childCount,
    totalSold,
    totalViews,
    status: category.status,
  };
};

/**
 * Get child categories
 */
export const getChildCategories = async (parentId) => {
  return await Category.find({ parentId }).sort({ order: 1, name: 1 });
};

/**
 * Bulk-update order fields for a list of categories.
 * @param {Array<{id: string, order: number}>} items
 */
export const reorderCategories = async (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ErrorResponse("items must be a non-empty array", 400);
  }

  const bulkOps = items.map(({ id, order }) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { order } },
    },
  }));

  await Category.bulkWrite(bulkOps);
  return { updated: items.length };
};

/**
 * Get categories for Mega Menu
 */
export const getMegaMenuCategories = async () => {
  // 1. Get top-level categories
  const categories = await Category.find({ parentId: null, status: "active" })
    .sort({ order: 1, name: 1 })
    .limit(6)
    .lean();

  const result = [];

  for (const cat of categories) {
    // 2. Get subcategories
    const subcats = await Category.find({ parentId: cat._id, status: "active" })
      .sort({ order: 1, name: 1 })
      .limit(6)
      .lean();

    const subcategories = [];

    for (const sub of subcats) {
      // 3. Get products for this subcategory
      const products = await Product.find({ categoryId: sub._id, status: "active" })
        .select("name brand images models originalPrice")
        .sort({ sold: -1, viewCount: -1 })
        .limit(5)
        .lean();

      subcategories.push({
        id: sub._id,
        name: sub.name,
        products: products.map(p => ({
          id: p._id,
          name: p.name,
          brand: p.brand || 'No Brand',
          image: p.images?.[0] || '',
          price: p.models?.length > 0 ? Math.min(...p.models.map(m => m.price)) : 0,
          originalPrice: p.originalPrice || null
        }))
      });
    }

    // 4. Get featured products for this category
    const catIds = [cat._id, ...subcats.map(s => s._id)];
    const featuredProducts = await Product.find({ categoryId: { $in: catIds }, status: "active" })
        .select("name brand images models originalPrice")
        .sort({ sold: -1, viewCount: -1 })
        .limit(4)
        .lean();

    result.push({
      id: cat._id,
      name: cat.name,
      subcategories,
      featuredProducts: featuredProducts.map(p => ({
        id: p._id,
        name: p.name,
        brand: p.brand || 'No Brand',
        image: p.images?.[0] || '',
        price: p.models?.length > 0 ? Math.min(...p.models.map(m => m.price)) : 0,
        originalPrice: p.originalPrice || null
      }))
    });
  }

  return result;
};
