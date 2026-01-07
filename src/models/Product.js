import mongoose from "mongoose";

// Sub-schema for product attributes (Material, Brand, etc.)
const productAttributeSchema = new mongoose.Schema(
  {
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
  { _id: false }
);

// Sub-schema for product tiers (Color, Size, etc.)
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
  { _id: false }
);

// Sub-schema for product models/variants (SKU combinations)
const modelSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, "SKU is required"],
      trim: true,
      uppercase: true,
      unique: true,
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
    stock: {
      type: Number,
      required: [true, "Stock is required"],
      min: [0, "Stock must be non-negative"],
      default: 0,
    },
    tierIndex: {
      type: [Number],
      required: [true, "Tier index is required"],
      validate: {
        validator: function (arr) {
          return arr.every((idx) => Number.isInteger(idx) && idx >= 0);
        },
        message: "Tier index must contain non-negative integers",
      },
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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

// Main Product Schema
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
      unique: true,
      lowercase: true,
      trim: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
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
      required: true,
      min: [0, "Original price must be non-negative"],
    },
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
      min: [0, "Review count must be non-negative"],
    },
    sold: {
      type: Number,
      default: 0,
      min: [0, "Sold count must be non-negative"],
    },
    viewCount: {
      type: Number,
      default: 0,
      min: [0, "View count must be non-negative"],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "out_of_stock", "draft"],
      default: "active",
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
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for performance optimization
productSchema.index({ name: "text", description: "text" });
productSchema.index({ categoryId: 1, status: 1 });
productSchema.index({ sellerId: 1, status: 1 });
productSchema.index({ originalPrice: 1 });
productSchema.index({ sold: -1 });
productSchema.index({ rating: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ "models.sku": 1 });

// Virtual for total stock across all models
productSchema.virtual("totalStock").get(function () {
  if (!this.models) return 0;
  return this.models.reduce((sum, model) => sum + model.stock, 0);
});

// Ensure virtuals are included when converting to JSON
productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

export default mongoose.model("Product", productSchema);
