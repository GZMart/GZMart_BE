import mongoose from "mongoose";

const topupRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    description: "Số tiền VND thanh toán qua PayOS",
  },
  coinAmount: {
    type: Number,
    required: true,
    description: "Số xu (Reward Points) sẽ được cộng vào ví",
  },
  orderCode: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ["pending", "completed", "failed"],
    default: "pending",
  },
  payosCheckoutUrl: String,
  payosQrCode: String,
  payosPaymentLinkId: String,
}, { timestamps: true });

const TopupRequest = mongoose.model("TopupRequest", topupRequestSchema);

export default TopupRequest;
