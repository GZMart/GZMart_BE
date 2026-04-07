import mongoose from "mongoose";

const disputeEvidenceSchema = new mongoose.Schema(
  {
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DisputeReport",
      required: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    uploadedByRole: {
      type: String,
      enum: ["buyer", "seller", "admin"],
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      trim: true,
      default: null,
    },
    mimeType: {
      type: String,
      trim: true,
      default: null,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: [1000, "Evidence caption cannot exceed 1000 characters"],
    },
    source: {
      type: String,
      enum: ["buyer", "seller", "admin"],
      default: "buyer",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

disputeEvidenceSchema.index({ reportId: 1, createdAt: 1 });

export default mongoose.model("DisputeEvidence", disputeEvidenceSchema);
