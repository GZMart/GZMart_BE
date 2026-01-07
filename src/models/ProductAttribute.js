import mongoose from "mongoose";

const productAttributeSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    label: {
      type: String,
      required: [true, "Attribute label is required"],
      trim: true,
      comment: "Ví dụ: Chất liệu, Xuất xứ",
    },
    value: {
      type: String,
      required: [true, "Attribute value is required"],
      trim: true,
      comment: "Ví dụ: Cotton, Việt Nam",
    },
    type: {
      type: String,
      enum: ["fixed", "custom"],
      default: "custom",
      comment: "'fixed' hoặc 'custom'",
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productAttributeSchema.index({ productId: 1, order: 1 });
productAttributeSchema.index({ productId: 1, label: 1 });
productAttributeSchema.index({ label: 1 });

export default mongoose.model("ProductAttribute", productAttributeSchema);
