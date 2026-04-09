import mongoose from "mongoose";

const demandForecastRateLimitSchema = new mongoose.Schema({
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
    unique: true,
  },
  dailyCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Midnight of the current day (UTC) — resets at start of new day
  dailyReset: {
    type: Date,
    default: () => {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      return now;
    },
  },
  /**
   * Per-product cooldown map.
   * Key = productId (string), Value = Date of last request.
   * Each product has a 60-second cooldown to avoid redundant web-scraping calls.
   */
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
 * Check daily limit and per-product cooldown before allowing a forecast request.
 *
 * Limits:
 *   - Daily: 50 requests per seller per day (lower than price suggestion since
 *     web searches are more expensive)
 *   - Per-product: 60-second cooldown between requests for the same product
 *
 * @param {string|null} productId  — optional; if provided also checks product cooldown
 * @returns {{ allowed: boolean, reason?: string, message?: string, msUntilReset?: number, secondsLeft?: number }}
 */
demandForecastRateLimitSchema.methods.checkAndIncrement = function (productId) {
  const now = new Date();

  // ── Reset daily count at midnight ──────────────────────────────────────────
  const todayMidnight = new Date(now);
  todayMidnight.setUTCHours(0, 0, 0, 0);

  if (this.dailyReset < todayMidnight) {
    this.dailyCount = 0;
    this.dailyReset = todayMidnight;
  }

  // ── Daily limit check ────────────────────────────────────────────────────
  if (this.dailyCount >= 200) {
    const msUntilReset = new Date(this.dailyReset.getTime() + 24 * 60 * 60 * 1000) - now;
    const hoursLeft = Math.max(1, Math.ceil(msUntilReset / (1000 * 60 * 60)));
    return {
      allowed: false,
      reason: "daily_limit",
      message: `Daily forecast limit reached (200 requests/day). Try again in ~${hoursLeft} hour(s).`,
      msUntilReset,
    };
  }

  // ── Per-product cooldown check ────────────────────────────────────────────
  if (productId) {
    const pidStr = productId.toString();
    const lastRequest = this.productCooldowns?.get(pidStr);
    if (lastRequest) {
      const msSince = now - new Date(lastRequest);
      if (msSince < 60000) {
        const secondsLeft = Math.ceil((60000 - msSince) / 1000);
        return {
          allowed: false,
          reason: "product_cooldown",
          message: `Please wait ${secondsLeft}s before requesting forecast for this product again.`,
          secondsLeft,
        };
      }
    }
  }

  // ── Allow: increment counters ────────────────────────────────────────────
  this.dailyCount += 1;
  if (productId) {
    if (!this.productCooldowns) {
      this.productCooldowns = new Map();
    }
    this.productCooldowns.set(productId.toString(), now);
  }
  this.updatedAt = now;

  return { allowed: true };
};

export default mongoose.model(
  "DemandForecastRateLimit",
  demandForecastRateLimitSchema
);
