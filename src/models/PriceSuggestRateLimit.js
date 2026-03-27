import mongoose from "mongoose";

const priceSuggestRateLimitSchema = new mongoose.Schema({
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  dailyCount: {
    type: Number,
    default: 1,
    min: 0,
  },
  dailyReset: {
    type: Date,
    default: () => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return now;
    },
  },
  productCooldowns: {
    type: Map,
    of: Date,
    default: {},
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

/**
 * Check daily limit and per-product cooldown.
 * Returns { allowed: true } if request is allowed, or { allowed: false, reason, message } if blocked.
 */
priceSuggestRateLimitSchema.methods.checkAndIncrement = function (productId) {
  const now = new Date();

  // Reset daily count if it's a new day
  if (this.dailyReset < new Date(now.toDateString())) {
    this.dailyCount = 0;
    this.dailyReset = new Date(now.toDateString());
  }

  // Check daily limit (50 requests/day)
  if (this.dailyCount >= 500) {
    const msUntilReset =
      new Date(this.dailyReset.getTime() + 24 * 60 * 60 * 1000) - now;
    const hoursUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60));
    return {
      allowed: false,
      reason: "daily_limit",
      message: `Đã đạt giới hạn 50 lượt/ngày. Vui lòng thử lại sau ${hoursUntilReset} giờ.`,
    };
  }

  // Check per-product cooldown (30 seconds)
  const productCooldown = this.productCooldowns?.get(productId?.toString());
  if (productId && productCooldown) {
    const msSinceCooldown = now - new Date(productCooldown);
    if (msSinceCooldown < 30000) {
      const secondsLeft = Math.ceil((30000 - msSinceCooldown) / 1000);
      return {
        allowed: false,
        reason: "product_cooldown",
        message: `Vui lòng đợi ${secondsLeft}s trước khi yêu cầu lại cho sản phẩm này.`,
      };
    }
  }

  // Increment counters
  this.dailyCount += 1;
  if (productId) {
    this.productCooldowns.set(productId.toString(), now);
  }
  this.updatedAt = now;

  return { allowed: true };
};

export default mongoose.model(
  "PriceSuggestRateLimit",
  priceSuggestRateLimitSchema,
);
