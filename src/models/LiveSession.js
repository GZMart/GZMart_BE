import mongoose from "mongoose";

const liveSessionSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, trim: true, default: "Live stream" },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended", "cancelled"],
      default: "scheduled",
      index: true,
    },
    liveKitRoomName: { type: String, trim: true, unique: true, sparse: true },
    liveKitToken: { type: String, select: false },
    startedAt: { type: Date },
    endedAt: { type: Date },
    viewerCount: { type: Number, default: 0 },
    products: [{ type: mongoose.Types.ObjectId, ref: "Product" }],
    pinnedProduct: { type: mongoose.Types.ObjectId, ref: "Product", default: null },
    vouchers: [{ type: mongoose.Types.ObjectId, ref: "Voucher" }],
    orderSyntax: {
      enabled: { type: Boolean, default: false },
      prefix: { type: String, trim: true, default: "" },
      productId: { type: mongoose.Types.ObjectId, ref: "Product", default: null },
      // Which product tiers buyers can specify in the chat message.
      // Each entry: { name: "Color", options: ["Vàng", "Xanh"] }
      // Buyer types: #prefix  Vàng  Xanh  2
      variantTiers: {
        type: [
          {
            name: { type: String, trim: true },
            options: { type: [String], default: [] },
          },
        ],
        default: null,
      },
    },
  },
  { timestamps: true }
);

liveSessionSchema.index({ shopId: 1, status: 1 });

export default mongoose.model("LiveSession", liveSessionSchema);
