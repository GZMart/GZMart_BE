import mongoose from "mongoose";
import Product from "../models/Product.js";
import InventoryItem from "../models/InventoryItem.js";
import Category from "../models/Category.js";
import User from "../models/User.js";
import ShopDecoration from "../models/ShopDecoration.js";
import Deal from "../models/Deal.js";
import ShopProgram from "../models/ShopProgram.js";
import ShopProgramProduct from "../models/ShopProgramProduct.js";
import ComboPromotion from "../models/ComboPromotion.js";
import AddOnDeal from "../models/AddOnDeal.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { generateSKU } from "../utils/skuGenerator.js";

// Public storefront visibility: include in-stock and out-of-stock products,
// but keep draft/inactive hidden.
const PUBLIC_VISIBLE_STATUSES = ["active", "out_of_stock"];

/**
 * Fetch the currently active flash sale for a product, shaped for the FE.
 * Returns null when there is no active flash sale.
 */
const getActiveFlashSaleForProduct = async (productId, originalPrice = 0) => {
  const now = new Date();
  const deal = await Deal.findOne({
    productId,
    type: "flash_sale",
    status: "active",
    startDate: { $lte: now },
    endDate: { $gt: now },
  }).lean();

  if (!deal) return null;

  const salePrice = deal.dealPrice ?? originalPrice;
  const discount =
    originalPrice > 0
      ? Math.round(((originalPrice - salePrice) / originalPrice) * 10000) / 100
      : 0;

  return {
    flashSaleId: deal._id,
    salePrice,
    originalPrice,
    discountPercent: discount,
    discountAmount: Math.max(0, originalPrice - salePrice),
    totalQuantity: deal.quantityLimit || 0,
    soldQuantity: deal.soldCount || 0,
    remainingQuantity: Math.max(
      0,
      (deal.quantityLimit || 0) - (deal.soldCount || 0),
    ),
    startAt: deal.startDate,
    endAt: deal.endDate,
    timeRemaining: Math.max(
      0,
      new Date(deal.endDate).getTime() - now.getTime(),
    ),
    campaignTitle: deal.title || null,
    purchaseLimitPerOrder: deal.purchaseLimitPerOrder,
    purchaseLimitPerUser: deal.purchaseLimitPerUser,
  };
};

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
    models: rawModels,
    images,
    tags,
    brand,
    preOrderDays,
    weight,
    weightUnit,
    dimLength,
    dimWidth,
    dimHeight,
    stock: topLevelStock,
  } = productData;

  const toSafeNonNegativeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  // Accept stock from multiple payload shapes to avoid accidental out_of_stock
  // when clients send quantity/top-level stock instead of model.stock.
  const models = (rawModels || []).map((model) => ({
    ...model,
    price: toSafeNonNegativeNumber(model.price, 0),
    costPrice: toSafeNonNegativeNumber(model.costPrice, 0),
    stock: toSafeNonNegativeNumber(
      model.stock ?? model.quantity ?? topLevelStock,
      0,
    ),
  }));

  if (categoryId) {
    const category = await Category.findById(categoryId);
    if (!category) {
      throw new ErrorResponse("Category not found", 404);
    }
    if (category.status !== "active") {
      throw new ErrorResponse("Cannot add product to inactive category", 400);
    }
  } else if (productData.status !== "draft") {
    throw new ErrorResponse("Category is required for published products", 400);
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

  if (originalPrice <= 0 && productData.status !== "draft") {
    throw new ErrorResponse("Product must have price > 0", 400);
  }

  const slug = generateSlug(name);
  let finalSlug = slug;
  let counter = 1;
  while (await Product.findOne({ slug: finalSlug })) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }

  const totalStock = models.reduce(
    (sum, model) => sum + (Number(model.stock) || 0),
    0,
  );
  const status =
    productData.status === "draft"
      ? "draft"
      : totalStock > 0
        ? "active"
        : "out_of_stock";

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
    preOrderDays: preOrderDays ?? 0,
    weight: weight ?? 0,
    weightUnit: weightUnit || "gr",
    dimLength: dimLength ?? 0,
    dimWidth: dimWidth ?? 0,
    dimHeight: dimHeight ?? 0,
  });

  await product.save();
  await Category.findByIdAndUpdate(categoryId, { $inc: { productCount: 1 } });

  // Auto-create InventoryItem for every model so stock is always tracked
  // even when the product was not imported via a Purchase Order.
  for (const model of product.models) {
    const existing = await InventoryItem.findOne({ sku: model.sku });
    if (!existing) {
      await InventoryItem.create({
        productId: product._id,
        modelId: model._id,
        sku: model.sku,
        quantity: model.stock || 0,
        costPrice: model.costPrice || 0,
        lastRestockDate: model.stock > 0 ? new Date() : null,
      });
    }
  }

  return product;
};

/**
 * Get product by ID
 * (Merged: Dev logic + GZM-13 view increment)
 */
export const getProductById = async (productId) => {
  const product = await Product.findById(productId)
    .populate("categoryId", "name slug")
    .populate(
      "sellerId",
      "fullName avatar email provinceName createdAt aboutMe",
    );

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  // Increment view count (GZM-13 feature)
  product.viewCount = (product.viewCount || 0) + 1;
  await product.save({ validateBeforeSave: false });

  // Convert to object so we can attach computed seller fields
  const productObj = product.toObject();

  if (productObj.sellerId && productObj.sellerId._id) {
    const sellerId = productObj.sellerId._id;
    // Import dynamically or ensure imported at file top
    // Try doing parallel promises to fetch shop details
    const [shopStats, productCount, followerCount, followingCount] =
      await Promise.all([
        import("../models/ShopStatistic.js").then((m) =>
          m.default.findOne({ sellerId }),
        ),
        Product.countDocuments({
          sellerId,
          status: { $in: PUBLIC_VISIBLE_STATUSES },
        }),
        import("../models/Follow.js").then((m) =>
          m.default.countDocuments({ followingId: sellerId }),
        ),
        import("../models/Follow.js").then((m) =>
          m.default.countDocuments({ followerId: sellerId }),
        ),
      ]);

    productObj.sellerId.productCount = productCount;
    productObj.sellerId.followerCount = followerCount;
    productObj.sellerId.followingCount = followingCount;

    if (shopStats) {
      productObj.sellerId.isPreferred = shopStats.isPreferred;
      productObj.sellerId.rating = shopStats.ratingAverage;
      productObj.sellerId.ratingCount = shopStats.ratingCount;
      productObj.sellerId.chatResponseRate = shopStats.chatResponseRate;
      productObj.sellerId.cancelDutyRate = shopStats.cancelDutyRate;
    } else {
      // Default fallback
      productObj.sellerId.isPreferred = false;
      productObj.sellerId.rating = 0;
      productObj.sellerId.ratingCount = 0;
      productObj.sellerId.chatResponseRate = 100;
      productObj.sellerId.cancelDutyRate = 0;
    }
  }

  console.log("RETURNING", JSON.stringify(productObj.sellerId));
  return productObj;
  const flashSale = await getActiveFlashSaleForProduct(
    product._id,
    product.originalPrice,
  );

  const result = product.toObject();
  result.flashSale = flashSale;
  return result;
};

/**
 * Get product by Slug
 */
export const getProductBySlug = async (slug) => {
  const product = await Product.findOne({ slug })
    .populate("categoryId", "name slug")
    .populate(
      "sellerId",
      "fullName avatar email provinceName createdAt aboutMe",
    );

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  product.viewCount = (product.viewCount || 0) + 1;
  await product.save({ validateBeforeSave: false });

  // Convert to object so we can attach computed seller fields
  const productObj = product.toObject();

  if (productObj.sellerId && productObj.sellerId._id) {
    const sellerId = productObj.sellerId._id;
    const [shopStats, productCount, followerCount, followingCount] =
      await Promise.all([
        import("../models/ShopStatistic.js").then((m) =>
          m.default.findOne({ sellerId }),
        ),
        Product.countDocuments({
          sellerId,
          status: { $in: PUBLIC_VISIBLE_STATUSES },
        }),
        import("../models/Follow.js").then((m) =>
          m.default.countDocuments({ followingId: sellerId }),
        ),
        import("../models/Follow.js").then((m) =>
          m.default.countDocuments({ followerId: sellerId }),
        ),
      ]);

    productObj.sellerId.productCount = productCount;
    productObj.sellerId.followerCount = followerCount;
    productObj.sellerId.followingCount = followingCount;

    if (shopStats) {
      productObj.sellerId.isPreferred = shopStats.isPreferred;
      productObj.sellerId.rating = shopStats.ratingAverage;
      productObj.sellerId.ratingCount = shopStats.ratingCount;
      productObj.sellerId.chatResponseRate = shopStats.chatResponseRate;
      productObj.sellerId.cancelDutyRate = shopStats.cancelDutyRate;
    } else {
      productObj.sellerId.isPreferred = false;
      productObj.sellerId.rating = 0;
      productObj.sellerId.ratingCount = 0;
      productObj.sellerId.chatResponseRate = 100;
      productObj.sellerId.cancelDutyRate = 0;
    }
  }

  return productObj;

  const flashSale = await getActiveFlashSaleForProduct(
    product._id,
    product.originalPrice,
  );

  const result = product.toObject();
  result.flashSale = flashSale;
  return result;
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
    categorySlug, // Slug-based lookup (alternative to categoryId)
    brands, // Array
    minPrice,
    maxPrice,
    minRating,
    inStock,
    colors, // Array of strings
    sizes, // Array of strings
    locations, // Array of strings
    minDiscount, // Number
    sortBy = "isFeatured",
    sortOrder = "desc",
  } = options;

  const query = { status: { $in: ["active", "out_of_stock"] } };

  // Resolve categorySlug to categoryId if slug provided instead of ID
  let resolvedCategoryId = categoryId;
  if (!resolvedCategoryId && categorySlug) {
    const cat = await Category.findOne({ slug: categorySlug })
      .select("_id")
      .lean();
    resolvedCategoryId = cat?._id;
  }

  if (resolvedCategoryId) query.categoryId = resolvedCategoryId;

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

  if (inStock) {
    query.status = "active";
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

  // Location Filter (Seller's Location)
  if (locations && locations.length > 0) {
    const locationMap = {
      hanoi: "Hà Nội",
      hcm: "Hồ Chí Minh",
      danang: "Đà Nẵng",
      cantho: "Cần Thơ",
      haiphong: "Hải Phòng",
    };

    const searchTerms = locations.map((loc) => locationMap[loc] || loc);
    const locationRegex = searchTerms.map((term) => new RegExp(term, "i"));

    const sellers = await User.find({
      $or: [
        { provinceName: { $in: locationRegex } }, // Assuming provinceName stores "Hà Nội", etc.
        { address: { $in: locationRegex } }, // Fallback to address
      ],
    }).select("_id");

    const sellerIds = sellers.map((s) => s._id);

    // If no sellers found for location, return empty immediately or filter by empty list matches nothing
    if (sellerIds.length === 0) {
      return {
        products: [],
        pagination: { total: 0, page, pages: 0, limit },
      };
    }

    query.sellerId = { $in: sellerIds };
  }

  // Discount Filter
  if (minDiscount) {
    // Calculate if any model has price <= originalPrice * (1 - minDiscount/100)
    // Using $expr to compare fields within the document
    query.$expr = {
      $lte: [
        { $min: "$models.price" }, // Min price of all models
        {
          $multiply: ["$originalPrice", (100 - parseFloat(minDiscount)) / 100],
        },
      ],
    };
  }

  const skip = (page - 1) * limit;

  // Map 'price' sort to 'originalPrice' for backend schema compatibility
  const sortKey = sortBy === "price" ? "originalPrice" : sortBy;
  const sortOptions = { [sortKey]: sortOrder === "desc" ? -1 : 1 };

  // Ensure we sort by ID/created last to ensure stable pagination
  if (sortKey !== "createdAt") {
    sortOptions.createdAt = -1;
  }

  const [products, total] = await Promise.all([
    Product.find(query)
      .populate("categoryId", "name slug")
      .populate(
        "sellerId",
        "fullName avatar email provinceName createdAt aboutMe",
      )
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
        const existingModel = existingModels.find(
          (em) =>
            JSON.stringify(em.tierIndex) === JSON.stringify(model.tierIndex),
        );
        if (existingModel?.sku) {
          model.sku = existingModel.sku;
        } else if (existingModels[idx]?.sku) {
          model.sku = existingModels[idx].sku;
        } else {
          model.sku = generateSKU(
            product.name,
            updateData.tiers || product.tiers || [],
            model.tierIndex || [],
          );
        }
      }

      // STOCK GUARD: preserve existing stock from DB — stock is owned by InventoryItem.
      // Never allow the product edit form to overwrite stock directly.
      const existingModel = existingModels.find(
        (em) =>
          em.sku === model.sku || em._id?.toString() === model._id?.toString(),
      );
      model.stock = existingModel ? existingModel.stock : model.stock || 0;

      return model;
    });
  }

  // Strip stock-related writes from the top-level updateData to prevent bypass.
  delete updateData.stock;

  Object.assign(product, updateData);

  // Derive status from InventoryItem totals (authoritative) rather than model.stock cache.
  const inventoryItems = await InventoryItem.find({ productId: product._id });
  const totalInventoryStock = inventoryItems.reduce(
    (sum, inv) => sum + inv.quantity,
    0,
  );
  if (totalInventoryStock === 0 && product.status === "active") {
    product.status = "out_of_stock";
  } else if (totalInventoryStock > 0 && product.status === "out_of_stock") {
    product.status = "active";
  }

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
  // Backward compatibility:
  // Frontend still uses /trending, but section title is now TODAY'S RECOMMENDATIONS.
  return await getTodayRecommendations(limit);
};

/**
 * Get today's recommendations
 * - Prioritize active, in-stock products with healthy social proof.
 * - Rotate results daily so recommendations feel fresh each day.
 */
export const getTodayRecommendations = async (limit = 10) => {
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 30)
    : 10;

  const candidates = await Product.find({
    status: "active",
    $or: [
      { stock: { $gt: 0 } },
      { "models.stock": { $gt: 0 } },
      { sold: { $gt: 0 } },
    ],
  })
    .populate("categoryId", "name slug")
    .sort({
      isFeatured: -1,
      isTrending: -1,
      sold: -1,
      rating: -1,
      reviewCount: -1,
      createdAt: -1,
    })
    .limit(120)
    .lean();

  if (candidates.length <= safeLimit) {
    return candidates;
  }

  const now = new Date();
  const daySeed = Number(
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`,
  );
  const start = daySeed % candidates.length;
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];

  return rotated.slice(0, safeLimit);
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
    { "models.$": 1 },
  );

  if (!product || !product.models || product.models.length === 0) {
    throw new ErrorResponse("Product variant not found", 404);
  }

  const model = product.models[0];

  // Read stock from InventoryItem (single source of truth).
  // Fall back to model.stock cache if no inventory record exists yet.
  const inventoryItem = await InventoryItem.findOne({ sku: model.sku });
  const availableStock = inventoryItem
    ? inventoryItem.availableQuantity
    : model.stock;

  return {
    available: availableStock >= quantity,
    stock: availableStock,
    price: model.price,
    // Expose breakdown for debugging
    source: inventoryItem ? "inventory" : "product_cache",
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
  const { page = 1, limit = 20, categoryId } = options;
  const skip = (page - 1) * limit;

  // Validate Seller exists (include shopDecoration for shop homepage blocks)
  const seller = await User.findById(sellerId).select(
    "fullName avatar provinceName createdAt aboutMe role profileImage shopDecoration",
  );
  if (!seller) {
    throw new ErrorResponse("Seller not found", 404);
  }

  const sellerObj = seller.toObject();

  const productQuery = {
    sellerId,
  };

  if (!options.includeHidden) {
    productQuery.status = { $in: PUBLIC_VISIBLE_STATUSES };
  }

  if (categoryId) {
    productQuery.categoryId = categoryId;
  }

  const [
    products,
    total,
    shopStats,
    productCount,
    followerCount,
    followingCount,
  ] = await Promise.all([
    Product.find(productQuery)
      .populate("categoryId", "name slug")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(productQuery),
    import("../models/ShopStatistic.js").then((m) =>
      m.default.findOne({ sellerId }),
    ),
    Product.countDocuments(productQuery),
    import("../models/Follow.js").then((m) =>
      m.default.countDocuments({ followingId: sellerId }),
    ),
    import("../models/Follow.js").then((m) =>
      m.default.countDocuments({ followerId: sellerId }),
    ),
  ]);

  sellerObj.productCount = productCount;
  sellerObj.followerCount = followerCount;
  sellerObj.followingCount = followingCount;

  if (shopStats) {
    sellerObj.isPreferred = shopStats.isPreferred;
    sellerObj.rating = shopStats.ratingAverage;
    sellerObj.ratingCount = shopStats.ratingCount;
    sellerObj.chatResponseRate = shopStats.chatResponseRate;
    sellerObj.cancelDutyRate = shopStats.cancelDutyRate;
  } else {
    sellerObj.isPreferred = false;
    sellerObj.rating = 0;
    sellerObj.ratingCount = 0;
    sellerObj.chatResponseRate = 100;
    sellerObj.cancelDutyRate = 0;
  }

  // Attach min/max price per product so the FE seller listing can show price ranges.
  const enrichedProducts = products.map((p) => {
    const prices = (p.models || [])
      .map((m) => m.price)
      .filter((x) => typeof x === "number");
    return {
      ...p,
      minPrice: prices.length ? Math.min(...prices) : p.originalPrice || 0,
      maxPrice: prices.length ? Math.max(...prices) : p.originalPrice || 0,
    };
  });
  // ── Shop decoration: live modules + widget data ──────────────────────────
  // Merge widget product data into liveModules so the FE can render everything
  // from liveModules alone (no separate widgetData needed for products).
  const deco = await ShopDecoration.findOne({ sellerId }).lean();
  let liveModules = [];

  if (deco) {
    const activeVer = deco.activeVersion || "desktop";
    const v = deco[activeVer] || {};
    liveModules = v.published?.modules?.length
      ? v.published.modules
      : v.draft?.modules || [];

    // Inject widget product data into matching module types
    // Only inject into modules that are enabled AND have a product type
    const { getShopWidgetData: fetchWidgetData } =
      await import("./shopDecoration.service.js");
    const widgetData = await fetchWidgetData(sellerId);

    // Map WIDGET_KEYS → MODULE_TYPES
    const productModuleMap = {
      featuredProducts: "featured_products",
      bestSelling: "best_selling",
      newProducts: "new_products",
      flashDeals: "flash_deals",
      addonDeals: "addon_deals",
      comboPromos: "combo_promos",
    };

    for (const mod of liveModules) {
      // Only inject into enabled product modules
      if (mod.isEnabled === false) continue;

      const widgetKey = Object.keys(productModuleMap).find(
        (k) => productModuleMap[k] === mod.type,
      );
      if (widgetKey && widgetData[widgetKey]?.length > 0) {
        mod.props = {
          ...(mod.props || {}),
          products: widgetData[widgetKey],
          _fromWidget: true,
        };
      }

      // Inject featuredCategories
      if (
        mod.type === "featured_categories" &&
        widgetData.featuredCategories?.length > 0
      ) {
        mod.props = {
          ...(mod.props || {}),
          categories: widgetData.featuredCategories,
          _fromWidget: true,
        };
      }

      // Inject categoryList
      if (mod.type === "category_list" && widgetData.categoryList?.length > 0) {
        mod.props = {
          ...(mod.props || {}),
          categories: widgetData.categoryList,
          _fromWidget: true,
        };
      }
    }
  }

  return {
    seller: sellerObj,
    products: enrichedProducts,
    total,
    page,
    pages: Math.ceil(total / limit),
    liveModules,
  };
};

/**
 * Get products by category ID
 */
export const getProductsByCategory = async (categoryId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find({ categoryId, status: "active" })
      .populate("categoryId", "name slug")
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

/**
 * Get all active promotions for a product (public buyer API)
 * Returns: shopProgram, comboPromotions, addOnDeals
 */
export const getActivePromotionsForProduct = async (productId) => {
  const now = new Date();

  // --- 1. Shop Program ---
  // Sync statuses first
  await ShopProgram.syncAllStatuses().catch(() => {});

  const programProduct = await ShopProgramProduct.findOne({
    productId,
    status: "active",
  })
    .populate("programId", "name startDate endDate status")
    .lean();

  let shopProgram = null;
  if (
    programProduct &&
    programProduct.programId &&
    programProduct.programId.status === "active"
  ) {
    // Find the first enabled variant with a real discount
    const enabledVariant = programProduct.variants.find(
      (v) => v.enabled && v.salePrice < v.originalPrice,
    );

    if (enabledVariant) {
      const discountPercent =
        enabledVariant.discountType === "percent"
          ? enabledVariant.discount
          : Math.round(
              ((enabledVariant.originalPrice - enabledVariant.salePrice) /
                enabledVariant.originalPrice) *
                100,
            );

      shopProgram = {
        programId: programProduct.programId._id,
        programName: programProduct.programId.name,
        salePrice: enabledVariant.salePrice,
        originalPrice: enabledVariant.originalPrice,
        discount: discountPercent,
        discountType: enabledVariant.discountType,
        endDate: programProduct.programId.endDate,
        variants: programProduct.variants
          .filter((v) => v.enabled)
          .map((v) => ({
            variantId: v.variantId,
            variantName: v.variantName,
            salePrice: v.salePrice,
            originalPrice: v.originalPrice,
            discount:
              v.discountType === "percent"
                ? v.discount
                : Math.round(
                    ((v.originalPrice - v.salePrice) / v.originalPrice) * 100,
                  ),
          })),
      };
    }
  }

  // --- 2. Combo Promotions ---
  // Sync statuses
  await ComboPromotion.updateMany(
    { status: "upcoming", startDate: { $lte: now } },
    { status: "active" },
  );
  await ComboPromotion.updateMany(
    { status: { $in: ["active", "upcoming"] }, endDate: { $lte: now } },
    { status: "ended" },
  );

  const comboPromotions = await ComboPromotion.find({
    products: productId,
    status: "active",
  })
    .select("name comboType tiers endDate")
    .lean();

  // --- 3. Add-on Deals ---
  // Sync statuses
  await AddOnDeal.updateMany(
    { status: "upcoming", startDate: { $lte: now } },
    { status: "active" },
  );
  await AddOnDeal.updateMany(
    { status: { $in: ["active", "upcoming"] }, endDate: { $lte: now } },
    { status: "ended" },
  );

  const addOnDeals = await AddOnDeal.find({
    mainProducts: productId,
    status: "active",
  })
    .populate("subProducts.productId", "name images originalPrice models")
    .select("name subProducts endDate purchaseLimit")
    .lean();

  // Transform add-on deals for FE
  const transformedAddOnDeals = addOnDeals.map((deal) => ({
    dealId: deal._id,
    name: deal.name,
    endDate: deal.endDate,
    purchaseLimit: deal.purchaseLimit,
    subProducts: deal.subProducts.map((sp) => {
      const productData = sp.productId;
      const originalPrice =
        productData?.originalPrice || (productData?.models?.[0]?.price ?? 0);
      return {
        product: productData
          ? {
              _id: productData._id,
              name: productData.name,
              images: productData.images,
            }
          : null,
        price: sp.price,
        originalPrice,
        limit: sp.limit,
      };
    }),
  }));

  return {
    shopProgram,
    comboPromotions: comboPromotions.map((c) => ({
      comboId: c._id,
      name: c.name,
      comboType: c.comboType,
      tiers: c.tiers,
      endDate: c.endDate,
    })),
    addOnDeals: transformedAddOnDeals,
  };
};

/**
 * Get shop program sale price for a specific product variant (model).
 * Used by cart/order controllers to override model.price.
 *
 * variantId format in ShopProgramProduct is "productId-modelIndex",
 * so we match by reconstructing this composite key.
 *
 * @param {string} productId
 * @param {number} modelIndex - The index of the model in product.models array
 * @param {number} originalPrice - Fallback price (model.price)
 * @returns {{ price: number, isShopProgram: boolean, originalPrice: number, programName?: string }}
 */
export const getShopProgramPriceForVariant = async (
  productId,
  modelIndex,
  originalPrice,
) => {
  try {
    const programProduct = await ShopProgramProduct.findOne({
      productId,
      status: "active",
    })
      .populate("programId", "name status")
      .lean();

    if (
      programProduct &&
      programProduct.programId &&
      programProduct.programId.status === "active"
    ) {
      // variantId format: "productId-modelIndex"
      const targetVariantId = `${productId.toString()}-${modelIndex}`;
      const variant = programProduct.variants.find(
        (v) =>
          v.enabled &&
          v.variantId === targetVariantId &&
          v.salePrice < v.originalPrice,
      );

      if (variant) {
        return {
          price: variant.salePrice,
          isShopProgram: true,
          originalPrice: variant.originalPrice,
          programName: programProduct.programId.name,
        };
      }
    }
  } catch (err) {
    // Silently fall back to original price
  }

  return { price: originalPrice, isShopProgram: false, originalPrice };
};

/**
 * Toggle product status (hide = inactive, unhide = active)
 * Only affects products owned by the seller.
 */
export const toggleProductStatus = async (productId, sellerId, newStatus) => {
  const product = await Product.findOne({ _id: productId, sellerId });
  if (!product) {
    throw new ErrorResponse("Product not found or access denied", 404);
  }

  product.status = newStatus;
  await product.save({ validateBeforeSave: false });
  return product;
};
