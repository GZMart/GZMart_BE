import mongoose from "mongoose";

const voucherSchema = new mongoose.Schema(
  {
    // Core Identity
    name: {
      type: String,
      required: [true, "Voucher name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Voucher code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      minLength: [3, "Code must be at least 3 characters"],
      maxLength: [20, "Code cannot exceed 20 characters"],
    },
    type: {
      type: String,
      enum: [
        "shop",
        "product",
        "private",
        "live",
        "new_buyer",
        "repeat_buyer",
        "follower",
        "system_shipping",
        "system_order",
        "system_vip_daily",
      ],
      required: true,
      default: "shop",
    },

    // Discount Logic
    discountType: {
      type: String,
      enum: ["amount", "percent", "coin"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: [0, "Discount value cannot be negative"],
    },
    maxDiscountAmount: {
      type: Number,
      min: [0, "Max discount amount must be positive"],
    }, // For % vouchers (e.g., 10% off up to 50k)
    minBasketPrice: {
      type: Number,
      default: 0,
      min: [0, "Minimum basket price must be positive"],
    },

    // Limits
    usageLimit: {
      type: Number,
      required: true,
      min: [1, "Usage limit must be at least 1"],
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    maxPerBuyer: {
      type: Number,
      default: 1,
      min: [1, "Max per buyer must be at least 1"],
    },

    // Buyer Eligibility (for repeat_buyer and follower voucher types)
    minOrderCount: {
      type: Number,
      default: 2,
      description: "Minimum number of completed orders required to use this voucher (for repeat_buyer type)",
    },
    followRequired: {
      type: Boolean,
      default: false,
      description: "Whether buyer must follow the shop to use this voucher (for follower type)",
    },

    // Validity
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "deleted"],
      default: "active",
    },

    // Scope
    applyTo: {
      type: String,
      enum: ["all", "specific"],
      default: "all",
    },
    appliedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    // For live vouchers — binds the voucher to a specific live session
    liveSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveSession",
      default: null,
    },

    // Display
    displaySetting: {
      type: String,
      enum: ["public", "private", "live"],
      default: "public",
    },

    // Metadata
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return !this.type.startsWith("system_");
      },
    },
  },
  {
    timestamps: true,
  },
);

// Index for efficient querying
voucherSchema.index({ startTime: 1, endTime: 1 });
voucherSchema.index({ status: 1 });

const Voucher = mongoose.model("Voucher", voucherSchema);

export default Voucher;
