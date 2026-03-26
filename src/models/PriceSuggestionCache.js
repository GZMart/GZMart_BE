import mongoose from "mongoose";

const priceSuggestionCacheSchema = new mongoose.Schema({
  cacheKey: {
    type: String,
    required: true,
    index: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
    index: true,
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  suggestedPrice: Number,
  reasoning: String,
  warning: String,
  riskLevel: String,
  warningMessage: String,
  discountPct: Number,
  // [Phase 3 - 5.1] Strategy used for this suggestion (affects cache key)
  strategy: {
    type: String,
    default: "balanced",
  },
  marketData: {
    min: Number,
    avg: Number,
    max: Number,
    count: Number,
    topSeller: {
      name: String,
      sold: Number,
      price: Number,
    },
  },
  competitors: mongoose.Schema.Types.Mixed,
  /** Full batch API response snapshot (executeBatch) — optional */
  batchPayload: mongoose.Schema.Types.Mixed,
  fromBatch: {
    type: Boolean,
    default: false,
  },
  product: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
    currentPrice: Number,
    modelId: String,
    modelSku: String,
    brand: String,
    rating: Number,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// TTL index: tự động xóa document khi expiresAt < now
priceSuggestionCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound unique constraint: không cache trùng productId + cacheKey
priceSuggestionCacheSchema.index(
  { productId: 1, cacheKey: 1 },
  { unique: true }
);

export default mongoose.model("PriceSuggestionCache", priceSuggestionCacheSchema);
