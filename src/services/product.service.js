import Product from "../models/Product.js";
import ProductModel from "../models/ProductModel.js";
import ProductTier from "../models/ProductTier.js";
import ProductAttribute from "../models/ProductAttribute.js";
import Deal from "../models/Deal.js";
import ErrorResponse from "../utils/errorResponse.js";
import mongoose from "mongoose";

class ProductService {
  /**
   * Get products with filters, sort, and pagination
   * OPTIMIZED: Using aggregation pipeline to avoid N+1 queries
   */
  async getProducts(options) {
    const { page = 1, limit = 20, sort = "-createdAt", filters = {} } = options;

    const pipeline = [];
    const matchStage = { isAvailable: true };

    // Apply filters
    if (filters.categoryId) {
      // Validate and convert to ObjectId
      if (mongoose.Types.ObjectId.isValid(filters.categoryId)) {
        matchStage.categoryId = new mongoose.Types.ObjectId(filters.categoryId);
      }
    }

    if (filters.brand) {
      if (Array.isArray(filters.brand)) {
        matchStage.brand = { $in: filters.brand };
      } else {
        matchStage.brand = filters.brand;
      }
    }

    if (filters.minRating) {
      matchStage.rating = { $gte: parseFloat(filters.minRating) };
    }

    if (filters.isFeatured) {
      matchStage.isFeatured = true;
    }

    if (filters.isTrending) {
      matchStage.isTrending = true;
    }

    if (filters.isNewArrival) {
      matchStage.isNewArrival = true;
    }

    if (filters.search) {
      matchStage.$text = { $search: filters.search };
    }

    pipeline.push({ $match: matchStage });

    // Lookup category
    pipeline.push({
      $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    });
    pipeline.push({
      $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
    });

    // Lookup models for price calculation
    pipeline.push({
      $lookup: {
        from: "productmodels",
        localField: "_id",
        foreignField: "productId",
        as: "models",
      },
    });

    // Calculate price and stock
    pipeline.push({
      $addFields: {
        minPrice: { $min: "$models.price" },
        maxPrice: { $max: "$models.price" },
        totalStock: { $sum: "$models.stock" },
        categoryId: "$category",
      },
    });

    // Apply price filter
    if (filters.minPrice || filters.maxPrice) {
      const priceFilter = {};
      if (filters.minPrice) {
        priceFilter.maxPrice = { $gte: parseFloat(filters.minPrice) };
      }
      if (filters.maxPrice) {
        priceFilter.minPrice = { $lte: parseFloat(filters.maxPrice) };
      }
      pipeline.push({ $match: priceFilter });
    }

    // Apply stock filter
    if (filters.inStock) {
      pipeline.push({ $match: { totalStock: { $gt: 0 } } });
    }

    // Lookup active deals
    const now = new Date();
    pipeline.push({
      $lookup: {
        from: "deals",
        let: { productId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$productId", "$$productId"] },
              status: "active",
              startDate: { $lte: now },
              endDate: { $gte: now },
            },
          },
          { $limit: 1 },
        ],
        as: "activeDeal",
      },
    });
    pipeline.push({
      $unwind: { path: "$activeDeal", preserveNullAndEmptyArrays: true },
    });

    // Remove models array (not needed in response)
    pipeline.push({
      $project: {
        models: 0,
      },
    });

    // Count total before pagination
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Product.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Apply sorting
    const sortStage = {};
    if (sort.startsWith("-")) {
      sortStage[sort.substring(1)] = -1;
    } else {
      sortStage[sort] = 1;
    }
    pipeline.push({ $sort: sortStage });

    // Pagination
    pipeline.push({ $skip: (page - 1) * limit });
    pipeline.push({ $limit: limit });

    // Execute aggregation
    const products = await Product.aggregate(pipeline);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Get product by ID with full details
   */
  async getProductById(productId) {
    const product = await Product.findOne({ _id: productId, isAvailable: true })
      .populate("categoryId", "name slug")
      .lean();

    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }

    // Get tiers
    const tiers = await ProductTier.find({ productId }).sort("order").lean();

    // Get models (variants)
    const models = await ProductModel.find({ productId }).lean();

    // Get attributes
    const attributes = await ProductAttribute.find({ productId })
      .sort("order")
      .lean();

    // Get active deals
    const now = new Date();
    const activeDeal = await Deal.findOne({
      productId,
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean();

    // Calculate price range
    if (models.length > 0) {
      const prices = models.map((m) => m.price);
      product.minPrice = Math.min(...prices);
      product.maxPrice = Math.max(...prices);
      product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
    }

    return {
      ...product,
      tiers,
      models,
      attributes,
      activeDeal: activeDeal || null,
    };
  }

  /**
   * Get featured products
   */
  async getFeaturedProducts(limit = 10) {
    const products = await Product.find({ isAvailable: true, isFeatured: true })
      .populate("categoryId", "name slug")
      .sort("-createdAt")
      .limit(limit)
      .lean();

    return await this._enrichProductsWithPriceAndDeals(products);
  }

  /**
   * Get trending products
   */
  async getTrendingProducts(limit = 10) {
    const products = await Product.find({ isAvailable: true, isTrending: true })
      .populate("categoryId", "name slug")
      .sort("-sold")
      .limit(limit)
      .lean();

    return await this._enrichProductsWithPriceAndDeals(products);
  }

  /**
   * Get new arrivals
   */
  async getNewArrivals(limit = 10) {
    const products = await Product.find({ isAvailable: true })
      .populate("categoryId", "name slug")
      .sort("-createdAt")
      .limit(limit)
      .lean();

    return await this._enrichProductsWithPriceAndDeals(products);
  }

  /**
   * Get related products (same category)
   */
  async getRelatedProducts(productId, limit = 10) {
    const product = await Product.findById(productId);

    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }

    const products = await Product.find({
      isAvailable: true,
      categoryId: product.categoryId,
      _id: { $ne: productId },
    })
      .populate("categoryId", "name slug")
      .sort("-rating")
      .limit(limit)
      .lean();

    return await this._enrichProductsWithPriceAndDeals(products);
  }

  /**
   * Increment product views
   */
  async incrementViews(productId) {
    await Product.findByIdAndUpdate(productId, {
      $inc: { views: 1 },
    });
  }

  /**
   * Get available filter options for products
   */
  async getAvailableFilters(categoryId = null) {
    const query = { isAvailable: true };
    if (categoryId) {
      query.categoryId = categoryId;
    }

    // Get unique brands
    const brands = await Product.distinct("brand", query);

    // Get price range from models
    const products = await Product.find(query).select("_id").lean();
    const productIds = products.map((p) => p._id);

    const models = await ProductModel.find({
      productId: { $in: productIds },
      stock: { $gt: 0 },
    })
      .select("price")
      .lean();

    let priceRange = { min: 0, max: 0 };
    if (models.length > 0) {
      const prices = models.map((m) => m.price);
      priceRange = {
        min: Math.min(...prices),
        max: Math.max(...prices),
      };
    }

    return {
      brands: brands.filter(Boolean).sort(),
      priceRange,
      ratings: [5, 4, 3, 2, 1],
    };
  }

  /**
   * Get variant details (model) based on tier selections
   */
  async getVariantByTierIndex(productId, tierIndex) {
    console.log("🔍 getVariantByTierIndex:", { productId, tierIndex });

    // First, try to find in ProductModel collection
    let model = await ProductModel.findOne({
      productId,
      tier_index: tierIndex,
    }).lean();

    console.log("🔍 Found in ProductModel collection:", model ? "Yes" : "No");

    // If not found in collection, check if product has embedded models
    if (!model) {
      const product = await Product.findById(productId).lean();
      console.log("🔍 Product found:", product ? "Yes" : "No");
      console.log("🔍 Product has models:", product?.models?.length || 0);

      if (product?.models) {
        // Try both tierIndex and tier_index field names
        model = product.models.find((m) => {
          const modelTierIndex = m.tierIndex || m.tier_index;
          const match =
            JSON.stringify(modelTierIndex) === JSON.stringify(tierIndex);
          if (!match) {
            console.log("🔍 Comparing:", modelTierIndex, "vs", tierIndex);
          }
          return match;
        });

        if (model) {
          console.log("✅ Found matching model:", model.sku);
        } else {
          console.log("❌ No matching model found. Available models:");
          product.models.forEach((m, i) => {
            console.log(
              `   Model ${i}:`,
              m.tierIndex || m.tier_index,
              "->",
              m.sku
            );
          });
        }
      }
    }

    if (!model) {
      throw new ErrorResponse("Variant not found", 404);
    }

    return model;
  }

  /**
   * Get available options for each tier based on current selection and stock
   * Example: User chọn Color Black (index 0) -> Trả về những Size nào còn hàng
   */
  async getAvailableOptions(productId, partialSelection = {}) {
    // First try ProductTier/ProductModel collections
    let tiers = await ProductTier.find({ productId }).sort("order").lean();
    let models = await ProductModel.find({ productId }).lean();

    // If not found, get from embedded data in Product
    if (tiers.length === 0 || models.length === 0) {
      const product = await Product.findById(productId).lean();
      if (product) {
        tiers = product.tiers || [];
        models = product.models || [];
      }
    }

    // Build result for each tier
    const availableOptions = tiers.map((tier, tierIndex) => {
      const availableIndices = new Set();

      models.forEach((model) => {
        // Check if model matches partial selection
        let matches = true;
        for (const [selectedTierIndex, selectedOptionIndex] of Object.entries(
          partialSelection
        )) {
          const modelTierIndex =
            model.tier_index?.[selectedTierIndex] ||
            model.tierIndex?.[selectedTierIndex];
          if (modelTierIndex !== selectedOptionIndex) {
            matches = false;
            break;
          }
        }

        // If matches and has stock, add this option index
        if (matches && model.stock > 0) {
          const optionIndex =
            model.tier_index?.[tierIndex] || model.tierIndex?.[tierIndex];
          availableIndices.add(optionIndex);
        }
      });

      return {
        tierId: tier._id || `tier-${tierIndex}`,
        tierName: tier.name,
        tierOrder: tier.order || tierIndex,
        options: tier.options.map((option, index) => ({
          name: option,
          index: index,
          image: tier.images?.[index] || null,
          available: availableIndices.has(index),
          disabled: !availableIndices.has(index),
        })),
      };
    });

    return availableOptions;
  }

  /**
   * MongoDB Aggregation: Filter products by Color, Size, Price, Brand
   * Advanced filtering with tier options
   */
  async getProductsWithAdvancedFilters(options) {
    const {
      page = 1,
      limit = 20,
      categoryId,
      brands = [],
      minPrice,
      maxPrice,
      colors = [],
      sizes = [],
      minRating,
      inStock = false,
    } = options;

    const pipeline = [];

    // Stage 1: Match active products
    const matchStage = { isAvailable: true };
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      matchStage.categoryId = new mongoose.Types.ObjectId(categoryId);
    }
    if (brands.length > 0) matchStage.brand = { $in: brands };
    if (minRating) matchStage.rating = { $gte: minRating };

    pipeline.push({ $match: matchStage });

    // Stage 2: Lookup models (variants)
    pipeline.push({
      $lookup: {
        from: "productmodels",
        localField: "_id",
        foreignField: "productId",
        as: "models",
      },
    });

    // Stage 3: Calculate price range and total stock
    pipeline.push({
      $addFields: {
        minPrice: { $min: "$models.price" },
        maxPrice: { $max: "$models.price" },
        totalStock: { $sum: "$models.stock" },
      },
    });

    // Stage 4: Filter by price range
    if (minPrice || maxPrice) {
      const priceFilter = {};
      if (minPrice) priceFilter.minPrice = { $gte: minPrice };
      if (maxPrice) priceFilter.maxPrice = { $lte: maxPrice };
      pipeline.push({ $match: priceFilter });
    }

    // Stage 5: Filter by stock
    if (inStock) {
      pipeline.push({ $match: { totalStock: { $gt: 0 } } });
    }

    // Stage 6: Lookup tiers for color/size filtering
    if (colors.length > 0 || sizes.length > 0) {
      pipeline.push({
        $lookup: {
          from: "producttiers",
          localField: "_id",
          foreignField: "productId",
          as: "tiers",
        },
      });

      // Filter by colors/sizes if specified
      // This requires checking if tiers contain the specified options
      if (colors.length > 0) {
        pipeline.push({
          $match: {
            tiers: {
              $elemMatch: {
                $or: [{ name: /color|màu/i, options: { $in: colors } }],
              },
            },
          },
        });
      }

      if (sizes.length > 0) {
        pipeline.push({
          $match: {
            tiers: {
              $elemMatch: {
                $or: [{ name: /size|kích/i, options: { $in: sizes } }],
              },
            },
          },
        });
      }
    }

    // Stage 7: Lookup category
    pipeline.push({
      $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    });

    pipeline.push({
      $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
    });

    // Stage 8: Lookup active deals
    const now = new Date();
    pipeline.push({
      $lookup: {
        from: "deals",
        let: { productId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$productId", "$$productId"] },
              status: "active",
              startDate: { $lte: now },
              endDate: { $gte: now },
            },
          },
          { $limit: 1 },
        ],
        as: "activeDeal",
      },
    });

    pipeline.push({
      $unwind: { path: "$activeDeal", preserveNullAndEmptyArrays: true },
    });

    // Count total for pagination
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Product.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Stage 9: Sort, skip, limit
    pipeline.push({ $sort: { createdAt: -1 } });
    pipeline.push({ $skip: (page - 1) * limit });
    pipeline.push({ $limit: limit });

    // Execute aggregation
    const products = await Product.aggregate(pipeline);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Check stock availability for a model
   */
  async checkStockAvailability(modelId, quantity = 1) {
    const model = await ProductModel.findById(modelId);

    if (!model) {
      throw new ErrorResponse("Product variant not found", 404);
    }

    return {
      available: model.stock >= quantity,
      stock: model.stock,
    };
  }

  /**
   * Get products with best offers (highest discount)
   * GET /api/products/best-offers
   * OPTIMIZED: Batch queries
   */
  async getBestOffers(limit = 20) {
    const now = new Date();

    // Get active deals with products
    const deals = await Deal.find({
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ discountPercent: -1 })
      .limit(limit)
      .populate({
        path: "productId",
        match: { isAvailable: true },
        select: "name slug brand images rating reviews sold originalPrice",
      })
      .lean();

    // Filter out deals where product was not found
    const validDeals = deals.filter((deal) => deal.productId);
    if (validDeals.length === 0) return [];

    const productIds = validDeals.map((deal) => deal.productId._id);

    // Batch query for all models
    const allModels = await ProductModel.find({
      productId: { $in: productIds },
    })
      .select("productId price stock")
      .lean();

    // Group models by productId
    const modelsByProduct = {};
    allModels.forEach((model) => {
      const key = model.productId.toString();
      if (!modelsByProduct[key]) {
        modelsByProduct[key] = [];
      }
      modelsByProduct[key].push(model);
    });

    // Enrich products with price info and deal
    const products = validDeals.map((deal) => {
      const product = deal.productId;
      const productKey = product._id.toString();
      const models = modelsByProduct[productKey] || [];

      if (models.length > 0) {
        const prices = models.map((m) => m.price);
        product.minPrice = Math.min(...prices);
        product.maxPrice = Math.max(...prices);
        product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
      }

      // Add deal info
      product.activeDeal = {
        _id: deal._id,
        title: deal.title,
        discountPercent: deal.discountPercent,
        endDate: deal.endDate,
        soldCount: deal.soldCount,
        quantityLimit: deal.quantityLimit,
      };

      return product;
    });

    return products;
  }

  /**
   * Helper: Enrich products with price and deals
   * OPTIMIZED: Batch queries instead of N+1
   */
  async _enrichProductsWithPriceAndDeals(products) {
    if (!products || products.length === 0) return products;

    const now = new Date();
    const productIds = products.map((p) => p._id);

    // Batch query for all models
    const allModels = await ProductModel.find({
      productId: { $in: productIds },
    })
      .select("productId price stock")
      .lean();

    // Group models by productId
    const modelsByProduct = {};
    allModels.forEach((model) => {
      const key = model.productId.toString();
      if (!modelsByProduct[key]) {
        modelsByProduct[key] = [];
      }
      modelsByProduct[key].push(model);
    });

    // Batch query for all active deals
    const allDeals = await Deal.find({
      productId: { $in: productIds },
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .select("productId discountPercent title endDate soldCount quantityLimit")
      .lean();

    // Map deals by productId
    const dealsByProduct = {};
    allDeals.forEach((deal) => {
      dealsByProduct[deal.productId.toString()] = deal;
    });

    // Enrich products
    return products.map((product) => {
      const productKey = product._id.toString();
      const models = modelsByProduct[productKey] || [];

      if (models.length > 0) {
        const prices = models.map((m) => m.price);
        product.minPrice = Math.min(...prices);
        product.maxPrice = Math.max(...prices);
        product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
      }

      const activeDeal = dealsByProduct[productKey];
      if (activeDeal) {
        product.activeDeal = activeDeal;
      }

      return product;
    });
  }
}

export default new ProductService();
