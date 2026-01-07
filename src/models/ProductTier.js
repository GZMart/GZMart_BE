import mongoose from "mongoose";

const productTierSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    name: {
      type: String,
      required: [true, "Tier name is required"],
      trim: true,
      comment: "Ví dụ: Color hoặc Size",
    },
    options: {
      type: [String],
      required: [true, "Tier options are required"],
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: "At least one option is required",
      },
      comment: "Ví dụ: ['Black', 'Blue']",
    },
    images: {
      type: [String],
      default: [],
      comment: "Mảng URL ảnh tương ứng với options",
    },
    order: {
      type: Number,
      required: [true, "Order is required"],
      default: 0,
      comment: "Thứ tự hiển thị: 0 cho màu sắc, 1 cho size",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productTierSchema.index({ productId: 1, order: 1 });
productTierSchema.index({ productId: 1, name: 1 });

// Validate images array length matches options if provided
productTierSchema.pre("save", function (next) {
  if (this.images && this.images.length > 0) {
    if (this.images.length !== this.options.length) {
      return next(
        new Error("Images array length must match options array length")
      );
    }
  }
  next();
});

export default mongoose.model("ProductTier", productTierSchema);
