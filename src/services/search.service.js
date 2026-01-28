import Product from "../models/Product.js";
import Deal from "../models/Deal.js";
import * as productService from "./product.service.js";

class SearchService {
  /**
   * Search products with full-text search and filters
   */
  async searchProducts(options) {
    const {
      query,
      page = 1,
      limit = 20,
      sort = "relevance",
      filters = {},
    } = options;

    const searchQuery = { isAvailable: true };

    // Full-text search
    if (query && query.trim()) {
      searchQuery.$text = { $search: query.trim() };
    }

    // Apply additional filters
    if (filters.categoryId) {
      searchQuery.categoryId = filters.categoryId;
    }

    if (filters.brand) {
      if (Array.isArray(filters.brand)) {
        searchQuery.brand = { $in: filters.brand };
      } else {
        searchQuery.brand = filters.brand;
      }
    }

    if (filters.minRating) {
      searchQuery.rating = { $gte: parseFloat(filters.minRating) };
    }

    // Count total
    const total = await Product.countDocuments(searchQuery);

    // Build query
    let productsQuery = Product.find(searchQuery)
      .populate("categoryId", "name slug")
      .skip((page - 1) * limit)
      .limit(limit);

    // Apply sorting
    switch (sort) {
      case "relevance":
        if (query && query.trim()) {
          productsQuery = productsQuery.sort({ score: { $meta: "textScore" } });
        } else {
          productsQuery = productsQuery.sort("-createdAt");
        }
        break;
      case "price_asc":
        productsQuery = productsQuery.sort("originalPrice");
        break;
      case "price_desc":
        productsQuery = productsQuery.sort("-originalPrice");
        break;
      case "rating":
        productsQuery = productsQuery.sort("-rating");
        break;
      case "sold":
        productsQuery = productsQuery.sort("-sold");
        break;
      case "newest":
        productsQuery = productsQuery.sort("-createdAt");
        break;
      default:
        productsQuery = productsQuery.sort("-createdAt");
    }

    let products = await productsQuery.lean();

    // Models are embedded in product documents
    const now = new Date();
    const productIds = products.map((p) => p._id);

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

    // Enrich products with price and deals (models are embedded)
    products = products.map((product) => {
      const models = product.models || [];

      if (models.length > 0) {
        const prices = models.map((m) => m.price);
        product.minPrice = Math.min(...prices);
        product.maxPrice = Math.max(...prices);
        product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
      }

      const activeDeal = dealsByProduct[product._id.toString()];
      if (activeDeal) {
        product.activeDeal = activeDeal;
      }

      return product;
    });

    // Apply price filter
    if (filters.minPrice || filters.maxPrice) {
      products = products.filter((product) => {
        if (!product.minPrice) return false;

        if (
          filters.minPrice &&
          product.maxPrice < parseFloat(filters.minPrice)
        ) {
          return false;
        }

        if (
          filters.maxPrice &&
          product.minPrice > parseFloat(filters.maxPrice)
        ) {
          return false;
        }

        return true;
      });
    }

    // Apply stock filter
    if (filters.inStock === "true" || filters.inStock === true) {
      products = products.filter((product) => product.totalStock > 0);
    }

    return {
      products,
      query,
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
   * Get search suggestions based on query
   */
  async getSearchSuggestions(query) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const regex = new RegExp(query.trim(), "i");

    // Get product names
    const products = await Product.find({
      isAvailable: true,
      name: regex,
    })
      .select("name")
      .limit(10)
      .lean();

    // Get brands
    const brands = await Product.distinct("brand", {
      isAvailable: true,
      brand: regex,
    });

    const suggestions = [
      ...products.map((p) => ({ type: "product", value: p.name, id: p._id })),
      ...brands.map((b) => ({ type: "brand", value: b })),
    ];

    return suggestions.slice(0, 10);
  }

  /**
   * Autocomplete for search box
   */
  async autocomplete(query) {
    if (!query || query.trim().length < 2) {
      return { products: [], categories: [], brands: [] };
    }

    const regex = new RegExp(query.trim(), "i");

    console.log("🔍 Autocomplete search for:", query.trim());
    console.log("🔍 Regex pattern:", regex);

    // Search products by name, brand, or tags
    const products = await Product.find({
      status: "active",
      $or: [
        { name: regex },
        { brand: regex },
        { tags: regex },
        { description: regex },
      ],
    })
      .select("name slug images models brand tags")
      .limit(10)
      .lean();

    console.log("🔍 Found products:", products.length);
    console.log(
      "🔍 Products:",
      products.map((p) => ({ name: p.name, brand: p.brand })),
    );

    // Search categories
    const Category = (await import("../models/Category.js")).default;
    const categories = await Category.find({
      isActive: true,
      name: regex,
    })
      .select("name slug")
      .limit(3)
      .lean();

    // Search brands
    const Brand = (await import("../models/Brand.js")).default;
    const brands = await Brand.find({
      isActive: true,
      name: regex,
    })
      .select("name logo")
      .limit(3)
      .lean();

    return {
      products: products.map((product) => {
        const models = product.models || [];
        const firstModel = models.find((m) => m.isActive) || models[0] || {};

        return {
          _id: product._id,
          name: product.name,
          slug: product.slug,
          images: product.images || [],
          price: firstModel.price || 0,
          brand: product.brand,
        };
      }),
      categories: categories.map((cat) => ({
        _id: cat._id,
        name: cat.name,
        slug: cat.slug,
      })),
      brands: brands.map((brand) => ({
        _id: brand._id,
        name: brand.name,
        logo: brand.logo,
      })),
    };
  }

  /**
   * Get available filters for search results
   */
  async getAvailableFilters(options = {}) {
    const query = { isAvailable: true };

    if (options.categoryId) {
      query.categoryId = options.categoryId;
    }

    if (options.search) {
      query.$text = { $search: options.search };
    }

    // Get unique brands
    const brands = await Product.distinct("brand", query);

    // Get price range from embedded models
    const products = await Product.find(query).select("models").lean();

    const allPrices = [];
    const colors = [];
    const sizes = [];

    products.forEach((product) => {
      const models = product.models || [];
      models.forEach((model) => {
        if (model.stock > 0) {
          allPrices.push(model.price);
        }
      });

      // Get available sizes and colors from embedded tiers
      const tiers = product.tiers || [];
      tiers.forEach((tier) => {
        if (
          tier.name.toLowerCase().includes("color") ||
          tier.name.toLowerCase().includes("màu")
        ) {
          colors.push(...tier.options);
        }
        if (
          tier.name.toLowerCase().includes("size") ||
          tier.name.toLowerCase().includes("kích")
        ) {
          sizes.push(...tier.options);
        }
      });
    });

    let priceRange = { min: 0, max: 0 };
    if (allPrices.length > 0) {
      priceRange = {
        min: Math.min(...allPrices),
        max: Math.max(...allPrices),
      };
    }

    return {
      brands: [...new Set(brands.filter(Boolean))].sort(),
      priceRange,
      colors: [...new Set(colors)],
      sizes: [...new Set(sizes)],
      ratings: [5, 4, 3, 2, 1],
    };
  }

  /**
   * Advanced search with MongoDB Aggregation
   * Filter by Color, Size, Price, Brand
   */
  async advancedSearchProducts(options) {
    const {
      query,
      page = 1,
      limit = 20,
      categoryId,
      brands = [],
      colors = [],
      sizes = [],
      minPrice,
      maxPrice,
      minRating,
      inStock = false,
    } = options;

    return await productService.getProductsAdvanced({
      page,
      limit,
      categoryId,
      brands,
      colors,
      sizes,
      minPrice,
      maxPrice,
      minRating,
      inStock,
    });
  }
}

export default new SearchService();
