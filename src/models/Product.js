import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
    },
    brand: {
      type: String,
      trim: true,
      default: null,
    },
    description: {
      type: String,
      default: null,
    },
    originalPrice: {
      type: Number,
      default: null,
      min: 0,
      comment: "Giá gốc để hiển thị gạch chân",
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviews: {
      type: Number,
      default: 0,
      min: 0,
    },
    sold: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: Boolean,
      default: true,
    },
    sizeChartType: {
      type: String,
      enum: ["image", "table", null],
      default: null,
      comment: "'image' or 'table'",
    },
    sizeChartData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      comment: "Lưu mảng đo đạc hoặc URL ảnh",
    },
    // Additional fields for better functionality
    images: [
      {
        url: String,
        alt: String,
        isPrimary: {
          type: Boolean,
          default: false,
        },
      },
    ],
    views: {
      type: Number,
      default: 0,
    },
    wishlistCount: {
      type: Number,
      default: 0,
    },
    isNewArrival: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isTrending: {
      type: Boolean,
      default: false,
    },
    seo: {
      title: String,
      description: String,
      keywords: [String],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for search and filter
productSchema.index({ name: "text", description: "text", brand: "text" });
productSchema.index({ categoryId: 1, status: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ sold: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ isTrending: 1, status: 1 });
productSchema.index({ isNewArrival: 1, status: 1 });

// Virtual for getting tiers
productSchema.virtual("tiers", {
  ref: "ProductTier",
  localField: "_id",
  foreignField: "productId",
});

// Virtual for getting models (variants)
productSchema.virtual("models", {
  ref: "ProductModel",
  localField: "_id",
  foreignField: "productId",
});

// Virtual for getting attributes
productSchema.virtual("attributes", {
  ref: "ProductAttribute",
  localField: "_id",
  foreignField: "productId",
});

// Virtual for getting active deals
productSchema.virtual("deals", {
  ref: "Deal",
  localField: "_id",
  foreignField: "productId",
});

// Virtual for min price (from models)
productSchema.virtual("minPrice").get(function () {
  if (this._minPrice !== undefined) return this._minPrice;
  return null;
});

// Virtual for max price (from models)
productSchema.virtual("maxPrice").get(function () {
  if (this._maxPrice !== undefined) return this._maxPrice;
  return null;
});

// Virtual for total stock (from models)
productSchema.virtual("totalStock").get(function () {
  if (this._totalStock !== undefined) return this._totalStock;
  return null;
});

// Pre-save middleware to generate slug
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

  // Set isNewArrival for products created in last 30 days
  if (this.isNewArrival !== true) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    this.isNewArrival = this.createdAt > thirtyDaysAgo;
  }

  next();
});

export default mongoose.model("Product", productSchema);
