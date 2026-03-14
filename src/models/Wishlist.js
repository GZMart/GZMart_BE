import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    wishlistItems: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        modelId: {
          type: mongoose.Schema.Types.ObjectId,
          default: null,
        },
        color: {
          type: String,
          default: "Default",
        },
        size: {
          type: String,
          default: "Default",
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
wishlistSchema.index({ userId: 1 });
wishlistSchema.index({ userId: 1, products: 1 });
wishlistSchema.index({ userId: 1, "wishlistItems.productId": 1 });
wishlistSchema.index({ userId: 1, "wishlistItems.modelId": 1 });

export default mongoose.model("Wishlist", wishlistSchema);
