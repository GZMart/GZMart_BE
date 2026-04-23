import Product from "../models/Product.js";
import Deal from "../models/Deal.js";
import * as productService from "./product.service.js";

/** 1 từ — thường là màu nền / màu chung, không dùng để ưu tiên "loại hàng" */
const SINGLE_COLOR_NOISE_EN = new Set([
  "black", "white", "beige", "red", "blue", "green", "yellow", "pink", "purple",
  "brown", "orange", "navy", "grey", "gray", "cream", "nude", "tan", "khaki",
  "burgundy", "maroon", "ivory", "offwhite", "off-white", "charcoal", "coral", "lilac",
  "magenta", "olive", "teal", "aqua", "multi", "multicolor", "print",
]);
const SINGLE_COLOR_NOISE_VI = new Set([
  "đen", "trắng", "đỏ", "xanh", "vàng", "hồng", "nâu", "cam", "tím", "xám", "kem", "nude",
  "be", "kaki", "gạch", "chanh", "bạc", "ngà", "rêu",
]);

function isSingleTokenColorNoise(phrase) {
  const t = String(phrase || "")
    .toLowerCase()
    .trim();
  if (!t || t.includes(" ")) {
    return false;
  }
  if (SINGLE_COLOR_NOISE_EN.has(t) || SINGLE_COLOR_NOISE_VI.has(t)) {
    return true;
  }
  if (/^[0-9]+$/.test(t)) {
    return true;
  }
  return false;
}

function buildLexicalTypePhrases(analyzed) {
  const out = [];
  const push = (s) => {
    const u = String(s || "").trim();
    if (u.length >= 2) {
      out.push(u);
    }
  };
  if (analyzed.product_type) {
    push(analyzed.product_type);
  }
  for (const k of analyzed.keywords_en || []) {
    if (!isSingleTokenColorNoise(k)) {
      push(k);
    }
  }
  for (const k of analyzed.keywords_vi || []) {
    if (!isSingleTokenColorNoise(k)) {
      push(k);
    }
  }
  if (analyzed.caption_en) {
    push(analyzed.caption_en);
  }
  if (analyzed.caption_vi) {
    push(analyzed.caption_vi);
  }
  const seen = new Set();
  return out.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

function productTextHaystack(p) {
  const cat = p.categoryId && typeof p.categoryId === "object" ? p.categoryId.name : "";
  const parts = [p.name, p.brand, p.description, cat, ...(p.tags || [])].filter(Boolean);
  return parts.join(" | ").toLowerCase();
}

function countPhraseHits(hay, phrases) {
  if (!hay || !phrases.length) {
    return 0;
  }
  let n = 0;
  for (const ph of phrases) {
    const p = ph.toLowerCase();
    if (p.length < 2) {
      continue;
    }
    if (hay.includes(p)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Gộp điểm vector với trùng từ loại sản phẩm (caption/keyword, không ưu tiên 1 từ màu nền).
 */
function reRankImageVectorResults(products, analyzed) {
  if (!Array.isArray(products) || products.length === 0) {
    return products;
  }
  const wEnv = Number(process.env.IMAGE_SEARCH_LEXICAL_WEIGHT);
  const lexicalW = Number.isFinite(wEnv) && wEnv >= 0 && wEnv <= 1 ? wEnv : 0.42;
  const phrases = buildLexicalTypePhrases(analyzed);
  if (phrases.length === 0) {
    return products;
  }
  const denom = Math.max(3, Math.ceil(phrases.length * 0.45));
  return products
    .map((p) => {
      const v = typeof p.vectorScore === "number" ? p.vectorScore : 0;
      const hits = countPhraseHits(productTextHaystack(p), phrases);
      const lex = Math.min(1, hits / denom);
      const combined = (1 - lexicalW) * v + lexicalW * lex;
      return { p, combined, lex, hits };
    })
    .sort((a, b) => b.combined - a.combined)
    .map(({ p, combined, lex, hits }) => {
      p.matchScore = Math.round(combined * 1000) / 1000;
      p._lex = lex;
      p._typeHits = hits;
      return p;
    });
}

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
   * AI Image Search — Groq vision (bilingual keys) + global vector search (similarity order).
   * Fallback: text / regex / tags, then popular products.
   */
  async searchByImage(imageBuffer, mimeType) {
    const { imageSearchService } = await import("./imageSearch.service.js");
    const { default: embeddingService } = await import("./embedding.service.js");

    const RESULT_LIMIT = 16;
    const VECTOR_NUM_CANDIDATES = Math.min(
      400,
      Math.max(100, parseInt(process.env.IMAGE_SEARCH_VECTOR_NUM_CANDIDATES || "200", 10) || 200),
    );
    /** Lấy nhiều ứng viên từ ANN, sau đó re-rank theo từ loại sản phẩm */
    const VECTOR_RERANK_POOL = Math.min(
      200,
      Math.max(40, parseInt(process.env.IMAGE_SEARCH_VECTOR_RERANK_POOL || "100", 10) || 100),
    );

    let analyzedData = null;
    let aiAnalysisFailed = false;

    try {
      analyzedData = await imageSearchService.analyzeProductImage(imageBuffer, mimeType);
    } catch (err) {
      console.warn("[SearchByImage] AI analysis failed:", err.message);
      aiAnalysisFailed = true;
    }

    let matchedProducts = [];

    if (analyzedData) {
      const searchText = (analyzedData.searchText || "").trim();
      const vectorQueryText = (analyzedData.vectorQueryText || searchText).trim();
      const keywordsEn = Array.isArray(analyzedData.keywords_en) ? analyzedData.keywords_en : [];
      const keywordsVi = Array.isArray(analyzedData.keywords_vi) ? analyzedData.keywords_vi : [];
      const typeForText = [
        analyzedData.product_type,
        analyzedData.category,
        analyzedData.brand,
        ...keywordsEn,
        ...keywordsVi,
        analyzedData.caption_en,
        analyzedData.caption_vi,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      const englishSearchStr = typeForText;
      const bilingualLine = [englishSearchStr, ...keywordsVi, analyzedData.caption_vi]
        .filter(Boolean)
        .join(" ")
        .trim();

      console.log(
        "[SearchByImage] provider=%s vectorQuery.length=%d",
        analyzedData.provider || "?",
        vectorQueryText.length,
      );

      let vectorEmbedding = null;
      try {
        vectorEmbedding = await embeddingService.getEmbedding(
          vectorQueryText || bilingualLine,
        );
      } catch (e) {
        console.warn("[SearchByImage] query embedding failed:", e.message);
      }

      const textSearchFilter = englishSearchStr
        ? { $text: { $search: englishSearchStr }, isAvailable: true }
        : null;

      const fromTerms = (keywordsEn.length ? keywordsEn : [analyzedData.category].filter(Boolean))
        .map((k) => String(k).toLowerCase().trim())
        .filter((k) => k.length > 2)
        .slice(0, 6);
      const fromTermsVi = keywordsVi
        .map((k) => String(k).toLowerCase().trim())
        .filter((k) => k.length > 1)
        .slice(0, 6);
      const engRegex = fromTerms.length > 0 ? new RegExp(fromTerms.join("|"), "i") : null;
      const viRegex = fromTermsVi.length > 0 ? new RegExp(fromTermsVi.join("|"), "i") : null;
      const allTagsKeywords = [...fromTerms, ...fromTermsVi].slice(0, 12);

      const productFields = {
        name: 1, slug: 1, categoryId: 1, sellerId: 1,
        description: 1, attributes: 1, originalPrice: 1,
        rating: 1, reviewCount: 1, sold: 1, brand: 1,
        tags: 1, "models.price": 1, "models.sku": 1, "models.stock": 1, images: 1, isAvailable: 1,
      };

      const searchStrategies = [
        ...(vectorEmbedding
          ? [
              {
                name: "Global vector (similarity desc)",
                find: async () => {
                  const results = await Product.aggregate([
                    {
                      $vectorSearch: {
                        index: "product_vector_index",
                        path: "embedding",
                        queryVector: vectorEmbedding,
                        numCandidates: VECTOR_NUM_CANDIDATES,
                        limit: VECTOR_RERANK_POOL,
                        filter: { status: "active" },
                      },
                    },
                    { $addFields: { vectorScore: { $meta: "vectorSearchScore" } } },
                    { $project: { ...productFields, vectorScore: 1 } },
                    { $sort: { vectorScore: -1 } },
                    { $limit: VECTOR_RERANK_POOL },
                  ]);
                  const populated = await Product.populate(results, {
                    path: "categoryId",
                    select: "name slug",
                  });
                  return reRankImageVectorResults(
                    populated,
                    analyzedData,
                  ).slice(0, RESULT_LIMIT);
                },
              },
            ]
          : []),
        ...(textSearchFilter
          ? [
              {
                name: "Text index (EN+)",
                find: () =>
                  Product.find(textSearchFilter, { score: { $meta: "textScore" } })
                    .populate("categoryId", "name slug")
                    .sort({ score: { $meta: "textScore" } })
                    .limit(RESULT_LIMIT)
                    .lean(),
              },
            ]
          : []),
        ...(engRegex
          ? [
              {
                name: "Regex (EN keywords)",
                find: () =>
                  Product.find({
                    $or: [
                      { name: { $regex: engRegex } },
                      { description: { $regex: engRegex } },
                    ],
                    isAvailable: true,
                  })
                    .populate("categoryId", "name slug")
                    .sort({ sold: -1 })
                    .limit(RESULT_LIMIT)
                    .lean(),
              },
            ]
          : []),
        ...(viRegex
          ? [
              {
                name: "Regex (VI keywords)",
                find: () =>
                  Product.find({
                    $or: [
                      { name: { $regex: viRegex } },
                      { description: { $regex: viRegex } },
                    ],
                    isAvailable: true,
                  })
                    .populate("categoryId", "name slug")
                    .sort({ sold: -1 })
                    .limit(RESULT_LIMIT)
                    .lean(),
              },
            ]
          : []),
        ...(allTagsKeywords.length > 0
          ? [
              {
                name: "Tags match",
                find: () =>
                  Product.find({
                    tags: { $in: allTagsKeywords.map((k) => new RegExp(k, "i")) },
                    isAvailable: true,
                  })
                    .populate("categoryId", "name slug")
                    .sort({ sold: -1 })
                    .limit(RESULT_LIMIT)
                    .lean(),
              },
            ]
          : []),
      ];

      for (const strategy of searchStrategies) {
        try {
          const products = await strategy.find();
          if (products.length > 0) {
            console.log(
              `[SearchByImage] ✅ ${strategy.name} → ${products.length} products`,
            );
            matchedProducts = products;
            break;
          }
          console.log(`[SearchByImage] ❌ ${strategy.name} → 0 results`);
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
        delete product._lex;
        delete product._typeHits;
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
        aiError: "AI image analysis is unavailable (configure GROQ_API_KEY or vision fallback). Showing popular products instead.",
      }),
    };
  }
}

export default new SearchService();