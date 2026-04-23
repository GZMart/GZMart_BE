import mongoose from "mongoose";

const viewHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    viewCount: {
      type: Number,
      default: 1,
    },
    lastViewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound index for fast upserts and querying user's unique viewed products
viewHistorySchema.index({ userId: 1, productId: 1 }, { unique: true });
// Index for sorting by recently viewed
viewHistorySchema.index({ userId: 1, lastViewedAt: -1 });

export default mongoose.model("ViewHistory", viewHistorySchema);
