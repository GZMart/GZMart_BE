import mongoose from "mongoose";

const comboPromotionSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Combo name is required"],
      trim: true,
      maxlength: 100,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    comboType: {
      type: String,
      enum: ["percent", "fixed_price", "special_price"],
      required: true,
      default: "percent",
    },
    // Tiers: Buy quantity X, get value Y
    tiers: [
      {
        quantity: { type: Number, required: true, min: 1 },
        value: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],
    orderLimit: {
      type: Number,
      default: 0, // 0 means unlimited
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    status: {
      type: String,
      enum: ["upcoming", "active", "ended", "cancelled"],
      default: "upcoming",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
comboPromotionSchema.index({ sellerId: 1, status: 1 });
comboPromotionSchema.index({ startDate: 1, endDate: 1 });

// Pre-save status update (borrowed from ShopProgram logic)
comboPromotionSchema.pre("save", async function () {
  if (this.status === "cancelled") return;

  const now = new Date();
  if (now < this.startDate) {
    this.status = "upcoming";
  } else if (now >= this.startDate && now <= this.endDate) {
    this.status = "active";
  } else if (now > this.endDate) {
    this.status = "ended";
  }
});

// Validation
comboPromotionSchema.pre("validate", async function () {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    this.invalidate("endDate", "End date must be after start date");
  }
});

const ComboPromotion = mongoose.model("ComboPromotion", comboPromotionSchema);
export default ComboPromotion;
