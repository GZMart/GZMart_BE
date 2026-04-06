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
        // model.stock is a cache synced from InventoryItem — safe for filter metadata
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

  /**
   * AI Image Search — with multi-strategy fallback for bilingual (VI/EN) product data
   */
  async searchByImage(imageBuffer, mimeType) {
    const { imageSearchService } = await import("./imageSearch.service.js");
    
    let analyzedData = null;
    let aiAnalysisFailed = false;

    // 1. Try to analyze image with AI (Gemini SDK → CF proxy fallback)
    try {
      analyzedData = await imageSearchService.analyzeProductImage(imageBuffer, mimeType);
    } catch (err) {
      console.warn("[SearchByImage] AI analysis failed:", err.message);
      aiAnalysisFailed = true;
    }

    // 2. Build search keywords
    let matchedProducts = [];

    if (analyzedData) {
      const { category, brand, colors, material, features, vi_keywords } = analyzedData;

      // EN → VI keyword dictionary for common product types
      const EN_TO_VI = {
        // Footwear
        shoes: "giày", sneakers: "giày", boots: "giày bốt", sandals: "dép", slippers: "dép",
        heels: "giày cao gót", loafers: "giày lười", oxford: "giày oxford",
        derby: "giày da", pumps: "giày cao gót",
        // Clothing
        shirt: "áo", tshirt: "áo phông", dress: "váy", skirt: "váy",
        pants: "quần", jeans: "quần jean", shorts: "quần short",
        jacket: "áo khoác", coat: "áo khoác", hoodie: "áo hoodie",
        blouse: "áo blouse", sweater: "áo len", cardigan: "áo cardigan",
        // Accessories
        bag: "túi", handbag: "túi xách", backpack: "balo", wallet: "ví",
        belt: "thắt lưng", hat: "mũ", cap: "mũ", scarf: "khăn",
        watch: "đồng hồ", sunglasses: "kính mát", necklace: "dây chuyền",
        ring: "nhẫn", earrings: "bông tai", bracelet: "vòng tay",
        // Electronics
        phone: "điện thoại", laptop: "laptop", tablet: "máy tính bảng",
        headphones: "tai nghe", speaker: "loa",
        // Colors
        black: "đen", white: "trắng", red: "đỏ", blue: "xanh", green: "xanh lá",
        yellow: "vàng", pink: "hồng", purple: "tím", brown: "nâu", grey: "xám",
        gray: "xám", orange: "cam", navy: "xanh navy", beige: "be",
        // Materials
        leather: "da", cotton: "cotton", denim: "jean", silk: "lụa",
        wool: "len", polyester: "polyester", canvas: "vải",
        // Common adj
        sport: "thể thao", casual: "thường ngày", fashion: "thời trang",
        formal: "công sở", men: "nam", women: "nữ", kids: "trẻ em",
        lace: "ren", high: "cao", low: "thấp", chunky: "đế chunky",
      };

      // Build EN + mapped VI keyword set
      const allEnKeywords = [
        category, brand, ...(colors || []), material, features,
        ...(features ? features.split(/[\s,\-]+/) : []),
        ...(category ? category.split(/[\s,\-]+/) : []),
      ].filter(Boolean).map(k => k.toLowerCase().trim());

      let viKeywords = allEnKeywords
        .map(k => EN_TO_VI[k])
        .filter(Boolean);

      // Add natively generated vi_keywords from Gemini
      if (Array.isArray(vi_keywords)) {
        viKeywords = [...viKeywords, ...vi_keywords.map(k => k.toLowerCase().trim())];
      }
      
      // Deduplicate
      viKeywords = [...new Set(viKeywords)];


      const englishSearchStr = allEnKeywords.join(" ");

      console.log("[SearchByImage] English keywords:", englishSearchStr);
      console.log("[SearchByImage] Vietnamese mapped keywords:", viKeywords);

      // Strategy 0: Semantic Vector Search (Best for visual similarity across languages)
      let vectorEmbedding = null;
      try {
        const { default: embeddingService } = await import("./embedding.service.js");
        const vectorQuery = `${category || ""} ${brand || ""} ${englishSearchStr} ${viKeywords.join(" ")}`.trim();
        vectorEmbedding = await embeddingService.getEmbedding(vectorQuery);
      } catch (e) {
        console.warn("[SearchByImage] Vector embedding generation failed:", e.message);
      }

      // Strategy 1: MongoDB text index (works if product name has English terms)
      const textSearchFilter = {
        $text: { $search: englishSearchStr },
        isAvailable: true,
      };

      // Strategy 2: Regex search on name/description with English terms
      const engRegexParts = allEnKeywords
        .filter(k => k.length > 2)
        .slice(0, 6);
      const engRegex = engRegexParts.length > 0
        ? new RegExp(engRegexParts.join("|"), "i")
        : null;

      // Strategy 3: Regex search with Vietnamese keywords
      const viRegexParts = viKeywords.filter(k => k.length > 1).slice(0, 6);
      const viRegex = viRegexParts.length > 0
        ? new RegExp(viRegexParts.join("|"), "i")
        : null;

      // Strategy 4: Tags search
      const allTagsKeywords = [...allEnKeywords, ...viKeywords].slice(0, 10);

      const searchStrategies = [
        // S0: Vector Search (Semantic similarity)
        ...(vectorEmbedding ? [{
          name: "Semantic Vector Search",
          find: async () => {
            const results = await Product.aggregate([
              {
                $vectorSearch: {
                  index: "product_vector_index",
                  path: "embedding",
                  queryVector: vectorEmbedding,
                  numCandidates: 16 * 5,
                  limit: 16,
                  filter: { status: "active" },
                },
              },
              {
                $project: {
                  name: 1, slug: 1, categoryId: 1, sellerId: 1,
                  description: 1, attributes: 1, originalPrice: 1,
                  rating: 1, reviewCount: 1, sold: 1, brand: 1,
                  tags: 1, "models.price": 1, "models.sku": 1,
                  "models.stock": 1, images: 1, isAvailable: 1,
                  score: { $meta: "vectorSearchScore" },
                },
              },
            ]);
            // Populate categoryId for consistency with other find() returns
            return Product.populate(results, { path: "categoryId", select: "name slug" });
          }
        }] : []),

        // S1: Text index search with English
        ...(englishSearchStr ? [{
          name: "Text index (EN)",
          find: () => Product.find(textSearchFilter, { score: { $meta: "textScore" } })
            .populate("categoryId", "name slug")
            .sort({ score: { $meta: "textScore" } })
            .limit(16)
            .lean(),
        }] : []),

        // S2: Regex search on name+description (English)
        ...(engRegex ? [{
          name: "Name regex (EN)",
          find: () => Product.find({
            $or: [{ name: { $regex: engRegex } }, { description: { $regex: engRegex } }],
            isAvailable: true,
          })
            .populate("categoryId", "name slug")
            .sort({ sold: -1 })
            .limit(16)
            .lean(),
        }] : []),

        // S3: Regex search on name+description (Vietnamese)
        ...(viRegex ? [{
          name: "Name regex (VI)",
          find: () => Product.find({
            $or: [{ name: { $regex: viRegex } }, { description: { $regex: viRegex } }],
            isAvailable: true,
          })
            .populate("categoryId", "name slug")
            .sort({ sold: -1 })
            .limit(16)
            .lean(),
        }] : []),

        // S4: Tags array search
        ...(allTagsKeywords.length > 0 ? [{
          name: "Tags match",
          find: () => Product.find({
            tags: { $in: allTagsKeywords.map(k => new RegExp(k, "i")) },
            isAvailable: true,
          })
            .populate("categoryId", "name slug")
            .sort({ sold: -1 })
            .limit(16)
            .lean(),
        }] : []),
      ];

      for (const strategy of searchStrategies) {
        try {
          const products = await strategy.find();
          if (products.length > 0) {
            console.log(`[SearchByImage] ✅ ${strategy.name} → ${products.length} products`);
            matchedProducts = products;
            break;
          } else {
            console.log(`[SearchByImage] ❌ ${strategy.name} → 0 results`);
          }
        } catch (e) {
          console.error(`[SearchByImage] Strategy "${strategy.name}" error:`, e.message);
        }
      }
    }

    // Fallback: return popular products when AI fails or no results found
    if (matchedProducts.length === 0) {
      if (!aiAnalysisFailed) {
        console.log("[SearchByImage] No matches found despite AI analysis — showing popular products");
      } else {
        console.log("[SearchByImage] AI unavailable — showing popular products");
      }
      matchedProducts = await Product.find({ isAvailable: true })
        .populate("categoryId", "name slug")
        .sort({ sold: -1 })
        .limit(16)
        .lean();
    }

    // Enrich with prices and deals
    if (matchedProducts.length > 0) {
      const now = new Date();
      const productIds = matchedProducts.map((p) => p._id);

      const allDeals = await Deal.find({
        productId: { $in: productIds },
        status: "active",
        startDate: { $lte: now },
        endDate: { $gte: now },
      }).select("productId discountPercent title endDate soldCount quantityLimit").lean();

      const dealsByProduct = {};
      allDeals.forEach(deal => { dealsByProduct[deal.productId.toString()] = deal; });

      matchedProducts = matchedProducts.map((product) => {
        // Map _id to id for Frontend components (like ProductCard)
        if (product._id) {
          product.id = product._id.toString();
        }

        // Map first image to 'image' if not present
        if (!product.image && product.images && product.images.length > 0) {
          product.image = product.images[0];
        }

        const models = product.models || [];
        if (models.length > 0) {
          const prices = models.map((m) => m.price);
          product.minPrice = Math.min(...prices);
          product.maxPrice = Math.max(...prices);
          product.price = product.minPrice; // FE ProductCard expects .price
          product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
        } else if (!product.price) {
          product.price = product.originalPrice || 0;
        }

        const activeDeal = dealsByProduct[product._id.toString()];
        if (activeDeal) product.activeDeal = activeDeal;
        return product;
      });
    }

    return {
      analyzedInfo: analyzedData,
      products: matchedProducts,
      ...(aiAnalysisFailed && {
        aiAnalysisFailed: true,
        aiError: "AI image analysis is currently unavailable. Showing popular products instead.",
      }),
    };
  }
}

export default new SearchService();

