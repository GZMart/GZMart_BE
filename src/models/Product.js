import mongoose from "mongoose";

/** Strip Vietnamese diacritics + uppercase. Used as a Mongoose setter for SKU fields. */
function normalizeSkuValue(v) {
  if (!v || typeof v !== "string") return v;
  return v
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D");
}

const productAttributeSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      comment: "Attribute slug/key from CategoryAttribute",
    },
    label: {
      type: String,
      required: [true, "Attribute label is required"],
      trim: true,
      maxlength: [50, "Attribute label cannot exceed 50 characters"],
    },
    value: {
      type: String,
      required: [true, "Attribute value is required"],
      trim: true,
      maxlength: [200, "Attribute value cannot exceed 200 characters"],
    },
    type: {
      type: String,
      enum: ["text", "number", "date", "select"],
      default: "text",
    },
  },
  { _id: false },
);

const tierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Tier name is required"],
      trim: true,
      maxlength: [50, "Tier name cannot exceed 50 characters"],
    },
    options: {
      type: [String],
      required: [true, "Tier options are required"],
      validate: {
        validator: function (arr) {
          return arr.length > 0 && arr.length <= 20;
        },
        message: "Tier must have between 1 and 20 options",
      },
    },
    images: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
);

const modelSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, "SKU is required"],
      trim: true,
      uppercase: true,
      set: normalizeSkuValue,
      maxlength: [100, "SKU cannot exceed 100 characters"],
    },
    price: {
      type: Number,
      required: [true, "Model price is required"],
      min: [0, "Price must be non-negative"],
    },
    costPrice: {
      type: Number,
      default: 0,
      min: [0, "Cost price must be non-negative"],
    },
    // Synced from InventoryItem — tracks whether cost came from a PO or was set manually
    costSource: {
      type: String,
      enum: ["manual", "po"],
      default: "manual",
    },
    costSourcePoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      default: null,
    },
    stock: {
      type: Number,
      required: [true, "Stock is required"],
      min: [0, "Stock must be non-negative"],
      default: 0,
    },
    tierIndex: {
      type: [Number],
      required: [true, "Tier index is required"],
    },
    image: {
      type: String,
      default: null,
    },
    weight: {
      type: Number,
      min: [0, "Weight must be non-negative"],
      default: 0,
    },
    weightUnit: {
      type: String,
      enum: ["gr", "kg"],
      default: "gr",
    },
    dimLength: { type: Number, default: 0, min: 0 },
    dimWidth: { type: Number, default: 0, min: 0 },
    dimHeight: { type: Number, default: 0, min: 0 },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [200, "Product name cannot exceed 200 characters"],
      index: "text",
    },
    slug: {
      type: String,
      lowercase: true,
      trim: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [
        function () {
          return this.status !== "draft";
        },
        "Category is required",
      ],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },
    attributes: {
      type: [productAttributeSchema],
      default: [],
    },
    tiers: {
      type: [tierSchema],
      validate: {
        validator: function (arr) {
          return arr.length <= 3;
        },
        message: "Product cannot have more than 3 tiers",
      },
      default: [],
    },
    models: {
      type: [modelSchema],
      required: [true, "Product must have at least one model/variant"],
      validate: {
        validator: function (arr) {
          return arr.length > 0 && arr.length <= 200;
        },
        message: "Product must have between 1 and 200 models",
      },
    },
    originalPrice: {
      type: Number,
      required: [
        function () {
          return this.status !== "draft";
        },
        "Original price is required for published products",
      ],
      min: [0, "Original price must be non-negative"],
    },
    preOrderDays: {
      type: Number,
      default: 0,
      min: [0, "Pre-order days must be non-negative"],
    },
    weight: { type: Number, default: 0, min: 0 },
    weightUnit: { type: String, enum: ["gr", "kg"], default: "gr" },
    dimLength: { type: Number, default: 0, min: 0 },
    dimWidth: { type: Number, default: 0, min: 0 },
    dimHeight: { type: Number, default: 0, min: 0 },
    images: {
      type: [String],
      default: [],
    },
    video: {
      type: String,
      default: null,
    },
    sizeChart: {
      type: String,
      default: null,
    },
    rating: {
      type: Number,
      default: 0,
      min: [0, "Rating must be between 0 and 5"],
      max: [5, "Rating must be between 0 and 5"],
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    sold: {
      type: Number,
      default: 0,
      min: 0,
    },
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "out_of_stock", "draft"],
      default: "active",
      index: true,
    },
    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Seller is required"],
      index: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    brand: {
      type: String,
      trim: true,
      default: null,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isTrending: {
      type: Boolean,
      default: false,
    },
    isNewArrival: {
      type: Boolean,
      default: false,
    },
    wishlistCount: {
      type: Number,
      default: 0,
    },
    seo: {
      title: String,
      description: String,
      keywords: [String],
    },
    embedding: {
      type: [Number],
      default: [],
      select: false,
    },
    embeddingText: {
      type: String,
      select: false,
    },
    // [Phase 3 - 5.2] Tracks when the embedding was last generated/refreshed
    embeddingUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

productSchema.index({ name: "text", description: "text" });
productSchema.index({ categoryId: 1, status: 1 });
productSchema.index({ sellerId: 1, status: 1 });
productSchema.index({ originalPrice: 1 });
productSchema.index({ sold: -1 });
productSchema.index({ rating: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ "models.sku": 1 }, { unique: true });
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ isNewArrival: 1, status: 1 });

productSchema.virtual("totalStock").get(function () {
  if (!this.models) return 0;
  return this.models.reduce((sum, model) => sum + model.stock, 0);
});

productSchema.virtual("price").get(function () {
  if (!this.models || this.models.length === 0) return null;
  const prices = this.models
    .map((m) => m.price)
    .filter((p) => typeof p === "number");
  if (prices.length === 0) return null;
  return Math.min(...prices);
});

productSchema.virtual("sku").get(function () {
  if (!this.models || this.models.length === 0) return null;
  return this.models[0].sku;
});

productSchema.pre("save", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }

  if (this.isNew) {
    this.isNewArrival = true;
  }
});

productSchema.post("save", async function () {
  const modifiedPaths = this.modifiedPaths();
  const relevantFields = [
    "name",
    "description",
    "attributes",
    "tags",
    "brand",
    "categoryId",
  ];
  const needsUpdate = relevantFields.some((f) => modifiedPaths.includes(f));

  if (needsUpdate && this.status === "active") {
    try {
      const { default: embeddingService } =
        await import("../services/embedding.service.js");
      const { default: Category } = await import("./Category.js");
      const cat = await Category.findById(this.categoryId)
        .select("name")
        .lean();

      // Compose text from identity fields only — NO description to avoid
      // e-commerce noise ("mua hàng", "giảm giá", "ship nhanh") that pulls
      // unrelated categories (e.g. shoes) into apparel search results.
      const parts = [
        this.name,
        cat?.name || "",
        this.brand || "",
        (this.attributes || []).map((a) => `${a.label} ${a.value}`).join(" "),
        (this.tags || []).join(" "),
      ];
      const text = parts.filter(Boolean).join(" | ");
      const embedding = await embeddingService.getEmbedding(text);

      await this.constructor.updateOne(
        { _id: this._id },
        { $set: { embedding, embeddingText: text } },
      );
    } catch (err) {
      console.error(`[Embedding] Failed for product ${this._id}:`, err.message);
    }
  }
});

export default mongoose.model("Product", productSchema);
