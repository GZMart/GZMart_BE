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
    aiScreening: {
      status: {
        type: String,
        enum: ["pending", "complete", "failed", "skipped"],
        default: "pending",
      },
      provider: { type: String, trim: true },
      recommendation: {
        type: String,
        enum: ["likely_approve", "likely_reject", "needs_human"],
      },
      confidence: { type: Number, min: 0, max: 1 },
      flags: [{ type: String, trim: true }],
      summary: { type: String, trim: true, maxlength: 2000 },
      localChecks: [
        {
          code: { type: String, trim: true },
          passed: { type: Boolean },
          detail: { type: String, trim: true },
        },
      ],
      error: { type: String, trim: true, maxlength: 1000 },
      evaluatedAt: { type: Date },
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

