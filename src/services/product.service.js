import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { generateSKU } from "../utils/skuGenerator.js";

/**
 * Create a new product with embedded tiers and models
 * @param {Object} productData - Product data from request body
 * @param {String} sellerId - ID of the seller creating the product
 * @returns {Object} Created product document
 */
const createProduct = async (productData, sellerId) => {
  const {
    name,
    categoryId,
    description,
    attributes,
    tiers,
    models,
    images,
    tags,
  } = productData;

  // Step 1: Validate that category exists and is active
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }
  if (category.status !== "active") {
    throw new ErrorResponse("Cannot add product to inactive category", 400);
  }

  // Step 2: Validate tier structure
  if (tiers && tiers.length > 0) {
    // Check tier count limit
    if (tiers.length > 3) {
      throw new ErrorResponse("Product cannot have more than 3 tiers", 400);
    }

    // Validate each tier has options
    tiers.forEach((tier, tierIdx) => {
      if (!tier.options || tier.options.length === 0) {
        throw new ErrorResponse(
          `Tier "${tier.name}" must have at least one option`,
          400
        );
      }
      if (tier.options.length > 20) {
        throw new ErrorResponse(
          `Tier "${tier.name}" cannot have more than 20 options`,
          400
        );
      }
    });
  }

  // Step 3: Validate models and tierIndex mapping
  if (!models || models.length === 0) {
    throw new ErrorResponse(
      "Product must have at least one model/variant",
      400
    );
  }

  if (models.length > 200) {
    throw new ErrorResponse("Product cannot have more than 200 models", 400);
  }

  // Validate tierIndex for each model (do not depend on SKU yet)
  models.forEach((model, modelIdx) => {
    // If no tiers, tierIndex should be empty or not provided
    if (!tiers || tiers.length === 0) {
      if (model.tierIndex && model.tierIndex.length > 0) {
        throw new ErrorResponse(
          `Product has no tiers, but model at index ${modelIdx} provides tierIndex`,
          400
        );
      }
      return;
    }

    // If tiers exist, tierIndex must match tier count
    if (!model.tierIndex || model.tierIndex.length !== tiers.length) {
      throw new ErrorResponse(
        `Model at index ${modelIdx}: tierIndex length (${
          model.tierIndex?.length || 0
        }) must match tier count (${tiers.length})`,
        400
      );
    }

    // Validate each index is within bounds
    model.tierIndex.forEach((idx, tierPosition) => {
      const tier = tiers[tierPosition];
      if (idx < 0 || idx >= tier.options.length) {
        throw new ErrorResponse(
          `Model at index ${modelIdx}: tierIndex[${tierPosition}] = ${idx} is out of bounds. Tier "${
            tier.name
          }" has ${tier.options.length} options (valid indices: 0-${
            tier.options.length - 1
          })`,
          400
        );
      }
    });
  });

  // Assign or generate SKUs for models (ensure normalized uppercase SKUs)
  const normalizedSKUs = [];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    let sku = model.sku ? String(model.sku).toUpperCase().trim() : null;

    if (!sku) {
      // generate SKU using product name + selected option labels
      let attempts = 0;
      let candidate = "";
      do {
        candidate = generateSKU(name, tiers || [], model.tierIndex || []);
        // ensure candidate not used in this payload yet
        if (!normalizedSKUs.includes(candidate)) break;
        attempts++;
      } while (attempts < 5);

      // final fallback append timestamp
      if (normalizedSKUs.includes(candidate)) {
        candidate = `${candidate}-${Date.now().toString().slice(-4)}`;
      }
      sku = candidate;
      model.sku = sku; // assign back to model
    }

    model.sku = String(sku).toUpperCase();
    normalizedSKUs.push(model.sku);
  }

  // Check for duplicate SKUs in the request after generation
  const duplicates = normalizedSKUs.filter(
    (sku, index) => normalizedSKUs.indexOf(sku) !== index
  );
  if (duplicates.length > 0) {
    throw new ErrorResponse(
      `Duplicate SKUs found in payload: ${[...new Set(duplicates)].join(", ")}`,
      400
    );
  }

  // Check if any SKU already exists in database
  const existingSKUs = await Product.find({
    "models.sku": { $in: normalizedSKUs },
  }).select("models.sku");
  if (existingSKUs.length > 0) {
    const existing = existingSKUs.flatMap((p) =>
      p.models.filter((m) => normalizedSKUs.includes(m.sku)).map((m) => m.sku)
    );
    throw new ErrorResponse(
      `SKU already exists: ${[...new Set(existing)].join(", ")}`,
      400
    );
  }

  // Step 4: Calculate originalPrice (minimum price from all models)
  const prices = models.map((m) => m.price);
  const originalPrice = Math.min(...prices);

  if (originalPrice <= 0) {
    throw new ErrorResponse(
      "Product must have at least one model with price > 0",
      400
    );
  }

  // Step 5: Generate slug from product name
  const slug = generateSlug(name);

  // Check if slug already exists
  let finalSlug = slug;
  let counter = 1;
  while (await Product.findOne({ slug: finalSlug })) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }

  // Step 6: Determine product status based on stock
  const totalStock = models.reduce((sum, model) => sum + model.stock, 0);
  const status = totalStock > 0 ? "active" : "out_of_stock";

  // Step 7: Create product document
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
    status,
    sellerId,
    isAvailable: totalStock > 0,
  });

  // Step 8: Save to database (atomic operation)
  try {
    await product.save();
  } catch (err) {
    console.error("Product save failed. Models payload:", models);
    if (err && err.name === "ValidationError" && err.errors) {
      Object.keys(err.errors).forEach((key) => {
        console.error("Validation error", key, err.errors[key].message);
      });
    } else {
      console.error(err);
    }
    throw err;
  }

  // Step 9: Optionally increment category product count
  await Category.findByIdAndUpdate(categoryId, { $inc: { productCount: 1 } });

  return product;
};

/**
 * Get product by ID with populated category
 * @param {String} productId - Product ID
 * @returns {Object} Product document
 */
const getProductById = async (productId) => {
  const product = await Product.findById(productId).populate(
    "categoryId",
    "name slug"
  );

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  return product;
};

/**
 * Get all products with filters and pagination
 * @param {Object} filters - Query filters
 * @param {Object} options - Pagination and sorting options
 * @returns {Object} Products list with pagination info
 */
const getProducts = async (filters = {}, options = {}) => {
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

  // Build query
  const query = {};

  if (categoryId) query.categoryId = categoryId;
  if (status) query.status = status;
  if (minPrice || maxPrice) {
    query.originalPrice = {};
    if (minPrice) query.originalPrice.$gte = minPrice;
    if (maxPrice) query.originalPrice.$lte = maxPrice;
  }
  if (search) {
    query.$text = { $search: search };
  }

  // Apply filters
  Object.assign(query, filters);

  // Execute query
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
 * Update product
 * @param {String} productId - Product ID
 * @param {Object} updateData - Data to update
 * @param {String} sellerId - Seller ID for authorization
 * @returns {Object} Updated product
 */
const updateProduct = async (productId, updateData, sellerId) => {
  const product = await Product.findById(productId);

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  // Verify ownership
  if (product.sellerId.toString() !== sellerId) {
    throw new ErrorResponse("Not authorized to update this product", 403);
  }

  // If updating models, recalculate originalPrice
  if (updateData.models) {
    const prices = updateData.models.map((m) => m.price);
    updateData.originalPrice = Math.min(...prices);
  }

  // Update product
  Object.assign(product, updateData);
  await product.save();

  return product;
};

/**
 * Delete product
 * @param {String} productId - Product ID
 * @param {String} sellerId - Seller ID for authorization
 * @returns {Object} Deleted product
 */
const deleteProduct = async (productId, sellerId) => {
  const product = await Product.findById(productId);

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  // Verify ownership
  if (product.sellerId.toString() !== sellerId) {
    throw new ErrorResponse("Not authorized to delete this product", 403);
  }

  // Decrement category product count
  await Category.findByIdAndUpdate(product.categoryId, {
    $inc: { productCount: -1 },
  });

  await product.deleteOne();

  return product;
};

/**
 * Generate URL-friendly slug from product name
 * @param {String} name - Product name
 * @returns {String} Slug
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .substring(0, 100); // Limit length
};

export {
  createProduct,
  getProductById,
  getProducts,
  updateProduct,
  deleteProduct,
};
