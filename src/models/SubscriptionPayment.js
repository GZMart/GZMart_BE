import mongoose from "mongoose";

const subscriptionPaymentSchema = new mongoose.Schema(
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
    orderCode: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    payosCheckoutUrl: String,
    payosQrCode: String,
    payosPaymentLinkId: String,
  },
  { timestamps: true }
);

export default mongoose.model("SubscriptionPayment", subscriptionPaymentSchema);
