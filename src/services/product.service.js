import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { generateSKU } from "../utils/skuGenerator.js";

/**
 * Generate URL-friendly slug
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);
};

/**
 * Create a new product with embedded tiers and models
 * (Logic: Dev - Strict validation)
 */
export const createProduct = async (productData, sellerId) => {
  const {
    name,
    categoryId,
    description,
    attributes,
    tiers,
    models,
    images,
    tags,
    brand,
  } = productData;

  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }
  if (category.status !== "active") {
    throw new ErrorResponse("Cannot add product to inactive category", 400);
  }

  if (tiers && tiers.length > 0) {
    if (tiers.length > 3) {
      throw new ErrorResponse("Product cannot have more than 3 tiers", 400);
    }
    tiers.forEach((tier) => {
      if (!tier.options || tier.options.length === 0) {
        throw new ErrorResponse(`Tier "${tier.name}" must have options`, 400);
      }
      if (tier.options.length > 20) {
        throw new ErrorResponse(`Tier "${tier.name}" limit is 20 options`, 400);
      }
    });
  }

  if (!models || models.length === 0) {
    throw new ErrorResponse("Product must have at least one variant", 400);
  }

  if (models.length > 200) {
    throw new ErrorResponse("Product cannot have more than 200 models", 400);
  }

  models.forEach((model, modelIdx) => {
    if (!tiers || tiers.length === 0) {
      if (model.tierIndex && model.tierIndex.length > 0) {
        throw new ErrorResponse(
          `Model ${modelIdx} has unexpected tierIndex`,
          400,
        );
      }
      return;
    }

    if (!model.tierIndex || model.tierIndex.length !== tiers.length) {
      throw new ErrorResponse(`Model ${modelIdx}: tierIndex mismatch`, 400);
    }

    model.tierIndex.forEach((idx, tierPosition) => {
      const tier = tiers[tierPosition];
      if (idx < 0 || idx >= tier.options.length) {
        throw new ErrorResponse(
          `Model ${modelIdx}: tierIndex out of bounds`,
          400,
        );
      }
    });
  });

  const normalizedSKUs = [];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    let sku = model.sku ? String(model.sku).toUpperCase().trim() : null;

    if (!sku) {
      let attempts = 0;
      let candidate = "";
      do {
        candidate = generateSKU(name, tiers || [], model.tierIndex || []);
        if (!normalizedSKUs.includes(candidate)) break;
        attempts++;
      } while (attempts < 5);

      if (normalizedSKUs.includes(candidate)) {
        candidate = `${candidate}-${Date.now().toString().slice(-4)}`;
      }
      sku = candidate;
      model.sku = sku;
    }

    model.sku = String(sku).toUpperCase();
    normalizedSKUs.push(model.sku);
  }

  const duplicates = normalizedSKUs.filter(
    (sku, index) => normalizedSKUs.indexOf(sku) !== index,
  );
  if (duplicates.length > 0) {
    throw new ErrorResponse(
      `Duplicate SKUs in payload: ${[...new Set(duplicates)].join(", ")}`,
      400,
    );
  }

  const existingSKUs = await Product.find({
    "models.sku": { $in: normalizedSKUs },
  }).select("models.sku");
  if (existingSKUs.length > 0) {
    throw new ErrorResponse("SKU already exists in database", 400);
  }

  const prices = models.map((m) => m.price);
  const originalPrice = Math.min(...prices);

  if (originalPrice <= 0) {
    throw new ErrorResponse("Product must have price > 0", 400);
  }

  const slug = generateSlug(name);
  let finalSlug = slug;
  let counter = 1;
  while (await Product.findOne({ slug: finalSlug })) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }

  const totalStock = models.reduce((sum, model) => sum + model.stock, 0);
  const status = totalStock > 0 ? "active" : "out_of_stock";

  const product = new Product({
    name,
    slug: finalSlug,
    categoryId,
    description,
    attributes: attributes || [],
    tiers: tiers || [],
    models,
    originalPrice,
    images: images || [],
    tags: tags || [],
    brand,
    status,
    sellerId,
  });

  await product.save();
  await Category.findByIdAndUpdate(categoryId, { $inc: { productCount: 1 } });

  return product;
};

/**
 * Get product by ID
 * (Merged: Dev logic + GZM-13 view increment)
 */
export const getProductById = async (productId) => {
  const product = await Product.findById(productId).populate(
    "categoryId",
    "name slug",
  );

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  // Increment view count (GZM-13 feature)
  product.viewCount = (product.viewCount || 0) + 1;
  await product.save({ validateBeforeSave: false });

  return product;
};

/**
 * Get product by Slug
 */
export const getProductBySlug = async (slug) => {
  const product = await Product.findOne({ slug }).populate(
    "categoryId",
    "name slug",
  );

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  product.viewCount = (product.viewCount || 0) + 1;
  await product.save({ validateBeforeSave: false });

  return product;
};

/**
 * Get products (Admin/Seller Dashboard)
 */
export const getProducts = async (filters = {}, options = {}) => {
  const {
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
    categoryId,
    status,
    minPrice,
    maxPrice,
    search,
  } = options;

  const query = {};

  if (categoryId) query.categoryId = categoryId;
  if (status) query.status = status;

  if (minPrice || maxPrice) {
    // Query embedded models price (Optimized)
    query["models.price"] = {};
    if (minPrice) query["models.price"].$gte = Number(minPrice);
    if (maxPrice) query["models.price"].$lte = Number(maxPrice);
  }

  if (search) {
    query.$text = { $search: search };
  }

  Object.assign(query, filters);

  const skip = (page - 1) * limit;
  const sortOptions = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

  const [products, total] = await Promise.all([
    Product.find(query)
      .populate("categoryId", "name slug")
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query),
  ]);

  return {
    products,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

/**
 * Advanced Search for Storefront
 * (Replaces GZM-13 Aggregation with Optimized Embedded Query)
 */
export const getProductsAdvanced = async (options) => {
  const {
    page = 1,
    limit = 20,
    categoryId,
    brands, // Array
    minPrice,
    maxPrice,
    minRating,
    inStock,
    colors, // Array of strings
    sizes, // Array of strings
  } = options;

  const query = { status: "active" };

  if (categoryId) query.categoryId = categoryId;

  if (brands && brands.length > 0) {
    query.brand = { $in: brands };
  }

  if (minRating) {
    query.rating = { $gte: Number(minRating) };
  }

  // Embedded Price Filter
  if (minPrice || maxPrice) {
    query["models.price"] = {};
    if (minPrice) query["models.price"].$gte = Number(minPrice);
    if (maxPrice) query["models.price"].$lte = Number(maxPrice);
  }

  // Embedded Stock Filter
  if (inStock) {
    // At least one model has stock > 0
    query["models.stock"] = { $gt: 0 };
  }

  // Attribute/Tier Filter (Colors/Sizes)
  if ((colors && colors.length > 0) || (sizes && sizes.length > 0)) {
    // Logic: Search inside tiers options
    const orConditions = [];
    if (colors && colors.length > 0) {
      orConditions.push({
        tiers: {
          $elemMatch: {
            name: { $regex: /color|màu/i },
            options: { $in: colors },
          },
        },
      });
    }
    if (sizes && sizes.length > 0) {
      orConditions.push({
        tiers: {
          $elemMatch: {
            name: { $regex: /size|kích/i },
            options: { $in: sizes },
          },
        },
      });
    }
    if (orConditions.length > 0) {
      query.$and = orConditions;
    }
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find(query)
      .populate("categoryId", "name slug")
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query),
  ]);

  return {
    products,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

/**
 * Update product
 * (Logic: Dev)
 */
export const updateProduct = async (productId, updateData, sellerId) => {
  const product = await Product.findById(productId);

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  // Debug: Log both values to identify mismatch
  console.log("🔍 Authorization check:", {
    productSellerId: product.sellerId?.toString(),
    requestSellerId: sellerId?.toString(),
    match: product.sellerId?.toString() === sellerId?.toString(),
  });

  if (product.sellerId?.toString() !== sellerId?.toString()) {
    throw new ErrorResponse("Not authorized to update this product", 403);
  }

  if (updateData.models) {
    const prices = updateData.models.map((m) => m.price);
    updateData.originalPrice = Math.min(...prices);

    // Preserve existing SKUs or generate new ones if missing
    const existingModels = product.models || [];
    updateData.models = updateData.models.map((model, idx) => {
      if (!model.sku) {
        // Try to find matching existing model by tierIndex
        const existingModel = existingModels.find(
          (em) =>
            JSON.stringify(em.tierIndex) === JSON.stringify(model.tierIndex),
        );
        if (existingModel?.sku) {
          model.sku = existingModel.sku;
        } else if (existingModels[idx]?.sku) {
          // Fallback to same index
          model.sku = existingModels[idx].sku;
        } else {
          // Generate new SKU
          model.sku = generateSKU(
            product.name,
            updateData.tiers || product.tiers || [],
            model.tierIndex || [],
          );
        }
      }
      return model;
    });

    // Auto update total stock availability status
    const totalStock = updateData.models.reduce(
      (sum, m) => sum + (m.stock || 0),
      0,
    );
    if (totalStock === 0 && product.status === "active") {
      updateData.status = "out_of_stock";
    }
  }

  Object.assign(product, updateData);
  await product.save();

  return product;
};

/**
 * Delete product
 * (Logic: Dev)
 */
export const deleteProduct = async (productId, sellerId) => {
  const product = await Product.findById(productId);

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  if (product.sellerId.toString() !== sellerId) {
    throw new ErrorResponse("Not authorized to delete this product", 403);
  }

  await Category.findByIdAndUpdate(product.categoryId, {
    $inc: { productCount: -1 },
  });

  await product.deleteOne();

  return product;
};

/**
 * Get featured products (GZM-13 Feature)
 */
export const getFeaturedProducts = async (limit = 10) => {
  return await Product.find({ status: "active", isFeatured: true })
    .populate("categoryId", "name slug")
    .sort("-createdAt")
    .limit(limit)
    .lean();
};

/**
 * Get trending products (GZM-13 Feature)
 */
export const getTrendingProducts = async (limit = 10) => {
  // Trending based on sales or explicit flag
  return await Product.find({
    status: "active",
    $or: [{ isTrending: true }, { sold: { $gt: 10 } }],
  })
    .populate("categoryId", "name slug")
    .sort({ sold: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get new arrivals (GZM-13 Feature)
 */
export const getNewArrivals = async (limit = 10) => {
  return await Product.find({ status: "active", isNewArrival: true })
    .populate("categoryId", "name slug")
    .sort("-createdAt")
    .limit(limit)
    .lean();
};

/**
 * Check stock availability for a specific SKU/Model ID
 */
export const checkStockAvailability = async (
  productId,
  modelId,
  quantity = 1,
) => {
  const product = await Product.findOne(
    { _id: productId, "models._id": modelId },
    { "models.$": 1 }, // Only fetch the matching model
  );

  if (!product || !product.models || product.models.length === 0) {
    throw new ErrorResponse("Product variant not found", 404);
  }

  const model = product.models[0];
  return {
    available: model.stock >= quantity,
    stock: model.stock,
    price: model.price,
  };
};

/**
 * Get filter metadata (Min/Max Price, Brands) for UI
 */
export const getAvailableFilters = async (categoryId = null) => {
  const query = { status: "active" };
  if (categoryId) query.categoryId = categoryId;

  // Get unique brands
  const brands = await Product.distinct("brand", query);

  // Get price range (Optimized using aggregation on embedded models)
  const priceStats = await Product.aggregate([
    { $match: query },
    { $unwind: "$models" },
    {
      $group: {
        _id: null,
        min: { $min: "$models.price" },
        max: { $max: "$models.price" },
      },
    },
  ]);

  const priceRange =
    priceStats.length > 0
      ? { min: priceStats[0].min, max: priceStats[0].max }
      : { min: 0, max: 0 };

  return {
    brands: brands.filter(Boolean).sort(),
    priceRange,
    ratings: [5, 4, 3, 2, 1],
  };
};

/**
 * Get products by seller ID
 */
export const getProductsBySeller = async (sellerId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find({ sellerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments({ sellerId }),
  ]);

  return { products, total, page, pages: Math.ceil(total / limit) };
};

/**
 * Get products by category ID
 */
export const getProductsByCategory = async (categoryId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find({ categoryId, status: "active" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments({ categoryId, status: "active" }),
  ]);

  return { products, total, page, pages: Math.ceil(total / limit) };
};

/**
 * Simple Search
 */
export const searchProducts = async (keyword, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const query = {
    status: "active",
    $text: { $search: keyword },
  };

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query),
  ]);

  return { products, total, page, pages: Math.ceil(total / limit) };
};

/**
 * Get related products
 */
export const getRelatedProducts = async (productId, limit = 10) => {
  const product = await Product.findById(productId).select("categoryId");
  if (!product) throw new ErrorResponse("Product not found", 404);

  return await Product.find({
    categoryId: product.categoryId,
    _id: { $ne: productId },
    status: "active",
  })
    .limit(limit)
    .sort({ sold: -1, rating: -1 })
    .lean();
};

/**
 * Get variant by tier index
 */
export const getVariantByTierIndex = async (productId, tierIndex) => {
  const product = await Product.findById(productId)
    .select("models tiers")
    .lean();
  if (!product) throw new ErrorResponse("Product not found", 404);

  const models = product.models || [];
  const variant = models.find((model) => {
    if (!model.tierIndex || !Array.isArray(model.tierIndex)) return false;
    return JSON.stringify(model.tierIndex) === JSON.stringify(tierIndex);
  });

  if (!variant)
    throw new ErrorResponse("Variant not found for tier selection", 404);
  return variant;
};

/**
 * Get available options for selection
 */
export const getAvailableOptions = async (productId, selection) => {
  const product = await Product.findById(productId)
    .select("models tiers")
    .lean();
  if (!product) throw new ErrorResponse("Product not found", 404);

  const models = product.models || [];
  const tiers = product.tiers || [];

  // Find available options for next tier
  const selectionKeys = Object.keys(selection);
  const nextTierIndex = selectionKeys.length;

  if (nextTierIndex >= tiers.length) {
    return { availableOptions: [], nextTier: null };
  }

  const availableOptions = new Set();

  models.forEach((model) => {
    if (!model.tierIndex || model.stock <= 0) return;

    // Check if current selection matches
    const matches = selectionKeys.every((key) => {
      return model.tierIndex[parseInt(key)] === selection[key];
    });

    if (matches && model.tierIndex[nextTierIndex] !== undefined) {
      availableOptions.add(model.tierIndex[nextTierIndex]);
    }
  });

  return {
    availableOptions: Array.from(availableOptions),
    nextTier: tiers[nextTierIndex],
  };
};
