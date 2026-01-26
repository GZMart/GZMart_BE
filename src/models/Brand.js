import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
      unique: true,
    },
    slug: {
      type: String,
      required: [true, "Brand slug is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    logo: {
      type: String,
      default: null,
    },
    featuredImage: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      default: null,
    },
    website: {
      type: String,
      default: null,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    productCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes
brandSchema.index({ isActive: 1, isFeatured: 1 });
brandSchema.index({ name: "text" });

// Virtual for products
brandSchema.virtual("products", {
  ref: "Product",
  localField: "_id",
  foreignField: "brand",
});

export default mongoose.model("Brand", brandSchema);
