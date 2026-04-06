import mongoose from "mongoose";

const demandForecastCacheSchema = new mongoose.Schema({
  cacheKey: {
    type: String,
    required: true,
    index: true,
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  trendDays: {
    type: Number,
    required: true,
    default: 30,
  },
  includeWebTrends: {
    type: Boolean,
    default: true,
  },
  // Cached forecast result
  trendingProducts: mongoose.Schema.Types.Mixed,
  summary: mongoose.Schema.Types.Mixed,
  dataPeriod: mongoose.Schema.Types.Mixed,
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

// TTL index: auto-delete document when expiresAt < now
demandForecastCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound unique: one cache entry per sellerId + cacheKey combination
demandForecastCacheSchema.index(
  { sellerId: 1, cacheKey: 1 },
  { unique: true }
);

export default mongoose.model("DemandForecastCache", demandForecastCacheSchema);
