/**
 * Shop Decoration Service
 * Handles all business logic for shop homepage decoration.
 *
 * Key concepts:
 * - Draft vs Published: seller edits draft, publishes to make live.
 * - Desktop vs Mobile: separate module lists per version.
 * - Widgets: auto-filled product/category/marketing blocks (no custom props needed).
 *
 * Optimizations applied:
 * - Single source of truth for widget defaults (WIDGET_DEFAULTS).
 * - Parallel DB queries in getShopWidgetData via Promise.all.
 * - Lean queries for read-heavy storefront endpoints.
 * - ObjectId validation before aggregation pipelines.
 */

import mongoose from "mongoose";
import ShopDecoration from "../models/ShopDecoration.js";
import Product from "../models/Product.js";
import Category from "../models/Category.js";
import Deal from "../models/Deal.js";
import AddOnDeal from "../models/AddOnDeal.js";
import ComboPromotion from "../models/ComboPromotion.js";
import { ErrorResponse } from "../utils/errorResponse.js";

// ─── Default widget config ─────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for widget defaults.
// Frontend and backend must stay in sync with this definition.
export const WIDGET_DEFAULTS = {
  featuredProducts: {
    enabled: true,
    limit: 10,
    source: "auto",
    productIds: [],
  },
  featuredCategories: { enabled: true, limit: 10 },
  bestSelling: { enabled: false, limit: 2 },
  newProducts: { enabled: false, limit: 1 },
  categoryList: { enabled: false, limit: 5 },
  flashDeals: { enabled: false, limit: 5 },
  addonDeals: { enabled: false, limit: 3 },
  comboPromos: { enabled: false, limit: 3 },
};

const VALID_VERSIONS = ["desktop", "mobile"];
const WIDGET_KEYS = Object.keys(WIDGET_DEFAULTS);

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Safely extract a string URL from any value (string, Document, or mixed) */
function toUrl(val) {
  if (!val) return "";
  if (typeof val === "string" && val.trim()) return val.trim();
  if (val.toString && val.constructor?.name !== "Object") {
    const str = val.toString();
    if (str && str.trim()) return str.trim();
  }
  return "";
}

/** Resolve first available image URL from product (images, models, tiers) */
function resolveProductImage(p) {
  const img0 = p.images?.[0];
  const url = toUrl(img0);
  if (url) return url;

  const model = p.models?.find((m) => m.isActive) || p.models?.[0];
  if (model) {
    const modelUrl = toUrl(model.image);
    if (modelUrl) return modelUrl;
  }

  for (const m of p.models || []) {
    const u = toUrl(m.image);
    if (u) return u;
  }

  for (const t of p.tiers || []) {
    for (const img of t.images || []) {
      const u = toUrl(img);
      if (u) return u;
    }
  }

  return "";
}

/** Normalize a product for storefront widget display */
function normalizeProduct(p) {
  const model = p.models?.find((m) => m.isActive) || p.models?.[0] || {};
  return {
    id: (p._id || p.id)?.toString(),
    _id: p._id,
    name: p.name,
    slug: p.slug,
    image: resolveProductImage(p),
    price: model?.price ?? p.originalPrice,
    originalPrice: p.originalPrice,
    categoryId: p.categoryId,
    sold: p.sold ?? 0,
    rating: p.rating ?? 0,
    reviewCount: p.reviewCount ?? 0,
  };
}

/** Normalize category */
function normalizeCategory(c) {
  return {
    id: (c._id || c.id)?.toString(),
    _id: c._id,
    name: c.name,
    slug: c.slug,
    image: c.image || c.icon || "",
  };
}

/** Validate ObjectId to prevent aggregation pipeline errors */
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

/** Get or create a ShopDecoration record for a seller */
export async function getOrCreateForSeller(sellerId) {
  let doc = await ShopDecoration.findOne({ sellerId });
  if (!doc) {
    doc = new ShopDecoration({
      sellerId,
      desktop: { draft: { modules: [] }, published: { modules: [] } },
      mobile: { draft: { modules: [] }, published: { modules: [] } },
      widgets: { ...WIDGET_DEFAULTS },
      activeVersion: "desktop",
    });
    await doc.save();
  }
  return doc;
}

/** Get the seller's full decoration config (editor) */
export async function getShopDecoration(sellerId) {
  const doc = await getOrCreateForSeller(sellerId);

  // Recursively flatten nested props objects
  // e.g. { props: { props: { displayLimit: 5 } } } -> { displayLimit: 5 }
  const flattenProps = (obj, depth = 0) => {
    if (depth > 100) return obj; // Safety limit
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj;

    // If this object has a 'props' key that is an object, recurse into it
    if (obj.props && typeof obj.props === "object") {
      return flattenProps(obj.props, depth + 1);
    }

    // Otherwise, recursively flatten all properties
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "props" && typeof value === "object" && value !== null) {
        // Flatten nested props
        Object.assign(result, flattenProps(value, depth + 1));
      } else if (Array.isArray(value)) {
        result[key] = value;
      } else if (typeof value === "object" && value !== null) {
        result[key] = flattenProps(value, depth + 1);
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  // Sanitize modules from DB to ensure no mongoose document references remain
  const sanitizeDbModules = (modules) => {
    if (!Array.isArray(modules)) return [];
    return modules.map((m) => {
      // Flatten any nested props
      const flatProps = flattenProps(m.props || {});
      // Remove voucherInfo to avoid potential nested document issues
      delete flatProps.voucherInfo;

      return {
        id: String(m.id || ""),
        type: String(m.type || ""),
        isEnabled: Boolean(m.isEnabled),
        sortOrder: Number(m.sortOrder || 0),
        props: flatProps,
      };
    });
  };

  const desktopModules = sanitizeDbModules(doc.desktop?.draft?.modules || []);
  const mobileModules = sanitizeDbModules(doc.mobile?.draft?.modules || []);

  // Sanitize widgets from DB
  const widgetsRaw = doc.widgets?.toObject
    ? doc.widgets.toObject()
    : doc.widgets || {};
  const widgets = {};
  for (const key of WIDGET_KEYS) {
    widgets[key] = JSON.parse(
      JSON.stringify({ ...WIDGET_DEFAULTS[key], ...widgetsRaw[key] }),
    );
  }

  return {
    desktopDraft: desktopModules,
    mobileDraft: mobileModules,
    widgets,
    activeVersion: doc.activeVersion || "desktop",
    desktopPublishedAt: doc.desktop?.published?.publishedAt || null,
    mobilePublishedAt: doc.mobile?.published?.publishedAt || null,
  };
}

/**
 * Sanitize module props to prevent nested BSON depth issues.
 * Uses JSON parse/stringify as primary method to ensure all data is serializable.
 */
function sanitizeModuleProps(props) {
  if (!props || typeof props !== "object") return {};

  try {
    // Primary: use JSON to completely flatten any nested objects or mongoose documents
    const serialized = JSON.parse(JSON.stringify(props));

    // Post-process to clean up voucherCodes (ensure it's a plain object)
    if (
      serialized.voucherCodes &&
      typeof serialized.voucherCodes === "object"
    ) {
      const cleanedCodes = {};
      for (const [key, value] of Object.entries(serialized.voucherCodes)) {
        if (typeof value === "string" || typeof value === "number") {
          cleanedCodes[String(key)] = String(value);
        }
      }
      serialized.voucherCodes = cleanedCodes;
    }

    // Ensure voucherIds is an array of strings
    if (serialized.voucherIds && Array.isArray(serialized.voucherIds)) {
      serialized.voucherIds = serialized.voucherIds
        .map((id) => String(id))
        .filter((id) => id);
    }

    return serialized;
  } catch (err) {
    console.error("JSON sanitize failed:", err);
    // Fallback: return empty props
    return {};
  }
}

/**
 * Sanitize widgets config to ensure only serializable data is saved.
 */
function sanitizeWidgets(widgets) {
  if (!widgets || typeof widgets !== "object") return {};

  try {
    return JSON.parse(JSON.stringify(widgets));
  } catch (err) {
    console.error("Widget sanitize failed:", err);
    return {};
  }
}

/**
 * Sanitize all modules before saving to prevent nested BSON issues.
 */
function sanitizeModules(modules) {
  if (!Array.isArray(modules)) return [];

  return modules.map((module) => {
    // Ensure basic fields are strings/numbers
    return {
      id: String(module.id || ""),
      type: String(module.type || ""),
      isEnabled: Boolean(module.isEnabled),
      sortOrder: Number(module.sortOrder || 0),
      props: sanitizeModuleProps(module.props),
    };
  });
}

/**
 * Recursively flatten nested props objects
 * e.g. { props: { props: { displayLimit: 5 } } } -> { displayLimit: 5 }
 */
function flattenPropsDeep(obj, depth = 0) {
  if (depth > 100) return obj; // Safety limit
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj;

  // If this object has ONLY a 'props' key and nothing else meaningful, recurse into it
  const keys = Object.keys(obj);
  if (
    keys.length === 1 &&
    keys[0] === "props" &&
    typeof obj.props === "object"
  ) {
    return flattenPropsDeep(obj.props, depth + 1);
  }

  // Otherwise, recursively flatten all properties
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      key === "props" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Recursively flatten nested props
      const flattened = flattenPropsDeep(value, depth + 1);
      for (const [k, v] of Object.entries(flattened)) {
        result[k] = v;
      }
    } else if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === "object" && value !== null) {
      result[key] = flattenPropsDeep(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Save draft modules + widgets for a version.
 * @param {string} sellerId
 * @param {"desktop"|"mobile"} version
 * @param {Array} modules - ordered array of module objects
 * @param {object} widgets - partial widget config (merged with existing)
 */
export async function saveDraft(sellerId, version, modules, widgets) {
  if (!VALID_VERSIONS.includes(version)) {
    throw new ErrorResponse(`Invalid version: ${version}`, 400);
  }
  const doc = await getOrCreateForSeller(sellerId);

  // Sanitize modules - flatten any nested props to prevent deep nesting
  const sanitizedModules = (modules || []).map((m) => {
    // Flatten nested props
    const flatProps = flattenPropsDeep(m.props || {});
    // Remove voucherInfo to avoid potential nested document issues
    delete flatProps.voucherInfo;

    return {
      id: String(m.id || ""),
      type: String(m.type || ""),
      isEnabled: Boolean(m.isEnabled),
      sortOrder: Number(m.sortOrder || 0),
      props: flatProps,
    };
  });

  // Reset the entire version structure to avoid nested BSON issues
  doc[version] = {
    draft: {
      modules: sanitizedModules,
      updatedAt: new Date(),
    },
    published: doc[version]?.published || {
      modules: [],
      updatedAt: null,
      publishedAt: null,
    },
  };

  if (widgets) {
    // Sanitize widgets
    const existingWidgets = doc.widgets?.toObject
      ? doc.widgets.toObject()
      : doc.widgets || {};
    const sanitizedNewWidgets = JSON.parse(JSON.stringify(widgets));

    for (const key of WIDGET_KEYS) {
      if (sanitizedNewWidgets[key] !== undefined) {
        existingWidgets[key] = {
          ...JSON.parse(JSON.stringify(WIDGET_DEFAULTS[key])),
          ...JSON.parse(JSON.stringify(existingWidgets[key])),
          ...sanitizedNewWidgets[key],
        };
      }
    }
    doc.widgets = existingWidgets;
  }

  await doc.save();
  return doc;
}

/**
 * Publish the current draft to live for a version.
 * Buyers will see the published modules.
 */
export async function publishVersion(sellerId, version) {
  if (!VALID_VERSIONS.includes(version)) {
    throw new ErrorResponse(`Invalid version: ${version}`, 400);
  }
  const doc = await getOrCreateForSeller(sellerId);

  // Get and sanitize draft modules
  const rawDraft = doc[version]?.draft?.modules || [];
  console.log(`[publishVersion] Raw draft modules: ${rawDraft.length}`);

  // Sanitize all modules - flatten nested props to prevent deep nesting
  const sanitizedModules = rawDraft.map((m) => {
    // Flatten nested props
    const flatProps = flattenPropsDeep(m.props || {});
    // Remove voucherInfo to avoid potential nested document issues
    delete flatProps.voucherInfo;

    return {
      id: String(m.id || ""),
      type: String(m.type || ""),
      isEnabled: Boolean(m.isEnabled),
      sortOrder: Number(m.sortOrder || 0),
      props: flatProps,
    };
  });

  // Log first module props for debugging
  if (sanitizedModules.length > 0) {
    const firstProps = sanitizedModules[0].props;
    console.log(
      "[publishVersion] First module props keys:",
      Object.keys(firstProps),
    );
    console.log(
      "[publishVersion] First module props sample:",
      JSON.stringify(firstProps).substring(0, 200),
    );
  }

  // Clear and reset the entire version structure to avoid nested issues
  doc[version] = {
    draft: {
      modules: sanitizedModules,
      updatedAt: new Date(),
    },
    published: {
      modules: sanitizedModules,
      updatedAt: new Date(),
      publishedAt: new Date(),
    },
  };

  // Also sanitize widgets
  if (doc.widgets) {
    doc.widgets = JSON.parse(JSON.stringify(doc.widgets));
  }

  console.log("[publishVersion] Saving document...");
  try {
    const saved = await doc.save();
    console.log("[publishVersion] Save successful!");
    return saved;
  } catch (err) {
    console.error("[publishVersion] Save failed:", err.message);
    console.error("[publishVersion] Error name:", err.name);
    if (err.errors) {
      console.error(
        "[publishVersion] Validation errors:",
        JSON.stringify(err.errors),
      );
    }
    throw err;
  }
}

/**
 * Set which version (desktop/mobile) is active on the storefront.
 */
export async function setActiveVersion(sellerId, version) {
  if (!VALID_VERSIONS.includes(version)) {
    throw new ErrorResponse(`Invalid version: ${version}`, 400);
  }
  const doc = await getOrCreateForSeller(sellerId);
  doc.activeVersion = version;
  await doc.save();
  return doc;
}

// ─── Storefront data ────────────────────────────────────────────────────────

/**
 * Get live modules for rendering on the storefront.
 * Priority: published modules → draft modules → [].
 */
export async function getLiveModules(sellerId, version = "desktop") {
  if (!isValidObjectId(sellerId)) return [];
  const doc = await ShopDecoration.findOne({ sellerId }).lean();
  if (!doc) return [];
  const v = doc[version] || {};
  if (v.published?.modules?.length) return v.published.modules;
  if (v.draft?.modules?.length) return v.draft.modules;
  return [];
}

/**
 * Resolve widget limits from decoration config with proper bounds.
 */
function resolveWidgetLimits(widgets) {
  const w = widgets || {};
  const result = {};
  for (const key of WIDGET_KEYS) {
    const def = WIDGET_DEFAULTS[key];
    const cfg = w[key] || {};
    result[key] = {
      enabled: cfg.enabled !== undefined ? cfg.enabled : def.enabled,
      limit: Math.min(20, Math.max(1, parseInt(cfg.limit, 10) || def.limit)),
      // passthrough extra fields (e.g. source, productIds for featuredProducts)
      ...Object.keys(cfg).reduce((acc, k) => {
        if (k !== "enabled" && k !== "limit") acc[k] = cfg[k];
        return acc;
      }, {}),
    };
  }
  return result;
}

/**
 * Get widget data for the storefront (featured products, categories, marketing, etc.)
 * Returns all sections; only sections with data are non-empty arrays.
 *
 * Optimization: runs all independent DB queries in parallel via Promise.all.
 */
export async function getShopWidgetData(sellerId) {
  if (!isValidObjectId(sellerId)) return getEmptyWidgetData();

  const doc = await ShopDecoration.findOne({ sellerId }).lean();
  if (!doc) return getEmptyWidgetData();

  const limits = resolveWidgetLimits(doc.widgets);
  const now = new Date();

  // ── Parallel query execution ──────────────────────────────────────────
  // These queries are independent — run them concurrently for maximum throughput.
  const [
    featuredProductsData,
    bestSellingData,
    newProductsData,
    categoryAggData,
    flashDealsData,
    addonDealsData,
    comboPromosData,
  ] = await Promise.allSettled([
    // featured_products
    limits.featuredProducts.enabled
      ? limits.featuredProducts.source === "manual"
        ? Product.find({
            _id: { $in: limits.featuredProducts.productIds || [] },
            sellerId,
            status: "active",
          })
            .populate("categoryId", "name slug image")
            .lean()
        : Product.find({
            sellerId,
            status: "active",
            isFeatured: true,
          })
            .populate("categoryId", "name slug image")
            .sort({ sold: -1 })
            .limit(limits.featuredProducts.limit)
            .lean()
      : Promise.resolve([]),

    // best_selling
    limits.bestSelling.enabled
      ? Product.find({ sellerId, status: "active" })
          .populate("categoryId", "name slug image")
          .sort({ sold: -1 })
          .limit(limits.bestSelling.limit)
          .lean()
      : Promise.resolve([]),

    // new_products
    limits.newProducts.enabled
      ? Product.find({ sellerId, status: "active" })
          .populate("categoryId", "name slug image")
          .sort({ createdAt: -1 })
          .limit(limits.newProducts.limit)
          .lean()
      : Promise.resolve([]),

    // categories aggregation (shared for featured + list)
    limits.featuredCategories.enabled || limits.categoryList.enabled
      ? Product.aggregate([
          {
            $match: {
              sellerId: new mongoose.Types.ObjectId(sellerId),
              status: "active",
            },
          },
          { $group: { _id: "$categoryId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          {
            $limit: Math.max(
              limits.featuredCategories.limit,
              limits.categoryList.limit,
            ),
          },
        ])
      : Promise.resolve([]),

    // flash_deals
    limits.flashDeals.enabled
      ? Deal.find({
          sellerId,
          status: "active",
          type: "flash_sale",
          startDate: { $lte: now },
          endDate: { $gt: now },
        })
          .populate("productId", "name images models originalPrice slug")
          .sort({ discountPercent: -1 })
          .limit(limits.flashDeals.limit)
          .lean()
      : Promise.resolve([]),

    // addon_deals
    limits.addonDeals.enabled
      ? AddOnDeal.find({
          sellerId,
          status: "active",
          startDate: { $lte: now },
          endDate: { $gt: now },
        })
          .populate("productId", "name images models originalPrice slug")
          .limit(limits.addonDeals.limit)
          .lean()
      : Promise.resolve([]),

    // combo_promos
    limits.comboPromos.enabled
      ? ComboPromotion.find({
          sellerId,
          status: "active",
          startDate: { $lte: now },
          endDate: { $gt: now },
        })
          .populate("products.productId", "name images slug")
          .limit(limits.comboPromos.limit)
          .lean()
      : Promise.resolve([]),
  ]);

  const out = getEmptyWidgetData();

  // ── featured_products ────────────────────────────────────────────────
  if (featuredProductsData.status === "fulfilled") {
    out.featuredProducts = featuredProductsData.value.map(normalizeProduct);
  }

  // ── best_selling ───────────────────────────────────────────────────
  if (bestSellingData.status === "fulfilled") {
    out.bestSelling = bestSellingData.value.map(normalizeProduct);
  }

  // ── new_products ───────────────────────────────────────────────────
  if (newProductsData.status === "fulfilled") {
    out.newProducts = newProductsData.value.map(normalizeProduct);
  }

  // ── categories ────────────────────────────────────────────────────
  if (
    categoryAggData.status === "fulfilled" &&
    categoryAggData.value.length > 0
  ) {
    const categoryIds = categoryAggData.value.map((c) => c._id).filter(Boolean);
    if (categoryIds.length > 0) {
      const categories = await Category.find({
        _id: { $in: categoryIds },
        status: "active",
      })
        .select("name slug image icon")
        .lean();
      const orderMap = new Map(
        categoryAggData.value.map((c, i) => [c._id.toString(), i]),
      );
      categories.sort(
        (a, b) =>
          orderMap.get(a._id.toString()) - orderMap.get(b._id.toString()),
      );
      const normalized = categories.map(normalizeCategory);
      if (limits.featuredCategories.enabled) {
        out.featuredCategories = normalized.slice(
          0,
          limits.featuredCategories.limit,
        );
      }
      if (limits.categoryList.enabled) {
        out.categoryList = normalized.slice(0, limits.categoryList.limit);
      }
    }
  }

  // ── flash_deals ────────────────────────────────────────────────────
  if (flashDealsData.status === "fulfilled") {
    out.flashDeals = flashDealsData.value.map((d) => {
      const p = d.productId;
      const model = p?.models?.find((m) => m.isActive) || p?.models?.[0] || {};
      return {
        id: d._id?.toString(),
        productId: p?._id?.toString(),
        name: p?.name || "",
        image: p?.images?.[0] || model?.image || "",
        price: model?.price ?? p?.originalPrice ?? 0,
        originalPrice: p?.originalPrice ?? 0,
        dealPrice: d.dealPrice ?? model?.price ?? p?.originalPrice ?? 0,
        discountPercent: d.discountPercent ?? 0,
        endDate: d.endDate,
        remaining: Math.max(0, (d.quantityLimit || 0) - (d.soldCount || 0)),
      };
    });
  }

  // ── addon_deals ───────────────────────────────────────────────────
  if (addonDealsData.status === "fulfilled") {
    out.addonDeals = addonDealsData.value.map((a) => {
      const p = a.productId;
      return {
        id: a._id?.toString(),
        productId: p?._id?.toString(),
        name: p?.name || a.title || "",
        image: p?.images?.[0] || "",
        addonPrice: a.addonPrice ?? 0,
        minQty: a.minQuantity ?? 1,
        endDate: a.endDate,
      };
    });
  }

  // ── combo_promos ──────────────────────────────────────────────────
  if (comboPromosData.status === "fulfilled") {
    out.comboPromos = comboPromosData.value.map((c) => ({
      id: c._id?.toString(),
      name: c.name || "",
      comboType: c.comboType || "bundle",
      bundlePrice: c.bundlePrice ?? 0,
      savings: c.savings ?? 0,
      productCount: c.products?.length || 0,
      products: (c.products || []).slice(0, 3).map((cp) => ({
        id: cp.productId?._id?.toString(),
        name: cp.productId?.name || "",
        image: cp.productId?.images?.[0] || "",
      })),
      endDate: c.endDate,
    }));
  }

  return out;
}

function getEmptyWidgetData() {
  return {
    featuredProducts: [],
    featuredCategories: [],
    bestSelling: [],
    newProducts: [],
    categoryList: [],
    flashDeals: [],
    addonDeals: [],
    comboPromos: [],
  };
}

/**
 * Get widget counts for the seller dashboard editor.
 * Returns how many items each widget type currently has in the DB.
 *
 * Optimization: all count queries run in parallel.
 */
export async function getShopWidgetCounts(sellerId) {
  if (!isValidObjectId(sellerId)) {
    return {
      featuredProducts: 0,
      featuredCategories: 0,
      bestSelling: 0,
      newProducts: 0,
      categoryList: 0,
      flashDeals: 0,
      addonDeals: 0,
      comboPromos: 0,
    };
  }
  const now = new Date();
  const [
    featuredCount,
    totalProducts,
    categoryAgg,
    flashCount,
    addonCount,
    comboCount,
  ] = await Promise.all([
    Product.countDocuments({ sellerId, status: "active", isFeatured: true }),
    Product.countDocuments({ sellerId, status: "active" }),
    Product.aggregate([
      {
        $match: {
          sellerId: new mongoose.Types.ObjectId(sellerId),
          status: "active",
        },
      },
      { $group: { _id: "$categoryId" } },
      { $count: "total" },
    ]),
    Deal.countDocuments({
      sellerId,
      status: "active",
      type: "flash_sale",
      startDate: { $lte: now },
      endDate: { $gt: now },
    }),
    AddOnDeal.countDocuments({
      sellerId,
      status: "active",
      startDate: { $lte: now },
      endDate: { $gt: now },
    }),
    ComboPromotion.countDocuments({
      sellerId,
      status: "active",
      startDate: { $lte: now },
      endDate: { $gt: now },
    }),
  ]);
  const distinctCategories = categoryAgg[0]?.total ?? 0;
  return {
    featuredProducts: featuredCount,
    featuredCategories: Math.min(10, distinctCategories),
    bestSelling: Math.min(2, totalProducts),
    newProducts: Math.min(1, totalProducts),
    categoryList: Math.min(5, distinctCategories),
    flashDeals: flashCount,
    addonDeals: addonCount,
    comboPromos: comboCount,
  };
}
