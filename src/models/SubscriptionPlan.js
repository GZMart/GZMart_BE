import mongoose from "mongoose";

const dailySlotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    discountType: {
      type: String,
      enum: ["amount", "percent", "coin"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscountAmount: { type: Number, min: 0, default: null },
    minBasketPrice: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, default: "GZMart VIP" },
    priceVnd: { type: Number, required: true, min: 1 },
    durationDays: { type: Number, required: true, min: 1, default: 30 },
    isActive: { type: Boolean, default: true },
    dailySlots: { type: [dailySlotSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
