import mongoose from "mongoose";

const reportHistorySchema = new mongoose.Schema(
  {
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DisputeReport",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "created",
        "counter_report_submitted",
        "status_changed",
        "appealed",
        "refund_triggered",
        "product_hidden",
        "note_added",
      ],
      required: true,
      index: true,
    },
    fromStatus: {
      type: String,
      default: null,
    },
    toStatus: {
      type: String,
      default: null,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["buyer", "seller", "admin"],
      required: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [5000, "History note cannot exceed 5000 characters"],
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

reportHistorySchema.index({ reportId: 1, createdAt: 1 });

export default mongoose.model("ReportHistory", reportHistorySchema);
