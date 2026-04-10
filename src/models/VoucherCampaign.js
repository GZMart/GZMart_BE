import mongoose from "mongoose";

const voucherCampaignSchema = new mongoose.Schema(
  {
    // Campaign identity
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    // Trigger type
    triggerType: {
      type: String,
      enum: ["birthday", "occasion"],
      required: true,
    },

    // For occasion triggers: which occasion
    occasion: {
      type: String,
      enum: [
        "",
        "NEW_YEAR",
        "LUNAR_NEW_YEAR",
        "BLACK_FRIDAY",
        "CHRISTMAS",
        "VALENTINE",
        "WOMEN_DAY",
        "CUSTOM",
      ],
      default: "",
      required: function () {
        return this.triggerType === "occasion";
      },
    },

    // For CUSTOM occasion: specific day/month each year
    customDate: {
      type: Number,
      min: 1,
      max: 31,
    },
    customMonth: {
      type: Number,
      min: 1,
      max: 12,
    },

    // Validity window
    voucherStartOffset: {
      type: Number,
      default: 0,
    },
    voucherValidityDays: {
      type: Number,
      required: true,
      min: 1,
      max: 365,
    },

    // Voucher template
    voucherName: {
      type: String,
      required: true,
    },
    voucherType: {
      type: String,
      enum: ["system_shipping", "system_order"],
      required: true,
    },
    discountType: {
      type: String,
      enum: ["amount", "percent"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    maxDiscountAmount: {
      type: Number,
      min: 0,
    },
    minBasketPrice: {
      type: Number,
      default: 0,
    },
    usageLimit: {
      type: Number,
      default: 1000,
    },
    maxPerBuyer: {
      type: Number,
      default: 1,
    },

    // Campaign control
    isActive: {
      type: Boolean,
      default: true,
    },

    // Meta
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

voucherCampaignSchema.index({ triggerType: 1, isActive: 1 });
voucherCampaignSchema.index({ occasion: 1 });

const VoucherCampaign = mongoose.model(
  "VoucherCampaign",
  voucherCampaignSchema
);

export default VoucherCampaign;
