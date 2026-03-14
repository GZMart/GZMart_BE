import mongoose from "mongoose";

const { Schema } = mongoose;

const sellerApplicationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required for seller application"],
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "approved", "rejected"],
        message: "{VALUE} is not a valid seller application status",
      },
      default: "pending",
      required: true,
    },
    adminReviewer: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: [1000, "Review note cannot exceed 1000 characters"],
    },
  },
  {
    timestamps: true,
  },
);

// Ensure a user can have only one pending application at a time
sellerApplicationSchema.index({ user: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });

const SellerApplication = mongoose.model("SellerApplication", sellerApplicationSchema);

export default SellerApplication;

