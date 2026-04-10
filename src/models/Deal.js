import mongoose from "mongoose";

const dealSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    variantSku: {
      type: String,
      trim: true,
      default: null,
      comment: "SKU of the specific variant on sale (optional)",
    },
    type: {
      type: String,
      enum: [
        "flash_sale",
        "daily_deal",
        "weekly_deal",
        "limited_time",
        "clearance",
        "special",
      ],
      required: [true, "Deal type is required"],
    },
    title: {
      type: String,
      trim: true,
      default: null,
      comment: "Also serves as campaignTitle for flash sales",
    },
    description: {
      type: String,
      default: null,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    discountPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    dealPrice: {
      type: Number,
      min: 0,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    quantityLimit: {
      type: Number,
      default: null,
      min: 0,
    },
    soldCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    purchaseLimitPerOrder: {
      type: Number,
      default: 1,
      min: 1,
      comment: "Maximum quantity per single order",
    },
    purchaseLimitPerUser: {
      type: Number,
      default: 1,
      min: 1,
      comment: "Maximum total quantity per user across all orders",
    },
    status: {
      type: String,
      enum: ["pending", "active", "expired", "cancelled", "paused"],
      default: "pending",
    },
    priority: {
      type: Number,
      default: 0,
      comment: "Higher priority deals show first",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes
dealSchema.index({ productId: 1, status: 1 });
dealSchema.index({ type: 1, status: 1, startDate: -1 });
dealSchema.index({ startDate: 1, endDate: 1 });
dealSchema.index({ status: 1, priority: -1 });
dealSchema.index({ productId: 1, status: 1, startDate: 1, endDate: 1 });

// Virtual for remaining quantity
dealSchema.virtual("remainingQuantity").get(function () {
  if (!this.quantityLimit) return null;
  return Math.max(0, this.quantityLimit - this.soldCount);
});

// Virtual for is active
dealSchema.virtual("isActive").get(function () {
  const now = new Date();
  return (
    this.status === "active" &&
    this.startDate <= now &&
    this.endDate >= now &&
    (!this.quantityLimit || this.soldCount < this.quantityLimit)
  );
});

// Virtual for time remaining in milliseconds (matching FE expectation)
dealSchema.virtual("timeRemaining").get(function () {
  const now = new Date();
  if (this.endDate < now) return 0;
  return Math.max(0, this.endDate.getTime() - now.getTime());
});

// Pre-save middleware to update status based on dates
// NOTE: "cancelled" and "paused" are manually set and should NOT be auto-overwritten
dealSchema.pre("save", async function () {
  if (this.status === "cancelled" || this.status === "paused") {
    return; // Manual status - skip auto-update
  }

  const now = new Date();

  if (this.startDate > now) {
    this.status = "pending";
  } else if (this.endDate < now) {
    this.status = "expired";
  } else if (this.quantityLimit && this.soldCount >= this.quantityLimit) {
    this.status = "expired";
  } else if (this.status === "pending" || this.status === "active") {
    this.status = "active";
  }
});

export default mongoose.model("Deal", dealSchema);
