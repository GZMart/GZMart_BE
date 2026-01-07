import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * Create a new category
 */
export const createCategory = async (categoryData) => {
  const { name, slug, parentId, level } = categoryData;

  // Sanitize parentId - convert empty string to null
  if (!parentId || parentId === "") {
    categoryData.parentId = null;
  }

  // Check if slug already exists and generate unique slug
  let finalSlug = slug;
  let counter = 1;
  while (await Category.findOne({ slug: finalSlug })) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }
  categoryData.slug = finalSlug;

  // If has parent, validate parent exists
  if (categoryData.parentId) {
    const parent = await Category.findById(categoryData.parentId);
    if (!parent) {
      throw new ErrorResponse("Parent category not found", 404);
    }
    // Set level based on parent
    categoryData.level = parent.level + 1;
  }

  const category = await Category.create(categoryData);
  return category;
};

/**
 * Get all categories with optional filters
 */
export const getCategories = async (filters = {}) => {
  const { parentId, level, status, search } = filters;

  const query = {};

  if (parentId !== undefined) {
    query.parentId = parentId === "null" ? null : parentId;
  }
  if (level) query.level = level;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  const categories = await Category.find(query)
    .populate("parentId", "name slug")
    .sort({ level: 1, name: 1 });

  return categories;
};

/**
 * Get category tree (hierarchical structure)
 */
export const getCategoryTree = async () => {
  const categories = await Category.find({ status: "active" }).lean();

  // Build tree structure
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
 * Get category by ID
 */
export const getCategoryById = async (categoryId) => {
  const category = await Category.findById(categoryId).populate(
    "parentId",
    "name slug"
  );

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  return category;
};

/**
 * Get child categories
 */
export const getChildCategories = async (parentId) => {
  const parent = await Category.findById(parentId);
  if (!parent) {
    throw new ErrorResponse("Parent category not found", 404);
  }

  const children = await Category.find({ parentId }).sort({ name: 1 });
  return children;
};

/**
 * Update category
 */
export const updateCategory = async (categoryId, updateData) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  // If changing slug, check uniqueness
  if (updateData.slug && updateData.slug !== category.slug) {
    const existingCategory = await Category.findOne({ slug: updateData.slug });
    if (existingCategory) {
      throw new ErrorResponse("Category slug already exists", 400);
    }
  }

  // If changing parentId, validate
  if (updateData.parentId) {
    const parent = await Category.findById(updateData.parentId);
    if (!parent) {
      throw new ErrorResponse("Parent category not found", 404);
    }
    updateData.level = parent.level + 1;
  }

  Object.assign(category, updateData);
  await category.save();

  return category;
};

/**
 * Delete category (soft delete by setting status to inactive)
 */
export const deleteCategory = async (categoryId) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  // Check if category has products
  const productCount = await Product.countDocuments({ categoryId });
  if (productCount > 0) {
    throw new ErrorResponse(
      `Cannot delete category with ${productCount} products. Please move or delete products first.`,
      400
    );
  }

  // Check if category has child categories
  const childCount = await Category.countDocuments({ parentId: categoryId });
  if (childCount > 0) {
    throw new ErrorResponse(
      `Cannot delete category with ${childCount} sub-categories. Please delete child categories first.`,
      400
    );
  }

  // Soft delete
  category.status = "inactive";
  await category.save();

  return category;
};

/**
 * Permanently delete category
 */
export const permanentDeleteCategory = async (categoryId) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  // Check constraints
  const productCount = await Product.countDocuments({ categoryId });
  if (productCount > 0) {
    throw new ErrorResponse("Cannot delete category with products", 400);
  }

  const childCount = await Category.countDocuments({ parentId: categoryId });
  if (childCount > 0) {
    throw new ErrorResponse("Cannot delete category with sub-categories", 400);
  }

  await category.deleteOne();
  return category;
};

/**
 * Get category statistics
 */
export const getCategoryStats = async (categoryId) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  const [productCount, childCount, products] = await Promise.all([
    Product.countDocuments({ categoryId, status: "active" }),
    Category.countDocuments({ parentId: categoryId }),
    Product.find({ categoryId, status: "active" })
      .select("sold viewCount")
      .lean(),
  ]);

  const totalSold = products.reduce((sum, p) => sum + p.sold, 0);
  const totalViews = products.reduce((sum, p) => sum + p.viewCount, 0);

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
