import mongoose from "mongoose";

/**
 * Banner Model - Support both ADMIN banners and SELLER Ad banners (Shopee-style)
 * 
 * Flow for SELLER banners:
 * 1. Seller submits => status: PENDING_PAYMENT, coins deducted (held)
 * 2. admin reviews => PENDING_REVIEW (already paid)
 * 3. Admin approves => status: APPROVED
 * 4. Cron job activates on startDate => status: RUNNING (visible on homepage)
 * 5. Cron job deactivates on endDate => status: COMPLETED
 * 6. Admin rejects => status: REJECTED, coins refunded
 *
 * Max RUNNING seller banners on homepage at a time: MAX_SELLER_SLOTS (default 5)
 */

// Maximum concurrent seller ad banners visible on homepage
export const MAX_SELLER_SLOTS = 1;
// Price per day in reward_points (coins)
export const PRICE_PER_DAY = 200000;

const bannerSchema = new mongoose.Schema(
  {
    // ─── Common Fields ───────────────────────────────────────────
    title: {
      type: String,
      trim: true,
      default: "",
    },
    subtitle: {
      type: String,
      trim: true,
      default: null,
    },
    image: {
      type: String,
      required: [true, "Banner image is required"],
    },
    imageSmall: {
      type: String,
      default: null,
    },
    link: {
      type: String,
      default: null,
    },
    linkType: {
      type: String,
      enum: ["product", "category", "deal", "external", "none"],
      default: "none",
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },

    // ─── Ownership ───────────────────────────────────────────────
    ownerType: {
      type: String,
      enum: ["ADMIN", "SELLER"],
      default: "ADMIN",
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },

    // ─── Hotspot Zones ────────────────────────────────────────────
    // Clickable areas on the banner image, each linking to a product/shop/etc.
    hotspots: [
      {
        x:      { type: Number, required: true }, // center x position (%)
        y:      { type: Number, required: true }, // center y position (%)
        width:  { type: Number, required: true }, // zone width (%)
        height: { type: Number, required: true }, // zone height (%)
        link:       { type: String, default: null },
        label:      { type: String, default: null },
        linkType:   { type: String, enum: ["product", "shop", "category", "external", "none"], default: "none" },
        productId:  { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
      },
    ],

    // ─── Seller Ad Status & Payment ──────────────────────────────
    /**
     * DRAFT          - Seller saved but not submitted
     * PENDING_PAYMENT- Request submitted, awaiting coin payment
     * PENDING_REVIEW - Coins paid (held), awaiting admin review
     * APPROVED       - Admin approved, waiting for startDate
     * RUNNING        - Live on homepage (startDate <= now <= endDate)
     * COMPLETED      - Campaign ended naturally
     * REJECTED       - Admin rejected, coins refunded
     * CANCELLED      - Seller cancelled before approval (coins refunded)
     */
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING_PAYMENT",
        "PENDING_REVIEW",
        "APPROVED",
        "RUNNING",
        "COMPLETED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "DRAFT",
      index: true,
    },

    // ─── Pricing ─────────────────────────────────────────────────
    pricing: {
      pricePerDay: {
        type: Number,
        default: PRICE_PER_DAY,
      },
      totalDays: {
        type: Number,
        default: 0,
      },
      totalFee: {
        type: Number,
        default: 0,
      },
    },

    // ─── Payment Info ────────────────────────────────────────────
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "HELD", "SETTLED", "REFUNDED"],
      default: "UNPAID",
    },
    walletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },

    // ─── Admin Review ─────────────────────────────────────────────
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },

    // ─── Metrics (Views + Clicks) ─────────────────────────────────
    metrics: {
      views: {
        type: Number,
        default: 0,
      },
      clicks: {
        type: Number,
        default: 0,
      },
    },

    // ─── Legacy field kept for backward compat ────────────────────
    clickCount: {
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

// ─── Indexes ─────────────────────────────────────────────────────────────────
bannerSchema.index({ isActive: 1, order: 1 });
bannerSchema.index({ startDate: 1, endDate: 1 });
bannerSchema.index({ ownerType: 1, status: 1 });
bannerSchema.index({ sellerId: 1, status: 1, createdAt: -1 });

// ─── Virtuals ────────────────────────────────────────────────────────────────
bannerSchema.virtual("isCurrentlyActive").get(function () {
  if (!this.isActive) return false;
  const now = new Date();
  if (this.startDate && this.startDate > now) return false;
  if (this.endDate && this.endDate < now) return false;
  return true;
});

// CTR = clicks / views * 100
bannerSchema.virtual("ctr").get(function () {
  if (!this.metrics.views) return 0;
  return ((this.metrics.clicks / this.metrics.views) * 100).toFixed(2);
});

export default mongoose.model("Banner", bannerSchema);
