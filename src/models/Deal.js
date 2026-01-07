import mongoose from "mongoose";

const dealSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    type: {
      type: String,
      enum: ["flash", "daily", "weekend", "special"],
      required: [true, "Deal type is required"],
      comment: "'flash', 'daily', 'weekend', 'special'",
    },
    title: {
      type: String,
      trim: true,
      default: null,
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
      required: [true, "Discount percent is required"],
      min: 0,
      max: 100,
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
    status: {
      type: String,
      enum: ["pending", "active", "expired", "cancelled"],
      default: "pending",
      comment: "'pending', 'active', 'expired', 'cancelled'",
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
  }
);

// Indexes
dealSchema.index({ productId: 1, status: 1 });
dealSchema.index({ type: 1, status: 1, startDate: -1 });
dealSchema.index({ startDate: 1, endDate: 1 });
dealSchema.index({ status: 1, priority: -1 });
// CRITICAL: Compound index for active deal lookups in batch queries
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

// Virtual for time remaining in seconds
dealSchema.virtual("timeRemaining").get(function () {
  const now = new Date();
  if (this.endDate < now) return 0;
  return Math.floor((this.endDate - now) / 1000);
});

// Pre-save middleware to update status based on dates
dealSchema.pre("save", function (next) {
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

  next();
});

export default mongoose.model("Deal", dealSchema);
