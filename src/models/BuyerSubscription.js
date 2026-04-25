import mongoose from "mongoose";

const buyerSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      default: "active",
    },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true, index: true },
    lastPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPayment",
    },
  },
  { timestamps: true }
);

buyerSubscriptionSchema.index({ userId: 1, status: 1 });

export default mongoose.model("BuyerSubscription", buyerSubscriptionSchema);
