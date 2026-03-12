import mongoose from "mongoose";

const savedVoucherSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Each user can save a voucher only once
savedVoucherSchema.index({ userId: 1, voucherId: 1 }, { unique: true });
savedVoucherSchema.index({ userId: 1 });

const SavedVoucher = mongoose.model("SavedVoucher", savedVoucherSchema);

export default SavedVoucher;
