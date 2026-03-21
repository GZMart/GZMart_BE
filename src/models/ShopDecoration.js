import mongoose from "mongoose";

const imageSlideSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    link: { type: String, default: "" },
    alt: { type: String, default: "" },
  },
  { _id: false }
);

const bannerMultiImageSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    link: { type: String, default: "" },
  },
  { _id: false }
);

const hotspotSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true, min: 0, max: 100 }, // percentage
    y: { type: Number, required: true, min: 0, max: 100 },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    link: { type: String, default: "" },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const VALID_MODULE_TYPES = [
  // Visuals
  "banner_carousel",
  "banner_multi",
  "banner_single",
  "banner_hotspot",
  // Marketing (auto)
  "flash_deals",
  "addon_deals",
  "combo_promos",
  // Products & Category
  "featured_products",
  "featured_categories",
  "best_selling",
  "new_products",
  "category_list",
  // Information
  "text",
  "image_text",
  "shop_info",
  // Mandatory sections
  "discount",
  "suggested_for_you",
];

const moduleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: VALID_MODULE_TYPES,
    },
    props: { type: mongoose.Schema.Types.Mixed, default: {} },
    isEnabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const versionSlotSchema = new mongoose.Schema(
  {
    modules: { type: [moduleSchema], default: [] },
    updatedAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null },
  },
  { _id: false }
);

const shopDecorationSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Each version has its own draft + published slot
    desktop: {
      draft: {
        type: versionSlotSchema,
        default: () => ({ modules: [] }),
      },
      published: {
        type: versionSlotSchema,
        default: () => ({ modules: [] }),
      },
    },

    mobile: {
      draft: {
        type: versionSlotSchema,
        default: () => ({ modules: [] }),
      },
      published: {
        type: versionSlotSchema,
        default: () => ({ modules: [] }),
      },
    },

    // Widgets config — mirrors WIDGET_DEFAULTS from the service
    // Includes marketing widgets (flashDeals, addonDeals, comboPromos) for completeness
    widgets: {
      featuredProducts: {
        enabled: { type: Boolean, default: true },
        limit: { type: Number, default: 10, min: 1, max: 20 },
        source: { type: String, enum: ["auto", "manual"], default: "auto" },
        productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
      },
      featuredCategories: {
        enabled: { type: Boolean, default: true },
        limit: { type: Number, default: 10, min: 1, max: 20 },
      },
      bestSelling: {
        enabled: { type: Boolean, default: false },
        limit: { type: Number, default: 2, min: 1, max: 10 },
      },
      newProducts: {
        enabled: { type: Boolean, default: false },
        limit: { type: Number, default: 1, min: 1, max: 10 },
      },
      categoryList: {
        enabled: { type: Boolean, default: false },
        limit: { type: Number, default: 5, min: 1, max: 20 },
      },
      // Marketing widgets — aligned with service WIDGET_DEFAULTS
      flashDeals: {
        enabled: { type: Boolean, default: false },
        limit: { type: Number, default: 5, min: 1, max: 20 },
      },
      addonDeals: {
        enabled: { type: Boolean, default: false },
        limit: { type: Number, default: 3, min: 1, max: 20 },
      },
      comboPromos: {
        enabled: { type: Boolean, default: false },
        limit: { type: Number, default: 3, min: 1, max: 20 },
      },
    },

    // Which version is currently active on the storefront (desktop | mobile | null)
    activeVersion: {
      type: String,
      enum: ["desktop", "mobile"],
      default: "desktop",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Save a draft for a specific version (desktop | mobile). */
shopDecorationSchema.methods.saveDraft = function (version, modules) {
  const slot = this[version]?.draft || { modules: [] };
  slot.modules = modules;
  slot.updatedAt = new Date();
  this[version].draft = slot;
  return this.save();
};

/** Atomically publish the draft → published for a specific version. */
shopDecorationSchema.methods.publish = function (version) {
  const draft = this[version]?.draft;
  if (!draft) throw new Error(`Version "${version}" not found`);
  const now = new Date();
  this[version].published = {
    modules: draft.modules,
    updatedAt: draft.updatedAt,
    publishedAt: now,
  };
  this[version].draft.updatedAt = now;
  return this.save();
};

/** Get the live modules for storefront rendering. Falls back to draft if nothing published. */
shopDecorationSchema.methods.getLiveModules = function (version) {
  const v = this[version] || {};
  const published = v.published?.modules;
  if (published && published.length > 0) return published;
  const draft = v.draft?.modules;
  if (draft && draft.length > 0) return draft;
  return [];
};

/** Add or update a module in the draft. */
shopDecorationSchema.methods.upsertModule = function (version, moduleEntry) {
  const modules = this[version]?.draft?.modules || [];
  const idx = modules.findIndex((m) => m.id === moduleEntry.id);
  if (idx >= 0) {
    modules[idx] = { ...modules[idx].toObject ? modules[idx].toObject() : modules[idx], ...moduleEntry };
  } else {
    modules.push(moduleEntry);
  }
  return this.saveDraft(version, modules);
};

/** Remove a module from the draft. */
shopDecorationSchema.methods.removeModule = function (version, moduleId) {
  const modules = (this[version]?.draft?.modules || []).filter(
    (m) => m.id !== moduleId
  );
  return this.saveDraft(version, modules);
};

/** Reorder modules in the draft. */
shopDecorationSchema.methods.reorderModules = function (version, orderedIds) {
  const all = this[version]?.draft?.modules || [];
  const map = new Map(all.map((m) => [m.id, m.toObject ? m.toObject() : m]));
  const reordered = orderedIds.map((id, index) => {
    const m = map.get(id);
    if (!m) return null;
    m.sortOrder = index;
    return m;
  }).filter(Boolean);
  return this.saveDraft(version, reordered);
};

const ShopDecoration = mongoose.model("ShopDecoration", shopDecorationSchema);
export default ShopDecoration;
