import mongoose from "mongoose";

const productModelSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    sku: {
      type: String,
      required: [true, "SKU is required"],
      unique: true,
      trim: true,
    },
    tier_index: {
      type: [Number],
      required: [true, "Tier index is required"],
      comment: "Ví dụ: [0, 1] nghĩa là Color index 0 và Size index 1",
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: 0,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Additional fields
    image: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productModelSchema.index({ productId: 1 });
productModelSchema.index({ productId: 1, tier_index: 1 }, { unique: true });
productModelSchema.index({ stock: 1 });
// Compound index for batch queries - CRITICAL for performance
productModelSchema.index({ productId: 1, stock: 1 });

// Virtual for stock status
productModelSchema.virtual("stockStatus").get(function () {
  if (this.stock === 0) return "out_of_stock";
  if (this.stock <= 10) return "low_stock";
  return "in_stock";
});

// Virtual for isAvailable
productModelSchema.virtual("isAvailable").get(function () {
  return this.isActive && this.stock > 0;
});

export default mongoose.model("ProductModel", productModelSchema);
