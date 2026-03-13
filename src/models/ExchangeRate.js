import mongoose from "mongoose";

/**
 * Stores historical and current VND/CNY exchange rates.
 * The most recent document where isActive = true is the "live" rate
 * used by PurchaseOrder calculations and the ERP Dashboard.
 */
const exchangeRateSchema = new mongoose.Schema(
  {
    baseCurrency: {
      type: String,
      default: "CNY",
      uppercase: true,
      trim: true,
    },
    targetCurrency: {
      type: String,
      default: "VND",
      uppercase: true,
      trim: true,
    },
    rate: {
      type: Number,
      required: [true, "Exchange rate is required"],
      min: [1, "Rate must be positive"],
    },
    // 'auto' = fetched from external API, 'manual' = set by admin/manager
    source: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    // Name of the external API used (for traceability)
    apiSource: {
      type: String,
      default: null,
    },
    // True when this record is the currently active rate
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Who made the last manual override (userId)
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    note: {
      type: String,
      default: null,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Only one active rate at a time
exchangeRateSchema.index(
  { baseCurrency: 1, targetCurrency: 1, isActive: 1 },
  { unique: false }
);

/**
 * Static: return the current active CNY→VND rate (Number).
 * Falls back to 3500 if no record exists.
 */
exchangeRateSchema.statics.getCurrent = async function () {
  const record = await this.findOne({
    baseCurrency: "CNY",
    targetCurrency: "VND",
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .lean();

  return record?.rate ?? 3500;
};

export default mongoose.model("ExchangeRate", exchangeRateSchema);
